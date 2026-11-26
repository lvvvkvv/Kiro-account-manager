import { PageHeader } from '../layout/PageHeader'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, Button } from '../ui'
import {
  Heart,
  Code,
  ExternalLink,
  X,
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Info,
  Zap
} from 'lucide-react'
import kiroLogo from '@/assets/kiro-high-resolution-logo-transparent.png'
import { useAccountsStore } from '@/store/accounts'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'

interface UpdateInfo {
  hasUpdate: boolean
  currentVersion?: string
  latestVersion?: string
  releaseNotes?: string
  releaseName?: string
  releaseUrl?: string
  publishedAt?: string
  assets?: Array<{
    name: string
    downloadUrl: string
    size: number
  }>
  error?: string
}

export function AboutPage() {
  const [version, setVersion] = useState('...')
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const { darkMode } = useAccountsStore()
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
    // 不自动检查更新，避免 GitHub API 速率限制
    // 用户可以手动点击"检查更新"按钮
  }, [])

  const checkForUpdates = async (showModal = true) => {
    setIsCheckingUpdate(true)
    try {
      const result = await window.api.checkForUpdatesManual()
      setUpdateInfo(result)
      if (showModal || result.hasUpdate) {
        setShowUpdateModal(true)
      }
    } catch (error) {
      console.error('Check update failed:', error)
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const openReleasePage = () => {
    if (updateInfo?.releaseUrl) {
      window.api.openExternal(updateInfo.releaseUrl)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-body">
      {/* Header */}
      <PageHeader icon={<Info />} title={<>{isEn ? 'About' : '关于本应用'}</>} />
      <div className="space-y-7 px-6 pt-4 pb-6">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <img
              src={kiroLogo}
              alt="Kiro"
              className={cn(
                'h-20 w-auto mx-auto transition-all',
                darkMode && 'invert brightness-0'
              )}
            />

            <h2 className="text-title font-semibold text-center">
              {isEn ? 'Kiro Account Manager' : 'Kiro 账户管理器'}
            </h2>
            <p className="text-caption text-muted-foreground text-center">
              {isEn ? `Version ${version}` : `版本 ${version}`}
            </p>

            <div className="flex gap-2 justify-center flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => checkForUpdates(true)}
                disabled={isCheckingUpdate}
              >
                <RefreshCw className={cn('h-4 w-4', isCheckingUpdate && 'animate-spin')} />
                {isCheckingUpdate
                  ? isEn
                    ? 'Checking...'
                    : '检查中...'
                  : isEn
                    ? 'Check Updates'
                    : '检查更新'}
              </Button>
            </div>

            {/* 更新提示 */}

            {updateInfo?.hasUpdate && !showUpdateModal && (
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-body cursor-pointer hover:bg-primary/20"
                onClick={() => setShowUpdateModal(true)}
              >
                <Download className="h-4 w-4" />
                {isEn
                  ? `New version v${updateInfo.latestVersion}`
                  : `发现新版本 v${updateInfo.latestVersion}`}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 更新弹窗 */}
        {showUpdateModal && updateInfo && (
          <div className="ui-dialog-overlay">
            <div
              className="absolute inset-0 bg-transparent"
              onClick={() => setShowUpdateModal(false)}
            />
            <div className="ui-dialog-panel" role="dialog" aria-modal="true">
              <button
                className="absolute top-4 right-4 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground h-control w-control p-0 rounded-control [&_svg]:size-4"
                onClick={() => setShowUpdateModal(false)}
                title={isEn ? 'Close' : '关闭'}
              >
                <X className="h-5 w-5" />
              </button>

              <div className="ui-dialog-header border-b">
                <h2 className="text-title font-semibold">{isEn ? 'Check Updates' : '检查更新'}</h2>
              </div>
              <div className="ui-dialog-body flex-auto min-h-0 py-3 space-y-4">
                {updateInfo.hasUpdate ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-success/10">
                        <Download className="h-6 w-6 text-success" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-title">
                          {isEn ? 'New Version Available' : '发现新版本'}
                        </h3>
                        <p className="text-caption text-muted-foreground">
                          {updateInfo.currentVersion} → {updateInfo.latestVersion}
                        </p>
                      </div>
                    </div>

                    <div className="bg-muted/50 rounded-panel p-3">
                      <p className="text-body font-medium mb-2">{updateInfo.releaseName}</p>
                      {updateInfo.publishedAt && (
                        <p className="text-caption text-muted-foreground">
                          {isEn
                            ? `Released: ${new Date(updateInfo.publishedAt).toLocaleDateString('en-US')}`
                            : `发布时间: ${new Date(updateInfo.publishedAt).toLocaleDateString('zh-CN')}`}
                        </p>
                      )}
                    </div>

                    {updateInfo.releaseNotes && (
                      <div className="space-y-2">
                        <p className="text-body font-medium">
                          {isEn ? 'Release Notes:' : '更新内容:'}
                        </p>
                        <div className="text-body text-muted-foreground bg-muted/30 rounded-panel p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {updateInfo.releaseNotes}
                        </div>
                      </div>
                    )}

                    {updateInfo.assets && updateInfo.assets.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-body font-medium">
                          {isEn ? 'Download Files:' : '下载文件:'}
                        </p>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {updateInfo.assets.slice(0, 6).map((asset, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between text-caption bg-muted/30 rounded-control px-2 py-1"
                            >
                              <span className="truncate flex-1">{asset.name}</span>
                              <span className="text-muted-foreground ml-2">
                                {formatFileSize(asset.size)}
                              </span>
                            </div>
                          ))}
                          {updateInfo.assets.length > 6 && (
                            <p className="text-caption text-muted-foreground text-center">
                              {isEn
                                ? `${updateInfo.assets.length - 6} more files...`
                                : `还有 ${updateInfo.assets.length - 6} 个文件...`}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <Button className="w-full gap-1.5" onClick={openReleasePage}>
                      <ExternalLink className="h-4 w-4" />
                      {isEn ? 'Go to Download Page' : '前往下载页面'}
                    </Button>
                  </>
                ) : updateInfo.error ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-red-500/10">
                        <AlertCircle className="h-6 w-6 text-red-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-title">
                          {isEn ? 'Check Failed' : '检查更新失败'}
                        </h3>
                        <p className="text-caption text-muted-foreground">{updateInfo.error}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => checkForUpdates(true)}
                    >
                      {isEn ? 'Retry' : '重试'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-success/10">
                        <CheckCircle className="h-6 w-6 text-success" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-title">
                          {isEn ? 'Up to Date' : '已是最新版本'}
                        </h3>
                        <p className="text-caption text-muted-foreground">
                          {isEn
                            ? `Version v${updateInfo.currentVersion} is the latest`
                            : `当前版本 v${updateInfo.currentVersion} 已经是最新的了`}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Description */}
        <Card className="">
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex items-center gap-3 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Info className="h-4 w-4 text-primary" />
              {isEn ? 'About' : '关于本应用'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-body text-muted-foreground space-y-3">
            <p>
              {isEn
                ? 'Kiro Account Manager is a powerful multi-account management tool for Kiro IDE. It supports quick account switching, auto token refresh, group/tag management, and machine ID management.'
                : 'Kiro 账户管理器是一个功能强大的 Kiro IDE 多账号管理工具。支持多账号快速切换、自动 Token 刷新、分组标签管理、机器码管理等功能，帮助你高效管理和使用多个 Kiro 账号。'}
            </p>
            <p>
              {isEn
                ? 'Built with Electron + React + TypeScript, supporting Windows, macOS and Linux. All data is stored locally to protect your privacy.'
                : '本应用使用 Electron + React + TypeScript 开发，支持 Windows、macOS 和 Linux 平台。所有数据均存储在本地，保护你的隐私安全。'}
            </p>
          </CardContent>
        </Card>

        {/* Features */}
        <Card className="">
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex items-center gap-3 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Zap className="h-4 w-4 text-primary" />
              {isEn ? 'Features' : '主要功能'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-body text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Multi-Account' : '多账号管理'}</strong>
                {isEn
                  ? ': Add, edit, delete multiple accounts'
                  : '：支持添加、编辑、删除多个 Kiro 账号'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'One-Click Switch' : '一键切换'}</strong>
                {isEn ? ': Quick account switching' : '：快速切换当前使用的账号'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Auto Refresh' : '自动刷新'}</strong>
                {isEn
                  ? ': Auto refresh tokens before expiry'
                  : '：Token 过期前自动刷新，保持登录状态'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Groups & Tags' : '分组与标签'}</strong>
                {isEn ? ': Batch set groups/tags' : '：多选账户批量设置分组/标签，支持多标签'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Privacy Mode' : '隐私模式'}</strong>
                {isEn ? ': Hide sensitive info' : '：隐藏邮箱和账号敏感信息'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Batch Import' : '批量导入'}</strong>
                {isEn ? ': SSO Token & OIDC batch import' : '：支持 SSO Token 和 OIDC 凭证批量导入'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Machine ID' : '机器码管理'}</strong>
                {isEn ? ': Modify device identifier' : '：修改设备标识符，防止账号关联封禁'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Auto Switch ID' : '自动换机器码'}</strong>
                {isEn ? ': Auto change ID on switch' : '：切换账号时自动更换机器码'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'ID Binding' : '账户机器码绑定'}</strong>
                {isEn ? ': Unique ID per account' : '：为每个账户分配唯一机器码'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Auto Switch' : '自动换号'}</strong>
                {isEn ? ': Switch when balance low' : '：余额不足时自动切换可用账号'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Proxy Support' : '代理支持'}</strong>
                {isEn ? ': HTTP/HTTPS/SOCKS5' : '：支持 HTTP/HTTPS/SOCKS5 代理'}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">✓</span>
                <strong>{isEn ? 'Themes' : '主题定制'}</strong>
                {isEn ? ': System, light and dark appearance' : '：跟随系统、浅色和深色外观'}
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Tech Stack */}
        <Card className="">
          <CardHeader className="pb-3">
            <CardTitle className="text-section flex items-center gap-3 min-w-0 flex-wrap [&_svg]:text-muted-foreground">
              <Code className="h-4 w-4 text-primary" />
              {isEn ? 'Tech Stack' : '技术栈'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {['Electron', 'React', 'TypeScript', 'Tailwind CSS', 'Zustand', 'Vite'].map(
                (tech) => (
                  <span
                    key={tech}
                    className="inline-flex h-5 items-center px-[7px] text-badge font-medium bg-muted rounded-full text-muted-foreground"
                  >
                    {tech}
                  </span>
                )
              )}
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-caption text-muted-foreground py-4">
          <p className="flex items-center justify-center gap-1">
            Made with <Heart className="h-3 w-3 text-primary" /> for Kiro users
          </p>
        </div>
      </div>
    </div>
  )
}
