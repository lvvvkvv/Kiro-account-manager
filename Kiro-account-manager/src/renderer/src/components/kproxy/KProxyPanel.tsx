import { useState, useEffect, useCallback } from 'react'
import {
  Play,
  Square,
  RefreshCw,
  Copy,
  Check,
  Shield,
  Activity,
  AlertCircle,
  Globe,
  Loader2,
  FileText,
  Download,
  Key,
  Fingerprint,
  Server
} from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Badge
} from '../ui'
import { useTranslation } from '../../hooks/useTranslation'
import { cn } from '../../lib/utils'

interface KProxyConfig {
  enabled: boolean
  port: number
  host: string
  mitmDomains: string[]
  deviceId?: string
  autoStart: boolean
  logRequests: boolean
}

interface KProxyStats {
  totalRequests: number
  mitmRequests: number
  bypassRequests: number
  modifiedRequests: number
  startTime: number
  lastRequestTime: number
}

interface CACertInfo {
  certPath: string
  fingerprint: string
  validFrom: string
  validTo: string
}

// K-Proxy 请求日志：模块级持久化 + 单次订阅，避免切到其它页面 unmount 后日志清空、中间请求事件丢失
type KProxyRecentRequest = {
  timestamp: number
  host: string
  method: string
  path: string
  isMitm: boolean
  deviceIdReplaced?: boolean
}
let _kproxyRecentRequests: KProxyRecentRequest[] = []
let _refSetKproxyRecentRequests: ((v: KProxyRecentRequest[]) => void) | null = null
let _kproxyRequestListenerRegistered = false
function ensureKproxyRequestListenerRegistered(): void {
  if (_kproxyRequestListenerRegistered) return
  _kproxyRequestListenerRegistered = true
  window.api.onKproxyRequest((info) => {
    _kproxyRecentRequests = [
      {
        timestamp: info.timestamp,
        host: info.host,
        method: info.method,
        path: info.path,
        isMitm: info.isMitm,
        deviceIdReplaced: info.deviceIdReplaced
      },
      ..._kproxyRecentRequests
    ].slice(0, 50)
    _refSetKproxyRecentRequests?.(_kproxyRecentRequests)
  })
}

