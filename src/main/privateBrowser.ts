import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { checkAborted, sleep, waitFor } from '../shared/async'

const execute = promisify(execFile)
let browserPromise: Promise<string[]> | undefined
let browserUntil = 0
let queue: Promise<unknown> = Promise.resolve()
let lastLaunch = 0

async function windowsBrowsers(): Promise<string[]> {
  if (browserPromise && Date.now() < browserUntil) return browserPromise
  browserUntil = Date.now() + 30000
  browserPromise = (async () => {
    let preferred = ''
    try {
      const { stdout } = await execute(
        'reg.exe',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
          '/v',
          'ProgId'
        ],
        { timeout: 5000, windowsHide: true }
      )
      preferred = /Chrome|Google/i.test(stdout)
        ? 'chrome.exe'
        : /Edge/i.test(stdout)
          ? 'msedge.exe'
          : /Firefox/i.test(stdout)
            ? 'firefox.exe'
            : /Brave/i.test(stdout)
              ? 'brave.exe'
              : /Opera/i.test(stdout)
                ? 'opera.exe'
                : ''
    } catch {
      /* Try installed browsers and then the system default. */
    }
    const executables = preferred ? [preferred] : ['chrome.exe', 'msedge.exe', 'firefox.exe']
    return Promise.all(
      executables.map(async (name) => {
        for (const hive of ['HKCU', 'HKLM']) {
          try {
            const { stdout } = await execute(
              'reg.exe',
              [
                'query',
                `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`,
                '/ve'
              ],
              { timeout: 5000, windowsHide: true }
            )
            const value = stdout
              .match(/REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]
              ?.trim()
              .replace(/^"|"$/g, '')
            if (value)
              return value.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || `%${key}%`)
          } catch {
            /* Continue to the next registry hive. */
          }
        }
        return name
      })
    )
  })()
  return browserPromise
}

function start(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  checkAborted(signal)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Preserve private-mode fallbacks, passing every URL as a literal process argument. */
export function openBrowserInPrivateMode(raw: string, signal?: AbortSignal): Promise<void> {
  let url: string
  try {
    const parsed = new URL(raw)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('仅支持 HTTP/HTTPS 链接')
    url = parsed.href
  } catch (error) {
    return Promise.reject(error)
  }
  const task = queue.then(async () => {
    checkAborted(signal)
    await sleep(Math.max(0, 100 - (Date.now() - lastLaunch)), signal)
    if (process.platform === 'darwin') {
      for (const [app, flag] of [
        ['Google Chrome', '--incognito'],
        ['Firefox', '-private-window']
      ]) {
        try {
          await execute('open', ['-na', app, '--args', flag, url], { timeout: 10000, signal })
          return
        } catch {
          checkAborted(signal)
        }
      }
    } else {
      const candidates =
        process.platform === 'win32'
          ? await waitFor(windowsBrowsers(), signal)
          : ['google-chrome', 'chromium', 'firefox']
      for (const executable of candidates) {
        const lower = executable.toLowerCase()
        const flag = lower.includes('firefox')
          ? '-private-window'
          : lower.includes('msedge')
            ? '-inprivate'
            : lower.includes('opera')
              ? '--private'
              : '--incognito'
        try {
          await start(executable, [flag, url], signal)
          return
        } catch {
          checkAborted(signal)
        }
      }
    }
    checkAborted(signal)
    await shell.openExternal(url)
  })
  const launched = task.then(() => {
    lastLaunch = Date.now()
  })
  queue = launched.catch(() => {})
  return waitFor(launched, signal)
}
