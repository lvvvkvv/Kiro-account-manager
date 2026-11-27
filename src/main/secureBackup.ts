// 自动备份使用用户数据目录中的随机密钥，不依赖钥匙串或应用签名。
// Electron safeStorage 仅用于主数据缺失时恢复旧版备份，原 .enc 始终保留。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const LOCAL_NAME = 'kiro-accounts.backup.local.enc'
const KEY_NAME = 'kiro-accounts.backup.key'
const LEGACY_ENC_NAME = 'kiro-accounts.backup.enc'
const LEGACY_JSON_NAME = 'kiro-accounts.backup.json'
const HEADER = Buffer.from('KAMBACKUP\x01')
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const operations = new Map<string, Promise<unknown>>()

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

// 同目录的读写及迁移串行执行，防止首次备份并发生成不同的密钥或乱序覆盖。
async function serialized<T>(dir: string, operation: () => Promise<T>): Promise<T> {
  const directory = path.resolve(dir)
  const previous = operations.get(directory) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  operations.set(directory, current)
  try {
    return await current
  } finally {
    if (operations.get(directory) === current) operations.delete(directory)
  }
}

async function replaceBackupFile(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      // Windows 可能在其他读取者或扫描程序持有文件时暂时拒绝替换，不能先删除原备份。
      const code = (error as NodeJS.ErrnoException).code
      if (
        process.platform !== 'win32' ||
        attempt >= 9 ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')
      ) {
        throw error
      }
      await delay(25 * (attempt + 1))
    }
  }
}

// 写入并同步临时文件后才发布。密钥使用硬链接发布，绝不覆盖已存在的密钥。
async function atomicWrite(file: string, data: Buffer, replace = true): Promise<void> {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  try {
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (replace) await replaceBackupFile(temporary, file)
    else await fs.link(temporary, file)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

async function readKey(dir: string): Promise<Buffer | null> {
  const file = path.join(dir, KEY_NAME)
  try {
    if (process.platform !== 'win32') await fs.chmod(file, 0o600)
    const key = await fs.readFile(file)
    if (key.length !== KEY_BYTES) {
      throw new Error('本地备份密钥无效，已保留原文件；请恢复原密钥文件。')
    }
    return key
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function getKey(dir: string, allowCreate: boolean): Promise<Buffer> {
  const existing = await readKey(dir)
  if (existing) return existing
  if (!allowCreate) {
    throw new Error('本地备份密钥缺失，已保留原备份；请恢复 kiro-accounts.backup.key。')
  }
  const key = randomBytes(KEY_BYTES)
  try {
    await atomicWrite(path.join(dir, KEY_NAME), key, false)
    return key
  } catch (error) {
    // 另一个进程可能已发布密钥，必须读取它，不能覆盖。
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const published = await readKey(dir)
    if (!published) throw error
    return published
  }
}

function encrypt(json: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(HEADER)
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  return Buffer.concat([HEADER, iv, cipher.getAuthTag(), encrypted])
}

function decrypt(data: Buffer, key: Buffer): string {
  try {
    if (
      data.length < HEADER.length + IV_BYTES + TAG_BYTES ||
      !data.subarray(0, HEADER.length).equals(HEADER)
    ) {
      throw new Error('Invalid backup format')
    }
    const ivEnd = HEADER.length + IV_BYTES
    const tagEnd = ivEnd + TAG_BYTES
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(HEADER.length, ivEnd))
    decipher.setAAD(HEADER)
    decipher.setAuthTag(data.subarray(ivEnd, tagEnd))
    return Buffer.concat([decipher.update(data.subarray(tagEnd)), decipher.final()]).toString(
      'utf8'
    )
  } catch {
    throw new Error('本地备份校验失败或密钥不匹配，已保留原备份和密钥。')
  }
}

function parseBackup(json: string): unknown {
  try {
    const data = JSON.parse(json) as { accounts?: unknown } | null
    if (
      !data ||
      typeof data !== 'object' ||
      !data.accounts ||
      typeof data.accounts !== 'object' ||
      Array.isArray(data.accounts)
    ) {
      throw new Error('Invalid account data')
    }
    return data
  } catch {
    throw new Error('备份缺少有效的账号数据，原文件已保留。')
  }
}

async function writeLocalBackup(dir: string, json: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, LOCAL_NAME)
  const existing = await readOptional(file)
  const key = await getKey(dir, existing === null)
  // 密钥丢失或不匹配时禁止覆盖旧备份，也不生成替代密钥。
  if (existing) decrypt(existing, key)
  await atomicWrite(file, encrypt(json, key))
  if (decrypt(await fs.readFile(file), key) !== json) {
    throw new Error('本地备份写入验证失败，已保留旧版备份。')
  }
  // 验证成功后清理旧明文；safeStorage 的 .enc 保留以供回退。
  try {
    await fs.unlink(path.join(dir, LEGACY_JSON_NAME))
  } catch (error) {
    if (!isMissing(error)) console.warn('[Backup] Could not remove legacy plaintext backup:', error)
  }
}

/** 主数据可用时直接写本地备份，无需读取旧钥匙串。失败时不回退明文。 */
export async function writeSecureBackup(dir: string, data: unknown): Promise<void> {
  // 排队前序列化，保存调用时的数据快照。
  const json = JSON.stringify(data)
  if (json === undefined) throw new Error('备份数据不能为空。')
  parseBackup(json)
  await serialized(dir, () => writeLocalBackup(dir, json))
}

/** 优先读本地备份；只有旧版 .enc 实际存在时才加载 safeStorage。 */
export async function readSecureBackup(dir: string): Promise<unknown | null> {
  return serialized(dir, async () => {
    const local = await readOptional(path.join(dir, LOCAL_NAME))
    if (local) return parseBackup(decrypt(local, await getKey(dir, false)))

    const legacyEncrypted = await readOptional(path.join(dir, LEGACY_ENC_NAME))
    let json: string
    if (legacyEncrypted) {
      try {
        const { safeStorage } = await import('electron')
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Keychain unavailable')
        json = safeStorage.decryptString(legacyEncrypted)
      } catch {
        throw new Error(
          '旧版备份解密失败或未获钥匙串授权，原备份已保留。请重启应用后允许访问，或恢复主数据文件。'
        )
      }
    } else {
      const legacyPlaintext = await readOptional(path.join(dir, LEGACY_JSON_NAME))
      if (!legacyPlaintext) return null
      json = legacyPlaintext.toString('utf8')
    }
    const data = parseBackup(json)
    await writeLocalBackup(dir, json)
    return data
  })
}

/** 正常升级优先使用主数据，只有主数据缺失时才恢复/迁移备份。 */
export async function initializeAccountBackup(
  dir: string,
  mainData: unknown
): Promise<unknown | null> {
  if (mainData == null) return readSecureBackup(dir)
  try {
    await writeSecureBackup(dir, mainData)
  } catch (error) {
    // 备份不可写不应阻止读取仍然完好的主数据。
    console.error('[Store] Failed to create local backup; main data retained:', error)
  }
  return mainData
}
