import { KProxyPanel } from '../kproxy'
import { PageHeader } from '../layout/PageHeader'
import { useTranslation } from '@/hooks/useTranslation'
import { Shield } from 'lucide-react'

export function KProxyPage() {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader icon={<Shield />} title="K-Proxy MITM" />
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6 pt-4">
        <p className="mb-7 text-body text-muted-foreground">
          {isEn
            ? 'MITM proxy for Machine ID replacement, reduces ban risk'
            : 'MITM 代理，替换 Machine ID，降低封禁风险'}
        </p>
        <KProxyPanel />
      </div>
    </div>
  )
}
