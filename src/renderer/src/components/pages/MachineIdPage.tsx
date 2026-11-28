import { PageHeader } from '../layout/PageHeader'
import { useEffect, useState, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { OSType } from '../../../../shared/machineId'
import { MachineIdBindingsDialog, MachineIdHistoryDialog } from '../machineId/MachineIdDialogs'
import { useMachineIdClipboard } from '../machineId/useMachineIdClipboard'
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
  AlertTriangle,
  CheckCircle,
  Monitor,
  Edit3,
  Check,
  Users
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
    setMachineIdConfig,
    refreshCurrentMachineId,
    changeMachineId,
    restoreOriginalMachineId,
    machineIdBusy,
    machineIdError,
    machineIdWarning
  } = useAccountsStore(
    useShallow((s) => ({
      machineIdConfig: s.machineIdConfig,
      currentMachineId: s.currentMachineId,
      originalMachineId: s.originalMachineId,
      originalBackupTime: s.originalBackupTime,
      accountMachineIds: s.accountMachineIds,
      machineIdHistory: s.machineIdHistory,
      setMachineIdConfig: s.setMachineIdConfig,
      refreshCurrentMachineId: s.refreshCurrentMachineId,
      changeMachineId: s.changeMachineId,
      restoreOriginalMachineId: s.restoreOriginalMachineId,
      clearMachineIdHistory: s.clearMachineIdHistory,
      machineIdBusy: s.machineIdBusy,
      machineIdError: s.machineIdError,
      machineIdWarning: s.machineIdWarning
    }))
  )

  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'
  const [localLoading, setIsLoading] = useState(false)
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null)
  const [osType, setOsType] = useState<OSType>('unknown')
  const [customMachineId, setCustomMachineId] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showAccountBindings, setShowAccountBindings] = useState(false)
  const { copiedId, copyToClipboard } = useMachineIdClipboard()
  const isLoading = localLoading || machineIdBusy
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    setIsLoading(true)
    void refreshCurrentMachineId().finally(() => {
      if (mounted.current) setIsLoading(false)
    })
    void Promise.all([window.api.machineIdGetOSType(), window.api.machineIdCheckAdmin()])
      .then(([os, admin]) => {
        if (mounted.current) {
          setOsType(os)
          setHasAdmin(admin)
        }
      })
      .catch((error) => {
        if (mounted.current) useAccountsStore.setState({ machineIdError: String(error) })
      })
    return () => {
      mounted.current = false
    }
  }, [refreshCurrentMachineId])

  // 随机生成并应用新机器码
  const handleRandomChange = async () => {
    setIsLoading(true)
    try {
      await changeMachineId()
    } finally {
      if (mounted.current) setIsLoading(false)
    }
  }

  // 应用自定义机器码
  const handleCustomChange = async () => {
    if (!customMachineId.trim()) return
    setIsLoading(true)
    try {
      const snapshot = customMachineId.trim()
      if (await changeMachineId(snapshot))
        setCustomMachineId((value) => (value.trim() === snapshot ? '' : value))
    } finally {
      if (mounted.current) setIsLoading(false)
    }
  }

  // 恢复原始机器码
  const handleRestore = async () => {
    setIsLoading(true)
    try {
      await restoreOriginalMachineId()
    } finally {
      if (mounted.current) setIsLoading(false)
    }
  }

  // 备份机器码到文件
  const handleBackupToFile = async () => {
    if (!currentMachineId) return
    try {
      const result = await window.api.machineIdBackupToFile(currentMachineId)
      if (!result.success && !result.cancelled)
        useAccountsStore.setState({
          machineIdError: result.error || (isEn ? 'Backup failed' : '备份失败')
        })
    } catch (error) {
      useAccountsStore.setState({ machineIdError: String(error) })
    }
  }

  // 从文件恢复机器码
  const handleRestoreFromFile = async () => {
    setIsLoading(true)
    try {
      const result = await window.api.machineIdRestoreFromFile()
      if (result.success && result.machineId) {
        await changeMachineId(result.machineId)
      } else if (!result.cancelled)
        useAccountsStore.setState({
          machineIdError: result.error || (isEn ? 'Import failed' : '导入失败')
        })
    } catch (error) {
      useAccountsStore.setState({ machineIdError: String(error) })
    } finally {
      if (mounted.current) setIsLoading(false)
    }
  }

  // 请求管理员权限
  const handleRequestAdmin = async () => {
    try {
      if (!(await window.api.machineIdRequestAdminRestart()))
        useAccountsStore.setState({
          machineIdError: isEn
            ? 'Authorization or restart was cancelled or failed'
            : '授权或重启未完成，请重试'
        })
    } catch (error) {
      useAccountsStore.setState({ machineIdError: String(error) })
    }
  }

  // 格式化时间
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(isEn ? 'en-US' : 'zh-CN')
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
        {(machineIdError || machineIdWarning) && (
          <div
            role="status"
            className={cn(
              'rounded-panel border p-3 text-body',
              machineIdError ? 'text-destructive' : 'text-warning'
            )}
          >
            {machineIdError || machineIdWarning}
          </div>
        )}
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
                      if (mounted.current) setIsLoading(false)
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
        {showAccountBindings && (
          <MachineIdBindingsDialog onClose={() => setShowAccountBindings(false)} />
        )}

        {/* 历史记录对话框 */}
        {showHistory && <MachineIdHistoryDialog onClose={() => setShowHistory(false)} />}

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
