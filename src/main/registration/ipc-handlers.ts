import { ipcMain, BrowserWindow } from 'electron'
import { Registrar, newConfig, type RegistrationConfig } from './index'
import type { RegStepEvent } from './registrar'
import { openProtonLogin, getProtonLoginStatus, closeProtonWindow } from './proton-mail-window'

// 注册池：支持多个并发注册任务
const registrarPool = new Map<string, Registrar>()
// 手动模式使用固定 key
const MANUAL_KEY = '__manual__'
const manualRequests = new WeakMap<Registrar, string | undefined>()
const disposals = new WeakMap<Registrar, Promise<void>>()
function dispose(key: string, registrar: Registrar): Promise<void> {
  let task = disposals.get(registrar)
  if (!task) {
    task = registrar
      .destroy()
      .catch((error) => console.error('[Registration] Cleanup failed:', error))
      .finally(() => {
        if (registrarPool.get(key) === registrar) registrarPool.delete(key)
      })
    disposals.set(registrar, task)
  }
  return task
}

export function registerIPCHandlers(getMainWindow: () => BrowserWindow | null): void {
  const sendLog = (msg: string, taskId?: string): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('registration-log', { message: msg, taskId })
    }
  }
  const sendStep = (event: RegStepEvent, taskId?: string): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('registration-step', { taskId, event })
    }
  }

  // 启动自动注册（支持并发：每个 taskId 独立运行）
  ipcMain.handle(
    'registration-start-auto',
    async (_event, config: Partial<RegistrationConfig> & { taskId?: string }) => {
      const taskId = config.taskId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      if (registrarPool.has(taskId)) return { success: false, error: '注册任务已在运行' }
      const logPrefix = config.taskId ? `[#${config.taskId.slice(0, 12)}] ` : ''

      const cfg = newConfig(config)
      cfg.manualMode = false
      const registrar = new Registrar(
        cfg,
        (msg) => sendLog(`${logPrefix}${msg}`, config.taskId),
        (event) => sendStep(event, config.taskId)
      )
      registrarPool.set(taskId, registrar)

      try {
        const result = await registrar.run()
        // run() 内部 finally 已调用 cleanup()，无需再次 destroy
        if (registrarPool.get(taskId) === registrar) registrarPool.delete(taskId)
        return { success: true, result }
      } catch (err) {
        // run() 内部 finally 已调用 cleanup()，无需再次 destroy
        if (registrarPool.get(taskId) === registrar) registrarPool.delete(taskId)
        const errMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errMsg }
      }
    }
  )

  // 手动模式 Phase1: OIDC + Device
  ipcMain.handle(
    'registration-manual-phase1',
    async (_event, config: Partial<RegistrationConfig> & { requestId?: string }) => {
      if (registrarPool.has(MANUAL_KEY))
        return { success: false, error: '已有手动注册流程正在进行' }
      const registrar = new Registrar(
        { ...newConfig(config), manualMode: true },
        sendLog,
        (event) => sendStep(event)
      )
      registrarPool.set(MANUAL_KEY, registrar)
      manualRequests.set(registrar, config.requestId)
      try {
        const result = await registrar.runManualPhase1()
        if (!result.success) await dispose(MANUAL_KEY, registrar)
        return result
      } catch (error) {
        await dispose(MANUAL_KEY, registrar)
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    'registration-manual-phase2',
    async (_event, email: string, fullName?: string, requestId?: string) => {
      const registrar = registrarPool.get(MANUAL_KEY)
      if (!registrar || (requestId && manualRequests.get(registrar) !== requestId))
        return { success: false, error: '无进行中的注册流程' }
      try {
        const result = await registrar.runManualPhase2(email, fullName)
        if (!result.success) await dispose(MANUAL_KEY, registrar)
        return result
      } catch (error) {
        await dispose(MANUAL_KEY, registrar)
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle('registration-manual-phase3', async (_event, otp: string, requestId?: string) => {
    const registrar = registrarPool.get(MANUAL_KEY)
    if (!registrar || (requestId && manualRequests.get(registrar) !== requestId))
      return { success: false, error: '无进行中的注册流程' }
    try {
      return { success: true, result: await registrar.runManualPhase3(otp) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      await dispose(MANUAL_KEY, registrar)
    }
  })

  ipcMain.handle('registration-cancel', async (_event, taskId?: string) => {
    const tasks = Array.from(registrarPool.entries()).filter(
      ([id, registrar]) => !taskId || id === taskId || manualRequests.get(registrar) === taskId
    )
    // Interrupt every request before awaiting any native-session cleanup.
    for (const [, registrar] of tasks) registrar.abort()
    await Promise.allSettled(tasks.map(([id, registrar]) => dispose(id, registrar)))
    return { success: true }
  })

  // 获取注册状态
  ipcMain.handle('registration-status', async () => {
    return { inProgress: registrarPool.size > 0, count: registrarPool.size }
  })

  // ===== Proton 邮箱取码源 =====

  // 打开 Proton 登录窗口（首次需用户手动登录，之后 session 持久化复用）
  ipcMain.handle('proton-open-login', async (_event, proxy?: string) => {
    return openProtonLogin(proxy)
  })

  // 查询 Proton 登录态（不弹窗）
  ipcMain.handle('proton-login-status', async (_event, proxy?: string) => {
    return getProtonLoginStatus(proxy)
  })

  // 关闭 Proton 窗口（保留登录态）
  ipcMain.handle('proton-close', async () => {
    closeProtonWindow()
    return { success: true }
  })
}
