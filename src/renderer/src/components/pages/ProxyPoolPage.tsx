import type { ChainDiagnose } from '../../../../shared/proxyPool'
import type { Account } from '@/types/account'
import { useShallow } from 'zustand/react/shallow'
import { useState, useMemo, useCallback, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Network,
  Plus,
  Trash2,
  RefreshCw,
  Power,
  PowerOff,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  Clock,
  Activity,
  Settings2,
  Copy,
  FileText,
  Link2,
  Users,
  Shuffle,
  Unlink,
  Stethoscope,
  Pencil
} from 'lucide-react'
import { PageHeader } from '../layout/PageHeader'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Switch,
  Badge
} from '../ui'
import { cn } from '@/lib/utils'
import type { ProxyEntry, ProxyPoolStrategy } from '@/types/proxy'
import { IP_DETECT_ENDPOINTS } from '@/types/proxy'

const STRATEGY_OPTIONS: {
  value: ProxyPoolStrategy
  label: string
  labelEn: string
  desc: string
  descEn: string
}[] = [
  {
    value: 'round_robin',
    label: '轮询',
    labelEn: 'Round Robin',
    desc: '依次使用每个代理',
    descEn: 'Use each proxy in sequence'
  },
  { value: 'random', label: '随机', labelEn: 'Random', desc: '随机挑选', descEn: 'Pick randomly' },
  {
    value: 'least_used',
    label: '最少使用',
    labelEn: 'Least Used',
    desc: '使用次数少的优先',
    descEn: 'Prefer proxies used less'
  },
  {
    value: 'fastest',
    label: '最快优先',
    labelEn: 'Fastest',
    desc: '按延迟升序',
    descEn: 'Sort by latency asc'
  }
]

function ChainDiagnosisCard({
  diag,
  isEn
}: {
  diag: { targetUrl: string; success: boolean; error?: string; diagnose?: ChainDiagnose }
  isEn: boolean
}): React.ReactNode {
  if (!diag.success || !diag.diagnose) {
    return (
      <div className="mt-2 text-caption rounded-panel bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 px-2 py-1.5">
        {isEn ? 'Diagnose failed: ' : '诊断失败：'}
        {diag.error || 'unknown error'}
      </div>
    )
  }
  const d = diag.diagnose
  const Row = ({
    ok,
    label,
    rt,
    err
  }: {
    ok: boolean
    label: string
    rt?: number
    err?: string
  }): React.ReactNode => (
    <div className="flex items-start gap-2 text-caption">
      <span
        className={cn(
          'mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-caption font-semibold',
          ok
            ? 'bg-green-500/20 text-green-600 dark:text-green-400'
            : 'bg-red-500/20 text-red-600 dark:text-red-400'
        )}
      >
        {ok ? '✓' : '✗'}
      </span>
      <span className="flex-1">
        <span className="text-foreground">{label}</span>
        {rt !== undefined && <span className="ml-1 text-muted-foreground font-mono">{rt}ms</span>}
        {err && <div className="mt-0.5 text-red-600 dark:text-red-400 break-all">{err}</div>}
      </span>
    </div>
  )
  return (
    <div className="mt-2 space-y-1.5 rounded-panel border border-border bg-card/50 px-3 py-2">
      <div className="text-caption text-muted-foreground font-mono truncate">
        target: {diag.targetUrl.replace(/:([^:@/]+)@/, ':***@')}
      </div>
      <Row
        ok={d.upstreamReachable}
        label={isEn ? 'A) Upstream TCP reachable' : 'A) 上游中转 TCP 可达'}
        rt={d.upstreamRtMs}
        err={d.upstreamError}
      />
      <Row
        ok={d.targetReachable}
        label={isEn ? 'B) Via upstream → target proxy entry' : 'B) 经上游 → 目标代理入口'}
        rt={d.targetRtMs}
        err={d.targetError}
      />
      <Row
        ok={d.endToEndOk === true}
        label={
          isEn
            ? `C) End-to-end CONNECT (status ${d.targetStatus ?? '?'} ${d.targetStatusText ?? ''})`.trim()
            : `C) 端到端 CONNECT（状态 ${d.targetStatus ?? '?'} ${d.targetStatusText ?? ''}）`.trim()
        }
        rt={d.endToEndRtMs}
        err={d.endToEndError}
      />
      {d.targetBodySnippet && (
        <div className="mt-1 text-caption text-muted-foreground font-mono break-all">
          body: {d.targetBodySnippet.slice(0, 160)}
        </div>
      )}
    </div>
  )
}

interface PoolHealthStats {
  total: number
  enabled: number
  alive: number
  slow: number
  dead: number
  untested: number
  testing: number
  totalUsed: number
  totalFailed: number
  totalSuccess: number
  successRate: number | null
  avgLatencyMs: number | null
  topUsed: Array<{
    id: string
    label: string
    used: number
    failed: number
    success: number
    rate: number | null
    status: ProxyEntry['status']
  }>
}

/** 把代理池实时聚合成几个关键指标，给"健康看板"用 */
function computePoolHealth(proxies: ProxyEntry[]): PoolHealthStats {
  const stats: PoolHealthStats = {
    total: proxies.length,
    enabled: 0,
    alive: 0,
    slow: 0,
    dead: 0,
    untested: 0,
    testing: 0,
    totalUsed: 0,
    totalFailed: 0,
    totalSuccess: 0,
    successRate: null,
    avgLatencyMs: null,
    topUsed: []
  }
  let latencySum = 0
  let latencyCount = 0
  for (const p of proxies) {
    if (p.enabled) stats.enabled++
    if (p.status === 'alive') stats.alive++
    else if (p.status === 'slow') stats.slow++
    else if (p.status === 'dead') stats.dead++
    else if (p.status === 'untested') stats.untested++
    else if (p.status === 'testing') stats.testing++
    stats.totalUsed += p.usedCount
    stats.totalFailed += p.failCount
    if (p.latencyMs && (p.status === 'alive' || p.status === 'slow')) {
      latencySum += p.latencyMs
      latencyCount++
    }
  }
  stats.totalSuccess = Math.max(0, stats.totalUsed - stats.totalFailed)
  stats.successRate = stats.totalUsed > 0 ? stats.totalSuccess / stats.totalUsed : null
  stats.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : null
  stats.topUsed = proxies
    .filter((p) => p.usedCount > 0)
    .sort((a, b) => b.usedCount - a.usedCount)
    .slice(0, 5)
    .map((p) => {
      const success = Math.max(0, p.usedCount - p.failCount)
      return {
        id: p.id,
        label: p.label || `${p.protocol}://${p.host}:${p.port}`,
        used: p.usedCount,
        failed: p.failCount,
        success,
        rate: p.usedCount > 0 ? success / p.usedCount : null,
        status: p.status
      }
    })
  return stats
}

