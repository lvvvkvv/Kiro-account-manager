import { ipcMain } from 'electron'
import type { ProxyAccount } from '../proxy/types'
import {
  fetchAvailableSubscriptions,
  fetchSubscriptionToken,
  setUserPreference
} from '../proxy/kiroApi'
import { beginDiagnostic, cancelDiagnostic } from '../diagnostics'
import { withDeadline } from '../../shared/async'
import { openBrowserInPrivateMode } from '../privateBrowser'

export interface SubscriptionAccountInput {
  id: string
  accessToken: string
  region?: string
  profileArn?: string
  machineId?: string
  provider?: string
  authMethod?: string
}

export function registerSubscriptionIPC(
  resolveAccount: (input: SubscriptionAccountInput) => ProxyAccount
): void {
  async function request<T>(
    id: string | undefined,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const { controller, finish } = beginDiagnostic(id)
    try {
      return await withDeadline(work, 30000, controller.signal, '订阅请求超时')
    } finally {
      finish()
    }
  }
  ipcMain.handle('subscription-cancel', (_event, id: string) => {
    if (typeof id === 'string') cancelDiagnostic(id)
  })
  ipcMain.handle(
    'account-get-subscriptions',
    async (
      _event,
      accessToken: string,
      region?: string,
      profileArn?: string,
      machineId?: string,
      provider?: string,
      authMethod?: string,
      accountId?: string,
      requestId?: string
    ) => {
      try {
        const plans = await request(requestId, (signal) =>
          fetchAvailableSubscriptions(
            resolveAccount({
              id: accountId || 'subscription-request',
              accessToken,
              region,
              profileArn,
              machineId,
              provider,
              authMethod
            }),
            signal
          )
        )
        return plans.subscriptionPlans
          ? { success: true, plans: plans.subscriptionPlans, disclaimer: plans.disclaimer }
          : { success: false, plans: [], error: 'No subscription plans returned' }
      } catch (error) {
        return {
          success: false,
          plans: [],
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )
  ipcMain.handle(
    'account-get-subscription-url',
    async (
      _event,
      accessToken: string,
      subscriptionType?: string,
      region?: string,
      profileArn?: string,
      machineId?: string,
      provider?: string,
      authMethod?: string,
      accountId?: string,
      requestId?: string
    ) => {
      try {
        const result = await request(requestId, (signal) =>
          fetchSubscriptionToken(
            resolveAccount({
              id: accountId || 'subscription-request',
              accessToken,
              region,
              profileArn,
              machineId,
              provider,
              authMethod
            }),
            subscriptionType,
            signal
          )
        )
        return result.encodedVerificationUrl
          ? { success: true, url: result.encodedVerificationUrl, status: result.status }
          : { success: false, error: result.message || 'No subscription URL returned' }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
  ipcMain.handle(
    'account-set-overage',
    async (
      _event,
      accessToken: string,
      overageStatus: 'ENABLED' | 'DISABLED',
      region?: string,
      profileArn?: string,
      machineId?: string,
      provider?: string,
      authMethod?: string,
      accountId?: string,
      requestId?: string
    ) => {
      try {
        if (!['ENABLED', 'DISABLED'].includes(overageStatus))
          throw new Error('Invalid overage status')
        return await request(requestId, (signal) =>
          setUserPreference(
            resolveAccount({
              id: accountId || 'subscription-request',
              accessToken,
              region,
              profileArn,
              machineId,
              provider,
              authMethod
            }),
            overageStatus,
            signal
          )
        )
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
  ipcMain.handle('open-subscription-window', async (_event, url: string, requestId?: string) => {
    try {
      await request(requestId, (signal) => openBrowserInPrivateMode(url, signal))
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
