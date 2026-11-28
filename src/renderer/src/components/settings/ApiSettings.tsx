import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Database } from 'lucide-react'
import { Button } from '../ui'
import { useTranslation } from '@/hooks/useTranslation'

export function ApiSettings(): ReactNode {
  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const [usage, setUsage] = useState<'rest' | 'cbor'>('rest')
  const [routing, setRouting] = useState(false)
  const [loaded, setLoaded] = useState({ usage: false, routing: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    mounted.current = true
    setLoading(true)
    setError('')
    void Promise.allSettled([window.api.getUsageApiType(), window.api.getUseKProxyForApi()]).then(
      ([usageResult, routingResult]) => {
        if (!active) return
        const usageOK =
          usageResult.status === 'fulfilled' && ['rest', 'cbor'].includes(usageResult.value)
        const routingOK =
          routingResult.status === 'fulfilled' && typeof routingResult.value === 'boolean'
        if (usageOK && usageResult.status === 'fulfilled') setUsage(usageResult.value)
        if (routingOK && routingResult.status === 'fulfilled') setRouting(routingResult.value)
        setLoaded({ usage: usageOK, routing: routingOK })
        if (!usageOK || !routingOK)
          setError('API 设置加载失败，请重试 / Could not load API settings. Please retry.')
        setLoading(false)
      }
    )
    return () => {
      active = false
      mounted.current = false
    }
  }, [retry])

  const save = async (
    request: () => Promise<{ success: boolean; error?: string }>,
    apply: () => void
  ): Promise<void> => {
    if (pending.current || loading) return
    pending.current = true
    setSaving(true)
    setError('')
    try {
      const result = await request()
      if (!result.success)
        throw new Error(result.error || (isEn ? 'Could not save API settings' : 'API 设置保存失败'))
      if (mounted.current) apply()
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const loadFailed = !loading && (!loaded.usage || !loaded.routing)
  return (
    <section className="ui-section">
      <h2 className="ui-section-title flex items-center gap-2">
        <Database className="h-4 w-4" />
        {isEn ? 'API Settings' : 'API 设置'}
      </h2>
      <div className="rounded-panel border bg-card divide-y">
        <div className="ui-setting-row">
          <div>
            <p className="font-medium">{isEn ? 'Usage API Type' : '用量查询 API'}</p>
            <p className="text-caption text-muted-foreground">
              {isEn ? 'Select API type for querying usage limits' : '选择查询账户用量的 API 类型'}
            </p>
          </div>
          <select
            aria-label={isEn ? 'Usage API Type' : '用量查询 API'}
            value={usage}
            disabled={loading || saving || !loaded.usage}
            className="h-control rounded-control border border-input bg-card px-2.5"
            onChange={(e) => {
              const value = e.target.value
              if (value === 'rest' || value === 'cbor')
                void save(
                  () => window.api.setUsageApiType(value),
                  () => setUsage(value)
                )
            }}
          >
            <option value="rest">REST (GetUsageLimits)</option>
            <option value="cbor">CBOR (GetUserUsageAndLimits)</option>
          </select>
        </div>
        <div className="p-3 text-caption text-muted-foreground space-y-1">
          <p>
            • <strong>REST</strong>:{' '}
            {isEn ? 'Official Kiro IDE format, recommended' : '官方 Kiro IDE 使用的格式，推荐使用'}
          </p>
          <p>
            • <strong>CBOR</strong>:{' '}
            {isEn ? 'Web portal format, may have different fields' : '网页端格式，字段可能有差异'}
          </p>
        </div>
        <div className="ui-setting-row">
          <div>
            <p className="font-medium">{isEn ? 'Use K-Proxy for API' : 'API 请求走 K-Proxy'}</p>
            <p className="text-caption text-muted-foreground">
              {isEn
                ? 'Route API requests through K-Proxy MITM proxy'
                : 'API 请求通过 K-Proxy MITM 代理发送'}
            </p>
          </div>
          <Button
            variant={routing ? 'default' : 'outline'}
            size="sm"
            disabled={loading || saving || !loaded.routing}
            onClick={() =>
              void save(
                () => window.api.setUseKProxyForApi(!routing),
                () => setRouting(!routing)
              )
            }
          >
            {routing ? (isEn ? 'On' : '已开启') : isEn ? 'Off' : '已关闭'}
          </Button>
        </div>
        {routing && (
          <p className="p-3 text-caption text-amber-500">
            {isEn
              ? '⚠️ K-Proxy must be running for this to work'
              : '⚠️ 需要先启动 K-Proxy MITM 代理才能生效'}
          </p>
        )}
        {(error || loadFailed) && (
          <div className="p-3 space-y-2">
            <p role="alert" className="text-body text-destructive">
              {error ||
                (isEn
                  ? 'Could not load API settings. Please retry.'
                  : 'API 设置加载失败，请重试。')}
            </p>
            {(!loaded.usage || !loaded.routing) && (
              <Button
                variant="outline"
                size="sm"
                disabled={loading || saving}
                onClick={() => setRetry((value) => value + 1)}
              >
                {isEn ? 'Retry' : '重试'}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