function StatTile({
  label,
  value,
  sub,
  tone
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'default' | 'green' | 'amber' | 'red' | 'blue'
}): React.ReactNode {
  const toneCls =
    tone === 'green'
      ? 'text-green-600 dark:text-green-400'
      : tone === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'red'
          ? 'text-red-600 dark:text-red-400'
          : tone === 'blue'
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-foreground'
  return (
    <div className="rounded-panel border border-border bg-card p-4">
      <div className="text-caption text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-metric font-semibold tabular-nums', toneCls)}>{value}</div>
      {sub !== undefined && <div className="text-caption text-muted-foreground">{sub}</div>}
    </div>
  )
}

function HealthDashboard({
  stats,
  isEn
}: {
  stats: PoolHealthStats
  isEn: boolean
}): React.ReactNode {
  if (stats.total === 0) return null
  const availabilityRate = stats.total > 0 ? (stats.alive + stats.slow) / stats.total : 0
  const successPct = stats.successRate !== null ? Math.round(stats.successRate * 100) : null
  const successTone: 'green' | 'amber' | 'red' | 'default' =
    successPct === null
      ? 'default'
      : successPct >= 80
        ? 'green'
        : successPct >= 50
          ? 'amber'
          : 'red'
  const availTone: 'green' | 'amber' | 'red' | 'default' =
    stats.total === 0
      ? 'default'
      : availabilityRate >= 0.7
        ? 'green'
        : availabilityRate >= 0.3
          ? 'amber'
          : 'red'
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-section flex flex-wrap items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {isEn ? 'Pool Health Dashboard' : '代理池健康看板'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <StatTile
            label={isEn ? 'Total / Enabled' : '总数 / 已启用'}
            value={
              <>
                {stats.total}
                <span className="text-muted-foreground text-strong"> / {stats.enabled}</span>
              </>
            }
          />
          <StatTile
            label={isEn ? 'Availability' : '可用率'}
            value={`${Math.round(availabilityRate * 100)}%`}
            sub={`${stats.alive + stats.slow} ${isEn ? 'alive' : '可用'}`}
            tone={availTone}
          />
          <StatTile
            label={isEn ? 'Success Rate' : '成功率'}
            value={successPct !== null ? `${successPct}%` : '—'}
            sub={`${stats.totalSuccess} / ${stats.totalUsed}`}
            tone={successTone}
          />
          <StatTile
            label={isEn ? 'Avg Latency' : '平均延迟'}
            value={stats.avgLatencyMs !== null ? `${stats.avgLatencyMs}ms` : '—'}
            tone="blue"
          />
          <StatTile
            label={isEn ? 'Dead' : '失效'}
            value={stats.dead}
            tone={stats.dead > 0 ? 'red' : 'default'}
          />
          <StatTile
            label={isEn ? 'Untested' : '未测试'}
            value={stats.untested + stats.testing}
            tone={stats.untested > 0 ? 'amber' : 'default'}
          />
        </div>

        {stats.topUsed.length > 0 && (
          <div>
            <div className="mb-2 text-caption text-muted-foreground">
              {isEn
                ? `Top ${stats.topUsed.length} most used proxies`
                : `承担量 Top ${stats.topUsed.length}`}
            </div>
            <div className="space-y-2">
              {stats.topUsed.map((p) => {
                const rate = p.rate !== null ? Math.round(p.rate * 100) : null
                const ratePct = p.rate !== null ? p.rate * 100 : 0
                const barTone =
                  rate === null
                    ? 'bg-muted-foreground/30'
                    : rate >= 80
                      ? 'bg-green-500'
                      : rate >= 50
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                return (
                  <div key={p.id} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2 text-caption">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <StatusBadge status={p.status} />
                        <span className="font-mono text-caption truncate">{p.label}</span>
                      </div>
                      <div className="shrink-0 text-caption tabular-nums text-muted-foreground">
                        {p.success}/{p.used}
                        {rate !== null && (
                          <span className="ml-1.5 font-medium text-foreground">{rate}%</span>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn('h-full transition-all', barTone)}
                        style={{ width: `${ratePct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({
  status,
  latency
}: {
  status: ProxyEntry['status']
  latency?: number
}): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const cfg = {
    untested: { color: 'bg-muted text-muted-foreground', label: '未测试', labelEn: 'Untested' },
    testing: {
      color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
      label: '测试中',
      labelEn: 'Testing'
    },
    alive: {
      color: 'bg-green-500/15 text-green-600 dark:text-green-400',
      label: '可用',
      labelEn: 'Alive'
    },
    slow: {
      color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      label: '较慢',
      labelEn: 'Slow'
    },
    dead: { color: 'bg-red-500/15 text-red-600 dark:text-red-400', label: '失效', labelEn: 'Dead' }
  }[status]

  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 px-[7px] rounded-full text-badge font-medium',
        cfg.color
      )}
    >
      {status === 'testing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'alive' && <CheckCircle2 className="h-3 w-3" />}
      {status === 'slow' && <Activity className="h-3 w-3" />}
      {status === 'dead' && <XCircle className="h-3 w-3" />}
      <span>{isEn ? cfg.labelEn : cfg.label}</span>
      {latency !== undefined && (status === 'alive' || status === 'slow') && (
        <span className="font-mono opacity-70">{latency}ms</span>
      )}
    </span>
  )
}

function ProxyBindingDetails({
  proxies,
  boundByProxy,
  accounts,
  unbindAccountFromProxy,
  isEn
}: {
  proxies: ProxyEntry[]
  boundByProxy: Map<string, string[]>
  accounts: Map<string, Account>
  unbindAccountFromProxy: (id: string) => void
  isEn: boolean
}): React.ReactNode {
  const container = useRef<HTMLDivElement>(null)
  const rows = useMemo(
    () =>
      proxies.flatMap((proxy) => {
        if (!proxy.enabled || proxy.status === 'dead') return []
        const ids = boundByProxy.get(proxy.id) || []
        return Array.from({ length: Math.ceil(ids.length / 20) }, (_, index) => ({
          key: `${proxy.id}:${index}`,
          proxy,
          ids: ids.slice(index * 20, (index + 1) * 20),
          total: ids.length
        }))
      }),
    [proxies, boundByProxy]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => container.current,
    estimateSize: () => 110,
    overscan: 3,
    getItemKey: (index) => rows[index].key
  })
  return (
    <div ref={container} className="max-h-64 overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          const p = row.proxy
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full p-2 border-b"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <div className="flex items-center justify-between gap-2 text-caption mb-1">
                <span className="font-mono truncate" title={p.url}>
                  {p.host}:{p.port}
                  {p.label && (
                    <Badge variant="outline" className="ml-1.5">
                      {p.label}
                    </Badge>
                  )}
                </span>
                <Badge variant="outline">
                  {row.total} {isEn ? 'accounts' : '账号'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1 pl-2">
                {row.ids.map((aid) => {
                  const acc = accounts.get(aid)
                  return (
                    <span
                      key={aid}
                      className="inline-flex h-5 items-center gap-1 px-[7px] rounded-full bg-muted text-badge font-medium hover:bg-destructive/10 transition-colors group"
                    >
                      <span title={acc?.email}>{acc?.email || aid.slice(0, 8)}</span>
                      <button
                        onClick={() => unbindAccountFromProxy(aid)}
                        className="inline-flex size-4 items-center justify-center rounded-control text-destructive hover:bg-danger-soft"
                        title={isEn ? 'Unbind' : '解绑'}
                      >
                        <XCircle className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ProxyPoolPage(): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const {
    proxyPool,
    proxyPoolConfig,
    addProxy,
    importProxies,
    removeProxy,
    removeProxies,
    toggleProxyEnabled,
    updateProxy,
    validateProxy,
    validateProxiesBatch,
    clearProxyPool,
    setProxyPoolConfig,
    accounts,
    accountProxyBindings,
    unbindAccountFromProxy,
    clearAccountProxyBindings,
    autoDistributeAccountsToProxies
  } = useAccountsStore(
    useShallow((state) => ({
      proxyPool: state.proxyPool,
      proxyPoolConfig: state.proxyPoolConfig,
      addProxy: state.addProxy,
      importProxies: state.importProxies,
      removeProxy: state.removeProxy,
      removeProxies: state.removeProxies,
      toggleProxyEnabled: state.toggleProxyEnabled,
      updateProxy: state.updateProxy,
      validateProxy: state.validateProxy,
      validateProxiesBatch: state.validateProxiesBatch,
      clearProxyPool: state.clearProxyPool,
      setProxyPoolConfig: state.setProxyPoolConfig,
      accounts: state.accounts,
      accountProxyBindings: state.accountProxyBindings,
      unbindAccountFromProxy: state.unbindAccountFromProxy,
      clearAccountProxyBindings: state.clearAccountProxyBindings,
      autoDistributeAccountsToProxies: state.autoDistributeAccountsToProxies
    }))
  )

  const [singleInput, setSingleInput] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // 搜索 / 过滤（v1.8 扩展：协议 / 启用状态 / 延迟 / 最后验证时间 + 全文）
  const [filterText, setFilterText] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | ProxyEntry['status']>('all')
  const [filterProtocol, setFilterProtocol] = useState<'all' | ProxyEntry['protocol']>('all')
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [filterLatency, setFilterLatency] = useState<
    'all' | 'fast' | 'medium' | 'slow' | 'unknown'
  >('all')
  const [filterTestedWithin, setFilterTestedWithin] = useState<
    'all' | '1h' | '1d' | '7d' | 'never'
  >('all')
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false)
  const [isValidatingAll, setIsValidatingAll] = useState(false)
  const [testConcurrency, setTestConcurrency] = useState(10)
  // 反代分桶：每代理承载账号数（0 = 均分）
  const [accountsPerProxy, setAccountsPerProxy] = useState<number>(5)
  const [bindingPanelExpanded, setBindingPanelExpanded] = useState(false)
  // 代理链诊断状态
  const [chainDiagnosing, setChainDiagnosing] = useState(false)
  const [chainDiagnose, setChainDiagnose] = useState<{
    targetUrl: string
    success: boolean
    error?: string
    diagnose?: ChainDiagnose
  } | null>(null)

  // 用池里第一条 enabled 代理作为诊断目标；如果没有则用任意第一条
  const runChainDiagnose = useCallback(async () => {
    const upstream = proxyPoolConfig.upstreamProxy?.trim()
    if (!upstream) return
    const candidates = Array.from(proxyPool.values())
    const target = candidates.find((p) => p.enabled) || candidates[0]
    if (!target) return
    setChainDiagnosing(true)
    setChainDiagnose(null)
    try {
      const res = await window.api.proxyPoolDiagnoseChain({
        targetUrl: target.url,
        upstreamProxy: upstream
      })
      setChainDiagnose({ targetUrl: target.url, ...res })
    } catch (err) {
      setChainDiagnose({
        targetUrl: target.url,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setChainDiagnosing(false)
    }
  }, [proxyPool, proxyPoolConfig.upstreamProxy])

  const proxies = useMemo(() => Array.from(proxyPool.values()), [proxyPool])
  const poolHealth = useMemo(() => computePoolHealth(proxies), [proxies])

  const boundByProxy = useMemo(() => {
    const index = new Map<string, string[]>()
    for (const [accountId, proxyId] of Object.entries(accountProxyBindings)) {
      const list = index.get(proxyId) || []
      list.push(accountId)
      index.set(proxyId, list)
    }
    return index
  }, [accountProxyBindings])

  // 反代分桶：当前账号-代理绑定关系
  const bindingStats = useMemo(() => {
    const allAccounts = Array.from(accounts.values())
    const totalActive = allAccounts.filter((a) => a.status === 'active').length
    const boundCount = Object.keys(accountProxyBindings).filter((aid) => accounts.get(aid)?.status === 'active').length
    const aliveProxies = proxies.filter((p) => p.enabled && p.status !== 'dead')
    // 每代理承载的账号数
    const perProxy: Record<string, number> = {}
    for (const [aid, pid] of Object.entries(accountProxyBindings)) {
      if (!accounts.has(aid)) continue
      perProxy[pid] = (perProxy[pid] || 0) + 1
    }
    // 风险点：单代理账号数 > 推荐阈值（默认 5）
    const overloadedProxies = Object.entries(perProxy)
      .filter(([, c]) => c > 10)
      .map(([pid, c]) => ({ pid, count: c, proxy: proxyPool.get(pid) }))
    return {
      totalActive,
      boundCount,
      unboundCount: totalActive - boundCount,
      aliveProxyCount: aliveProxies.length,
      perProxy,
      overloadedProxies
    }
  }, [accounts, accountProxyBindings, proxies, proxyPool])

  const handleAutoDistribute = useCallback(
    (onlyUnbound: boolean) => {
      if (bindingStats.aliveProxyCount === 0) {
        alert(isEn ? 'No alive proxies. Validate proxies first.' : '没有可用代理，请先验活代理')
        return
      }
      const activeAccountIds = Array.from(accounts.values())
        .filter((a) => a.status === 'active')
        .map((a) => a.id)
      if (activeAccountIds.length === 0) {
        alert(isEn ? 'No active accounts.' : '没有可用账号')
        return
      }
      const result = autoDistributeAccountsToProxies({
        accountsPerProxy,
        onlyUnbound,
        accountIds: activeAccountIds
      })
      alert(
        isEn
          ? `Distributed ${result.distributed} accounts, skipped ${result.skipped}`
          : `已分配 ${result.distributed} 个账号，跳过 ${result.skipped}`
      )
    },
    [
      accounts,
      accountsPerProxy,
      autoDistributeAccountsToProxies,
      bindingStats.aliveProxyCount,
      isEn
    ]
  )

  const stats = poolHealth

  // v1.8 升级版过滤：全文匹配（任意字段片段都能搜到）+ 多维度筛选
  const filtered = useMemo(() => {
    const now = Date.now()
    const HOUR = 60 * 60 * 1000
    const DAY = 24 * HOUR
    return proxies.filter((p) => {
      // 状态过滤
      if (filterStatus !== 'all' && p.status !== filterStatus) return false
      // 协议过滤
      if (filterProtocol !== 'all' && p.protocol !== filterProtocol) return false
      // 启用状态过滤
      if (filterEnabled === 'enabled' && !p.enabled) return false
      if (filterEnabled === 'disabled' && p.enabled) return false
      // 延迟范围过滤
      if (filterLatency !== 'all') {
        const lat = p.latencyMs
        if (filterLatency === 'unknown') {
          if (typeof lat === 'number') return false
        } else if (typeof lat !== 'number') {
          return false
        } else {
          if (filterLatency === 'fast' && lat >= 200) return false
          if (filterLatency === 'medium' && (lat < 200 || lat >= 1000)) return false
          if (filterLatency === 'slow' && lat < 1000) return false
        }
      }
      // 最后验证时间过滤
      if (filterTestedWithin !== 'all') {
        if (filterTestedWithin === 'never') {
          if (p.lastTestedAt) return false
        } else if (!p.lastTestedAt) {
          return false
        } else {
          const diff = now - p.lastTestedAt
          if (filterTestedWithin === '1h' && diff > HOUR) return false
          if (filterTestedWithin === '1d' && diff > DAY) return false
          if (filterTestedWithin === '7d' && diff > 7 * DAY) return false
        }
      }
      // 全文搜索（host / port / protocol / username / label / lastBoundEmail / url / tags）
      if (filterText) {
        const q = filterText.toLowerCase().trim()
        const haystack = [
          p.host,
          String(p.port),
          p.protocol,
          p.username || '',
          p.label || '',
          p.lastBoundEmail || '',
          p.url || '',
          (p.tags || []).join(' '),
          p.source || ''
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [
    proxies,
    filterText,
    filterStatus,
    filterProtocol,
    filterEnabled,
    filterLatency,
    filterTestedWithin
  ])

  // 已应用的过滤条件计数（用于在 UI 显示"高级搜索"徽章）
  const activeAdvancedFilterCount = useMemo(() => {
    let n = 0
    if (filterProtocol !== 'all') n++
    if (filterEnabled !== 'all') n++
    if (filterLatency !== 'all') n++
    if (filterTestedWithin !== 'all') n++
    return n
  }, [filterProtocol, filterEnabled, filterLatency, filterTestedWithin])

  const clearAdvancedFilters = useCallback(() => {
    setFilterProtocol('all')
    setFilterEnabled('all')
    setFilterLatency('all')
    setFilterTestedWithin('all')
  }, [])

  const handleAddSingle = useCallback(() => {
    if (!singleInput.trim()) return
    const id = addProxy(singleInput.trim())
    if (id) {
      setSingleInput('')
    } else {
      alert(isEn ? 'Invalid proxy URL or duplicate' : '代理 URL 无效或重复')
    }
  }, [singleInput, addProxy, isEn])

  const handleImport = useCallback(() => {
    if (!bulkInput.trim()) return
    const result = importProxies(bulkInput)
    alert(
      isEn
        ? `Imported: added ${result.added}, skipped ${result.skipped}, failed ${result.failed}`
        : `导入完成：新增 ${result.added}，跳过 ${result.skipped}，失败 ${result.failed}`
    )
    setBulkInput('')
    setBulkOpen(false)
  }, [bulkInput, importProxies, isEn])

  const handleValidateAll = useCallback(async () => {
    const ids = filtered.map((p) => p.id)
    if (ids.length === 0) return
    setIsValidatingAll(true)
    try {
      await validateProxiesBatch(ids, testConcurrency)
    } finally {
      setIsValidatingAll(false)
    }
  }, [filtered, validateProxiesBatch, testConcurrency])

  const handleValidateSelected = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setIsValidatingAll(true)
    try {
      await validateProxiesBatch(ids, testConcurrency)
    } finally {
      setIsValidatingAll(false)
    }
  }, [selectedIds, validateProxiesBatch, testConcurrency])

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return
    if (
      !confirm(
        isEn ? `Delete ${selectedIds.size} proxies?` : `确定删除 ${selectedIds.size} 个代理？`
      )
    )
      return
    removeProxies(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [selectedIds, removeProxies, isEn])

  const handleRemoveDead = useCallback(() => {
    const deadIds = proxies.filter((p) => p.status === 'dead').map((p) => p.id)
    if (deadIds.length === 0) return
    if (
      !confirm(
        isEn ? `Remove ${deadIds.length} dead proxies?` : `确定移除 ${deadIds.length} 个失效代理？`
      )
    )
      return
    removeProxies(deadIds)
  }, [proxies, removeProxies, isEn])

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (): void => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)))
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader icon={<Network />} title={isEn ? 'Proxy Pool' : '代理池'} />
      <div className="min-h-0 flex-1 space-y-7 overflow-auto px-6 pb-6 pt-4">
        <p className="text-body text-muted-foreground">
          {isEn
            ? 'IP rotation pool for registration tasks. Reduces association/risk control on batch sign-ups.'
            : '注册批量任务的 IP 轮换池。降低同 IP 多账号关联风控。'}
        </p>

        {/* 健康看板：池总览 + Top 承担量 */}
        <HealthDashboard stats={poolHealth} isEn={isEn} />

        {/* 池总开关 + 调度策略 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex flex-wrap items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              {isEn ? 'Pool Configuration' : '池配置'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 总开关 */}
            <div className="flex items-center gap-3">
              <Switch
                checked={proxyPoolConfig.enabled}
                onCheckedChange={(v) => setProxyPoolConfig({ enabled: v })}
              />
              <div>
                <Label className="cursor-pointer text-body">
                  {isEn ? 'Enable proxy pool for registration' : '为注册流程启用代理池'}
                </Label>
                <p className="text-caption text-muted-foreground">
                  {isEn
                    ? 'When enabled, each registration task picks an available proxy by the strategy below.'
                    : '开启后，每个注册任务会按下方策略自动选取一个可用代理'}
                </p>
              </div>
            </div>

            {/* 调度策略 */}
            <div className="space-y-2">
              <Label className="text-caption">{isEn ? 'Selection Strategy' : '调度策略'}</Label>
              <div className="flex flex-wrap gap-2">
                {STRATEGY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setProxyPoolConfig({ strategy: opt.value })}
                    className={cn(
                      'h-control rounded-control px-3.5 text-body border transition-colors',
                      proxyPoolConfig.strategy === opt.value
                        ? 'border-border-strong bg-muted text-foreground font-medium'
                        : 'border-border hover:bg-muted'
                    )}
                    title={isEn ? opt.descEn : opt.desc}
                  >
                    {isEn ? opt.labelEn : opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 自动停用 + 失败阈值 + 测试 URL */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Switch
                  checked={proxyPoolConfig.autoDisableDead}
                  onCheckedChange={(v) => setProxyPoolConfig({ autoDisableDead: v })}
                />
                <Label className="text-caption cursor-pointer">
                  {isEn ? 'Auto-disable on failure' : '失败自动停用'}
                </Label>
              </div>
              <div className="space-y-1">
                <Label className="text-caption">{isEn ? 'Failure threshold' : '失败阈值'}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={proxyPoolConfig.failureThreshold}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v) && v >= 1) setProxyPoolConfig({ failureThreshold: v })
                  }}
                  className="rounded-control text-body h-control"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-caption">
                  {isEn ? 'IP Detection Endpoint' : 'IP 检测端点'}
                </Label>
                <div className="flex gap-1.5">
                  <select
                    value={
                      IP_DETECT_ENDPOINTS.find((e) => e.url === proxyPoolConfig.testUrl)?.id ||
                      '_custom'
                    }
                    onChange={(e) => {
                      const ep = IP_DETECT_ENDPOINTS.find((ep) => ep.id === e.target.value)
                      if (ep) setProxyPoolConfig({ testUrl: ep.url })
                    }}
                    className="border flex-shrink-0 rounded-control text-body h-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                  >
                    {IP_DETECT_ENDPOINTS.map((ep) => (
                      <option key={ep.id} value={ep.id}>
                        {ep.label}
                      </option>
                    ))}
                    <option value="_custom">{isEn ? 'Custom...' : '自定义...'}</option>
                  </select>
                  <Input
                    value={proxyPoolConfig.testUrl}
                    onChange={(e) => setProxyPoolConfig({ testUrl: e.target.value })}
                    placeholder="https://api.ipify.org?format=json"
                    className="font-mono flex-1 rounded-control text-body h-control"
                  />
                </div>
              </div>
            </div>

            {/* 定时自动验活 (B2) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-caption flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {isEn ? 'Auto-validate interval (min, 0=off)' : '定时自动验活（分钟，0=关闭）'}
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={proxyPoolConfig.autoValidateIntervalMin}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v) && v >= 0) setProxyPoolConfig({ autoValidateIntervalMin: v })
                  }}
                  className="rounded-control text-body h-control"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-caption">
                  {isEn ? 'Auto-validate concurrency' : '验活并发'}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={proxyPoolConfig.autoValidateConcurrency}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v) && v >= 1) setProxyPoolConfig({ autoValidateConcurrency: v })
                  }}
                  disabled={proxyPoolConfig.autoValidateIntervalMin === 0}
                  className="rounded-control text-body h-control"
                />
              </div>
            </div>

            {/* 上游中转代理（代理链）：用于目标代理要求非大陆来源 IP 的场景 */}
            <div className="space-y-1">
              <Label className="text-caption">
                {isEn ? 'Upstream relay proxy (proxy chaining)' : '上游中转代理（代理链）'}
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={proxyPoolConfig.upstreamProxy || ''}
                  onChange={(e) => setProxyPoolConfig({ upstreamProxy: e.target.value })}
                  placeholder={
                    isEn
                      ? 'e.g. socks5://127.0.0.1:7890 (empty = off)'
                      : '如 socks5://127.0.0.1:7890（留空=不启用）'
                  }
                  className="font-mono flex-1 rounded-control text-body h-control"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 whitespace-nowrap"
                  disabled={
                    !proxyPoolConfig.upstreamProxy?.trim() ||
                    proxyPool.size === 0 ||
                    chainDiagnosing
                  }
                  onClick={() => void runChainDiagnose()}
                  title={
                    isEn
                      ? 'Diagnose proxy chain (locates failure layer)'
                      : '诊断代理链（定位失败在哪一层）'
                  }
                >
                  {chainDiagnosing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Stethoscope className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">{isEn ? 'Diagnose' : '诊断'}</span>
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">
                {isEn
                  ? 'When set, traffic chains: local → relay → target proxy → site. Use when the target proxy requires a non-mainland source IP (e.g. bestproxy). Supports http/socks5; your VPN local port works.'
                  : '填写后链路为：本机 → 上游中转 → 目标代理 → 目标站点。用于目标代理要求非大陆来源 IP 的情况（如 bestproxy）。支持 http/socks5，可填你科学上网的本地端口。'}
              </p>
              {chainDiagnose && <ChainDiagnosisCard diag={chainDiagnose} isEn={isEn} />}
            </div>
          </CardContent>
        </Card>

        {/* 添加代理 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex flex-wrap items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              {isEn ? 'Add Proxies' : '添加代理'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 单个添加 */}
            <div className="flex flex-wrap gap-2">
              <Input
                value={singleInput}
                onChange={(e) => setSingleInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSingle()}
                placeholder={
                  isEn
                    ? 'http://user:pass@host:port  or  host:port  or  socks5://...'
                    : 'http://user:pass@host:port 或 host:port 或 socks5://...'
                }
                className="font-mono rounded-control text-body h-control"
              />
              <Button onClick={handleAddSingle} disabled={!singleInput.trim()}>
                <Plus className="h-4 w-4" />
                {isEn ? 'Add' : '添加'}
              </Button>
              <Button variant="outline" onClick={() => setBulkOpen(!bulkOpen)}>
                <Upload className="h-4 w-4" />
                {isEn ? 'Bulk' : '批量'}
              </Button>
            </div>

            {/* 批量导入 */}
            {bulkOpen && (
              <div className="space-y-2 p-3 bg-muted/30 rounded-panel border border-dashed">
                <Label className="text-caption">
                  {isEn
                    ? 'One proxy per line. Supports: http(s)://host:port, user:pass@host:port, host:port:user:pass, socks5://...'
                    : '每行一个代理。支持格式: http(s)://host:port、user:pass@host:port、host:port:user:pass、socks5://...'}
                </Label>
                <textarea
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows={5}
                  className="w-full py-2 border font-mono resize-none rounded-control text-body border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                  placeholder={
                    'http://127.0.0.1:7890\nuser:pass@1.2.3.4:8080\nsocks5://example.com:1080'
                  }
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBulkInput('')
                      setBulkOpen(false)
                    }}
                  >
                    {isEn ? 'Cancel' : '取消'}
                  </Button>
                  <Button size="sm" onClick={handleImport} disabled={!bulkInput.trim()}>
                    <FileText className="h-4 w-4" />
                    {isEn ? 'Import' : '导入'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 统计 + 工具栏 */}
        <Card>
          <CardContent className="py-3 space-y-3">
            <div className="flex items-center gap-4 text-body flex-wrap">
              <span className="text-muted-foreground">
                {isEn ? 'Total:' : '总计：'}{' '}
                <strong className="text-foreground">{stats.total}</strong>
              </span>
              <Badge
                variant="outline"
                className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950/30"
              >
                {isEn ? 'Alive' : '可用'}: {stats.alive}
              </Badge>
              <Badge
                variant="outline"
                className="text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30"
              >
                {isEn ? 'Slow' : '较慢'}: {stats.slow}
              </Badge>
              <Badge
                variant="outline"
                className="text-red-600 border-red-200 bg-red-50 dark:bg-red-950/30"
              >
                {isEn ? 'Dead' : '失效'}: {stats.dead}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {isEn ? 'Untested' : '未测试'}: {stats.untested}
              </Badge>
              <span className="ml-auto text-caption text-muted-foreground">
                {isEn ? `${stats.enabled} enabled` : `${stats.enabled} 已启用`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={
                  isEn
                    ? 'Search any field (host/port/protocol/user/email/label/url)...'
                    : '搜索任意字段（host/端口/协议/user/邮箱/备注/URL）...'
                }
                className="max-w-md rounded-control text-body h-control"
              />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | ProxyEntry['status'])}
                className="border rounded-control text-body h-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
              >
                <option value="all">{isEn ? 'All Status' : '全部状态'}</option>
                <option value="alive">{isEn ? 'Alive' : '可用'}</option>
                <option value="slow">{isEn ? 'Slow' : '较慢'}</option>
                <option value="dead">{isEn ? 'Dead' : '失效'}</option>
                <option value="untested">{isEn ? 'Untested' : '未测试'}</option>
              </select>

              <Button
                size="sm"
                variant={
                  advancedSearchOpen || activeAdvancedFilterCount > 0 ? 'default' : 'outline'
                }
                className="h-8"
                onClick={() => setAdvancedSearchOpen(!advancedSearchOpen)}
              >
                {isEn ? 'Advanced' : '高级'}
                {activeAdvancedFilterCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-background/30 text-caption">
                    {activeAdvancedFilterCount}
                  </span>
                )}
              </Button>

              {(filterText || filterStatus !== 'all' || activeAdvancedFilterCount > 0) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => {
                    setFilterText('')
                    setFilterStatus('all')
                    clearAdvancedFilters()
                  }}
                >
                  {isEn ? 'Clear' : '清空'}
                </Button>
              )}

              <div className="w-px h-6 bg-border" />

              <Button
                size="sm"
                variant="outline"
                onClick={handleValidateAll}
                disabled={isValidatingAll || filtered.length === 0}
              >
                {isValidatingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isEn ? `Test All (${filtered.length})` : `全部测试 (${filtered.length})`}
              </Button>

              {selectedIds.size > 0 && (
                <>
                  <Button size="sm" variant="outline" onClick={handleValidateSelected}>
                    <RefreshCw className="h-4 w-4" />
                    {isEn
                      ? `Test Selected (${selectedIds.size})`
                      : `测试选中 (${selectedIds.size})`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={handleDeleteSelected}
                  >
                    <Trash2 className="h-4 w-4" />
                    {isEn ? `Delete (${selectedIds.size})` : `删除 (${selectedIds.size})`}
                  </Button>
                </>
              )}

              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemoveDead}
                disabled={stats.dead === 0}
              >
                <XCircle className="h-4 w-4" />
                {isEn ? 'Remove Dead' : '移除失效'}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="text-destructive ml-auto"
                onClick={() => {
                  if (proxies.length === 0) return
                  if (confirm(isEn ? 'Clear all proxies?' : '确定清空所有代理？')) clearProxyPool()
                }}
                disabled={proxies.length === 0}
              >
                <Trash2 className="h-4 w-4" />
                {isEn ? 'Clear All' : '清空'}
              </Button>

              <div className="flex flex-wrap items-center gap-2 text-caption">
                <span className="text-muted-foreground">{isEn ? 'Concurrency:' : '并发:'}</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={testConcurrency}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v) && v >= 1) setTestConcurrency(v)
                  }}
                  className="w-14 text-center rounded-control text-body h-control"
                />
              </div>
            </div>

            {/* 高级搜索折叠面板：协议 / 启用 / 延迟 / 最后验证 */}
            {advancedSearchOpen && (
              <div className="flex flex-wrap items-center gap-2 p-3 rounded-panel border bg-muted/30 mt-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-caption text-muted-foreground">
                    {isEn ? 'Protocol:' : '协议:'}
                  </span>
                  <select
                    value={filterProtocol}
                    onChange={(e) =>
                      setFilterProtocol(e.target.value as 'all' | ProxyEntry['protocol'])
                    }
                    className="border rounded-control text-body h-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                  >
                    <option value="all">{isEn ? 'All' : '全部'}</option>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks5">SOCKS5</option>
                    <option value="socks4">SOCKS4</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-caption text-muted-foreground">
                    {isEn ? 'Enabled:' : '启用:'}
                  </span>
                  <select
                    value={filterEnabled}
                    onChange={(e) =>
                      setFilterEnabled(e.target.value as 'all' | 'enabled' | 'disabled')
                    }
                    className="border rounded-control text-body h-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                  >
                    <option value="all">{isEn ? 'All' : '全部'}</option>
                    <option value="enabled">{isEn ? 'Enabled' : '已启用'}</option>
                    <option value="disabled">{isEn ? 'Disabled' : '已停用'}</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-caption text-muted-foreground">
                    {isEn ? 'Latency:' : '延迟:'}
                  </span>
                  <select
                    value={filterLatency}
                    onChange={(e) =>
                      setFilterLatency(
                        e.target.value as 'all' | 'fast' | 'medium' | 'slow' | 'unknown'
                      )
                    }
                    className="border rounded-control text-body h-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                  >
                    <option value="all">{isEn ? 'All' : '全部'}</option>
                    <option value="fast">{isEn ? '< 200ms (Fast)' : '< 200ms（快）'}</option>
                    <option value="medium">{isEn ? '200-1000ms' : '200-1000ms'}</option>
                    <option value="slow">{isEn ? '> 1000ms (Slow)' : '> 1000ms（慢）'}</option>
                    <option value="unknown">{isEn ? 'Unknown' : '未知'}</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-caption text-muted-foreground">
                    {isEn ? 'Tested:' : '验证于:'}
                  </span>
                  <select
                    value={filterTestedWithin}
                    onChange={(e) =>
                      setFilterTestedWithin(e.target.value as 'all' | '1h' | '1d' | '7d' | 'never')
                    }
                    className="border rounded-control text-body h-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                  >
                    <option value="all">{isEn ? 'Any time' : '任意时间'}</option>
                    <option value="1h">{isEn ? 'Last 1h' : '最近 1 小时'}</option>
                    <option value="1d">{isEn ? 'Last 1 day' : '最近 1 天'}</option>
                    <option value="7d">{isEn ? 'Last 7 days' : '最近 7 天'}</option>
                    <option value="never">{isEn ? 'Never tested' : '从未测试'}</option>
                  </select>
                </div>

                {activeAdvancedFilterCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 ml-auto"
                    onClick={clearAdvancedFilters}
                  >
                    {isEn ? 'Reset' : '重置'}
                  </Button>
                )}

                <div className="w-full text-caption text-muted-foreground mt-1">
                  {isEn
                    ? `Matched ${filtered.length} of ${proxies.length}`
                    : `匹配 ${filtered.length} / ${proxies.length}`}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 反代账号-代理 N:1 分桶 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex flex-wrap items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              {isEn ? 'Reverse Proxy: Account-to-IP Bucketing' : '反代分桶（账号绑定代理 IP）'}
              <span className="text-caption font-normal text-muted-foreground">
                {isEn
                  ? '— Limit accounts per IP to avoid risk-control association'
                  : '— 限制每 IP 账号数，避免被风控关联'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 统计 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-caption">
              <div className="p-4 bg-muted rounded-panel">
                <div className="text-caption text-muted-foreground">
                  {isEn ? 'Active Accounts' : '可用账号'}
                </div>
                <div className="text-metric font-semibold">{bindingStats.totalActive}</div>
              </div>
              <div className="p-4 bg-success-soft rounded-panel">
                <div className="text-caption text-muted-foreground">
                  {isEn ? 'Bound' : '已绑定'}
                </div>
                <div className="text-metric font-semibold text-green-600">
                  {bindingStats.boundCount}
                </div>
              </div>
              <div className="p-4 bg-warning-soft rounded-panel">
                <div className="text-caption text-muted-foreground">
                  {isEn ? 'Unbound' : '未绑定'}
                </div>
                <div className="text-metric font-semibold text-amber-600">
                  {bindingStats.unboundCount}
                </div>
              </div>
              <div className="p-4 bg-muted rounded-panel">
                <div className="text-caption text-muted-foreground">
                  {isEn ? 'Alive Proxies' : '可用代理'}
                </div>
                <div className="text-metric font-semibold text-cyan-600">
                  {bindingStats.aliveProxyCount}
                </div>
              </div>
            </div>

            {/* 风险提示 */}
            {bindingStats.overloadedProxies.length > 0 && (
              <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-control text-caption">
                <div className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-300">
                  <XCircle className="h-3.5 w-3.5" />
                  {isEn ? 'Risk: Overloaded proxies' : '风险：超载代理'}
                </div>
                <p className="text-muted-foreground mt-1">
                  {isEn
                    ? `${bindingStats.overloadedProxies.length} proxy/proxies are carrying more than 10 accounts. Consider re-distributing.`
                    : `${bindingStats.overloadedProxies.length} 个代理承载了超过 10 个账号，建议重新分配。`}
                </p>
              </div>
            )}

            {/* 自动分配 */}
            <div className="flex items-center gap-3 flex-wrap p-3 bg-muted/20 rounded-panel border border-dashed">
              <div className="flex flex-wrap items-center gap-2">
                <Shuffle className="h-4 w-4 text-primary" />
                <Label className="text-body">{isEn ? 'Accounts per proxy' : '每代理承载'}:</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={accountsPerProxy}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v) && v >= 0) setAccountsPerProxy(v)
                  }}
                  className="w-20 shrink-0 text-center rounded-control text-body h-control"
                />
                <span className="text-caption text-muted-foreground italic">
                  {accountsPerProxy === 0
                    ? isEn
                      ? '(0 = even split)'
                      : '(0 = 均分)'
                    : isEn
                      ? `accounts → 1 IP`
                      : '账号 / IP'}
                </span>
              </div>
              <Button
                size="sm"
                onClick={() => handleAutoDistribute(true)}
                disabled={bindingStats.unboundCount === 0}
              >
                <Users className="h-4 w-4" />
                {isEn
                  ? `Auto-Bind Unbound (${bindingStats.unboundCount})`
                  : `自动绑定未分配 (${bindingStats.unboundCount})`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleAutoDistribute(false)}>
                <RefreshCw className="h-4 w-4" />
                {isEn ? 'Re-Distribute All' : '重新分配全部'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive ml-auto"
                onClick={() => {
                  if (bindingStats.boundCount === 0) return
                  if (
                    confirm(
                      isEn
                        ? `Unbind all ${bindingStats.boundCount} accounts?`
                        : `解绑全部 ${bindingStats.boundCount} 个账号？`
                    )
                  ) {
                    clearAccountProxyBindings()
                  }
                }}
                disabled={bindingStats.boundCount === 0}
              >
                <Unlink className="h-4 w-4" />
                {isEn ? 'Unbind All' : '解绑全部'}
              </Button>
            </div>

            {/* 详细绑定关系（折叠） */}
            <button
              onClick={() => setBindingPanelExpanded(!bindingPanelExpanded)}
              className="text-caption text-primary hover:underline flex items-center gap-1"
            >
              {bindingPanelExpanded
                ? isEn
                  ? '▼ Hide binding details'
                  : '▼ 隐藏绑定明细'
                : isEn
                  ? '▶ Show binding details'
                  : '▶ 显示绑定明细'}
            </button>

            {bindingPanelExpanded && (
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded-panel">
                <ProxyBindingDetails proxies={proxies} boundByProxy={boundByProxy} accounts={accounts} unbindAccountFromProxy={unbindAccountFromProxy} isEn={isEn} />
                {bindingStats.unboundCount > 0 && (
                  <div className="p-2 bg-amber-50 dark:bg-amber-950/10 text-caption">
                    <span className="text-amber-700 dark:text-amber-300">
                      {isEn
                        ? `${bindingStats.unboundCount} accounts have no proxy binding (will use global proxy / direct).`
                        : `${bindingStats.unboundCount} 个账号未绑定代理（将走全局代理 / 直连）`}
                    </span>
                  </div>
                )}
                {bindingStats.boundCount === 0 && (
                  <div className="p-4 text-center text-caption text-muted-foreground">
                    {isEn
                      ? 'No bindings yet. Click "Auto-Bind" above to start.'
                      : '尚无绑定。点击上方"自动绑定"开始。'}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 代理列表 */}
        {filtered.length > 0 ? (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {/* 表头 */}
              <div className="flex items-center min-w-[1120px] gap-3 py-2 pr-3 pl-2 border-b text-caption font-medium text-muted-foreground bg-muted/30">
                <button onClick={toggleSelectAll} className="flex-shrink-0">
                  <input
                    type="checkbox"
                    readOnly
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    className="cursor-pointer"
                  />
                </button>
                <span className="w-12 text-center">{isEn ? 'On' : '启用'}</span>
                <span className="flex-1">URL</span>
                <span className="w-[120px] shrink-0 text-center">{isEn ? 'Status' : '状态'}</span>
                <span className="w-20 shrink-0 text-center">{isEn ? 'Used' : '使用'}</span>
                <span className="w-20 shrink-0 text-center">{isEn ? 'Failed' : '失败'}</span>
                <span className="w-32 shrink-0 text-center">
                  {isEn ? 'External IP / Email' : '出口 IP / 邮箱'}
                </span>
                <span className="w-[136px] shrink-0 text-center">{isEn ? 'Actions' : '操作'}</span>
              </div>

              <ProxyVirtualList
                filtered={filtered}
                selectedIds={selectedIds}
                onSelect={toggleSelect}
                onToggle={toggleProxyEnabled}
                onTest={validateProxy}
                onDelete={removeProxy}
                onSaveLabel={(id, label) => updateProxy(id, { label })}
                isEn={isEn}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-body">
                {proxies.length === 0
                  ? isEn
                    ? 'No proxies yet. Add some to begin.'
                    : '暂无代理。先添加一些代理。'
                  : isEn
                    ? 'No proxies match the current filter.'
                    : '当前筛选无匹配代理。'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

interface ProxyRowProps {
  proxy: ProxyEntry
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onTest: () => Promise<unknown>
  onDelete: () => void
  onSaveLabel: (label?: string) => void
  isEn: boolean
}

function ProxyRow({
  proxy,
  selected,
  onSelect,
  onToggle,
  onTest,
  onDelete,
  onSaveLabel,
  isEn
}: ProxyRowProps): React.ReactNode {
  // 脱敏密码部分
  const displayUrl = useMemo(() => {
    if (!proxy.password) return proxy.url
    return proxy.url.replace(/:([^:@\/]+)@/, ':***@')
  }, [proxy.url, proxy.password])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(proxy.url)
  }

  // 备注 inline 编辑：点击铅笔/徽章进入编辑，回车/失焦保存，ESC 取消
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(proxy.label || '')
  const startEditLabel = (): void => {
    setLabelDraft(proxy.label || '')
    setEditingLabel(true)
  }
  const saveLabel = (): void => {
    const v = labelDraft.trim()
    if (v !== (proxy.label || '')) onSaveLabel(v || undefined)
    setEditingLabel(false)
  }

  return (
    <div
      className={cn(
        'flex h-[58px] min-w-[1120px] items-center gap-3 py-2.5 pr-3 pl-2 border-b last:border-b-0 hover:bg-muted text-caption transition-colors',
        selected && 'bg-muted',
        !proxy.enabled && 'opacity-60'
      )}
      data-proxy-id={proxy.id}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        className="flex-shrink-0 cursor-pointer"
      />
      <button
        onClick={onToggle}
        className="w-12 h-7 shrink-0 flex items-center justify-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground"
        title={isEn ? (proxy.enabled ? 'Disable' : 'Enable') : proxy.enabled ? '停用' : '启用'}
      >
        {proxy.enabled ? (
          <Power className="h-4 w-4 text-green-500" />
        ) : (
          <PowerOff className="h-4 w-4" />
        )}
      </button>
      <span
        className="flex-1 min-w-[160px] font-mono truncate flex items-center"
        title={displayUrl}
      >
        <span className="opacity-50 mr-1 flex-shrink-0">{proxy.protocol}://</span>
        <span className="truncate">
          {proxy.host}:{proxy.port}
          {proxy.username && <span className="opacity-50 ml-1">@{proxy.username}</span>}
        </span>
        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={saveLabel}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLabel()
              else if (e.key === 'Escape') {
                setLabelDraft(proxy.label || '')
                setEditingLabel(false)
              }
            }}
            placeholder={isEn ? 'Note' : '备注'}
            className="ml-2 border font-sans w-28 flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-primary rounded-control text-body h-control border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20"
          />
        ) : proxy.label ? (
          <Badge
            variant="outline"
            className="ml-2 cursor-pointer hover:bg-muted flex-shrink-0"
            onClick={startEditLabel}
            title={isEn ? 'Click to edit note' : '点击编辑备注'}
          >
            {proxy.label}
          </Badge>
        ) : null}
      </span>
      <span className="w-[120px] shrink-0 flex justify-center">
        <StatusBadge status={proxy.status} latency={proxy.latencyMs} />
      </span>
      <span className="w-20 shrink-0 text-center font-mono tabular-nums">{proxy.usedCount}</span>
      <span
        className={cn(
          'w-20 shrink-0 text-center font-mono tabular-nums',
          proxy.failCount > 0 && 'text-amber-600'
        )}
      >
        {proxy.failCount}
      </span>
      <span
        className="w-32 shrink-0 text-center text-caption truncate"
        title={proxy.lastBoundEmail}
      >
        {proxy.lastBoundEmail ? (
          <span className="text-muted-foreground">{proxy.lastBoundEmail}</span>
        ) : proxy.lastTestedAt ? (
          <span className="text-muted-foreground inline-flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {Math.round((Date.now() - proxy.lastTestedAt) / 60000)}m
          </span>
        ) : (
          <span className="opacity-40">-</span>
        )}
      </span>
      <span className="w-[136px] shrink-0 flex justify-center gap-2 [&_svg]:size-4 [&_svg]:stroke-[1.5]">
        <button
          onClick={() => void onTest()}
          disabled={proxy.status === 'testing'}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control hover:bg-muted"
          title={isEn ? 'Test' : '测试'}
        >
          {proxy.status === 'testing' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={startEditLabel}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control hover:bg-muted"
          title={isEn ? 'Edit note' : '编辑备注'}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleCopy}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control hover:bg-muted"
          title={isEn ? 'Copy URL' : '复制 URL'}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control hover:bg-destructive/10 text-destructive"
          title={isEn ? 'Delete' : '删除'}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}

/**
 * 代理列表虚拟化渲染（处理几百到几千个代理时避免卡顿）
 * 行高 58px（含 padding 和 border）
 */
interface ProxyVirtualListProps {
  filtered: ProxyEntry[]
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onTest: (id: string) => Promise<unknown>
  onDelete: (id: string) => void
  onSaveLabel: (id: string, label?: string) => void
  isEn: boolean
}

function ProxyVirtualList({
  filtered,
  selectedIds,
  onSelect,
  onToggle,
  onTest,
  onDelete,
  onSaveLabel,
  isEn
}: ProxyVirtualListProps): React.ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)
  const ROW_HEIGHT = 58

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  // 行数较少（< 50）时不虚拟，直接渲染避免虚拟列表布局开销
  if (filtered.length < 50) {
    return (
      <div ref={parentRef} className="max-h-[60vh] overflow-y-auto">
        {filtered.map((p) => (
          <ProxyRow
            key={p.id}
            proxy={p}
            selected={selectedIds.has(p.id)}
            onSelect={() => onSelect(p.id)}
            onToggle={() => onToggle(p.id)}
            onTest={() => onTest(p.id)}
            onDelete={() => onDelete(p.id)}
            onSaveLabel={(label) => onSaveLabel(p.id, label)}
            isEn={isEn}
          />
        ))}
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  return (
    <div ref={parentRef} className="h-[60vh] overflow-y-auto" style={{ contain: 'strict' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((virtualRow) => {
          const p = filtered[virtualRow.index]
          if (!p) return null
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              <ProxyRow
                proxy={p}
                selected={selectedIds.has(p.id)}
                onSelect={() => onSelect(p.id)}
                onToggle={() => onToggle(p.id)}
                onTest={() => onTest(p.id)}
                onDelete={() => onDelete(p.id)}
                onSaveLabel={(label) => onSaveLabel(p.id, label)}
                isEn={isEn}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
