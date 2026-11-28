/** OS machine identifiers; file and child-process work never block Electron's main thread. */
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { app, dialog } from 'electron'
import { normalizeMachineId, type MachineIdResult, type OSType } from '../shared/machineId'
export type { MachineIdResult, OSType } from '../shared/machineId'
import { requestAdminRestart as restartAdmin } from './machineIdRestart'
export async function requestAdminRestart(): Promise<boolean> {
  return restartAdmin(process.platform === 'win32' ? await findPowerShell() : undefined)
}

const runFile = promisify(execFile)
const run = (file: string, args: string[], timeout = 10000): Promise<{ stdout: string }> =>
  runFile(file, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 1024 * 1024 })
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'
const text = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const permission = (error: unknown): boolean =>
  /EACCES|EPERM|access is denied|permission denied|operation not permitted|拒绝访问/i.test(
    text(error)
  )
let powershell: Promise<string | null> | undefined
export function findPowerShell(): Promise<string | null> {
  return (powershell ??= (async () => {
    const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
    const candidates = [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe'),
      path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      path.join(root, 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe')
    ]
    for (const candidate of candidates)
      if (candidate) {
        try {
          await fs.access(candidate)
          return candidate
        } catch {
          /* Probe the next installed executable. */
        }
      }
    for (const name of ['pwsh.exe', 'powershell.exe']) {
      try {
        const { stdout } = await run('where.exe', [name], 3000)
        const found = stdout
          .split(/\r?\n/)
          .find((line) => line.trim())
          ?.trim()
        if (found) {
          await fs.access(found)
          return found
        }
      } catch {
        /* PATH may not contain either PowerShell edition. */
      }
    }
    return null
  })())
}
export function getOSType(): OSType {
  return process.platform === 'win32'
    ? 'windows'
    : process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'linux'
        ? 'linux'
        : 'unknown'
}
export function generateRandomMachineId(): string {
  return randomUUID().toLowerCase()
}
let admin: Promise<boolean> | undefined
export function checkAdminPrivilege(): Promise<boolean> {
  return (admin ??= (async () => {
    if (process.platform === 'darwin') return true
    if (process.platform === 'linux') return process.getuid?.() === 0
    if (process.platform !== 'win32') return false
    const ps = await findPowerShell()
    if (ps)
      try {
        const { stdout } = await run(
          ps,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
          ],
          5000
        )
        if (/^(true|false)$/i.test(stdout.trim())) return stdout.trim().toLowerCase() === 'true'
      } catch {
        /* Fall back to the existing net session probe. */
      }
    try {
      await run('net.exe', ['session'], 3000)
      return true
    } catch {
      return false
    }
  })())
}
async function readId(file: string): Promise<string | null> {
  try {
    return normalizeMachineId(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}
async function readCurrent(): Promise<MachineIdResult> {
  try {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await run(
          'reg.exe',
          ['query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
          5000
        )
        const id = normalizeMachineId(stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)?.[1])
        if (id) return { success: true, machineId: id }
      } catch {
        /* Preserve the Windows fallback order. */
      }
      const ps = await findPowerShell()
      if (ps)
        try {
          const { stdout } = await run(ps, [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid"
          ])
          const id = normalizeMachineId(stdout)
          if (id) return { success: true, machineId: id }
        } catch {
          /* WMIC is the last read-only fallback. */
        }
      const { stdout } = await run('wmic.exe', ['csproduct', 'get', 'UUID'], 5000)
      const id = stdout
        .split(/\r?\n/)
        .map(normalizeMachineId)
        .find((value) => value && value !== 'ffffffff-ffff-ffff-ffff-ffffffffffff')
      if (id) return { success: true, machineId: id }
    } else if (process.platform === 'darwin') {
      for (const file of [overridePath(), kiroPath()]) {
        const id = await readId(file)
        if (id) return { success: true, machineId: id }
      }
      const { stdout } = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
      const id = normalizeMachineId(stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1])
      if (id) return { success: true, machineId: id }
    } else if (process.platform === 'linux') {
      for (const file of linuxPaths) {
        try {
          const id = await readId(file)
          if (id) return { success: true, machineId: id }
        } catch {
          /* A readable valid secondary file is still a legitimate read source. */
        }
      }
    }
    return { success: false, error: '无法获取有效的机器码' }
  } catch (error) {
    return { success: false, error: text(error) }
  }
}
const linuxPaths = ['/etc/machine-id', '/var/lib/dbus/machine-id']
const overridePath = (): string => path.join(app.getPath('userData'), 'machine-id-override')
const kiroPath = (): string => path.join(homedir(), 'Library/Application Support/Kiro/machineid')
let mutationTail: Promise<unknown> = Promise.resolve()
let reading: Promise<MachineIdResult> | undefined
export function getCurrentMachineId(): Promise<MachineIdResult> {
  if (reading) return reading
  const task = mutationTail
    .catch(() => {})
    .then(readCurrent)
    .finally(() => {
      if (reading === task) reading = undefined
    })
  reading = task
  return task
}
export function setMachineId(input: unknown): Promise<MachineIdResult> {
  const id = normalizeMachineId(input)
  if (!id) return Promise.resolve({ success: false, error: '无效的机器码格式' })
  const work = mutationTail
    .catch(() => {})
    .then(async (): Promise<MachineIdResult> => {
      try {
        if (process.platform === 'win32') {
          await run('reg.exe', [
            'add',
            'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography',
            '/v',
            'MachineGuid',
            '/t',
            'REG_SZ',
            '/d',
            id,
            '/f'
          ])
          // Verify the actual write target, not a hardware-UUID fallback.
          const { stdout } = await run(
            'reg.exe',
            ['query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
            5000
          )
          if (normalizeMachineId(stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)?.[1]) !== id)
            throw new Error('机器码写入后验证失败')
        } else if (process.platform === 'darwin') {
          // Publish the app override only after the Kiro destination is safely written.
          const target = kiroPath(),
            override = overridePath()
          const previous = await fs.readFile(target).catch((error) => {
            if (!missing(error)) throw error
            return null
          })
          await atomicWrite(target, id)
          try {
            await atomicWrite(override, id)
          } catch (error) {
            try {
              if (previous === null) await fs.unlink(target)
              else await atomicWrite(target, previous)
            } catch (rollback) {
              throw new Error(`${text(error)}；恢复 Kiro 原值失败: ${text(rollback)}`)
            }
            throw error
          }
          if ((await readId(target)) !== id || (await readId(override)) !== id)
            throw new Error('机器码写入后验证失败')
        } else if (process.platform === 'linux') {
          // Once a primary file exists it remains the effective target, even if it is not writable.
          let primary: string | undefined
          for (const file of linuxPaths)
            try {
              await fs.access(file)
              primary = file
              break
            } catch (error) {
              if (!missing(error)) {
                primary = file
                break
              }
            }
          if (!primary) throw new Error('机器码文件不存在')
          await writeLinux(primary, id)
          if ((await readId(primary)) !== id) throw new Error('机器码写入后验证失败')
          let warning: string | undefined
          if (primary === linuxPaths[0])
            try {
              await fs.access(linuxPaths[1])
              // A symlink to the same file already reflects the primary write.
              if ((await fs.realpath(primary)) !== (await fs.realpath(linuxPaths[1])))
                await writeLinux(linuxPaths[1], id)
            } catch (error) {
              if (!missing(error)) warning = `主机器码已更新，D-Bus 同步失败: ${text(error)}`
            }
          return { success: true, machineId: id, warning }
        } else return { success: false, error: '不支持的操作系统' }
        return { success: true, machineId: id }
      } catch (error) {
        const cancelled = /dismissed|not authorized|用户取消|exit code 126/i.test(text(error))
        return {
          success: false,
          error: cancelled ? '用户取消了授权' : text(error),
          cancelled,
          requiresAdmin: !cancelled && permission(error)
        }
      }
    })
  mutationTail = work
  // Reads started after a mutation must wait for it, rather than join an older read.
  reading = undefined
  return work
}
async function atomicWrite(file: string, value: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const mode = await fs.stat(file).then(
    (info) => info.mode,
    (error) => {
      if (!missing(error)) throw error
      return 0o600
    }
  )
  try {
    await fs.writeFile(temporary, value, { mode, flag: 'wx' })
    await fs.rename(temporary, file)
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (!missing(error)) throw error
    })
  }
}
async function writeLinux(file: string, id: string): Promise<void> {
  const raw = id.replace(/-/g, '') + '\n'
  try {
    await fs.writeFile(file, raw, 'utf8')
    return
  } catch (error) {
    if (!permission(error)) throw error
  }
  // Authorize the specific file write; the desktop app can stay in the user's session.
  for (const command of ['pkexec', 'gksudo', 'kdesudo']) {
    try {
      await run('which', [command], 3000)
    } catch {
      continue
    }
    try {
      await run(command, ['sh', '-c', 'printf "%s" "$1" > "$2"', 'machine-id', raw, file], 120000)
      return
    } catch (error) {
      if (/dismissed|not authorized|126/i.test(text(error))) throw new Error('用户取消了授权')
      throw error
    }
  }
  throw new Error('EACCES: 没有可用的权限提升工具')
}
export async function backupMachineIdToFile(input: unknown, file: string): Promise<boolean> {
  const machineId = normalizeMachineId(input)
  if (!machineId) return false
  try {
    await atomicWrite(
      file,
      JSON.stringify(
        { machineId, backupTime: Date.now(), osType: getOSType(), appVersion: app.getVersion() },
        null,
        2
      )
    )
    return true
  } catch (error) {
    console.error('[MachineId] Backup failed:', error)
    return false
  }
}
export async function restoreMachineIdFromFile(file: string): Promise<MachineIdResult> {
  try {
    const data: unknown = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
    const machineId = normalizeMachineId(
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).machineId
        : undefined
    )
    return machineId ? { success: true, machineId } : { success: false, error: '备份文件格式无效' }
  } catch (error) {
    return { success: false, error: text(error) }
  }
}
export async function showAdminRequiredDialog(): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: '需要管理员权限',
    message: '修改机器码需要管理员权限',
    detail: '是否以管理员权限重新启动应用程序？',
    buttons: ['取消', '以管理员身份重启'],
    defaultId: 1,
    cancelId: 0
  })
  return result.response === 1
}
