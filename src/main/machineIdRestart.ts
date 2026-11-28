import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { readFile, writeFile, unlink, mkdir, access } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { app } from 'electron'
import { sleep } from '../shared/async'

let prepareExit: (() => Promise<void>) | undefined
let beforeExit: () => void = () => {}
let restarting: Promise<boolean> | undefined
export function configureAdminRestart(
  prepare: () => Promise<void>,
  finish: () => void = () => {}
): void {
  prepareExit = prepare
  beforeExit = finish
}
/** Carry the existing app profile across an explicitly requested elevated restart. */
export function restoreRestartProfile(): void {
  const value = process.argv
    .find((arg) => arg.startsWith('--kiro-machine-id-profile='))
    ?.split('=')
    .slice(1)
    .join('=')
  if (value && isAbsolute(value)) app.setPath('userData', value)
}
const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`
const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
/** The elevated helper acknowledges authorization, then waits for this process to finish saving and exit. */
export function requestAdminRestart(powershell?: string | null): Promise<boolean> {
  return (restarting ??= restart(powershell).finally(() => {
    restarting = undefined
  }))
}
async function restart(powershell?: string | null): Promise<boolean> {
  if (!prepareExit) return false
  const executable = app.getPath('exe'),
    token = randomUUID()
  const marker = join(app.getPath('userData'), `machine-id-restart-${token}`)
  const args = [
    ...(process.defaultApp ? [app.getAppPath()] : []),
    `--kiro-machine-id-profile=${app.getPath('userData')}`
  ]
  let launched = false,
    failure: Error | undefined
  try {
    await access(executable)
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(marker, `${token}:pending`, { flag: 'wx', mode: 0o600 })
    if (process.platform === 'win32') {
      if (!powershell) return false
      const script = `$ErrorActionPreference='Stop'; $marker=${psQuote(marker)}; $token=${psQuote(token)}; $exe=${psQuote(executable)}; if(!(Test-Path -LiteralPath $exe)){exit 1}; [IO.File]::WriteAllText($marker,$token+':ready'); $end=(Get-Date).AddMinutes(2); while(Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue){if((Get-Date)-gt $end){exit 1}; if(!(Test-Path -LiteralPath $marker)){exit 1}; if([IO.File]::ReadAllText($marker)-eq($token+':cancel')){exit 1}; Start-Sleep -Milliseconds 100}; if([IO.File]::ReadAllText($marker)-eq($token+':exit')){Remove-Item -LiteralPath $marker; Start-Process -FilePath $exe -ArgumentList @(${args.map((arg) => psQuote('"' + arg + '"')).join(',')})}`
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const command = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${psQuote(powershell)} -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}' -Verb RunAs -ErrorAction Stop | Out-Null`
      await promisify(execFile)(
        powershell,
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { timeout: 120000, windowsHide: true }
      )
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      const script = `marker=$1; token=$2; parent_pid=$3; binary=$4; shift 4; test -x "$binary" || exit 1; printf '%s' "$token:ready" > "$marker"; count=0; while kill -0 "$parent_pid" 2>/dev/null; do test -f "$marker" || exit 1; test "$(cat "$marker")" = "$token:cancel" && exit 1; count=$((count+1)); test "$count" -lt 1200 || exit 1; sleep 0.1; done; test "$(cat "$marker")" = "$token:exit" || exit 1; rm -f "$marker"; exec "$binary" "$@"`
      const parameters = [
        'sh',
        '-c',
        script,
        'machine-id-restart',
        marker,
        token,
        String(process.pid),
        executable,
        ...args
      ]
      let file: string, launchArgs: string[]
      if (process.platform === 'darwin') {
        const command = parameters.map(shellQuote).join(' ')
        file = 'osascript'
        launchArgs = [
          '-e',
          `do shell script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`
        ]
      } else {
        file = ''
        for (const candidate of ['pkexec', 'gksudo', 'kdesudo'])
          try {
            await promisify(execFile)('which', [candidate], { timeout: 3000 })
            file = candidate
            break
          } catch {
            /* Preserve available elevation-tool fallback order. */
          }
        if (!file) return false
        launchArgs = parameters
      }
      const child = spawn(file, launchArgs, { detached: true, stdio: 'ignore' })
      child.once('error', (error) => {
        failure = error
      })
      child.once('exit', (code) => {
        if (code !== 0) failure = new Error('授权或重启助手启动失败')
      })
      child.unref()
    } else return false
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (failure) throw failure
      const state = await readFile(marker, 'utf8')
      if (state === `${token}:ready`) break
      await sleep(100)
    }
    if ((await readFile(marker, 'utf8')) !== `${token}:ready`) throw new Error('等待授权重启超时')
    await prepareExit()
    await writeFile(marker, `${token}:exit`, { mode: 0o600 })
    launched = true
    // The helper waits for process exit, so the existing single-instance lock cannot reject the replacement.
    beforeExit()
    app.exit(0)
    return true
  } catch (error) {
    console.error('[MachineId] Admin restart was not completed:', error)
    await writeFile(marker, `${token}:cancel`).catch(() => {})
    return false
  } finally {
    if (!launched) await unlink(marker).catch(() => {})
  }
}
