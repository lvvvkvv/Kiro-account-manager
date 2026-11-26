import { useState, useEffect } from 'react'
import { X, Loader2, RefreshCw, Download, CheckCircle, Copy, Check } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../ui'
import { useAccountsStore } from '@/store'
import { useTranslation } from '@/hooks/useTranslation'
import type { Account, SubscriptionType } from '@/types/account'

interface EditAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account | null
}

export function EditAccountDialog({ open, onOpenChange, account }: EditAccountDialogProps) {
  const { updateAccount } = useAccountsStore()
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  // OIDC 凭证（核心）
  const [refreshToken, setRefreshToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [region, setRegion] = useState('us-east-1')

  // 可编辑字段
  const [nickname, setNickname] = useState('')

  // 自动获取的信息（只读显示）
  const [accountInfo, setAccountInfo] = useState<{
    email: string
    userId: string
    accessToken: string
    subscriptionType: string
    subscriptionTitle: string
    usage: {
      current: number
      limit: number
      baseLimit?: number
      baseCurrent?: number
      freeTrialLimit?: number
      freeTrialCurrent?: number
      freeTrialExpiry?: string
      bonuses?: { code: string; name: string; current: number; limit: number; expiresAt?: string }[]
      nextResetDate?: string
    }
    daysRemaining?: number
    expiresAt?: number
  } | null>(null)

  // 状态
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)

  const handleCopyAccessToken = (): void => {
    if (accountInfo?.accessToken) {
      navigator.clipboard.writeText(accountInfo.accessToken)
      setCopiedToken(true)
      setTimeout(() => setCopiedToken(false), 2000)
    }
  }

  // 当账号变化时更新表单
  useEffect(() => {
    if (account) {
      setRefreshToken(account.credentials.refreshToken || '')
      setClientId(account.credentials.clientId || '')
      setClientSecret(account.credentials.clientSecret || '')
      setRegion(account.credentials.region || 'us-east-1')
      setNickname(account.nickname || '')

      // 设置当前账号信息
      setAccountInfo({
        email: account.email,
        userId: account.userId || '',
        accessToken: account.credentials.accessToken,
        subscriptionType: account.subscription.type,
        subscriptionTitle: account.subscription.title || account.subscription.type,
        usage: {
          current: account.usage?.current || 0,
          limit: account.usage?.limit || 0
        },
        daysRemaining: account.subscription.daysRemaining,
        expiresAt: account.subscription.expiresAt
      })
      setError(null)
    }
  }, [account])

  // 从本地配置导入
  const handleImportFromLocal = async () => {
    try {
      const result = await window.api.loadKiroCredentials()
      if (result.success && result.data) {
        setRefreshToken(result.data.refreshToken)
        setClientId(result.data.clientId)
        setClientSecret(result.data.clientSecret)
        setRegion(result.data.region)
        setError(null)
      } else {
        setError(result.error || '导入失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    }
  }

  // 验证并刷新信息
  const handleVerifyAndRefresh = async () => {
    const isSocial = account?.credentials.authMethod === 'social'
    if (!refreshToken) {
      setError('请填写 Refresh Token')
      return
    }
    if (!isSocial && (!clientId || !clientSecret)) {
      setError('请填写 Client ID 和 Client Secret')
      return
    }

    setIsVerifying(true)
    setError(null)

    try {
      const result = await window.api.verifyAccountCredentials({
        refreshToken,
        clientId,
        clientSecret,
        region,
        authMethod: account?.credentials.authMethod,
        provider: account?.credentials.provider || account?.idp
      })

      if (result.success && result.data) {
        setAccountInfo({
          email: result.data.email,
          userId: result.data.userId,
          accessToken: result.data.accessToken,
          subscriptionType: result.data.subscriptionType,
          subscriptionTitle: result.data.subscriptionTitle,
          usage: result.data.usage,
          daysRemaining: result.data.daysRemaining,
          expiresAt: result.data.expiresAt
        })
        // 更新 refreshToken（可能返回新的）
        if (result.data.refreshToken) {
          setRefreshToken(result.data.refreshToken)
        }
      } else {
        setError(result.error || '验证失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证失败')
    } finally {
      setIsVerifying(false)
    }
  }

  // 保存
  const handleSave = () => {
    if (!account || !accountInfo) return

    const now = Date.now()

    updateAccount(account.id, {
      email: accountInfo.email,
      userId: accountInfo.userId,
      nickname: nickname || undefined,
      credentials: {
        ...account.credentials,
        accessToken: accountInfo.accessToken,
        csrfToken: '',
        refreshToken,
        clientId,
        clientSecret,
        region,
        expiresAt: now + 3600 * 1000
      },
      subscription: {
        type: accountInfo.subscriptionType as SubscriptionType,
        title: accountInfo.subscriptionTitle,
        daysRemaining: accountInfo.daysRemaining,
        expiresAt: accountInfo.expiresAt
      },
      usage: {
        current: accountInfo.usage.current,
        limit: accountInfo.usage.limit,
        percentUsed:
          accountInfo.usage.limit > 0 ? accountInfo.usage.current / accountInfo.usage.limit : 0,
        lastUpdated: now,
        baseLimit: accountInfo.usage.baseLimit,
        baseCurrent: accountInfo.usage.baseCurrent,
        freeTrialLimit: accountInfo.usage.freeTrialLimit,
        freeTrialCurrent: accountInfo.usage.freeTrialCurrent,
        freeTrialExpiry: accountInfo.usage.freeTrialExpiry,
        bonuses: accountInfo.usage.bonuses,
        nextResetDate: accountInfo.usage.nextResetDate
      },
      status: 'active'
    })

    onOpenChange(false)
  }

  if (!open || !account) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => onOpenChange(false)} />

      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="EditAccountDialog-title"
        className="ui-dialog-panel rounded-dialog"
      >
        {/* 头部 */}
        <CardHeader className="ui-dialog-header px-6 pt-5 pb-3 space-y-0">
          <div className="flex items-center justify-between">
            <CardTitle id="EditAccountDialog-title" className="text-title font-semibold">
              {isEn ? 'Edit Account' : '编辑账号'}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-control hover:bg-muted transition-colors"
              onClick={() => onOpenChange(false)}
              title={isEn ? 'Close' : '关闭'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-body text-muted-foreground">
            {isEn ? 'Modify account settings or update credentials' : '修改账号配置或更新凭证'}
          </p>
        </CardHeader>

        <CardContent className="ui-dialog-body p-0 px-6 pb-5 space-y-4">
          {/* 当前账号信息 */}
          {accountInfo && (
            <div className="p-4 bg-primary/5 rounded-panel border border-primary/10 space-y-3">
              <div className="flex items-center justify-between border-b border-primary/10 pb-2">
                <span className="text-body font-semibold text-foreground/80">
                  {isEn ? 'Account Status' : '当前账号状态'}
                </span>
                <div className="h-5 px-[7px] rounded-full bg-success/10 text-success text-badge font-medium flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {isEn ? 'Verified' : '已验证'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-body">
                <div>
                  <span className="text-muted-foreground text-caption block mb-1">
                    {isEn ? 'Email' : '邮箱'}
                  </span>
                  <span
                    className="font-medium font-mono text-caption truncate block"
                    title={accountInfo.email}
                  >
                    {accountInfo.email}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground text-caption block mb-1">
                    {isEn ? 'Plan' : '订阅计划'}
                  </span>
                  <span className="font-medium">{accountInfo.subscriptionTitle}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-caption block mb-1">
                    {isEn ? 'Usage' : '使用额度'}
                  </span>
                  <span className="font-medium">
                    {accountInfo.usage.current.toLocaleString()} /{' '}
                    {accountInfo.usage.limit.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground text-caption block mb-1">
                    {isEn ? 'Days Left' : '剩余天数'}
                  </span>
                  <span className="font-medium">
                    {accountInfo.daysRemaining ?? '-'} {isEn ? 'd' : '天'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 别名 */}
          <div className="space-y-2">
            <label className="text-body font-medium">{isEn ? 'Nickname' : '账号别名'}</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={isEn ? 'Give this account a memorable name' : '给这个账号起个好记的名字'}
              className="w-full h-control px-2.5 py-1 text-body rounded-control border border-input bg-card ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0 min-w-0"
            />
          </div>

          {/* 凭证配置 */}
          <div className="space-y-5 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-body font-semibold">
                  {account?.credentials.authMethod === 'social'
                    ? isEn
                      ? 'Social Login'
                      : '社交登录凭证'
                    : isEn
                      ? 'OIDC Credentials'
                      : 'OIDC 凭证配置'}
                </h3>
                {account?.credentials.authMethod === 'social' && (
                  <span className="inline-flex h-5 items-center px-[7px] text-badge rounded-full bg-primary/10 text-primary">
                    {account?.credentials.provider || account?.idp}
                  </span>
                )}
              </div>
              {account?.credentials.authMethod !== 'social' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-control text-body"
                  onClick={handleImportFromLocal}
                >
                  <Download className="h-3 w-3 " />
                  {isEn ? 'Import Local' : '从本地导入'}
                </Button>
              )}
            </div>

            {account?.credentials.authMethod === 'social' && (
              <p className="text-caption text-muted-foreground">
                {isEn
                  ? 'Social login only needs Refresh Token'
                  : '社交登录账号只需要 Refresh Token，不需要 Client ID 和 Client Secret'}
              </p>
            )}

            <div className="space-y-4">
              {/* Access Token (只读，可复制) */}
              {accountInfo?.accessToken && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-body font-medium">Access Token</label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-3 text-body"
                      onClick={handleCopyAccessToken}
                    >
                      {copiedToken ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <Copy className="h-3 w-3 " />
                      )}
                      {copiedToken ? (isEn ? 'Copied' : '已复制') : isEn ? 'Copy' : '复制'}
                    </Button>
                  </div>
                  <div className="w-full px-3 py-2.5 text-body rounded-panel border border-input bg-muted/50 font-mono text-muted-foreground truncate">
                    {accountInfo.accessToken.slice(0, 50)}...
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-body font-medium">
                  Refresh Token <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="aorAAAAA..."
                  className="w-full min-h-[80px] px-2.5 py-1.5 text-body rounded-control border border-input bg-card ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 resize-none font-mono min-w-0"
                />
              </div>

              {account?.credentials.authMethod !== 'social' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-body font-medium">
                        Client ID <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="Client ID"
                        className="w-full h-control px-2.5 py-1 text-body rounded-control border border-input bg-card ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0 font-mono min-w-0"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-body font-medium">
                        Client Secret <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="Client Secret"
                        className="w-full h-control px-2.5 py-1 text-body rounded-control border border-input bg-card ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0 font-mono min-w-0"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-body font-medium">AWS Region</label>
                    <select
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      className="w-full h-control px-2.5 py-1 text-body rounded-control border border-input bg-card ring-offset-background focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0 min-w-0"
                    >
                      <option value="us-east-1">us-east-1 (N. Virginia)</option>
                      <option value="us-west-2">us-west-2 (Oregon)</option>
                      <option value="eu-west-1">eu-west-1 (Ireland)</option>
                    </select>
                  </div>
                </>
              )}

              <Button
                type="button"
                variant="secondary"
                className="w-full h-control rounded-control font-medium"
                onClick={handleVerifyAndRefresh}
                disabled={
                  isVerifying ||
                  !refreshToken ||
                  (account?.credentials.authMethod !== 'social' && (!clientId || !clientSecret))
                }
              >
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 " />
                )}
                {isEn ? 'Verify & Refresh' : '验证并刷新凭证信息'}
              </Button>
            </div>
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-panel text-body flex items-center gap-2 animate-in fade-in slide-in-">
              <div className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
              {error}
            </div>
          )}
        </CardContent>

        {/* 底部按钮 */}
        <div className="ui-dialog-footer">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-control h-control px-3.5"
          >
            {isEn ? 'Cancel' : '取消'}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!accountInfo}
            className="rounded-control h-control px-3.5"
          >
            {isEn ? 'Save Changes' : '保存更改'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
