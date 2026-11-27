/* eslint @typescript-eslint/explicit-function-return-type: "off" -- JavaScript test helpers. */
import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDecipheriv, randomBytes } from 'node:crypto'
import Conf from 'conf'
import { build } from 'esbuild'

const LOCAL = 'kiro-accounts.backup.local.enc'
const KEY = 'kiro-accounts.backup.key'
const LEGACY = 'kiro-accounts.backup.enc'
const PLAIN = 'kiro-accounts.backup.json'
const control = (globalThis.__secureBackupTest = {})
const sample = {
  accounts: {
    first: {
      id: 'first',
      credentials: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
    },
    second: { id: 'second', credentials: { clientSecret: 'fixture-secret' } }
  },
  groups: { group: { name: '原有分组' } },
  tags: { tag: { name: '原有标签' } },
  activeAccountId: 'first',
  proxyPool: { proxy: { password: 'fixture-proxy-password' } },
  autoRefreshEnabled: false,
  language: 'zh'
}

beforeEach(() =>
  Object.assign(control, {
    available: true,
    denied: false,
    calls: 0,
    decrypts: 0,
    failRename: false
  })
)

const { outputFiles } = await build({
  entryPoints: ['src/main/secureBackup.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'isolated-keychain-and-disk-faults',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'fixture'
        }))
        builder.onResolve({ filter: /^node:fs\/promises$/ }, (args) =>
          args.namespace === 'fixture' ? undefined : { path: 'fs', namespace: 'fixture' }
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
          loader: 'js',
          contents:
            name === 'electron'
              ? `
          export const safeStorage = {
            isEncryptionAvailable() {
              const c = globalThis.__secureBackupTest;
              c.calls++;
              return c.available;
            },
            decryptString(buffer) {
              const c = globalThis.__secureBackupTest;
              c.decrypts++;
              if (c.denied) throw Error('permission denied');
              if (buffer.subarray(0, 3).toString() !== 'v10') throw Error('bad legacy fixture');
              return buffer.subarray(3).toString();
            }
          };
        `
              : `
          export * from 'node:fs/promises';
          import { rename as realRename } from 'node:fs/promises';
          export async function rename(from, to) {
            if (globalThis.__secureBackupTest.failRename) throw Object.assign(Error('disk failure'), {code:'EIO'});
            return realRename(from, to);
          }
        `
        }))
      }
    }
  ]
})
let moduleNumber = 0
const freshModule = () =>
  import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text + '\n//' + moduleNumber++).toString('base64')}`
  )
const backup = await freshModule()

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-local-backup-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

async function legacy(dir, data = sample) {
  const bytes = Buffer.from('v10' + JSON.stringify(data))
  await fs.writeFile(path.join(dir, LEGACY), bytes)
  return bytes
}

async function absent(file) {
  await assert.rejects(fs.stat(file), { code: 'ENOENT' })
}

test('fresh install does not load Keychain or create empty backups', async (t) => {
  const dir = await directory(t)
  assert.equal(await backup.initializeAccountBackup(dir, undefined), null)
  assert.equal(control.calls, 0)
  assert.deepEqual(await fs.readdir(dir), [])
})

test('existing primary store retains all accounts and settings without any Keychain access', async (t) => {
  const dir = await directory(t)
  const store = new Conf({
    cwd: dir,
    configName: 'kiro-accounts',
    encryptionKey: 'kiro-account-manager-secret-key'
  })
  store.set('accountData', sample)
  store.set('traySettings', { enabled: true })
  const primaryBefore = await fs.readFile(store.path)
  const oldBackup = await legacy(dir, { accounts: {} })
  control.available = false

  assert.deepEqual(await backup.initializeAccountBackup(dir, store.get('accountData')), sample)
  assert.deepEqual(await fs.readFile(store.path), primaryBefore)
  assert.deepEqual(await fs.readFile(path.join(dir, LEGACY)), oldBackup)
  assert.equal(store.get('traySettings').enabled, true)
  assert.equal(control.calls, 0)
  assert.deepEqual(await backup.readSecureBackup(dir), sample)
  const reopened = new Conf({
    cwd: dir,
    configName: 'kiro-accounts',
    encryptionKey: 'kiro-account-manager-secret-key'
  })
  assert.deepEqual(reopened.get('accountData'), sample)
})

test('backup uses authenticated encryption, private files and a persistent key across restarts', async (t) => {
  const dir = await directory(t)
  await backup.writeSecureBackup(dir, sample)
  const key = await fs.readFile(path.join(dir, KEY))
  const first = await fs.readFile(path.join(dir, LOCAL))
  assert.equal(key.length, 32)
  for (const value of [
    'fixture-access',
    'fixture-refresh',
    'fixture-secret',
    'fixture-proxy-password'
  ]) {
    assert.equal(first.includes(value), false)
  }
  // Independent decryption verifies the on-disk format and GCM authentication.
  const headerLength = Buffer.byteLength('KAMBACKUP\x01')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    first.subarray(headerLength, headerLength + 12)
  )
  decipher.setAAD(first.subarray(0, headerLength))
  decipher.setAuthTag(first.subarray(headerLength + 12, headerLength + 28))
  const json = Buffer.concat([decipher.update(first.subarray(headerLength + 28)), decipher.final()])
  assert.deepEqual(JSON.parse(json), sample)
  if (process.platform !== 'win32') {
    for (const file of [KEY, LOCAL])
      assert.equal((await fs.stat(path.join(dir, file))).mode & 0o777, 0o600)
  }
  const restarted = await freshModule()
  assert.deepEqual(await restarted.readSecureBackup(dir), sample)
  await restarted.writeSecureBackup(dir, sample)
  assert.deepEqual(await fs.readFile(path.join(dir, KEY)), key)
  assert.notDeepEqual(await fs.readFile(path.join(dir, LOCAL)), first)
  assert.equal(control.calls, 0)
  await absent(path.join(dir, PLAIN))
})

test('legacy encrypted backup is migrated once; old ciphertext is retained', async (t) => {
  const dir = await directory(t)
  const old = await legacy(dir)
  assert.deepEqual(await backup.initializeAccountBackup(dir, undefined), sample)
  assert.equal(control.calls, 1)
  assert.equal(control.decrypts, 1)
  assert.deepEqual(await fs.readFile(path.join(dir, LEGACY)), old)
  control.available = false
  const restarted = await freshModule()
  assert.deepEqual(await restarted.initializeAccountBackup(dir, undefined), sample)
  await restarted.writeSecureBackup(dir, sample)
  assert.equal(control.calls, 1)
  assert.equal(control.decrypts, 1)
})

test('legacy plaintext migrates without Keychain and is removed after successful verification', async (t) => {
  const dir = await directory(t)
  await fs.writeFile(path.join(dir, PLAIN), JSON.stringify(sample))
  assert.deepEqual(await backup.readSecureBackup(dir), sample)
  assert.deepEqual(await backup.readSecureBackup(dir), sample)
  assert.equal(control.calls, 0)
  await absent(path.join(dir, PLAIN))
})

for (const reason of ['unavailable', 'denied']) {
  test(`legacy Keychain ${reason} preserves original data and does not create an empty replacement`, async (t) => {
    const dir = await directory(t)
    const old = await legacy(dir)
    control.available = reason !== 'unavailable'
    control.denied = reason === 'denied'
    await assert.rejects(backup.initializeAccountBackup(dir, undefined), /原备份已保留/)
    assert.deepEqual(await fs.readFile(path.join(dir, LEGACY)), old)
    await absent(path.join(dir, LOCAL))
    await absent(path.join(dir, KEY))
  })
}

for (const contents of ['{broken', 'null', '{"accounts":[]}']) {
  test(`invalid legacy plaintext is retained: ${contents}`, async (t) => {
    const dir = await directory(t)
    await fs.writeFile(path.join(dir, PLAIN), contents)
    await assert.rejects(backup.readSecureBackup(dir), /原文件已保留/)
    assert.equal(await fs.readFile(path.join(dir, PLAIN), 'utf8'), contents)
    await absent(path.join(dir, LOCAL))
    await absent(path.join(dir, KEY))
  })
}

for (const part of ['header', 'iv', 'tag', 'ciphertext', 'truncated']) {
  test(`tampered ${part} cannot be read, overwritten or silently restored from an older backup`, async (t) => {
    const dir = await directory(t)
    await backup.writeSecureBackup(dir, sample)
    await legacy(dir, { accounts: {} })
    const key = await fs.readFile(path.join(dir, KEY))
    const bytes = await fs.readFile(path.join(dir, LOCAL))
    const offsets = { header: 0, iv: 10, tag: 22, ciphertext: bytes.length - 1 }
    const damaged = part === 'truncated' ? bytes.subarray(0, 5) : Buffer.from(bytes)
    if (part !== 'truncated') damaged[offsets[part]] ^= 1
    await fs.writeFile(path.join(dir, LOCAL), damaged)
    await assert.rejects(backup.readSecureBackup(dir), /校验失败/)
    await assert.rejects(backup.writeSecureBackup(dir, { accounts: {} }), /校验失败/)
    assert.deepEqual(await fs.readFile(path.join(dir, LOCAL)), damaged)
    assert.deepEqual(await fs.readFile(path.join(dir, KEY)), key)
    assert.equal(control.calls, 0)
  })
}

for (const keyState of ['missing', 'invalid-length', 'wrong-key']) {
  test(`${keyState} never regenerates a key or replaces a recoverable backup`, async (t) => {
    const dir = await directory(t)
    await backup.writeSecureBackup(dir, sample)
    const original = await fs.readFile(path.join(dir, LOCAL))
    const keyPath = path.join(dir, KEY)
    const damagedKey = keyState === 'invalid-length' ? Buffer.alloc(1) : randomBytes(32)
    if (keyState === 'missing') await fs.unlink(keyPath)
    else await fs.writeFile(keyPath, damagedKey)
    await assert.rejects(backup.readSecureBackup(dir))
    await assert.rejects(backup.writeSecureBackup(dir, sample))
    assert.deepEqual(await fs.readFile(path.join(dir, LOCAL)), original)
    if (keyState === 'missing') await absent(keyPath)
    else assert.deepEqual(await fs.readFile(keyPath), damagedKey)
    assert.equal(control.calls, 0)
  })
}

test('concurrent writes keep one key, preserve invocation snapshots and commit the latest data', async (t) => {
  const dir = await directory(t)
  const data = { accounts: {}, revision: 0 }
  const writes = []
  for (let revision = 0; revision < 20; revision++) {
    data.revision = revision
    writes.push(backup.writeSecureBackup(dir, data))
  }
  data.revision = 999
  await Promise.all(writes)
  assert.deepEqual(await backup.readSecureBackup(dir), { accounts: {}, revision: 19 })
  assert.equal((await fs.readFile(path.join(dir, KEY))).length, 32)
  assert.deepEqual((await fs.readdir(dir)).sort(), [KEY, LOCAL].sort())
})

test('independent instances cannot publish conflicting first-use keys', async (t) => {
  const dir = await directory(t)
  const instances = await Promise.all(Array.from({ length: 4 }, freshModule))
  await Promise.all(instances.map((instance) => instance.writeSecureBackup(dir, sample)))
  assert.deepEqual(await backup.readSecureBackup(dir), sample)
  assert.deepEqual((await fs.readdir(dir)).sort(), [KEY, LOCAL].sort())
})

test('failed atomic replacement preserves previous ciphertext, key and plaintext recovery copy', async (t) => {
  const dir = await directory(t)
  await backup.writeSecureBackup(dir, sample)
  const original = await fs.readFile(path.join(dir, LOCAL))
  const key = await fs.readFile(path.join(dir, KEY))
  await fs.writeFile(path.join(dir, PLAIN), JSON.stringify(sample))
  control.failRename = true
  await assert.rejects(backup.writeSecureBackup(dir, { accounts: {} }), { code: 'EIO' })
  assert.deepEqual(await fs.readFile(path.join(dir, LOCAL)), original)
  assert.deepEqual(await fs.readFile(path.join(dir, KEY)), key)
  assert.equal(await fs.readFile(path.join(dir, PLAIN), 'utf8'), JSON.stringify(sample))
  assert.equal(
    (await fs.readdir(dir)).some((file) => file.endsWith('.tmp')),
    false
  )
  control.failRename = false
  await backup.writeSecureBackup(dir, sample)
  assert.deepEqual(await backup.readSecureBackup(dir), sample)
})

test('failed legacy migration retains the only original backup and can be retried', async (t) => {
  const dir = await directory(t)
  const old = await legacy(dir)
  control.failRename = true
  await assert.rejects(backup.readSecureBackup(dir), { code: 'EIO' })
  assert.deepEqual(await fs.readFile(path.join(dir, LEGACY)), old)
  await absent(path.join(dir, LOCAL))
  const key = await fs.readFile(path.join(dir, KEY))
  control.failRename = false
  assert.deepEqual(await backup.readSecureBackup(dir), sample)
  assert.deepEqual(await fs.readFile(path.join(dir, KEY)), key)
})

test('backup disk failure still allows intact primary accounts to load', async (t) => {
  const dir = await directory(t)
  control.failRename = true
  t.mock.method(console, 'error', () => {})
  assert.equal(await backup.initializeAccountBackup(dir, sample), sample)
  assert.equal(control.calls, 0)
  await absent(path.join(dir, LOCAL))
  await absent(path.join(dir, PLAIN))
})