export function KProxyPanel() {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  const [isRunning, setIsRunning] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [config, setConfig] = useState<KProxyConfig>({
    enabled: false,
    port: 8899,
    host: '127.0.0.1',
    mitmDomains: ['amazonaws.com', 'amazon.com'],
    autoStart: false,
    logRequests: true
  })
  const [stats, setStats] = useState<KProxyStats | null>(null)
  const [caInfo, setCaInfo] = useState<CACertInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deviceIdCopied, setDeviceIdCopied] = useState(false)
  const [recentRequests, setRecentRequests] = useState<KProxyRecentRequest[]>(_kproxyRecentRequests)
  const [caInstalled, setCaInstalled] = useState<boolean | null>(null)

  // 检查 CA 证书是否已安装
  const checkCaInstalled = useCallback(async () => {
    try {
      const result = await window.api.kproxyCheckCaCertInstalled()
      setCaInstalled(result.installed)
    } catch {
      setCaInstalled(null)
    }
  }, [])

  // 初始化 K-Proxy
  const initKProxy = useCallback(async () => {
    if (isInitialized || isInitializing) return
    setIsInitializing(true)
    setError(null)

    try {
      const result = await window.api.kproxyInit()
      if (result.success) {
        setIsInitialized(true)
        if (result.caInfo) {
          setCaInfo(result.caInfo)
        }
        // 获取状态
        const status = await window.api.kproxyGetStatus()
        if (status.config) {
          setConfig(status.config as KProxyConfig)
        }
        if (status.stats) {
          setStats(status.stats as KProxyStats)
        }
        setIsRunning(status.running)
      } else {
        setError(result.error || 'Failed to initialize K-Proxy')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Init failed')
    } finally {
      setIsInitializing(false)
    }
  }, [isInitialized, isInitializing])

  // 初始化
  useEffect(() => {
    initKProxy()
    checkCaInstalled()
  }, [initKProxy, checkCaInstalled])

  // 监听事件
  useEffect(() => {
    // onKproxyRequest：模块级单次订阅；只在组件挂载期间挂 setter 通道
    ensureKproxyRequestListenerRegistered()
    _refSetKproxyRecentRequests = setRecentRequests

    const unsubStatus = window.api.onKproxyStatusChange((status) => {
      setIsRunning(status.running)
    })

    const unsubError = window.api.onKproxyError((err) => {
      setError(err)
    })

    return () => {
      unsubStatus()
      unsubError()
      _refSetKproxyRecentRequests = null
    }
  }, [])

  // 启动/停止
  const toggleProxy = async () => {
    setError(null)
    try {
      if (isRunning) {
        const result = await window.api.kproxyStop()
        if (!result.success) {
          setError(result.error || 'Failed to stop')
        }
      } else {
        const result = await window.api.kproxyStart(config)
        if (!result.success) {
          setError(result.error || 'Failed to start')
        }
      }
      // 刷新状态
      const status = await window.api.kproxyGetStatus()
      setIsRunning(status.running)
      if (status.stats) {
        setStats(status.stats as KProxyStats)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    }
  }

  // 更新配置
  const updateConfig = async (updates: Partial<KProxyConfig>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    try {
      await window.api.kproxyUpdateConfig(updates)
    } catch (err) {
      console.error('Failed to update config:', err)
    }
  }

  // 生成设备 ID
  const generateDeviceId = async () => {
    try {
      const result = await window.api.kproxyGenerateDeviceId()
      if (result.success && result.deviceId) {
        await updateConfig({ deviceId: result.deviceId })
        await window.api.kproxySetDeviceId(result.deviceId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate device ID')
    }
  }

  // 复制代理地址
  const copyProxyAddress = () => {
    const address = `${config.host}:${config.port}`
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 复制设备 ID
  const copyDeviceId = () => {
    if (config.deviceId) {
      navigator.clipboard.writeText(config.deviceId)
      setDeviceIdCopied(true)
      setTimeout(() => setDeviceIdCopied(false), 2000)
    }
  }

  // 导出 CA 证书
  const exportCaCert = async () => {
    try {
      const result = await window.api.kproxyExportCaCert()
      if (!result.success) {
        setError(result.error || 'Export failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  // 格式化时间
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString()
  }

  if (!isInitialized) {
    // 初始化中或尚未开始初始化时显示加载状态
    if (isInitializing || !error) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">
            {isEn ? 'Initializing K-Proxy...' : '正在初始化 K-Proxy...'}
          </p>
        </div>
      )
    }
    // 只有明确出错时才显示错误状态
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-destructive">{error}</p>
        <Button onClick={initKProxy}>
          <RefreshCw className="h-4 w-4" />
          {isEn ? 'Retry' : '重试'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {/* 错误提示 */}
      {error && (
        <div className="ui-notice items-center bg-danger-soft text-danger-text">
          <AlertCircle className="h-4 w-4" />
          <span className="min-w-0 flex-1 break-words text-body">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            title={isEn ? 'Dismiss error' : '关闭错误提示'}
            className="ml-auto h-7 w-7 shrink-0 p-0"
            onClick={() => setError(null)}
          >
            ✕
          </Button>
        </div>
      )}

      {/* 主控制卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-section">K-Proxy MITM</CardTitle>
              <Badge
                variant={isRunning ? 'default' : 'secondary'}
                className={cn('ml-2', isRunning && 'bg-success-soft text-success-text')}
              >
                {isRunning ? (
                  <span className="flex items-center gap-1">
                    <span className="relative flex h-2 w-2">
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                    </span>
                    {isEn ? 'Running' : '运行中'}
                  </span>
                ) : isEn ? (
                  'Stopped'
                ) : (
                  '已停止'
                )}
              </Badge>
            </div>
            <Button onClick={toggleProxy} variant={isRunning ? 'destructive' : 'default'} size="sm">
              {isRunning ? (
                <>
                  <Square className="h-4 w-4" />
                  {isEn ? 'Stop' : '停止'}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {isEn ? 'Start' : '启动'}
                </>
              )}
            </Button>
          </div>
          <CardDescription>
            {isEn
              ? 'MITM proxy for replacing Machine ID in Kiro requests'
              : 'MITM 代理，用于替换 Kiro 请求中的 Machine ID'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 代理地址 */}
          <div className="flex flex-wrap items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-body text-muted-foreground">{isEn ? 'Proxy:' : '代理地址:'}</span>
            <code className="bg-muted px-2 py-1 rounded-control text-body font-mono">
              {config.host}:{config.port}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title={isEn ? 'Copy address' : '复制地址'}
              onClick={copyProxyAddress}
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>

          {/* 配置项 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{isEn ? 'Port' : '端口'}</Label>
              <Input
                type="number"
                value={config.port}
                onChange={(e) => updateConfig({ port: parseInt(e.target.value) || 8899 })}
                disabled={isRunning}
                className="rounded-control text-body h-control"
              />
            </div>
            <div className="space-y-2">
              <Label>{isEn ? 'Host' : '监听地址'}</Label>
              <Input
                value={config.host}
                onChange={(e) => updateConfig({ host: e.target.value })}
                disabled={isRunning}
                className="rounded-control text-body h-control"
              />
            </div>
          </div>

          {/* 开关选项 */}
          <div className="ui-setting-row px-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <Label>{isEn ? 'Log Requests' : '记录请求日志'}</Label>
            </div>
            <Switch
              checked={config.logRequests}
              onCheckedChange={(checked) => updateConfig({ logRequests: checked })}
            />
          </div>

          <div className="ui-setting-row px-0">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-muted-foreground" />
              <Label>{isEn ? 'Auto Start' : '自动启动'}</Label>
            </div>
            <Switch
              checked={config.autoStart}
              onCheckedChange={(checked) => updateConfig({ autoStart: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 设备 ID 卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-section">{isEn ? 'Device ID' : '设备 ID'}</CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? 'Machine ID to replace in requests (64 hex characters)'
              : '替换请求中的 Machine ID（64位十六进制）'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={config.deviceId || ''}
              onChange={(e) => {
                updateConfig({ deviceId: e.target.value })
                if (e.target.value.length === 64) {
                  window.api.kproxySetDeviceId(e.target.value)
                }
              }}
              placeholder={isEn ? 'Enter or generate device ID' : '输入或生成设备 ID'}
              className="font-mono rounded-control text-body h-control"
            />
            <Button variant="outline" size="sm" className="h-8" onClick={generateDeviceId}>
              <Key className="h-3 w-3" />
              {isEn ? 'Generate' : '生成'}
            </Button>
            {config.deviceId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                title={isEn ? 'Copy device ID' : '复制设备 ID'}
                onClick={copyDeviceId}
              >
                {deviceIdCopied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
          {config.deviceId && (
            <p className="text-caption text-muted-foreground">
              {config.deviceId.length === 64
                ? isEn
                  ? '✓ Valid device ID format'
                  : '✓ 设备 ID 格式正确'
                : isEn
                  ? `⚠ Invalid length: ${config.deviceId.length}/64`
                  : `⚠ 长度不正确: ${config.deviceId.length}/64`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* CA 证书卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-section">{isEn ? 'CA Certificate' : 'CA 证书'}</CardTitle>
            </div>
            <div className="flex flex-wrap gap-2">
              {caInstalled === false ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={async () => {
                    try {
                      const result = await window.api.kproxyInstallCaCert()
                      if (result.success) {
                        setCaInstalled(true)
                        alert(result.message || (isEn ? 'Certificate installed' : '证书已安装'))
                      } else {
                        alert(result.error || (isEn ? 'Failed to install' : '安装失败'))
                      }
                    } catch (e) {
                      alert(e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  {isEn ? 'Install' : '安装'}
                </Button>
              ) : caInstalled === true ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    try {
                      const result = await window.api.kproxyUninstallCaCert()
                      if (result.success) {
                        setCaInstalled(false)
                        alert(result.message || (isEn ? 'Certificate uninstalled' : '证书已卸载'))
                      } else {
                        alert(result.error || (isEn ? 'Failed to uninstall' : '卸载失败'))
                      }
                    } catch (e) {
                      alert(e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  {isEn ? 'Uninstall' : '卸载'}
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  {isEn ? 'Checking...' : '检测中...'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportCaCert}>
                <Download className="h-3 w-3" />
                {isEn ? 'Export' : '导出'}
              </Button>
            </div>
          </div>
          <CardDescription>
            {isEn
              ? 'Install this certificate to trust K-Proxy MITM'
              : '安装此证书以信任 K-Proxy MITM 代理'}
          </CardDescription>
        </CardHeader>
        {caInfo && (
          <CardContent className="space-y-2 text-body">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{isEn ? 'Fingerprint:' : '指纹:'}</span>
              <code className="bg-muted px-2 py-0.5 rounded-control text-caption font-mono truncate max-w-[300px]">
                {caInfo.fingerprint}
              </code>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{isEn ? 'Valid:' : '有效期:'}</span>
              <span className="text-caption">
                {new Date(caInfo.validFrom).toLocaleDateString()} -{' '}
                {new Date(caInfo.validTo).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 统计卡片 */}
      {stats && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-section">{isEn ? 'Statistics' : '统计'}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-metric font-semibold">{stats.totalRequests}</div>
                <div className="text-caption text-muted-foreground">
                  {isEn ? 'Total' : '总请求'}
                </div>
              </div>
              <div>
                <div className="text-metric font-semibold text-blue-500">{stats.mitmRequests}</div>
                <div className="text-caption text-muted-foreground">{isEn ? 'MITM' : 'MITM'}</div>
              </div>
              <div>
                <div className="text-metric font-semibold text-green-500">
                  {stats.modifiedRequests}
                </div>
                <div className="text-caption text-muted-foreground">
                  {isEn ? 'Modified' : '已修改'}
                </div>
              </div>
              <div>
                <div className="text-metric font-semibold text-gray-500">
                  {stats.bypassRequests}
                </div>
                <div className="text-caption text-muted-foreground">{isEn ? 'Bypass' : '透传'}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 最近请求 */}
      {recentRequests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-section">
                {isEn ? 'Recent Requests' : '最近请求'}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {recentRequests.slice(0, 10).map((req, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-caption py-1 border-b last:border-0"
                >
                  <span className="text-muted-foreground w-16">{formatTime(req.timestamp)}</span>
                  <Badge variant={req.isMitm ? 'default' : 'secondary'}>
                    {req.isMitm ? 'MITM' : 'PASS'}
                  </Badge>
                  {req.deviceIdReplaced && (
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      ID
                    </Badge>
                  )}
                  <span className="font-mono truncate flex-1">{req.host}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 使用说明 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-section">{isEn ? 'Usage Guide' : '使用说明'}</CardTitle>
        </CardHeader>
        <CardContent className="text-body text-muted-foreground space-y-2">
          <p>
            1.{' '}
            {isEn
              ? 'Export and install the CA certificate to your system trust store'
              : '导出并安装 CA 证书到系统信任存储'}
          </p>
          <p>
            2. {isEn ? 'Set your system/application proxy to' : '设置系统/应用代理为'}{' '}
            <code className="bg-muted px-1 rounded-control">
              {config.host}:{config.port}
            </code>
          </p>
          <p>
            3.{' '}
            {isEn
              ? 'Generate or enter a device ID to use for requests'
              : '生成或输入用于请求的设备 ID'}
          </p>
          <p>
            4. {isEn ? 'Start the proxy and use Kiro IDE normally' : '启动代理后正常使用 Kiro IDE'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
