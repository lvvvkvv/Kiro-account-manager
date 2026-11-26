import { ProxyPanel } from '../proxy'
import { PageHeader } from '../layout/PageHeader'
import { useTranslation } from '@/hooks/useTranslation'
import { Server } from 'lucide-react'

export function ProxyPage() {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader icon={<Server />} title={isEn ? 'API Proxy Service' : 'API 反代服务'} />
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6 pt-4">
        <p className="mb-7 text-body text-muted-foreground">
          {isEn
            ? 'Provide OpenAI and Claude compatible API endpoints with multi-account rotation'
            : '提供 OpenAI 和 Claude 兼容的 API 端点，支持多账号轮询'}
        </p>
        <ProxyPanel />
      </div>
    </div>
  )
}
