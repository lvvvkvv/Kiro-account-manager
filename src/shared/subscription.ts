export interface SubscriptionPlan {
  name: string
  qSubscriptionType: string
  description: { title: string; billingInterval: string; featureHeader: string; features: string[] }
  pricing: { amount: number; currency: string }
}

export interface SubscriptionLink {
  accountId: string
  email: string
  status: 'pending' | 'loading' | 'success' | 'error' | 'expired' | 'cancelled'
  url?: string
  error?: string
  generatedAt?: number
  validated?: boolean
  validation?: 'valid' | 'stale' | 'unknown' | 'expired'
}

export interface OverageItem {
  accountId: string
  email: string
  status: 'pending' | 'loading' | 'success' | 'error' | 'skipped' | 'cancelled'
  error?: string
}

export function subscriptionConcurrency(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value))) : 1
}
