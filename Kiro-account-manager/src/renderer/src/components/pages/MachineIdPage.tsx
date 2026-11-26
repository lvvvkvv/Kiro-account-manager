import { PageHeader } from '../layout/PageHeader'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccountsStore } from '@/store/accounts'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '../ui'
import { useTranslation } from '@/hooks/useTranslation'
import {
  Fingerprint,
  RefreshCw,
  RotateCcw,
  Copy,
  Download,
  Upload,
  Shield,
  Link2,
  Shuffle,
  History,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Monitor,
  Edit3,
  Check,
  X,
  Users,
  Search
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function MachineIdPage() {
  const {
    machineIdConfig,
    currentMachineId,
    originalMachineId,
    originalBackupTime,
    accountMachineIds,
    machineIdHistory,
    accounts,
    setMachineIdConfig,
    refreshCurrentMachineId,
    changeMachineId,
    restoreOriginalMachineId,
    clearMachineIdHistory,
    bindMachineIdToAccount
  } = useAccountsStore()

  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const [isLoading, setIsLoading] = useState(false)
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null)
  const [osType, setOsType] = useState<string>('unknown')
  const [customMachineId, setCustomMachineId] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showAccountBindings, setShowAccountBindings] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [editingMachineId, setEditingMachineId] = useState('')
  const [accountSearchQuery, setAccountSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 初始化
  useEffect(() => {
    const init = async () => {
      setIsLoading(true)
      try {
        // 获取操作系统类型
        const os = await window.api.machineIdGetOSType()
        setOsType(os)

        // 检查管理员权限
        const admin = await window.api.machineIdCheckAdmin()
        setHasAdmin(admin)

        // 刷新当前机器码
        await refreshCurrentMachineId()
      } catch (error) {
        console.error('初始化失败:', error)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [refreshCurrentMachineId])

  // 复制机器码到剪贴板
  const copyToClipboard = (text: string, id: string = 'default') => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  // 随机生成并应用新机器码
  const handleRandomChange = async () => {
    setIsLoading(true)
    try {
      await changeMachineId()
      await refreshCurrentMachineId()
    } finally {
      setIsLoading(false)
    }
  }

  // 应用自定义机器码
  const handleCustomChange = async () => {
    if (!customMachineId.trim()) return
    setIsLoading(true)
    try {
      await changeMachineId(customMachineId.trim())
      await refreshCurrentMachineId()
      setCustomMachineId('')
    } finally {
      setIsLoading(false)
    }
  }

  // 恢复原始机器码
  const handleRestore = async () => {
    setIsLoading(true)
    try {
      await restoreOriginalMachineId()
      await refreshCurrentMachineId()
    } finally {
      setIsLoading(false)
    }
  }

  // 备份机器码到文件
  const handleBackupToFile = async () => {
    if (!currentMachineId) return
    await window.api.machineIdBackupToFile(currentMachineId)
  }

  // 从文件恢复机器码
  const handleRestoreFromFile = async () => {
    setIsLoading(true)
    try {
      const result = await window.api.machineIdRestoreFromFile()
      if (result.success && result.machineId) {
        await changeMachineId(result.machineId)
        await refreshCurrentMachineId()
      }
    } finally {
      setIsLoading(false)
    }
  }

  // 请求管理员权限
  const handleRequestAdmin = async () => {
    await window.api.machineIdRequestAdminRestart()
  }

  // 生成随机 UUID
  const generateRandomUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  // 开始编辑账户机器码
  const startEditAccountMachineId = (accountId: string) => {
    setEditingAccountId(accountId)
    setEditingMachineId(accountMachineIds[accountId] || '')
  }

  // 保存账户机器码
  const saveAccountMachineId = (accountId: string) => {
    if (editingMachineId.trim()) {
      bindMachineIdToAccount(accountId, editingMachineId.trim())
    }
    setEditingAccountId(null)
    setEditingMachineId('')
  }

  // 取消编辑
  const cancelEditAccountMachineId = () => {
    setEditingAccountId(null)
    setEditingMachineId('')
  }

  // 为账户生成随机机器码
  const randomizeAccountMachineId = (accountId: string) => {
    const newMachineId = generateRandomUUID()
    bindMachineIdToAccount(accountId, newMachineId)
    if (editingAccountId === accountId) {
      setEditingMachineId(newMachineId)
    }
  }

  // 删除账户机器码绑定
  const removeAccountMachineId = (accountId: string) => {
    const { accountMachineIds: currentBindings } = useAccountsStore.getState()
    const newBindings = { ...currentBindings }
    delete newBindings[accountId]
    useAccountsStore.setState({ accountMachineIds: newBindings })
    useAccountsStore.getState().saveToStorage()
  }

  // 格式化时间
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  // 获取操作系统显示名称
  const getOSName = () => {
    switch (osType) {
      case 'windows':
        return 'Windows'
      case 'macos':
        return 'macOS'
      case 'linux':
        return 'Linux'
      default:
        return isEn ? 'Unknown' : '未知'
    }
  }

  // 获取账户绑定数量
  const boundAccountCount = Object.keys(accountMachineIds).length

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-body">
      {/* Hero Header */}
      <PageHeader
        icon={<Fingerprint />}
        title={<>{isEn ? 'Machine ID' : '机器码管理'}</>}
        subtitle={
          <>
            {isEn
              ? 'Manage device identifier to prevent account bans'
              : '管理设备标识符，防止账号关联和封禁'}
          </>
        }
        titleExtra={
          <Badge variant="outline" className="bg-card">
            <Monitor className="h-3 w-3 mr-0" />
            {getOSName()}
          </Badge>
        }
      />
      <div className="space-y-7 px-6 pt-4 pb-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 rounded-panel bg-card border border-border">
            <div className="flex items-center gap-3">
              <Fingerprint className="h-4 w-4 text-primary" />
              <div>
                <p className="text-metric font-semibold">{machineIdHistory.length}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'History' : '变更记录'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-panel bg-card border border-border">
            <div className="flex items-center gap-3">
              <Link2 className="h-4 w-4 text-primary" />
              <div>
                <p className="text-metric font-semibold">{boundAccountCount}</p>
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'Bound Accounts' : '已绑定账户'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-panel bg-card border border-border">
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-primary" />
              <div>
                <p className="text-metric font-semibold">
                  {originalMachineId ? (isEn ? 'Backed' : '已备份') : isEn ? 'None' : '未备份'}
                </p>
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'Original ID' : '原始机器码'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 权限警告 */}
        {hasAdmin === false && (
          <Card className="border-warning/50 overflow-hidden">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-panel bg-warning/20">
                    <AlertTriangle className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <p className="font-medium text-warning">
                      {isEn ? 'Admin Required' : '需要管理员权限'}
                    </p>
                    <p className="text-body text-warning/80">
                      {isEn
                        ? 'Run as administrator to modify machine ID'
                        : '修改机器码需要以管理员身份运行应用'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRequestAdmin}
                  className="border-warning/50 hover:bg-warning/10"
                >
                  <Shield className="h-4 w-4 mr-0" />
                  {isEn ? 'Restart as Admin' : '以管理员重启'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 当前机器码 */}
          <Card className="group relative overflow-hidden transition-all duration-300">
            <CardHeader className="pb-3 relative z-10">
              <CardTitle className="text-section flex items-center gap-2 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
                <Monitor className="h-4 w-4 text-primary" />
                {isEn ? 'Current Machine ID' : '当前机器码'}
                {currentMachineId && currentMachineId !== originalMachineId && (
                  <Badge className="ml-auto bg-primary/10 text-primary border-primary/20">
                    {isEn ? 'Modified' : '已修改'}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 relative z-10">
              <div className="relative group/code">
                <div className="p-4 bg-muted rounded-panel font-mono text-body break-all border border-border text-foreground">
                  {isLoading ? (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      {isEn ? 'Loading...' : '加载中...'}
                    </span>
                  ) : (
                    currentMachineId || (
                      <span className="text-muted-foreground">
                        {isEn ? 'Unable to get' : '无法获取'}
                      </span>
                    )
                  )}
                </div>
              </div>
              {machineIdHistory.length > 0 && (
                <p className="text-caption text-muted-foreground flex items-center gap-1">
                  <History className="h-3 w-3" />
                  {isEn ? 'Last modified:' : '最后修改:'}{' '}
                  {formatTime(machineIdHistory[machineIdHistory.length - 1].timestamp)}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(currentMachineId, 'current')}
                  disabled={!currentMachineId}
                  className="flex-1"
                >
                  {copiedId === 'current' ? (
                    <Check className="h-4 w-4 mr-0 text-success" />
                  ) : (
                    <Copy className="h-4 w-4 mr-0" />
                  )}
                  {copiedId === 'current' ? (isEn ? 'Copied!' : '已复制') : isEn ? 'Copy' : '复制'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setIsLoading(true)
                    try {
                      await refreshCurrentMachineId()
                    } finally {
                      setIsLoading(false)
                    }
                  }}
                  disabled={isLoading}
                  className="flex-1"
                >
                  <RefreshCw className={cn('h-4 w-4 mr-0', isLoading && 'animate-spin')} />
                  {isEn ? 'Refresh' : '刷新'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 原始机器码备份 */}
          <Card className="group relative overflow-hidden transition-all duration-300">
            <CardHeader className="pb-3 relative z-10">
              <CardTitle className="text-section flex items-center gap-2 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
                <Shield className="h-4 w-4 text-primary" />
                {isEn ? 'Original Machine ID Backup' : '原始机器码备份'}
                {originalMachineId && (
                  <Badge className="ml-auto bg-primary/10 text-primary border-primary/20">
                    <CheckCircle className="h-3 w-3 mr-0" />
                    {isEn ? 'Backed Up' : '已备份'}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 relative z-10">
              {originalMachineId ? (
                <>
                  <div className="p-4 rounded-panel font-mono text-body break-all border border-primary/20">
                    {originalMachineId}
                  </div>
                  <p className="text-caption text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-primary" />
                    {isEn ? 'Backup time:' : '备份时间:'}{' '}
                    {originalBackupTime
                      ? formatTime(originalBackupTime)
                      : isEn
                        ? 'Unknown'
                        : '未知'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(originalMachineId, 'original')}
                      className="flex-1"
                    >
                      {copiedId === 'original' ? (
                        <Check className="h-4 w-4 mr-0 text-success" />
                      ) : (
                        <Copy className="h-4 w-4 mr-0" />
                      )}
                      {copiedId === 'original'
                        ? isEn
                          ? 'Copied!'
                          : '已复制'
                        : isEn
                          ? 'Copy'
                          : '复制'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRestore}
                      disabled={isLoading || currentMachineId === originalMachineId}
                      className="flex-1 border-primary/50 hover:bg-primary/10 hover:text-primary"
                    >
                      <RotateCcw className="h-4 w-4 mr-0" />
                      {isEn ? 'Restore' : '恢复原始'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="p-6 text-center rounded-panel border-2 border-dashed border-muted">
                  <Shield className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-muted-foreground text-caption">
                    {isEn
                      ? 'Original ID will be backed up on first change'
                      : '首次修改机器码时将自动备份原始值'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 机器码操作 */}
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="text-section flex items-center gap-2 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Shuffle className="h-4 w-4 text-primary" />
              {isEn ? 'Operations' : '机器码操作'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 随机生成 */}
              <div className="group p-4 rounded-panel border hover:border-primary/50 hover:bg-primary/5 transition-all space-y-4">
                <div className="flex items-center gap-3">
                  <Shuffle className="h-5 w-5" />
                  <div>
                    <h4 className="font-semibold">{isEn ? 'Random Generate' : '随机生成'}</h4>
                    <p className="text-caption text-muted-foreground">
                      {isEn ? 'Generate UUID format machine ID' : '一键生成 UUID 格式机器码'}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleRandomChange}
                  disabled={isLoading}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Shuffle className="h-4 w-4 mr-0" />
                  {isEn ? 'Generate & Apply' : '随机生成并应用'}
                </Button>
              </div>

              {/* 自定义机器码 */}
              <div className="group p-4 rounded-panel border hover:border-primary/50 hover:bg-primary/5 transition-all space-y-4">
                <div className="flex items-center gap-3">
                  <Edit3 className="h-5 w-5" />
                  <div>
                    <h4 className="font-semibold">{isEn ? 'Custom Input' : '自定义输入'}</h4>
                    <p className="text-caption text-muted-foreground">
                      {isEn ? 'Enter a specific machine ID' : '输入指定的机器码'}
                    </p>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder={isEn ? 'Enter UUID format machine ID...' : '输入 UUID 格式机器码...'}
                  value={customMachineId}
                  onChange={(e) => setCustomMachineId(e.target.value)}
                  className="w-full text-body bg-background focus:outline-none transition-all min-w-0 rounded-control border border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                />
                <Button
                  onClick={handleCustomChange}
                  disabled={isLoading || !customMachineId.trim()}
                  variant="outline"
                  className="w-full border-2 hover:bg-primary/10 hover:border-primary/50"
                >
                  {isEn ? 'Apply Custom ID' : '应用自定义机器码'}
                </Button>
              </div>
            </div>

            {/* 文件操作 */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBackupToFile}
                disabled={!currentMachineId}
                className="flex-1 h-control"
              >
                <Download className="h-4 w-4 mr-0" />
                {isEn ? 'Export to File' : '导出到文件'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestoreFromFile}
                disabled={isLoading}
                className="flex-1 h-control"
              >
                <Upload className="h-4 w-4 mr-0" />
                {isEn ? 'Import from File' : '从文件导入'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 自动化设置 */}
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="text-section flex items-center gap-2 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Link2 className="h-4 w-4 text-primary" />
              {isEn ? 'Automation' : '自动化设置'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y">
            {/* 切号时自动更换 */}
            <div className="ui-setting-row">
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'p-2.5 rounded-panel transition-colors',
                    machineIdConfig.autoSwitchOnAccountChange ? 'bg-primary/10' : 'bg-muted'
                  )}
                >
                  <RefreshCw
                    className={cn(
                      'h-5 w-5 transition-colors',
                      machineIdConfig.autoSwitchOnAccountChange
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  />
                </div>
                <div>
                  <p className="font-medium">
                    {isEn ? 'Auto Change on Switch' : '切换账号时自动更换机器码'}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {isEn
                      ? 'Auto generate new ID when switching accounts'
                      : '每次切换账号时自动生成并应用新的机器码'}
                  </p>
                </div>
              </div>
              <Button
                variant={machineIdConfig.autoSwitchOnAccountChange ? 'default' : 'outline'}
                size="sm"
                onClick={() =>
                  setMachineIdConfig({
                    autoSwitchOnAccountChange: !machineIdConfig.autoSwitchOnAccountChange
                  })
                }
                className={cn(
                  'min-w-[80px]',
                  machineIdConfig.autoSwitchOnAccountChange && 'bg-primary hover:bg-primary/90'
                )}
              >
                {machineIdConfig.autoSwitchOnAccountChange
                  ? isEn
                    ? 'On'
                    : '已开启'
                  : isEn
                    ? 'Off'
                    : '已关闭'}
              </Button>
            </div>

            {/* 账户绑定 */}
            <div className="ui-setting-row">
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'p-2.5 rounded-panel transition-colors',
                    machineIdConfig.bindMachineIdToAccount ? 'bg-primary/10' : 'bg-muted'
                  )}
                >
                  <Link2
                    className={cn(
                      'h-5 w-5 transition-colors',
                      machineIdConfig.bindMachineIdToAccount
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  />
                </div>
                <div>
                  <p className="font-medium flex items-center gap-2">
                    {isEn ? 'Account ID Binding' : '账户机器码绑定'}
                    {boundAccountCount > 0 && (
                      <Badge className="bg-primary/10 text-primary border-primary/20">
                        {isEn ? `${boundAccountCount} accounts` : `${boundAccountCount} 个账户`}
                      </Badge>
                    )}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {isEn
                      ? 'Assign unique ID per account, auto-apply on switch'
                      : '为每个账户分配唯一的机器码，切换时自动使用'}
                  </p>
                </div>
              </div>
              <Button
                variant={machineIdConfig.bindMachineIdToAccount ? 'default' : 'outline'}
                size="sm"
                onClick={() =>
                  setMachineIdConfig({
                    bindMachineIdToAccount: !machineIdConfig.bindMachineIdToAccount
                  })
                }
                className={cn(
                  'min-w-[80px]',
                  machineIdConfig.bindMachineIdToAccount && 'bg-primary hover:bg-primary/90'
                )}
              >
                {machineIdConfig.bindMachineIdToAccount
                  ? isEn
                    ? 'On'
                    : '已开启'
                  : isEn
                    ? 'Off'
                    : '已关闭'}
              </Button>
            </div>

            {/* 使用绑定的机器码 */}
            {machineIdConfig.bindMachineIdToAccount && (
              <div className="ui-setting-row bg-muted/30">
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      'p-2 rounded-panel transition-colors',
                      machineIdConfig.useBindedMachineId ? 'bg-primary/10' : 'bg-muted'
                    )}
                  >
                    <CheckCircle
                      className={cn(
                        'h-4 w-4 transition-colors',
                        machineIdConfig.useBindedMachineId
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      )}
                    />
                  </div>
                  <div>
                    <p className="font-medium text-body">
                      {isEn ? 'Use bound machine ID' : '使用绑定的唯一机器码'}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'When off, generates new ID on each switch'
                        : '关闭时每次切换将随机生成新机器码'}
                    </p>
                  </div>
                </div>
                <Button
                  variant={machineIdConfig.useBindedMachineId ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    setMachineIdConfig({ useBindedMachineId: !machineIdConfig.useBindedMachineId })
                  }
                  className={cn(
                    'min-w-[80px]',
                    machineIdConfig.useBindedMachineId && 'bg-primary hover:bg-primary/90'
                  )}
                >
                  {machineIdConfig.useBindedMachineId
                    ? isEn
                      ? 'On'
                      : '已开启'
                    : isEn
                      ? 'Off'
                      : '已关闭'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 快捷操作 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 账户机器码管理按钮 */}
          <Card
            className="group cursor-pointer transition-all duration-300 hover:border-primary/50"
            onClick={() => setShowAccountBindings(true)}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-panel transition-colors">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold group-hover:text-primary transition-colors">
                    {isEn ? 'Account Machine ID' : '账户机器码管理'}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {isEn ? 'View and manage bound machine IDs' : '查看和管理每个账户绑定的机器码'}
                  </p>
                </div>
                <Edit3 className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </CardContent>
          </Card>

          {/* 历史记录按钮 */}
          <Card
            className="group cursor-pointer transition-all duration-300 hover:border-primary/50"
            onClick={() => setShowHistory(true)}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-panel transition-colors">
                  <History className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold group-hover:text-primary transition-colors">
                    {isEn ? 'Change History' : '变更历史记录'}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {isEn
                      ? `${machineIdHistory.length} records`
                      : `共 ${machineIdHistory.length} 条历史记录`}
                  </p>
                </div>
                <History className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 账户机器码管理对话框 */}
        {showAccountBindings &&
          createPortal(
            <div className="ui-dialog-overlay">
              {/* 背景遮罩 */}
              <div
                className="absolute inset-0 bg-transparent"
                onClick={() => setShowAccountBindings(false)}
              />

              {/* 对话框内容 */}
              <div
                className="ui-dialog-panel w-[600px] max-w-[min(600px,calc(100vw-32px))]"
                role="dialog"
                aria-modal="true"
              >
                {/* 标题栏 */}
                <div className="ui-dialog-header flex-row items-center justify-between gap-2 border-b flex-wrap">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    <h2 className="text-title font-semibold min-w-0 break-words">
                      {isEn ? 'Account Machine ID' : '账户机器码管理'}
                    </h2>
                    <Badge variant="secondary">
                      {accounts.size} {isEn ? 'accounts' : '个账户'}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-muted hover:text-foreground transition-colors shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                    onClick={() => setShowAccountBindings(false)}
                    title={isEn ? 'Close' : '关闭'}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* 搜索框 */}
                <div className="shrink-0 px-6 pt-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={accountSearchQuery}
                      onChange={(e) => setAccountSearchQuery(e.target.value)}
                      placeholder={isEn ? 'Search accounts...' : '搜索账户...'}
                      className="w-full pl-9 pr-3 text-body bg-muted border-0 focus:outline-none min-w-0 rounded-control border border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                    />
                    {accountSearchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                        onClick={() => setAccountSearchQuery('')}
                        title={isEn ? 'Clear search' : '清除搜索'}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* 账户列表 */}
                <div className="ui-dialog-body flex-auto min-h-0 py-3 space-y-2">
                  {Array.from(accounts.values())
                    .filter((account) => {
                      if (!accountSearchQuery.trim()) return true
                      const query = accountSearchQuery.toLowerCase()
                      return (
                        account.email?.toLowerCase().includes(query) ||
                        account.nickname?.toLowerCase().includes(query) ||
                        accountMachineIds[account.id]?.toLowerCase().includes(query)
                      )
                    })
                    .map((account) => {
                      const boundMachineId = accountMachineIds[account.id]
                      const isEditing = editingAccountId === account.id

                      return (
                        <div key={account.id} className="p-3 bg-muted rounded-panel">
                          {/* 账户信息行 */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-body font-medium">
                                {(account.nickname || account.email || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-medium text-body truncate max-w-[200px]">
                                  {account.nickname || account.email}
                                </span>
                                {account.nickname && account.email && (
                                  <span className="text-caption text-muted-foreground truncate max-w-[200px]">
                                    {account.email}
                                  </span>
                                )}
                              </div>
                              {boundMachineId && (
                                <Badge
                                  variant="secondary"
                                  className="text-badge bg-success/10 text-success"
                                >
                                  {isEn ? 'Bound' : '已绑定'}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {!isEditing ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                                    onClick={() => startEditAccountMachineId(account.id)}
                                    title={isEn ? 'Edit' : '编辑'}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                                    onClick={() => randomizeAccountMachineId(account.id)}
                                    title={isEn ? 'Random' : '随机'}
                                  >
                                    <Shuffle className="h-3.5 w-3.5" />
                                  </Button>
                                  {boundMachineId && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                                        onClick={() => copyToClipboard(boundMachineId)}
                                        title={isEn ? 'Copy' : '复制'}
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive hover:text-destructive shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                                        onClick={() => removeAccountMachineId(account.id)}
                                        title={isEn ? 'Delete' : '删除'}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </>
                                  )}
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="default"
                                    size="sm"
                                    className="h-control px-2 text-body"
                                    onClick={() => saveAccountMachineId(account.id)}
                                  >
                                    <Check className="h-3.5 w-3.5 mr-0" />
                                    {isEn ? 'Save' : '保存'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-control px-2 text-body"
                                    onClick={cancelEditAccountMachineId}
                                  >
                                    {isEn ? 'Cancel' : '取消'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                                    onClick={() => randomizeAccountMachineId(account.id)}
                                    title={isEn ? 'Random' : '随机'}
                                  >
                                    <Shuffle className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* 机器码显示/编辑 */}
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingMachineId}
                              onChange={(e) => setEditingMachineId(e.target.value)}
                              placeholder={
                                isEn ? 'Enter UUID format machine ID' : '输入 UUID 格式机器码'
                              }
                              className="w-full font-mono bg-background border focus:outline-none min-w-0 rounded-control border-input bg-card px-2.5 text-body focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                              autoFocus
                            />
                          ) : boundMachineId ? (
                            <div className="flex items-center gap-2 px-2 py-1.5 bg-background rounded-control border">
                              <code className="text-caption font-mono flex-1">
                                {boundMachineId}
                              </code>
                            </div>
                          ) : (
                            <div className="px-2 py-1.5 bg-card rounded-control border border-dashed text-center">
                              <span className="text-caption text-muted-foreground">
                                {isEn ? 'Not bound' : '未绑定'}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}

                  {accounts.size === 0 && (
                    <div className="text-center py-12">
                      <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">{isEn ? 'No accounts' : '暂无账户'}</p>
                      <p className="text-caption text-muted-foreground">
                        {isEn ? 'Please add accounts first' : '请先添加账户'}
                      </p>
                    </div>
                  )}

                  {accounts.size > 0 &&
                    accountSearchQuery &&
                    Array.from(accounts.values()).filter((account) => {
                      const query = accountSearchQuery.toLowerCase()
                      return (
                        account.email?.toLowerCase().includes(query) ||
                        account.nickname?.toLowerCase().includes(query) ||
                        accountMachineIds[account.id]?.toLowerCase().includes(query)
                      )
                    }).length === 0 && (
                      <div className="text-center py-8">
                        <Search className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                        <p className="text-muted-foreground">
                          {isEn ? 'No matches found' : '未找到匹配的账户'}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          {isEn ? 'Try other keywords' : '尝试其他关键词'}
                        </p>
                      </div>
                    )}
                </div>

                {/* 底部提示 */}
                <div className="ui-dialog-footer justify-start border-t text-caption text-muted-foreground">
                  {isEn
                    ? '💡 Tip: After binding, switching to this account will auto-apply the bound machine ID'
                    : '💡 提示：绑定机器码后，切换到该账户时会自动应用对应的机器码'}
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* 历史记录对话框 */}
        {showHistory &&
          createPortal(
            <div className="ui-dialog-overlay">
              {/* 背景遮罩 */}
              <div
                className="absolute inset-0 bg-transparent"
                onClick={() => setShowHistory(false)}
              />

              {/* 对话框内容 */}
              <div
                className="ui-dialog-panel w-[550px] max-w-[min(550px,calc(100vw-32px))]"
                role="dialog"
                aria-modal="true"
              >
                {/* 标题栏 */}
                <div className="ui-dialog-header flex-row items-center justify-between gap-2 border-b flex-wrap">
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    <h2 className="text-title font-semibold min-w-0 break-words">
                      {isEn ? 'Change History' : '变更历史'}
                    </h2>
                    <Badge variant="secondary">
                      {machineIdHistory.length} {isEn ? 'records' : '条'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {machineIdHistory.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearMachineIdHistory}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-0" />
                        {isEn ? 'Clear' : '清空'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-muted hover:text-foreground transition-colors shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                      onClick={() => setShowHistory(false)}
                      title={isEn ? 'Close' : '关闭'}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* 历史列表 */}
                <div className="ui-dialog-body flex-auto min-h-0 py-3">
                  {machineIdHistory.length > 0 ? (
                    <div className="space-y-2">
                      {[...machineIdHistory].reverse().map((entry, index) => (
                        <div key={entry.id} className="p-3 bg-muted rounded-panel">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-caption text-muted-foreground">
                                #{machineIdHistory.length - index}
                              </span>
                              <Badge
                                variant="secondary"
                                className={cn(
                                  'text-badge whitespace-nowrap',
                                  entry.action === 'initial' &&
                                    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
                                  entry.action === 'manual' &&
                                    'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
                                  entry.action === 'auto_switch' &&
                                    'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
                                  entry.action === 'restore' &&
                                    'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
                                  entry.action === 'bind' &&
                                    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
                                )}
                              >
                                {entry.action === 'initial' && (isEn ? 'Init' : '初始')}
                                {entry.action === 'manual' && (isEn ? 'Manual' : '手动')}
                                {entry.action === 'auto_switch' && (isEn ? 'Auto' : '自动')}
                                {entry.action === 'restore' && (isEn ? 'Restore' : '恢复')}
                                {entry.action === 'bind' && (isEn ? 'Bind' : '绑定')}
                              </Badge>
                            </div>
                            <span className="text-caption text-muted-foreground">
                              {formatTime(entry.timestamp)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 p-2 bg-background rounded-control border">
                            <code className="text-body flex-1 font-mono">{entry.machineId}</code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0 h-control w-control p-0 rounded-control [&_svg]:size-4"
                              onClick={() => copyToClipboard(entry.machineId)}
                              title={isEn ? 'Copy' : '复制'}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          {entry.accountId && (
                            <p className="text-caption text-muted-foreground mt-2">
                              {isEn ? 'Account: ' : '关联账户: '}
                              {accounts.get(entry.accountId)?.nickname ||
                                accounts.get(entry.accountId)?.email ||
                                entry.accountId}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">
                        {isEn ? 'No change records' : '暂无变更记录'}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {isEn ? 'Changes will be recorded automatically' : '机器码变更后将自动记录'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* 平台说明 */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start gap-4">
              <Shield className="h-5 w-5 text-primary" />
              <div className="space-y-3">
                <p className="font-semibold">{isEn ? 'Platform Notes' : '平台说明'}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 rounded-panel bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Monitor className="h-4 w-4 text-primary" />
                      <span className="font-medium text-body">Windows</span>
                    </div>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Modifies registry MachineGuid, requires admin'
                        : '修改注册表 MachineGuid，需要管理员权限'}
                    </p>
                  </div>
                  <div className="p-3 rounded-panel bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Monitor className="h-4 w-4 text-primary" />
                      <span className="font-medium text-body">macOS</span>
                    </div>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'App-level override, hardware UUID unchanged'
                        : '应用层覆盖方式，原生硬件 UUID 无法修改'}
                    </p>
                  </div>
                  <div className="p-3 rounded-panel bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Monitor className="h-4 w-4 text-primary" />
                      <span className="font-medium text-body">Linux</span>
                    </div>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Modifies /etc/machine-id, requires root'
                        : '修改 /etc/machine-id，需要 root 权限'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-panel bg-warning/10 border border-warning/20">
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                  <p className="text-caption text-warning">
                    {isEn
                      ? 'Changing machine ID may affect some software licenses, proceed with caution'
                      : '修改机器码可能影响部分软件的授权，请谨慎操作'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
