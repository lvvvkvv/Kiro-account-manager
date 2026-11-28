// Proton 邮箱「借壳官方网页」取码（轻量版，借鉴 ElectronMail 思路）
//
// 原理：ProtonMail 是 E2E 加密、无官方 IMAP/SMTP/公开 API。本模块在主进程起一个
// 带持久化 session 的隐藏 BrowserWindow 加载官方网页 mail.proton.me，由官方网页自己
// 完成 SRP 登录 + PGP 解密；我们只通过 webContents.executeJavaScript 读取「已解密的 DOM」
// 提取 6 位验证码。不劫持 webpack 内部模块、不碰 PGP，仅依赖少量 DOM 选择器。
//
// 登录态：首次需用户在弹出的窗口里手动登录一次（含 hCaptcha/2FA），之后通过
// partition='persist:proton' 持久化复用，无需重复登录。这正是 ElectronMail 的做法。
//
// 多地址「匿名」：配合 Proton catch-all 自定义域名 / SimpleLogin 别名，一个收件箱可收
// 无限个 prefix@yourdomain 的验证码邮件。
//
// WARN: 标注「Proton DOM 依赖点」的选择器随 Proton 改版可能失效，届时只需更新本文件。

import { BrowserWindow, session, type Session } from 'electron'
import { checkAborted, sleep, waitFor, withDeadline } from './async'

const PARTITION = 'persist:proton'
// 真实 Chrome UA，去掉 Electron 标识，降低被 Proton 风控/拒绝的概率
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
// 验证码邮件一般落 inbox；如需覆盖垃圾箱可改为 all-mail
const PROTON_INBOX_URL = 'https://mail.proton.me/u/0/inbox'
const appliedProxies = new WeakMap<Session, string>()

let win: BrowserWindow | null = null

export type ProtonLogger = (msg: string) => void

/**
 * 解析 Proton 窗口应使用的代理：优先显式传入，否则用「设置里的全局代理」
 * （设置页经 set-proxy 写入 process.env.HTTPS_PROXY，见 main/index.ts applyProxySettings）。
 * 注意：这里刻意用应用全局代理，而非注册代理池——代理池是逐账号轮换的临时出口，
 * 不适合常驻、需要稳定登录态的取码窗口。
 */
function resolveSettingsProxy(explicit?: string): string {
  const e = (explicit || '').trim()
  if (e) return e
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  ).trim()
}

async function applyProxy(sess: Session, proxy?: string): Promise<void> {
  const resolved = resolveSettingsProxy(proxy)
  if (appliedProxies.get(sess) === resolved) return
  if (resolved) {
    console.log(`[Proton] 走设置代理: ${resolved.replace(/:[^:@/]+@/, ':***@')}`)
    await sess.setProxy({ proxyRules: resolved })
    appliedProxies.set(sess, resolved)
    return
  }
  // 设置里未配代理 → 跟随系统代理（Proton 在受限网络下通常需要代理才能访问）
  console.log('[Proton] 设置未配代理，跟随系统代理')
  await sess.setProxy({ mode: 'system' })
  appliedProxies.set(sess, resolved)
}

/** 懒创建（或复用）Proton 窗口。show=true 时显示并聚焦，便于用户手动登录 */
async function ensureWindow(
  show: boolean,
  proxy?: string,
  signal?: AbortSignal
): Promise<BrowserWindow> {
  checkAborted(signal)
  const sess = session.fromPartition(PARTITION)
  // 设置变更后更新代理；同一配置下复用连接，避免每次扫描重置 session 代理。
  await applyProxy(sess, proxy)
  checkAborted(signal)

  if (win && !win.isDestroyed()) {
    if (show) {
      win.show()
      win.focus()
    }
    return win
  }

  win = new BrowserWindow({
    width: 1024,
    height: 800,
    show,
    title: 'Proton Mail',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      // 后台隐藏时不节流定时器/网络，保证 Proton 仍能实时收新邮件
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.setUserAgent(CHROME_UA)
  // 站内导航（登录跳转等）保持在本窗口；其它外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/proton\.me/i.test(url)) return { action: 'allow' }
    return { action: 'deny' }
  })

  const current = win
  const closed = (): void => {
    if (win === current) win = null
  }
  win.on('closed', closed)

  await loadAndWait(win, PROTON_INBOX_URL)
  checkAborted(signal)
  return win
}

/** 加载 URL 并等待页面 dom-ready（带超时兜底） */
function loadAndWait(w: BrowserWindow, url: string, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      w.webContents.removeListener('dom-ready', ready)
      w.removeListener('closed', closed)
      if (error) reject(error)
      else resolve()
    }
    const ready = (): void => finish()
    const closed = (): void => finish(new Error('Proton 窗口已关闭'))
    const timer = setTimeout(() => finish(new Error('Proton 页面加载超时')), timeoutMs)
    w.webContents.once('dom-ready', ready)
    w.once('closed', closed)
    void w.loadURL(url).catch((error) => finish(error))
  })
}

