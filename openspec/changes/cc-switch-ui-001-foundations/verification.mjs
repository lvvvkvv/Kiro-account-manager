// 隔离 renderer 验证：所有 IPC 使用固定样例，不读写真实账号或启动服务。
// PLAYWRIGHT_MODULE 可指向本机已有的 playwright/index.mjs；不修改应用依赖。
import assert from 'node:assert/strict'
import { verifyDialogs } from './verification/dialogs.mjs'
import { verifyControls } from './verification/controls.mjs'
import { verifyGeometry } from './verification/geometry.mjs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const appRoot = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(path.join(appRoot, 'package.json'))
const { createServer } = await import(pathToFileURL(require.resolve('vite')))
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')))
const { default: tailwind } = await import(pathToFileURL(require.resolve('@tailwindcss/vite')))
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const out = process.env.UI_CHECK_OUTPUT || '/tmp/cc-foundations-final'
await fs.mkdir(out, { recursive: true })
const server = await createServer({
  configFile: false,
  root: path.join(appRoot, 'src/renderer'),
  resolve: { alias: { '@': path.join(appRoot, 'src/renderer/src') } },
  plugins: [{
    name: 'isolated-foundation-fixture',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/styles/globals.css')) return `${code}\n@source "${fileURLToPath(new URL('./verification/geometry.mjs', import.meta.url))}";`
    },
    resolveId(id) { if (id === '/__foundation_test__.js') return path.join(appRoot, 'src/renderer/src/__foundation_test__.js') },
    load(id) { if (id.endsWith('/__foundation_test__.js')) return "export { createElement, useState } from 'react'; export { createRoot } from 'react-dom/client';" }
  }, react(), tailwind()],
  server: { host: '127.0.0.1', port: 0, fs: { allow: [appRoot] } }
})
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true
})
const errors = []
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, colorScheme: 'light' })
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  window.__events = {}
  window.__calls = []
  const accounts = Object.fromEntries(['active', 'error', 'expired'].map((status, i) => {
    const id = `fixture-${i}`
    return [id, {
      id, email: `fixture${i}@example.invalid`, nickname: `Fixture ${i}`, idp: 'BuilderId',
      machineId: '0'.repeat(64), credentials: { accessToken: '', csrfToken: '', expiresAt: Date.now() + 86400000 },
      subscription: { type: 'Pro', title: 'KIRO PRO', daysRemaining: i ? 2 : 30 },
      usage: { current: i ? 96 : 22, limit: 100, percentUsed: i ? 0.96 : 0.22, lastUpdated: Date.now() },
      tags: [], status, isActive: i === 0, createdAt: Date.now(), lastUsedAt: Date.now(),
      lastError: status === 'error' ? 'Account suspended' : undefined
    }]
  }))
  let data = {
    accounts, groups: { group: { id: 'group', name: 'Fixture group', order: 0, createdAt: 0 } }, tags: {},
    activeAccountId: 'fixture-0', theme: 'ocean', language: 'en', darkMode: true,
    privacyMode: true, usagePrecision: true, autoRefreshEnabled: false
  }
  window.api = new Proxy({}, { get: (_, name) => {
    if (name === 'window') return { getPlatform: async () => 'darwin', isMaximized: async () => false, onMaximizeChange: () => () => {} }
    if (String(name).startsWith('on')) return cb => { window.__events[name] = cb; return () => { delete window.__events[name] } }
    return async (...args) => {
      window.__calls.push({ name, args })
      if (name === 'getAppVersion') return '1.7.6'
      if (name === 'loadAccounts') return structuredClone(data)
      if (name === 'saveAccounts') { data = structuredClone(args[0]); return { success: true } }
      if (name === 'getTraySettings') return {}
      if (name === 'getShowWindowShortcut') return 'CommandOrControl+Shift+K'
      if (name === 'getUsageApiType') return 'desktop'
      if (name === 'getProactiveRenewalEnabled') return false
      if (name === 'verifyAccountCredentials') return new Promise(resolve => { window.__resolveVerification = resolve })
      if (name === 'loadKiroCredentials') return { success: false }
      return { success: true }
    }
  } })
})
const state = () => page.evaluate(async () => {
  const { useAccountsStore } = await import('/src/store/accounts.ts')
  const s = useAccountsStore.getState()
  return { theme: s.theme, darkMode: s.darkMode, language: s.language, privacyMode: s.privacyMode, usagePrecision: s.usagePrecision }
})
const navigate = async view => {
  await page.evaluate(view => window.dispatchEvent(new CustomEvent('navigate-page', { detail: view })), view)
  await page.waitForTimeout(650)
}
try {
  await page.goto(server.resolvedUrls.local[0])
  await page.getByText('Total Accounts', { exact: true }).waitFor()
  assert.deepEqual(await state(), { theme: 'system', darkMode: false, language: 'en', privacyMode: true, usagePrecision: true })
  await navigate('settings')
  const modes = page.getByRole('group', { name: 'Appearance', exact: true })
  for (const [label, theme] of [['Light', 'light'], ['Dark', 'dark'], ['System', 'system']]) {
    await modes.getByRole('button', { name: label, exact: true }).click()
    assert.equal((await state()).theme, theme)
    assert.equal((await state()).darkMode, theme === 'dark')
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await modes.getByRole('button', { name: 'Light', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' })
  assert.equal((await state()).darkMode, false)
  await modes.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('combobox', { name: 'Display Language' }).selectOption('zh')
  assert.equal(await page.getByRole('combobox', { name: '显示语言' }).locator('option').count(), 2)
  assert.equal(await page.getByText('主题颜色', { exact: true }).count(), 0)
  await page.evaluate(async () => {
    const { useAccountsStore } = await import('/src/store/accounts.ts')
    await useAccountsStore.getState().flushSaveImmediately()
    await useAccountsStore.getState().loadFromStorage()
  })
  assert.deepEqual(await state(), { theme: 'dark', darkMode: true, language: 'zh', privacyMode: true, usagePrecision: true })
  console.log('通过：外观三档、系统变化、两种语言、旧配置解析、保存重载、隐私与精度保持')
  if (process.env.UI_CHECK_STAGE === 'theme') process.exitCode = 0
  else if (process.env.UI_CHECK_STAGE === 'geometry') await verifyGeometry(page, out)
  else {
    await verifyDialogs(page, out, navigate)
    await verifyControls(page, out)
    await verifyGeometry(page, out)
    for (const size of [{ width: 1200, height: 1200 }, { width: 800, height: 600 }]) {
      await page.setViewportSize(size)
      for (const language of ['zh', 'en']) for (const mode of ['light', 'dark']) {
        await page.evaluate(async ({ language, mode }) => {
          const { useAccountsStore } = await import('/src/store/accounts.ts')
          useAccountsStore.getState().setLanguage(language)
          useAccountsStore.getState().setTheme(mode)
        }, { language, mode })
        for (const view of ['home', 'accounts', 'settings']) {
          await navigate(view)
          await page.screenshot({ path: `${out}/${view}-${language}-${mode}-${size.width}.png` })
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        }
      }
    }
    console.log('通过：3 个代表页面 × 2 种语言 × 2 种明暗 × 2 种尺寸，共 24 张截图')
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
