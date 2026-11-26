import { PageHeader } from '../layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '../ui'
import { Heart, Info, Zap } from 'lucide-react'
import { useTranslation } from '@/hooks/useTranslation'
import { UpdateSection } from '../updates/UpdateSection'

export function AboutPage(): React.JSX.Element {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-body">
      <PageHeader icon={<Info />} title={<>{isEn ? 'About' : '关于本应用'}</>} />
      <div className="space-y-7 px-6 pt-4 pb-6">
        <UpdateSection />
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