/** 通过当前 URL + DOM 判断是否已登录 Proton Mail */
async function checkLoggedIn(w: BrowserWindow): Promise<boolean> {
  const url = w.webContents.getURL()
  // 未登录会跳到 account.proton.me 的 login/authorize 页
  if (/account\.proton\.me/i.test(url) || /\/(login|authorize|switch)/i.test(url)) return false
  if (!/mail\.proton\.me\/u\//i.test(url)) return false
  // DOM 兜底确认：已登录时存在邮件列表容器，登录页存在密码输入框
  try {
    const ok = await w.webContents.executeJavaScript(
      `(() => {
        if (document.querySelector('input[type="password"], #password')) return false
        const sels = ['[data-testid="message-list"]','.items-column-list','[data-shortcut-target="item-container"]','main [role="main"]']
        return sels.some(s => document.querySelector(s)) || /\\/u\\//.test(location.pathname)
      })()`,
      false
    )
    return Boolean(ok)
  } catch {
    return /mail\.proton\.me\/u\//i.test(url)
  }
}

/** 打开 Proton 登录窗口（显示），返回当前登录态。用户在窗口内手动完成登录 */
export async function openProtonLogin(
  proxy?: string
): Promise<{ success: boolean; loggedIn: boolean; error?: string }> {
  try {
    return await withMailbox(async (signal) => {
      const w = await ensureWindow(true, proxy, signal)
      await sleep(1200, signal)
      return { success: true, loggedIn: await checkLoggedIn(w) }
    })
  } catch (err) {
    return {
      success: false,
      loggedIn: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** 查询当前 Proton 登录态（不弹窗：窗口不存在则后台静默创建检测） */
export async function getProtonLoginStatus(proxy?: string): Promise<{ loggedIn: boolean }> {
  try {
    return await withMailbox(async (signal) => {
      const w = await ensureWindow(false, proxy, signal)
      await sleep(600, signal)
      return { loggedIn: await checkLoggedIn(w) }
    })
  } catch {
    return { loggedIn: false }
  }
}

/** 关闭 Proton 窗口（保留持久化 session，下次免登录） */
export function closeProtonWindow(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  scanOffset = 0
  lastInboxLoad = 0
  receivedCodes.clear()
}

// ===== 取码 =====

interface ScanResult {
  code: string
  from: 'body' | 'body-nocode' | 'wrong-recipient' | 'none' | 'error'
  matched: boolean
  nextOffset?: number
  messages?: Array<{ address: string; code: string }>
  snippet?: string
  err?: string
}

/**
 * 在已解密的收件箱中查找「发给当前注册地址」那封 AWS 验证码邮件的验证码。
 * 三重定位（鲁棒优先）：
 *   1) 发件人筛选：只看发件人为 no-reply@signin.aws 的邮件，排除「Response Required」等非验证码 AWS 邮件；
 *   2) 每轮读取两封候选并推进游标，避免长时间占用共享窗口；
 *   3) 收件人精确匹配：用邮件头收件人原样带点地址区分同母号不同点号变体的旧码。
 * 收件人读不到时，正文必须包含完整目标地址。
 * @param address 当前注册使用的收件地址（点号变体，原样含点）
 */
function buildScanScript(address: string, offset = 0): string {
  const addrFull = JSON.stringify(address.trim().toLowerCase())
  return `(async () => {
    const addrFull = ${addrFull};
    let nextOffset = 0;
    const messages = [];
    const extractCode = (t) => { const m = (t||'').match(/\\b\\d{6}\\b/g); return m ? m[m.length-1] : ''; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    // 读取当前打开邮件的收件人地址集合（Proton DOM 依赖点：mailto / recipient-label / recipients:item-）
    const readRecipients = () => {
      const set = new Set();
      document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
        const m = (a.getAttribute('href') || '').replace(/^mailto:/i, '').trim().toLowerCase();
        if (m.indexOf('@') > 0) set.add(m);
      });
      document.querySelectorAll('[data-testid="recipient-label"], bdi.message-recipient-item-label').forEach((el) => {
        const t = (el.innerText || '').trim().toLowerCase();
        if (t.indexOf('@') > 0) set.add(t);
      });
      document.querySelectorAll('[data-testid^="recipients:item-"]').forEach((el) => {
        const t = (el.getAttribute('data-testid') || '').replace('recipients:item-', '').trim().toLowerCase();
        if (t.indexOf('@') > 0) set.add(t);
      });
      return set;
    };
    // 列表项发件人地址（Proton DOM 依赖点）：AWS 验证码邮件发件人固定为 no-reply@signin.aws，
    // 用它精确筛掉同为 AWS 的非验证码邮件（如「Response Required: Your Kiro Account」，
    // 那封收件人也是当前地址，仅靠收件人校验会误判「匹配但无码」而卡住）。
    const SENDER = 'no-reply@signin.aws';
    const senderOf = (it) => {
      const el = it.querySelector('[data-testid="message-column:sender-address"]');
      return el ? (el.getAttribute('title') || el.innerText || '').trim().toLowerCase() : '';
    };
    // 打开某封邮件：避开行内星标 button / 复选框 input，否则只会切换星标而打不开邮件
    const openItem = (it) => {
      let target = it.querySelector('[data-testid="message-column:subject"]')
        || it.querySelector('[data-testid^="message-row"]')
        || it.querySelector('.item-subject-wrapper, .subject, span[role="heading"]');
      if (!target) {
        const cand = Array.from(it.querySelectorAll('span, div'))
          .filter((el) => !el.closest('button') && !el.querySelector('button, input') && (el.innerText || '').trim().length > 8);
        target = cand[0] || it;
      }
      fire(target, 'mousedown'); fire(target, 'mouseup'); fire(target, 'click');
    };
    // 读正文（Proton 正文渲染在 iframe 内，优先读 iframe）
    const readBody = () => {
      let body = '';
      const ifr = document.querySelector('iframe[data-testid="content-iframe"], iframe[title], iframe');
      if (ifr) { try { body = (ifr.contentDocument && ifr.contentDocument.body) ? (ifr.contentDocument.body.innerText || '') : ''; } catch (e) {} }
      if (!body) {
        const readSels = ['[data-testid="message-content"]','.message-content','[data-testid="message-view"]','main [role="article"]','main'];
        for (const rs of readSels) { const el = document.querySelector(rs); if (el && el.innerText) { body = el.innerText; break; } }
      }
      if (!body) body = document.body.innerText || '';
      return body;
    };
    // Proton DOM 依赖点：邮件列表项候选选择器（多重兜底）
    const listSels = ['[data-testid="message-item"]','[data-shortcut-target="item-container"]','.items-column-list [role="row"]','.item-container-wrapper','.item-container'];
    let items = [];
    for (const s of listSels) { const e = [...document.querySelectorAll(s)]; if (e.length) { items = e; break; } }
    if (!items[0]) return { messages, nextOffset, code: '', from: 'none', matched: false };
    // 优先 AWS 验证码邮件；DOM 改版时仍按游标扫描候选并校验收件地址。
    const awsItems = items.filter((it) => senderOf(it) === SENDER);
    const allCandidates = awsItems.length ? awsItems : items;
    const start = ${offset} % allCandidates.length;
    const candidates = allCandidates.slice(start, start + 2);
    nextOffset = (start + candidates.length) % allCandidates.length;
    const results = [];
    for (let i = 0; i < candidates.length; i++) {
      try {
        openItem(candidates[i]);
        // 轮询等渲染就绪（出现 6 位码 / 收件人+正文齐备）即提前继续，省去固定死等 2.2s。
        // 首次稍等 iframe 切到新邮件，之后细粒度轮询；上限 ~2s 与原死等相当但通常 0.5s 内命中。
        let body = '';
        let recipients = new Set();
        for (let t = 0; t < 11; t++) {
          await sleep(t === 0 ? 350 : 170);
          body = readBody();
          recipients = readRecipients();
          if (extractCode(body) || (recipients.size > 0 && body.length > 30)) break;
        }
        const r = {
          i,
          hasRecip: recipients.size > 0,
          match: recipients.has(addrFull) || (recipients.size === 0 && ((body || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-z0-9.-]+/g) || []).some(a => a.replace(/[.,;]+$/, '') === addrFull)),
          code: extractCode(body),
          recipText: Array.from(recipients).join(',').slice(0, 100),
          bodySnip: body.slice(0, 100)
        };
        results.push(r);
        // 早停：收件人精确匹配 + 有码 → 当前注册地址那封的验证码（最高置信）
        if (r.code) {
          const targets = recipients.size ? [...recipients] : ((body || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-z0-9.-]+/g) || []);
          for (const address of targets) messages.push({ address: address.replace(/[.,;]+$/, ''), code: r.code });
        }
      } catch (e) {
        results.push({ i, hasRecip: false, match: false, code: '', recipText: '', bodySnip: 'err=' + String(e) });
      }
    }
    const match = results.find(r => r.match && r.code);
    if (match) return { messages, nextOffset, code: match.code, from: 'body', matched: true };
    // 收件人精确匹配但还没读到码（邮件刚到正在渲染）
    const matchNoCode = results.find((r) => r.match && !r.code);
    if (matchNoCode) return { messages, nextOffset, code: '', from: 'body-nocode', matched: true, snippet: 'aws#' + matchNoCode.i + ' ' + matchNoCode.bodySnip };
    // 有码但收件人是别的变体 → 不是当前的，继续等
    const wrongRecip = results.find((r) => r.code && r.hasRecip && !r.match);
    if (wrongRecip) return { messages, nextOffset, code: '', from: 'wrong-recipient', matched: false, snippet: 'aws#' + wrongRecip.i + ' recipients=' + wrongRecip.recipText };
    return { messages, nextOffset, code: '', from: 'body-nocode', matched: false, snippet: 'awsItems=' + awsItems.length + '; ' + results.map((r) => '#' + r.i + (r.code ? '+code' : '-nocode') + ' r=' + (r.recipText || 'none')).join(' | ').slice(0, 170) };
  })()`
}

/**
 * 轮询 Proton 收件箱 DOM 等待验证码。
 * @param address  收件地址（catch-all 下用于区分目标邮件）
 * @param opts.timeoutSec  总超时
 * @param opts.intervalSec 轮询间隔
 * @param opts.signal      注册取消信号
 * @param opts.log         日志回调
 * @param opts.proxy       可选代理
 */
interface WaitProtonOtpOptions {
  timeoutSec: number
  intervalSec: number
  signal?: AbortSignal
  log?: ProtonLogger
  proxy?: string
}

// Serialize one DOM interaction, not an entire OTP wait. A cancelled caller leaves no queued navigation.
let domQueue: Promise<unknown> = Promise.resolve()
let scanOffset = 0
let lastInboxLoad = 0
const waitingAddresses = new Map<string, number>()
const receivedCodes = new Map<string, string>()
function withMailbox<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const task = domQueue.then(async () => {
    checkAborted(signal)
    try {
      // If Chromium hangs, destroy that page before allowing another DOM interaction.
      return await withDeadline(work, 35000)
    } catch (error) {
      if (error instanceof Error && error.message.includes('超时')) closeProtonWindow()
      throw error
    }
  })
  domQueue = task.catch(() => {})
  return waitFor(task, signal)
}

export function waitProtonOtp(address: string, opts: WaitProtonOtpOptions): Promise<string> {
  const target = address.trim().toLowerCase()
  waitingAddresses.set(target, (waitingAddresses.get(target) || 0) + 1)
  return withDeadline(
    async (signal) => {
      const log = opts.log ?? ((): void => {})
      let attempt = 0
      const pollMs = Math.min(Math.max(opts.intervalSec * 1000, 250), 1000)
      for (;;) {
        checkAborted(signal)
        const result = await withMailbox(async (domSignal) => {
          const cached = receivedCodes.get(target)
          if (cached) return { code: cached, from: 'body', matched: true } as ScanResult
          const w = await ensureWindow(false, opts.proxy, domSignal)
          checkAborted(signal)
          if (!(await checkLoggedIn(w)))
            throw new Error('Proton 未登录，请先在「登录 Proton」窗口完成登录')
          checkAborted(signal)
          checkAborted(domSignal)
          if (Date.now() - lastInboxLoad > 20000 || !w.webContents.getURL().includes('/inbox')) {
            await loadAndWait(w, PROTON_INBOX_URL)
            await sleep(1200)
            lastInboxLoad = Date.now()
            checkAborted(signal)
            checkAborted(domSignal)
          }
          const res = (await withDeadline(
            () => w.webContents.executeJavaScript(buildScanScript(address, scanOffset), true),
            8000
          )) as ScanResult
          checkAborted(domSignal)
          scanOffset = res.nextOffset ?? scanOffset
          for (const mail of res.messages || []) {
            if (waitingAddresses.has(mail.address)) receivedCodes.set(mail.address, mail.code)
          }
          checkAborted(signal)
          return res
        }, signal).catch((error) => {
          checkAborted(signal)
          if (error instanceof Error && error.message.includes('未登录')) throw error
          if (++attempt % 10 === 0) log(`[Proton] 读取失败: ${error}`)
          return undefined
        })
        checkAborted(signal)
        attempt++
        if (result?.code && result.from === 'body' && result.matched) {
          log(`[Proton] 验证码: ${result.code} (收件地址匹配)`)
          return result.code
        }
        if (attempt % 10 === 0) log('[Proton] 等待当前地址的验证码...')
        await sleep(pollMs, signal)
      }
    },
    opts.timeoutSec * 1000,
    opts.signal,
    `等待验证码超时 (${opts.timeoutSec}s)`
  ).finally(() => {
    const remaining = (waitingAddresses.get(target) || 1) - 1
    if (remaining) waitingAddresses.set(target, remaining)
    else {
      waitingAddresses.delete(target)
      receivedCodes.delete(target)
    }
  })
}
