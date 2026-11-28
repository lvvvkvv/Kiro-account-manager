import { ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { KiroConfigFiles } from '../kiroSettings'
import { fetchKiroModels } from '../proxy/kiroApi'
import type { ProxyAccount } from '../proxy/types'
import { withDeadline } from '../../shared/async'
import type {
  KiroSettings,
  KiroModelsResult,
  KiroFileResult,
  McpServerEdit
} from '../../shared/kiroSettings'

/** A single screen needs only the last successful list; in-flight work is shared across remounts. */
export function createSettingsModelLoader(
  getAccount: () => ProxyAccount | undefined,
  fetchModels = fetchKiroModels,
  timeoutMs = 30000
): (force?: boolean) => Promise<KiroModelsResult> {
  let cached: { key: string; result: KiroModelsResult; at: number } | undefined
  const pending = new Map<string, Promise<KiroModelsResult>>()
  return async (force = false) => {
    const account = getAccount()
    if (!account) return { models: [] }
    const key = JSON.stringify([
      account.id,
      account.accessToken,
      account.region,
      account.profileArn,
      account.machineId,
      account.provider,
      account.authMethod,
      account.proxyUrl
    ])
    if (!force && cached?.key === key && Date.now() - cached.at < 300000) return cached.result
    const existing = pending.get(key)
    if (existing) return existing
    const task = withDeadline(
      async (signal) => {
        const models = await fetchModels(account, signal)
        signal.throwIfAborted()
        const result = {
          models: models.map((m) => ({
            id: m.modelId,
            name: m.modelName,
            description: m.description
          }))
        }
        if (result.models.length) cached = { key, result, at: Date.now() }
        return result
      },
      timeoutMs,
      undefined,
      '模型列表请求超时'
    )
      .catch((error) => ({
        models: [],
        error: error instanceof Error ? error.message : String(error)
      }))
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key)
      })
    pending.set(key, task)
    return task
  }
}

export function registerKiroSettingsIPC(
  getAccount: () => ProxyAccount | undefined,
  getWorkspacePath: () => string | undefined
): void {
  const files = new KiroConfigFiles()
  const models = createSettingsModelLoader(getAccount)
  async function run(work: () => Promise<void>): Promise<KiroFileResult> {
    try {
      await work()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  async function open(file: string): Promise<void> {
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
  }
  ipcMain.handle('get-kiro-settings', (_event, section?: 'settings' | 'mcp' | 'steering') => {
    if (section !== undefined && !['settings', 'mcp', 'steering'].includes(section))
      return { error: '设置类型无效' }
    return files.load(section)
  })
  ipcMain.handle('get-kiro-available-models', (_event, force?: boolean) => models(force === true))
  ipcMain.handle('save-kiro-settings', (_event, settings: Partial<KiroSettings>) =>
    run(() => files.saveSettings(settings))
  )
  ipcMain.handle('open-kiro-settings-file', () =>
    run(async () => open(await files.ensureSettings()))
  )
  ipcMain.handle('open-kiro-steering-folder', () =>
    run(async () => open(await files.ensureSteeringFolder()))
  )
  ipcMain.handle('open-kiro-steering-file', (_event, filename: string) =>
    run(async () => open(await files.openRule(filename)))
  )
  ipcMain.handle('create-kiro-default-rules', () =>
    run(async () => open(await files.createRules()))
  )
  ipcMain.handle('read-kiro-steering-file', async (_event, filename: string) => {
    try {
      return { success: true, content: await files.readRule(filename) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('save-kiro-steering-file', (_event, filename: string, content: string) =>
    run(() => files.saveRule(filename, content))
  )
  ipcMain.handle('delete-kiro-steering-file', (_event, filename: string) =>
    run(() => files.deleteRule(filename))
  )
  ipcMain.handle(
    'save-mcp-server',
    (_event, name: string, config: McpServerEdit, oldName?: string) =>
      run(() => files.saveMcp(name, config, oldName))
  )
  ipcMain.handle('delete-mcp-server', (_event, name: string) => run(() => files.deleteMcp(name)))
  ipcMain.handle(
    'open-kiro-mcp-config',
    async (_event, type: 'user' | 'workspace'): Promise<KiroFileResult> => {
      if (type === 'user') return run(async () => open(await files.ensureMcp()))
      if (type !== 'workspace') return { success: false, error: 'MCP 配置类型无效' }
      const selected = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: getWorkspacePath()
      })
      if (selected.canceled || !selected.filePaths[0]) return { success: false, cancelled: true }
      return run(async () =>
        open(await files.ensureMcp(join(selected.filePaths[0], '.kiro', 'settings', 'mcp.json')))
      )
    }
  )
}
