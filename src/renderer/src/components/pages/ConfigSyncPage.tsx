import { PageHeader } from '../layout/PageHeader'
import { useRef, useState } from 'react'
import {
  Archive,
  Download,
  Upload,
  FileJson,
  ShieldAlert,
  CheckCircle2,
  Trash2,
  RefreshCw,
  AlertTriangle
} from 'lucide-react'
import { useAccountsStore } from '@/store/accounts'
import { useWebhookStore } from '@/store/webhooks'
import { useTranslation } from '@/hooks/useTranslation'
import {
  buildPortableConfig,
  containsConfigSecrets,
  importPortableConfig,
  type ConfigImportResult
} from '@/lib/configSync'
import {
  REGISTRATION_PREFERENCE_KEYS,
  TEMPLATES_KEY,
  EMAIL_BLACKLIST_KEY
} from '@/lib/registration'
import { Card, CardContent, CardHeader, CardTitle, Button, Label, Switch } from '../ui'

export function ConfigSyncPage(): React.ReactNode {
  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const proxyCount = useAccountsStore((state) => state.proxyPool.size)
  const webhookCount = useWebhookStore((state) => state.webhooks.size)
  const busy = useRef(false)
  const [working, setWorking] = useState(false)

  // 导出选项（默认全开）
  const [opts, setOpts] = useState({
    proxyPool: true,
    webhooks: true,
    registerConfig: true,
    registerTemplates: true,
    registerSettings: true,
    appSettings: true,
    /** 包含代理认证信息？关闭时只导出 host:port，更安全用于分享 */
    includeProxyCredentials: false,
    /** 启用密码加密：使用用户密码 + Web Crypto AES-GCM */
    encrypt: false
  })
  const [encryptPassword, setEncryptPassword] = useState('')

  const [lastExportSize, setLastExportSize] = useState<number | null>(null)
  const [lastImportResult, setLastImportResult] = useState<ConfigImportResult | null>(null)

  const handleExport = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setWorking(true)
    try {
      const payload = buildPortableConfig(opts)
      if (containsConfigSecrets(payload) && !opts.encrypt) {
        throw new Error(
          isEn
            ? 'This selection contains proxy/mailbox credentials or Webhook secrets. Enable encryption to export it.'
            : '所选配置含有代理、邮箱凭据或 Webhook 等敏感信息，请启用加密导出。'
        )
      }
      let outputText = JSON.stringify(payload, null, 2)
      if (opts.encrypt) {
        if (!encryptPassword.trim())
          throw new Error(isEn ? 'Please enter encryption password' : '请输入加密密码')
        outputText = await encryptText(outputText, encryptPassword)
      }
      const blob = new Blob([outputText], {
        type: opts.encrypt ? 'application/octet-stream' : 'application/json'
      })
      setLastExportSize(blob.size)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kiro-config-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.${opts.encrypt ? 'kcfg' : 'json'}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      busy.current = false
      setWorking(false)
    }
  }

  const handleImport = async (file: File): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setWorking(true)
    try {
      let text = (await file.text()).replace(/^\uFEFF/, '')
      if (file.name.toLowerCase().endsWith('.kcfg') || text.startsWith(ENC_PREFIX)) {
        const password = prompt(isEn ? 'Enter decryption password:' : '请输入解密密码：')
        if (password === null) return
        text = await decryptText(text, password)
      }
      const payload: unknown = JSON.parse(text)
      if (
        payload &&
        typeof payload === 'object' &&
        'type' in payload &&
        payload.type === 'kiro-account-manager-config' &&
        !confirm(
          isEn
            ? 'This legacy file will replace the proxy pool, Webhooks and preferences it contains. Continue?'
            : '旧版配置会替换文件中包含的代理池、Webhook 和偏好，确定继续？'
        )
      )
        return
      setLastImportResult(await importPortableConfig(payload))
    } catch (error) {
      setLastImportResult({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      busy.current = false
      setWorking(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-body">
      {/* Header */}
      <PageHeader
        icon={<Archive />}
        title={<>{isEn ? 'Config Sync' : '配置同步'}</>}
        subtitle={
          <>
            {isEn
              ? 'Export & import proxy pools, Webhooks, register templates and preferences for multi-device sync.'
              : '导出/导入代理池、Webhook、注册模板和应用偏好，用于多设备同步'}
          </>
        }
      />
      <div className="space-y-7 px-6 pt-4 pb-6">
        {/* 安全提示 */}
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="py-3 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-caption space-y-1">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {isEn ? 'Security Notice' : '安全提示'}
              </p>
              <p className="text-muted-foreground">
                {isEn
                  ? 'Register config and templates may contain mailbox passwords and refresh tokens. Webhook URLs may contain access tokens. Exports containing these secrets require password encryption.'
                  : '注册配置和模板可能含有邮箱密码、Refresh Token，Webhook 地址可能含有访问密钥。包含这些敏感信息的导出须启用密码加密。'}
              </p>
              <p className="text-muted-foreground">
                {isEn
                  ? 'Tip: keep "Include proxy credentials" OFF when sharing the file with others.'
                  : '提示：分享给他人时，建议关闭"包含代理认证信息"选项，认证信息会被移除。'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 导出 */}
        <Card className="">
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex items-center gap-2 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Download className="h-4 w-4 text-primary" />
              {isEn ? 'Export' : '导出'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-body">
              <ExportToggle
                label={`${isEn ? 'Proxy Pool' : '代理池'} (${proxyCount})`}
                checked={opts.proxyPool}
                onChange={(v) => setOpts((p) => ({ ...p, proxyPool: v }))}
              />
              <ExportToggle
                label={`${isEn ? 'Webhooks' : 'Webhook'} (${webhookCount})`}
                checked={opts.webhooks}
                onChange={(v) => setOpts((p) => ({ ...p, webhooks: v }))}
              />
              <ExportToggle
                label={isEn ? 'Register Config' : '注册配置'}
                checked={opts.registerConfig}
                onChange={(v) => setOpts((p) => ({ ...p, registerConfig: v }))}
              />
              <ExportToggle
                label={isEn ? 'Register Templates' : '注册模板'}
                checked={opts.registerTemplates}
                onChange={(v) => setOpts((p) => ({ ...p, registerTemplates: v }))}
              />
              <ExportToggle
                label={isEn ? 'Register Preferences' : '注册偏好（限速/定时/配额等）'}
                checked={opts.registerSettings}
                onChange={(v) => setOpts((p) => ({ ...p, registerSettings: v }))}
              />
              <ExportToggle
                label={
                  isEn ? 'App Settings (theme/lang/auto-refresh)' : 'App 设置（主题/语言/自动刷新）'
                }
                checked={opts.appSettings}
                onChange={(v) => setOpts((p) => ({ ...p, appSettings: v }))}
              />
            </div>

            <div className="border-t pt-3 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  checked={opts.includeProxyCredentials}
                  onCheckedChange={(v) => setOpts((p) => ({ ...p, includeProxyCredentials: v }))}
                />
                <Label className="text-body cursor-pointer flex items-center gap-1.5">
                  {opts.includeProxyCredentials ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  {isEn
                    ? 'Include proxy credentials (NOT recommended for sharing)'
                    : '包含代理认证信息（分享时不建议）'}
                </Label>
              </div>
              {/* C4: 加密导出 */}
              <div className="flex items-center gap-2">
                <Switch
                  checked={opts.encrypt}
                  onCheckedChange={(v) => setOpts((p) => ({ ...p, encrypt: v }))}
                />
                <Label className="text-body cursor-pointer flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-green-500" />
                  {isEn ? 'Encrypt (AES-GCM)' : '加密导出 (AES-GCM)'}
                </Label>
              </div>
              {opts.encrypt && (
                <input
                  type="password"
                  value={encryptPassword}
                  onChange={(e) => setEncryptPassword(e.target.value)}
                  placeholder={isEn ? 'Password...' : '加密密码...'}
                  className="border bg-background flex-1 max-w-xs min-w-0 rounded-control border-input bg-card px-2.5 text-body focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                />
              )}
              <Button
                className="ml-auto"
                onClick={handleExport}
                disabled={working || (opts.encrypt && !encryptPassword.trim())}
              >
                <FileJson className="h-4 w-4 mr-0" />
                {isEn ? 'Export' : '导出'}
              </Button>
            </div>

            {lastExportSize !== null && (
              <p className="text-caption text-muted-foreground">
                {isEn
                  ? `Last export: ${(lastExportSize / 1024).toFixed(1)} KB`
                  : `上次导出大小: ${(lastExportSize / 1024).toFixed(1)} KB`}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 导入 */}
        <Card className="">
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex items-center gap-2 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Upload className="h-4 w-4 text-primary" />
              {isEn ? 'Import' : '导入'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="text-body">
              {isEn
                ? 'Choose a previously exported JSON or encrypted KCFG file. Duplicates will be merged/skipped automatically.'
                : '选择之前导出的 JSON 或加密 KCFG 文件。重复项会自动合并/跳过。'}
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="application/json,.json,.kcfg"
                disabled={working}
                className="min-w-0 rounded-control border border-input bg-card px-2.5 text-body focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleImport(file)
                  e.currentTarget.value = ''
                }}
              />
            </div>

            {lastImportResult && (
              <div
                className={`p-3 rounded-panel border ${
                  lastImportResult.success
                    ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/10'
                    : 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10'
                }`}
              >
                {lastImportResult.success ? (
                  <>
                    <div className="flex items-center gap-2 text-body font-medium text-green-700 dark:text-green-300">
                      <CheckCircle2 className="h-4 w-4" />
                      {isEn ? 'Import Successful' : '导入成功'}
                    </div>
                    {lastImportResult.counts && (
                      <div className="mt-2 grid grid-cols-2 gap-1 text-caption">
                        {Object.entries(lastImportResult.counts).map(([k, v]) => (
                          <div key={k} className="flex justify-between">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono tabular-nums">
                              {v}
                              {(lastImportResult.skipped?.[k] || 0) > 0 &&
                                ` (${isEn ? 'skipped' : '跳过'} ${lastImportResult.skipped?.[k]})`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-start gap-2 text-body text-red-700 dark:text-red-300">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{isEn ? 'Import Failed' : '导入失败'}</div>
                      <div className="text-caption mt-0.5">{lastImportResult.error}</div>
                      {Object.values(lastImportResult.counts || {}).some((count) => count > 0) && (
                        <div className="text-caption mt-1">
                          {isEn ? 'Applied before the failure: ' : '失败前已应用：'}
                          {Object.entries(lastImportResult.counts || {})
                            .map(([key, count]) => `${key}: ${count}`)
                            .join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 危险操作 */}
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex items-center gap-2 text-red-600 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Trash2 className="h-4 w-4" />
              {isEn ? 'Danger Zone' : '危险操作'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
              disabled={working}
              onClick={() => {
                if (
                  !confirm(
                    isEn
                      ? 'Reset register page preferences (rate limit / schedule / quota / mixed sources / blacklist / templates)? This does NOT affect accounts.'
                      : '重置注册页所有偏好（限速/定时/配额/混合源/黑名单/模板）？不影响账号数据。'
                  )
                )
                  return
                try {
                  for (const k of REGISTRATION_PREFERENCE_KEYS) localStorage.removeItem(k)
                  localStorage.removeItem(TEMPLATES_KEY)
                  localStorage.removeItem(EMAIL_BLACKLIST_KEY)
                  alert(isEn ? 'Done. Please reload the page.' : '已重置，请刷新页面')
                } catch (error) {
                  alert(error instanceof Error ? error.message : String(error))
                }
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-0.5" />
              {isEn ? 'Reset Register Preferences' : '重置注册页偏好'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ExportToggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.ReactNode {
  return (
    <label className="flex items-center gap-2 p-2 rounded-control hover:bg-muted/40 cursor-pointer">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-body">{label}</span>
    </label>
  )
}

// ============ AES-GCM 加密辅助（C4） ============

const ENC_PREFIX = 'KCFG1:'
const PBKDF2_ITER = 100_000

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  // 用 .slice() 拿到独立的 ArrayBuffer 视图，规避 TypeScript 5 严格 ArrayBufferLike 类型问题
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password).slice().buffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.slice().buffer, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < arr.length; i += 32768)
    s += String.fromCharCode(...arr.subarray(i, i + 32768))
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

async function encryptText(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.slice().buffer },
    key,
    plaintextBytes.slice().buffer
  )
  return `${ENC_PREFIX}${b64encode(salt)}.${b64encode(iv)}.${b64encode(ciphertext)}`
}

async function decryptText(envelope: string, password: string): Promise<string> {
  if (!envelope.startsWith(ENC_PREFIX)) throw new Error('Not an encrypted KCFG payload')
  const parts = envelope.slice(ENC_PREFIX.length).split('.')
  if (parts.length !== 3) throw new Error('Invalid encrypted payload format')
  const [saltB64, ivB64, ctB64] = parts
  const salt = b64decode(saltB64)
  const iv = b64decode(ivB64)
  const ct = b64decode(ctB64)
  const key = await deriveKey(password, salt)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.slice().buffer },
    key,
    ct.slice().buffer
  )
  return new TextDecoder().decode(plaintext)
}
