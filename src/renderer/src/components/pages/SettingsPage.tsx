import { useShallow } from 'zustand/react/shallow'
import { ApiSettings } from '../settings/ApiSettings'
import { shortcutKey } from '../../../../shared/shortcut'
import { PageHeader } from '../layout/PageHeader'
import { useAccountsStore } from '@/store/accounts'
import { Card, CardContent, Button } from '../ui'
import {
  Eye,
  EyeOff,
  RefreshCw,
  Clock,
  Trash2,
  Download,
  Upload,
  Globe,
  Repeat,
  Palette,
  Moon,
  Sun,
  Fingerprint,
  Info,
  Settings,
  Database,
  Layers,
  UserX,
  Monitor
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { ExportDialog } from '../accounts/ExportDialog'
import { useTranslation } from '@/hooks/useTranslation'

export function SettingsPage() {
  const {
    privacyMode,
    setPrivacyMode,
    usagePrecision,
    setUsagePrecision,
    autoRefreshEnabled,
    autoRefreshInterval,
    autoRefreshConcurrency,
    autoRefreshSyncInfo,
    proactiveRenewalEnabled,
    setProactiveRenewalEnabled,
    setAutoRefresh,
    setAutoRefreshConcurrency,
    setAutoRefreshSyncInfo,
    checkAndRefreshExpiringTokens,
    proxyEnabled,
    proxyUrl,
    setProxy,
    autoSwitchEnabled,
    autoSwitchThreshold,
    autoSwitchInterval,
    setAutoSwitch,
    batchImportConcurrency,
    setBatchImportConcurrency,
    loginPrivateMode,
    setLoginPrivateMode,
    switchTarget,
    setSwitchTarget,
    theme,
    setTheme,
    language,
    setLanguage,
    importFromExportData
  } = useAccountsStore(
    useShallow((state) => ({
      privacyMode: state.privacyMode,
      setPrivacyMode: state.setPrivacyMode,
      usagePrecision: state.usagePrecision,
      setUsagePrecision: state.setUsagePrecision,
      autoRefreshEnabled: state.autoRefreshEnabled,
      autoRefreshInterval: state.autoRefreshInterval,
      autoRefreshConcurrency: state.autoRefreshConcurrency,
      autoRefreshSyncInfo: state.autoRefreshSyncInfo,
      proactiveRenewalEnabled: state.proactiveRenewalEnabled,
      setProactiveRenewalEnabled: state.setProactiveRenewalEnabled,
      setAutoRefresh: state.setAutoRefresh,
      setAutoRefreshConcurrency: state.setAutoRefreshConcurrency,
      setAutoRefreshSyncInfo: state.setAutoRefreshSyncInfo,
      checkAndRefreshExpiringTokens: state.checkAndRefreshExpiringTokens,
      proxyEnabled: state.proxyEnabled,
      proxyUrl: state.proxyUrl,
      setProxy: state.setProxy,
      autoSwitchEnabled: state.autoSwitchEnabled,
      autoSwitchThreshold: state.autoSwitchThreshold,
      autoSwitchInterval: state.autoSwitchInterval,
      setAutoSwitch: state.setAutoSwitch,
      batchImportConcurrency: state.batchImportConcurrency,
      setBatchImportConcurrency: state.setBatchImportConcurrency,
      loginPrivateMode: state.loginPrivateMode,
      setLoginPrivateMode: state.setLoginPrivateMode,
      switchTarget: state.switchTarget,
      setSwitchTarget: state.setSwitchTarget,
      theme: state.theme,
      setTheme: state.setTheme,
      language: state.language,
      setLanguage: state.setLanguage,
      importFromExportData: state.importFromExportData
    }))
  )

  const { t, actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [tempProxyUrl, setTempProxyUrl] = useState(proxyUrl)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)

  // 托盘设置状态
  const [traySettings, setTraySettings] = useState({
    enabled: true,
    closeAction: 'ask' as 'ask' | 'minimize' | 'quit',
    showNotifications: true,
    minimizeOnStart: false
  })
  const [trayLoading, setTrayLoading] = useState(true)

  // 快捷键设置状态
  const [showWindowShortcut, setShowWindowShortcut] = useState('')
  const [shortcutLoading, setShortcutLoading] = useState(true)
  const [shortcutError, setShortcutError] = useState('')
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)

  // 加载快捷键设置
  useEffect(() => {
    const loadShortcut = async () => {
      try {
        const shortcut = await window.api.getShowWindowShortcut()
        setShowWindowShortcut(shortcut)
      } catch (error) {
        console.error('Failed to load shortcut:', error)
      } finally {
        setShortcutLoading(false)
      }
    }
    loadShortcut()
  }, [])

  // 保存快捷键设置
  const handleShortcutChange = async (shortcut: string) => {
    const previous = showWindowShortcut
    setShowWindowShortcut(shortcut)
    setShortcutError('')
    try {
      const result = await window.api.setShowWindowShortcut(shortcut)
      if (!result.success) {
        setShowWindowShortcut(previous)
        setShortcutError(result.error || 'Failed to set shortcut')
      }
    } catch (error) {
      setShowWindowShortcut(previous)
      setShortcutError(String(error))
    }
  }

  // 按键录制处理
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isRecordingShortcut) return
    e.preventDefault()

    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.metaKey) parts.push('Command')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    // 忽略单独的修饰键
    const key = e.key
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(key)) {
      // 转换特殊键名
      const keyName = shortcutKey(key)
      parts.push(keyName)

      const shortcut = parts.join('+')
      handleShortcutChange(shortcut)
      setIsRecordingShortcut(false)
    }
  }

  // 加载托盘设置
  useEffect(() => {
    const loadTraySettings = async () => {
      try {
        const settings = await window.api.getTraySettings()
        setTraySettings(settings)
      } catch (error) {
        console.error('Failed to load tray settings:', error)
      } finally {
        setTrayLoading(false)
      }
    }
    loadTraySettings()
  }, [])

  // 保存托盘设置
  const handleTraySettingChange = async (
    key: keyof typeof traySettings,
    value: boolean | string
  ) => {
    const newSettings = { ...traySettings, [key]: value }
    setTraySettings(newSettings)
    try {
      const result = await window.api.saveTraySettings({ [key]: value })
      if (!result.success) throw new Error(result.error || '托盘设置保存失败')
    } catch (error) {
      setTraySettings(traySettings)
      setShortcutError(String(error))
    }
  }

  const handleManualRefresh = async () => {
    setIsManualRefreshing(true)
    try {
      await checkAndRefreshExpiringTokens()
    } finally {
      setIsManualRefreshing(false)
    }
  }

  const handleExport = () => {
    setShowExportDialog(true)
  }

  const handleImport = async () => {
    setIsImporting(true)
    try {
      const fileData = await window.api.importFromFile()
      if (fileData && fileData.format === 'json') {
        const data = JSON.parse(fileData.content)
        const importResult = importFromExportData(data)
        alert(`导入完成：成功 ${importResult.success} 个，失败 ${importResult.failed} 个`)
      } else if (fileData) {
        alert('设置页面仅支持 JSON 格式导入，请使用账号管理页面导入 CSV/TXT')
      }
    } catch (e) {
      alert(`导入失败: ${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setIsImporting(false)
    }
  }

  const clearing = useRef(false)
  const [isClearing, setIsClearing] = useState(false)
  const handleClearData = async (): Promise<void> => {
    if (clearing.current) return
    if (
      !confirm(
        isEn
          ? 'Delete all accounts? This cannot be undone.'
          : '确定要清除所有账号吗？此操作不可恢复！'
      )
    )
      return
    if (
      !confirm(
        isEn
          ? 'Confirm deleting all accounts. Groups and tags will be kept.'
          : '再次确认：删除所有账号，保留分组和标签。'
      )
    )
      return
    clearing.current = true
    setIsClearing(true)
    try {
      const state = useAccountsStore.getState()
      state.removeAccounts(Array.from(state.accounts.keys()))
      await state.flushSaveImmediately()
      alert(isEn ? 'All accounts cleared' : '所有账号已清除')
    } catch (error) {
      alert(String(error))
    } finally {
      clearing.current = false
      setIsClearing(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-body">
      {/* 页面头部 */}
      <PageHeader
        icon={<Settings />}
        title={<>{t('settings.title')}</>}
        subtitle={
          <>
            {t('settings.title') === 'Settings' ? 'Configure app features' : '配置应用的各项功能'}
          </>
        }
      />
      <div className="space-y-7 px-6 pt-4 pb-6">
        {/* 语言设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Globe className="h-4 w-4 text-primary" />
              语言 / Language
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">显示语言 / Display Language</p>
                <p className="text-caption text-muted-foreground">
                  选择界面显示语言 / Select interface language
                </p>
              </div>
              <select
                className="w-[160px] border border-input bg-card text-body focus:outline-none min-w-0 rounded-control px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                aria-label={isEn ? 'Display Language' : '显示语言'}
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
              >
                <option value="zh">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </section>

        {/* 主题设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Palette className="h-4 w-4 text-primary" />
              {isEn ? 'Theme' : '主题设置'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <p className="font-medium">{isEn ? 'Appearance' : '外观'}</p>
              <div
                role="group"
                aria-label={isEn ? 'Appearance' : '外观'}
                className="ui-segmented ui-segmented-sm"
              >
                {(
                  [
                    { value: 'system', label: isEn ? 'System' : '跟随系统', icon: Monitor },
                    { value: 'light', label: isEn ? 'Light' : '浅色', icon: Sun },
                    { value: 'dark', label: isEn ? 'Dark' : '深色', icon: Moon }
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={theme === value}
                    className={`h-full rounded-[5px] px-2.5 text-caption [&_svg]:size-3.5 ${theme === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                    onClick={() => setTheme(value)}
                  >
                    <Icon aria-hidden="true" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 隐私设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <div className="contents">
                {privacyMode ? (
                  <EyeOff className="h-4 w-4 text-primary" />
                ) : (
                  <Eye className="h-4 w-4 text-primary" />
                )}
              </div>
              {isEn ? 'Privacy' : '隐私设置'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Privacy Mode' : '隐私模式'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'Hide emails and sensitive info' : '隐藏邮箱和账号敏感信息'}
                </p>
              </div>
              <Button
                variant={privacyMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPrivacyMode(!privacyMode)}
              >
                {privacyMode ? (
                  <EyeOff className="h-4 w-4 mr-0" />
                ) : (
                  <Eye className="h-4 w-4 mr-0" />
                )}
                {privacyMode ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
              </Button>
            </div>
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Usage Precision' : '使用量精度'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Show decimal places for usage values'
                    : '显示使用量的小数精度（如 1.22 而非 1）'}
                </p>
              </div>
              <Button
                variant={usagePrecision ? 'default' : 'outline'}
                size="sm"
                onClick={() => setUsagePrecision(!usagePrecision)}
              >
                {usagePrecision ? (isEn ? 'Decimal' : '小数') : isEn ? 'Integer' : '整数'}
              </Button>
            </div>
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Switch Target' : '切号目标'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Which client to switch account credentials to'
                    : '切换账号凭证写入的客户端'}
                </p>
              </div>
              <select
                className="border bg-background text-body focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                value={switchTarget}
                onChange={(e) => setSwitchTarget(e.target.value as 'ide' | 'cli' | 'both')}
              >
                <option value="ide">Kiro IDE</option>
                <option value="cli">Kiro CLI</option>
                <option value="both">{isEn ? 'Both (IDE + CLI)' : '两者 (IDE + CLI)'}</option>
              </select>
            </div>
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Login Private Mode' : '登录隐私模式'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Open browser in incognito/private mode when logging in'
                    : '在线登录时使用浏览器无痕/隐私模式打开'}
                </p>
              </div>
              <Button
                variant={loginPrivateMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLoginPrivateMode(!loginPrivateMode)}
              >
                <UserX className="h-4 w-4 mr-0" />
                {loginPrivateMode ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
              </Button>
            </div>
          </div>
        </section>

        {/* Token 刷新设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <RefreshCw className="h-4 w-4 text-primary" />
              {isEn ? 'Auto Refresh' : '自动刷新'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Auto Refresh' : '自动刷新'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Auto refresh tokens before expiration'
                    : 'Token 过期前自动刷新，并同步更新账户信息'}
                </p>
              </div>
              <Button
                variant={autoRefreshEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh(!autoRefreshEnabled)}
              >
                {autoRefreshEnabled ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
              </Button>
            </div>

            <div className="text-caption text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-panel p-3 space-y-1">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {isEn ? 'About Kiro IDE auto refresh' : '关于 Kiro IDE 自动刷新'}
              </p>
              <p>
                {isEn
                  ? '• Kiro IDE has its own internal refresh loop (independent of this app). Disabling Auto Refresh here only stops this app from refreshing — it does NOT stop Kiro IDE.'
                  : '• Kiro IDE 自带独立的刷新循环，关闭本工具的"自动刷新"不会停止 IDE 自己的刷新。'}
              </p>
              <p>
                {isEn
                  ? '• When switching accounts or refreshing tokens here, the new token is synced to ~/.aws/sso/cache/kiro-auth-token.json only for the IDE current active account; other accounts only update the local store.'
                  : '• 切号 / 刷新 Token 时，仅当该账号是 Kiro IDE 当前激活账号才会同步到磁盘文件；非激活账号仅更新本工具内部 store。'}
              </p>
              <p>
                {isEn
                  ? '• If IDE refreshes the token itself, this app detects the file change and syncs the new token back to its store (bidirectional sync).'
                  : '• 当 Kiro IDE 自己 refresh 后，本工具会监听磁盘文件变化并反向同步到 store（双向同步）。'}
              </p>
            </div>

            {/* 主动续期开关（默认关闭） */}
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">
                  {isEn ? 'Proactive Token Renewal for IDE' : 'IDE 主动续期'}
                  <span className="ml-2 text-caption text-muted-foreground">
                    ({isEn ? 'Advanced' : '进阶'})
                  </span>
                </p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Renew the IDE active token at a randomized time 10–30 minutes before expiry and sync it to disk.'
                    : '在 IDE 激活账号的 Token 过期前 10～30 分钟随机续期，并同步写入磁盘。'}
                </p>
              </div>
              <Button
                variant={proactiveRenewalEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={async () => {
                  const result = await setProactiveRenewalEnabled(!proactiveRenewalEnabled)
                  if (!result.success && result.error) {
                    alert(
                      (isEn ? 'Failed to toggle proactive renewal: ' : '切换主动续期失败：') +
                        result.error
                    )
                  }
                }}
              >
                {proactiveRenewalEnabled ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
              </Button>
            </div>
            {proactiveRenewalEnabled && (
              <div className="text-caption text-muted-foreground bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-panel p-3 space-y-1">
                <p>
                  {isEn
                    ? '• On: the main process renews the active token 10–30 minutes before expiry. The scheduled time stays fixed until the token changes.'
                    : '• 启用后：主进程在 Token 过期前 10～30 分钟随机续期；同一 Token 的调度时间固定，更新后重新安排。'}
                </p>
                <p>
                  {isEn
                    ? '• Only the IDE current active account is renewed. Switching accounts re-schedules the timer for the new active account.'
                    : '• 仅对 IDE 当前激活账号续期。切号时 timer 会自动重新调度到新账号。'}
                </p>
                <p>
                  {isEn
                    ? "• If a renewal fails (e.g. server outage), the timer stops; IDE's own refresh loop takes over as fallback."
                    : '• 续期失败时 timer 停止，由 IDE 自己的 refresh loop 接管（双向同步仍生效）。'}
                </p>
              </div>
            )}

            {autoRefreshEnabled && (
              <>
                <div className="text-caption text-muted-foreground bg-muted/50 rounded-panel p-3 space-y-1">
                  <p>
                    •{' '}
                    {isEn
                      ? 'Refresh each token at a randomized time 10–30 minutes before expiry'
                      : '每个 Token 在过期前 10～30 分钟随机刷新，调度时间固定至 Token 更新'}
                  </p>
                  <p>
                    •{' '}
                    {isEn
                      ? 'Update usage and subscription info after refresh'
                      : 'Token 刷新后自动更新账户用量、订阅等信息'}
                  </p>
                  <p>
                    •{' '}
                    {isEn
                      ? 'Check all balances when auto-switch is on'
                      : '开启自动换号时，会定期检查所有账户余额'}
                  </p>
                </div>
                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium">{isEn ? 'Check Interval' : '检查间隔'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Account info check interval; token deadlines are scheduled independently'
                        : '账户信息检查间隔；Token 按独立随机时间调度'}
                    </p>
                  </div>
                  <select
                    className="w-[120px] border bg-background text-body focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                    value={autoRefreshInterval}
                    onChange={(e) => setAutoRefresh(true, parseInt(e.target.value))}
                  >
                    <option value="1">{isEn ? '1 min' : '1 分钟'}</option>
                    <option value="3">{isEn ? '3 min' : '3 分钟'}</option>
                    <option value="5">{isEn ? '5 min' : '5 分钟'}</option>
                    <option value="10">{isEn ? '10 min' : '10 分钟'}</option>
                    <option value="15">{isEn ? '15 min' : '15 分钟'}</option>
                    <option value="20">{isEn ? '20 min' : '20 分钟'}</option>
                    <option value="30">{isEn ? '30 min' : '30 分钟'}</option>
                    <option value="45">{isEn ? '45 min' : '45 分钟'}</option>
                    <option value="60">{isEn ? '60 min' : '60 分钟'}</option>
                  </select>
                </div>
                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium">{isEn ? 'Concurrency' : '刷新并发数'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Maximum simultaneous token refreshes across all refresh tasks'
                        : '所有刷新任务共享的 Token 刷新并发上限'}
                    </p>
                  </div>
                  <input
                    type="number"
                    className="w-24 border bg-background text-body text-center focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                    value={autoRefreshConcurrency}
                    min={1}
                    max={500}
                    onChange={(e) => setAutoRefreshConcurrency(parseInt(e.target.value) || 50)}
                  />
                </div>
                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium">{isEn ? 'Sync Account Info' : '同步检测账户信息'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Detect usage, subscription, and ban status'
                        : '刷新 Token 时同步检测用量、订阅、封禁状态'}
                    </p>
                  </div>
                  <Button
                    variant={autoRefreshSyncInfo ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAutoRefreshSyncInfo(!autoRefreshSyncInfo)}
                  >
                    {autoRefreshSyncInfo ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
                  </Button>
                </div>
                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium">{isEn ? 'Manual Trigger' : '手动触发'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Manually trigger auto-refresh for debugging'
                        : '手动触发一次自动刷新流程（用于调试）'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualRefresh}
                    disabled={isManualRefreshing}
                  >
                    {isManualRefreshing
                      ? isEn
                        ? 'Refreshing...'
                        : '刷新中...'
                      : isEn
                        ? 'Trigger Now'
                        : '立即触发'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>

        <ApiSettings />

        {/* 代理设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Globe className="h-4 w-4 text-primary" />
              {isEn ? 'Proxy' : '代理设置'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Enable Proxy' : '启用代理'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'All requests through proxy server' : '所有网络请求将通过代理服务器'}
                </p>
              </div>
              <Button
                variant={proxyEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setProxy(!proxyEnabled, tempProxyUrl)}
              >
                {proxyEnabled ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
              </Button>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <label className="text-body font-medium">{isEn ? 'Proxy URL' : '代理地址'}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 border bg-background text-body font-mono focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                  placeholder={
                    isEn
                      ? 'http://127.0.0.1:7890 or socks5://127.0.0.1:1080'
                      : 'http://127.0.0.1:7890 或 socks5://127.0.0.1:1080'
                  }
                  value={tempProxyUrl}
                  onChange={(e) => setTempProxyUrl(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setProxy(proxyEnabled, tempProxyUrl)}
                  disabled={tempProxyUrl === proxyUrl}
                >
                  {isEn ? 'Save' : '保存'}
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">
                {isEn
                  ? 'Supports HTTP/HTTPS/SOCKS5, format: protocol://host:port'
                  : '支持 HTTP/HTTPS/SOCKS5 代理，格式: protocol://host:port'}
              </p>
            </div>
          </div>
        </section>

        {/* 自动换号设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Repeat className="h-4 w-4 text-primary" />
              {isEn ? 'Auto Switch' : '自动换号'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Enable Auto Switch' : '启用自动换号'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'Auto switch when balance is low' : '余额不足时自动切换到其他可用账号'}
                </p>
              </div>
              <Button
                variant={autoSwitchEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoSwitch(!autoSwitchEnabled)}
              >
                {autoSwitchEnabled ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
              </Button>
            </div>

            {autoSwitchEnabled && (
              <>
                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium">{isEn ? 'Balance Threshold' : '余额阈值'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn ? 'Switch when balance below this' : '余额低于此值时自动切换'}
                    </p>
                  </div>
                  <input
                    type="number"
                    className="w-20 border bg-background text-body text-center focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                    value={autoSwitchThreshold}
                    min={0}
                    onChange={(e) => setAutoSwitch(true, parseInt(e.target.value) || 0)}
                  />
                </div>

                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {isEn ? 'Check Interval' : '检查间隔'}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {isEn ? 'How often to check balance' : '每隔多久检查一次余额'}
                    </p>
                  </div>
                  <select
                    className="border bg-background text-body focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                    value={autoSwitchInterval}
                    onChange={(e) => setAutoSwitch(true, undefined, parseInt(e.target.value))}
                  >
                    <option value="1">{isEn ? '1 min' : '1 分钟'}</option>
                    <option value="3">{isEn ? '3 min' : '3 分钟'}</option>
                    <option value="5">{isEn ? '5 min' : '5 分钟'}</option>
                    <option value="10">{isEn ? '10 min' : '10 分钟'}</option>
                    <option value="15">{isEn ? '15 min' : '15 分钟'}</option>
                    <option value="30">{isEn ? '30 min' : '30 分钟'}</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </section>

        {/* 批量导入设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Layers className="h-4 w-4 text-primary" />
              {isEn ? 'Batch Import' : '批量导入'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Concurrency' : '并发数'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Too high may cause API rate limiting'
                    : '同时验证的账号数量，过大可能导致 API 限流'}
                </p>
              </div>
              <input
                type="number"
                className="w-24 border bg-background text-body text-center focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                value={batchImportConcurrency}
                min={1}
                max={500}
                onChange={(e) => setBatchImportConcurrency(parseInt(e.target.value) || 100)}
              />
            </div>
            <p className="text-caption text-muted-foreground bg-muted/50 rounded-panel p-2">
              {isEn
                ? 'Recommended: 10-100. Too high may cause failures, too low is slow.'
                : '建议范围: 10-100。设置过大可能导致大量「验证失败」，设置过小则导入速度较慢。'}
            </p>
          </div>
        </section>

        {/* 系统托盘设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Monitor className="h-4 w-4 text-primary" />
              {isEn ? 'System Tray' : '系统托盘'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            {trayLoading ? (
              <div className="text-body text-muted-foreground">
                {isEn ? 'Loading...' : '加载中...'}
              </div>
            ) : (
              <>
                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium">{isEn ? 'Enable System Tray' : '启用系统托盘'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn ? 'Show icon in system tray' : '在系统托盘显示图标'}
                    </p>
                  </div>
                  <Button
                    variant={traySettings.enabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleTraySettingChange('enabled', !traySettings.enabled)}
                  >
                    {traySettings.enabled ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
                  </Button>
                </div>

                {traySettings.enabled && (
                  <>
                    <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                      <div className="min-w-0 flex-1 basis-[220px]">
                        <p className="font-medium">
                          {isEn ? 'Close Button Action' : '关闭按钮行为'}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          {isEn ? 'What happens when you click X' : '点击关闭按钮时的行为'}
                        </p>
                      </div>
                      <select
                        className="w-[140px] border bg-background text-body focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                        value={traySettings.closeAction}
                        onChange={(e) => handleTraySettingChange('closeAction', e.target.value)}
                      >
                        <option value="ask">{isEn ? 'Ask every time' : '每次询问'}</option>
                        <option value="minimize">
                          {isEn ? 'Minimize to tray' : '最小化到托盘'}
                        </option>
                        <option value="quit">{isEn ? 'Quit application' : '退出程序'}</option>
                      </select>
                    </div>
                  </>
                )}

                <div className="text-caption text-muted-foreground bg-muted/50 rounded-panel p-3 space-y-1">
                  <p>
                    •{' '}
                    {isEn ? 'Double-click tray icon to show window' : '双击托盘图标可以显示主窗口'}
                  </p>
                  <p>
                    • {isEn ? 'Right-click tray icon to show menu' : '右键托盘图标可以显示菜单'}
                  </p>
                  <p>
                    •{' '}
                    {isEn
                      ? 'Tray menu shows current account info and usage'
                      : '托盘菜单可以查看当前账户信息和用量'}
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* 快捷键设置 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Settings className="h-4 w-4 text-primary" />
              {isEn ? 'Keyboard Shortcuts' : '快捷键'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            {shortcutLoading ? (
              <div className="text-body text-muted-foreground">
                {isEn ? 'Loading...' : '加载中...'}
              </div>
            ) : (
              <>
                <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <p className="font-medium">{isEn ? 'Show Window' : '显示主窗口'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn ? 'Global shortcut to show main window' : '全局快捷键唤起主窗口'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      className={`h-control w-[160px] min-w-0 rounded-control border border-input bg-card px-2.5 py-1 text-body text-center focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 ${isRecordingShortcut ? 'border-ring ring-[3px] ring-ring/20 animate-pulse' : ''}`}
                      value={
                        isRecordingShortcut
                          ? isEn
                            ? 'Press keys...'
                            : '请按键...'
                          : showWindowShortcut
                      }
                      onKeyDown={handleKeyDown}
                      onFocus={() => setIsRecordingShortcut(true)}
                      onBlur={() => setIsRecordingShortcut(false)}
                      readOnly
                      placeholder={isEn ? 'Click to record' : '点击录制'}
                    />
                    {showWindowShortcut && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className=" h-control w-control p-0 rounded-control [&_svg]:size-4"
                        onClick={() => handleShortcutChange('')}
                        title={isEn ? 'Clear shortcut' : '清除快捷键'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {shortcutError && <p className="text-body text-destructive">{shortcutError}</p>}
                <div className="text-caption text-muted-foreground bg-muted/50 rounded-panel p-3 space-y-1">
                  <p>
                    •{' '}
                    {isEn
                      ? 'Click input and press key combination to record'
                      : '点击输入框后按下组合键自动录制'}
                  </p>
                  <p>
                    •{' '}
                    {isEn
                      ? 'macOS use Command, Windows/Linux use Ctrl'
                      : 'macOS 使用 Command，Windows/Linux 使用 Ctrl'}
                  </p>
                  <p>
                    • {isEn ? 'Click trash icon to clear shortcut' : '点击垃圾桶图标可清除快捷键'}
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* 机器码管理提示 */}
        <Card className="bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Fingerprint className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="font-medium text-body">{isEn ? 'Machine ID' : '机器码管理'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Device identifier, auto-switch, account binding'
                    : '修改设备标识符、切号自动换码、账户机器码绑定等功能'}
                </p>
              </div>
              <div className="flex items-center gap-1 text-caption text-muted-foreground">
                <Info className="h-3 w-3" />
                <span>{isEn ? 'Set in sidebar "Machine ID"' : '请在侧边栏「机器码」中设置'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 数据管理 */}
        <section className="ui-section">
          <div className="flex min-h-7 items-center gap-2">
            <h2 className="ui-section-title flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Database className="h-4 w-4 text-primary" />
              {isEn ? 'Data Management' : '数据管理'}
            </h2>
          </div>
          <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row)]:p-4 [&>p]:p-4">
            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Export Data' : '导出数据'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Supports JSON, TXT, CSV, Clipboard'
                    : '支持 JSON、TXT、CSV、剪贴板等多种格式'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-0" />
                {isEn ? 'Export' : '导出'}
              </Button>
            </div>

            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium">{isEn ? 'Import Data' : '导入数据'}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'Import accounts from JSON file' : '从 JSON 文件导入账号数据'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleImport} disabled={isImporting}>
                <Upload className="h-4 w-4 mr-0" />
                {isImporting ? (isEn ? 'Importing...' : '导入中...') : isEn ? 'Import' : '导入'}
              </Button>
            </div>

            <div className="ui-setting-row rounded-none [&>button]:shrink-0 [&>select]:shrink-0">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="font-medium text-destructive">
                  {isEn ? 'Clear All Accounts' : '清除所有账号'}
                </p>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'Delete all accounts; keep groups and tags'
                    : '删除所有账号，保留分组和标签'}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearData}
                disabled={isClearing}
              >
                <Trash2 className="h-4 w-4 mr-0" />
                {isEn ? 'Clear' : '清除'}
              </Button>
            </div>
          </div>
        </section>

        {/* 配置同步（不含敏感凭据，便于多设备共享） */}
        <ConfigSyncCard isEn={isEn} />

        {/* 导出对话框 */}
        {showExportDialog && (
          <SettingsExportDialog
            open={showExportDialog}
            onClose={() => setShowExportDialog(false)}
          />
        )}
      </div>
    </div>
  )
}

/** Share the validated import/export flow, including legacy-file compatibility. */
function ConfigSyncCard({ isEn }: { isEn: boolean }): React.ReactNode {
  return (
    <section className="ui-section">
      <h2 className="ui-section-title flex items-center gap-2">
        <Repeat />
        {isEn ? 'Configuration Sync' : '配置同步'}
      </h2>
      <div className="rounded-panel border bg-card p-4 space-y-3">
        <p className="text-caption text-muted-foreground">
          {isEn
            ? 'Import or export proxy pools, Webhooks, registration templates and preferences. Sensitive exports support password encryption; older configuration files can still be imported.'
            : '导入或导出代理池、Webhook、注册模板和偏好；敏感配置使用密码加密，支持导入旧版配置文件。'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'configSync' }))
          }
        >
          {isEn ? 'Open Configuration Sync' : '打开配置同步'}
        </Button>
      </div>
    </section>
  )
}

function SettingsExportDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.ReactNode {
  const accounts = useAccountsStore((state) => state.accounts)
  return (
    <ExportDialog
      open={open}
      onClose={onClose}
      accounts={Array.from(accounts.values())}
      selectedCount={0}
    />
  )
}
