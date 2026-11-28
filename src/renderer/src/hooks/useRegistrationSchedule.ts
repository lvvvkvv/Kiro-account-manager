import { useEffect } from 'react'
import { useTranslation } from './useTranslation'
import { loadConfig, boundedInteger, type AutoEmailSource } from '@/lib/registration'
import {
  initializeRegistration,
  refreshRegistrationQuota,
  startRegistrationBatch,
  useRegistrationStore,
  quotaDate,
  type RegistrationOptions
} from '@/registration/runtime'

let currentOptions: RegistrationOptions | undefined
let currentStamp: string | undefined
function settingsStamp(): string {
  return JSON.stringify(
    [
      'config',
      'ratelimit-enabled',
      'ratelimit-max',
      'ratelimit-burst',
      'backoff-base-sec',
      'backoff-max-sec',
      'autobackoff',
      'autopause-risk',
      'dailyquota-limit',
      'mixed-sources',
      'mixed-weights'
    ].map((key) => localStorage.getItem(`kiro-register-${key}`))
  )
}
export function setRegistrationOptions(options: RegistrationOptions): void {
  currentOptions = options
  currentStamp = settingsStamp()
}
function number(key: string, fallback: number, min: number, max: number): number {
  const value = localStorage.getItem(key)
  return value === null ? fallback : boundedInteger(Number(value), fallback, min, max)
}
export function readRegistrationOptions(): RegistrationOptions {
  if (currentOptions && currentStamp === settingsStamp()) return currentOptions
  const config = loadConfig()
  let sources: AutoEmailSource[] = config.mixedEnabledSources || ['outlook', 'tempmail']
  const weights = { outlook: 1, tempmail: 1, proton: 1, gptmail: 1 }
  try {
    const parsed = JSON.parse(localStorage.getItem('kiro-register-mixed-sources') || 'null')
    if (Array.isArray(parsed))
      sources = parsed.filter((source): source is AutoEmailSource =>
        ['outlook', 'tempmail', 'proton', 'gptmail'].includes(source)
      )
    const saved = JSON.parse(localStorage.getItem('kiro-register-mixed-weights') || '{}')
    for (const source of Object.keys(weights) as AutoEmailSource[])
      weights[source] = boundedInteger(saved[source], 1, 0, 100)
  } catch {
    /* Fall back to the existing default email sources. */
  }
  return {
    mode: config.mode || 'manual',
    fullName: '',
    outlookData: '',
    batchCount: 1,
    batchInterval: 5,
    batchRetries: 1,
    batchConcurrency: 1,
    batchAutoImport: true,
    autoFetchProLink: false,
    proPlanType: 'Q_DEVELOPER_STANDALONE_PRO',
    tempMailEmail: '',
    tempMailEpin: '',
    tempMailDomain: '',
    protonBaseEmail: '',
    gptMailBaseURL: '',
    gptMailInboxEmail: '',
    gptMailDomain: '',
    gptMailPrefix: '',
    gptMailPrivatePassword: '',
    manualParentEmail: '',
    manualAnonymousEmail: false,
    ...config,
    mixedEnabledSources: sources,
    mixedWeights: weights,
    dailyQuotaLimit: number('kiro-register-dailyquota-limit', 0, 0, 9999),
    rateLimitEnabled: localStorage.getItem('kiro-register-ratelimit-enabled') !== '0',
    maxPerMinute: number('kiro-register-ratelimit-max', 10, 1, 300),
    burstSize: number('kiro-register-ratelimit-burst', 3, 1, 100),
    backoffBaseSec: number('kiro-register-backoff-base-sec', 8, 1, 300),
    backoffMaxSec: number('kiro-register-backoff-max-sec', 120, 1, 3600),
    autoBackoff: localStorage.getItem('kiro-register-autobackoff') !== '0',
    autoPauseOnRisk: localStorage.getItem('kiro-register-autopause-risk') === '1'
  }
}
export function useRegistrationSchedule(ready: boolean): void {
  const { t } = useTranslation()
  useEffect(() => {
    if (!ready) return
    initializeRegistration()
    const tick = (): void => {
      refreshRegistrationQuota()
      if (localStorage.getItem('kiro-register-schedule-enabled') !== '1') return
      const state = useRegistrationStore.getState()
      if (state.batchRunning || !['idle', 'done', 'finalized'].includes(state.phase)) return
      const today = quotaDate()
      if (localStorage.getItem('kiro-register-last-schedule') === today) return
      const now = new Date()
      if (!(number('kiro-register-schedule-week-mask', 127, 0, 127) & (1 << now.getDay()))) return
      const [hour, minute] = (localStorage.getItem('kiro-register-schedule-time') || '03:00')
        .split(':')
        .map(Number)
      if (now.getHours() !== hour || now.getMinutes() !== minute) return
      void startRegistrationBatch(readRegistrationOptions(), t)
      if (useRegistrationStore.getState().batchRunning)
        localStorage.setItem('kiro-register-last-schedule', today)
    }
    tick()
    const timer = setInterval(tick, 60000)
    return () => clearInterval(timer)
  }, [ready, t])
}
