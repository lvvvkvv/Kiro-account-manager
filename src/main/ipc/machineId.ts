import { ipcMain, dialog, type BrowserWindow } from 'electron'
import * as machine from '../machineId'
import type { MachineIdResult } from '../../shared/machineId'
export function registerMachineIdIPC(window: () => BrowserWindow | null): void {
  ipcMain.handle('machine-id:get-os-type', () => machine.getOSType())
  ipcMain.handle('machine-id:get-current', () => machine.getCurrentMachineId())
  ipcMain.handle('machine-id:set', async (_event, value: unknown) => {
    const result = await machine.setMachineId(value)
    if (!result.success && result.requiresAdmin && (await machine.showAdminRequiredDialog()))
      await machine.requestAdminRestart()
    return result
  })
  ipcMain.handle('machine-id:generate-random', () => machine.generateRandomMachineId())
  ipcMain.handle('machine-id:check-admin', () => machine.checkAdminPrivilege())
  ipcMain.handle(
    'machine-id:request-admin-restart',
    async () => (await machine.showAdminRequiredDialog()) && machine.requestAdminRestart()
  )
  ipcMain.handle(
    'machine-id:backup-to-file',
    async (_event, value: unknown): Promise<MachineIdResult> => {
      try {
        const options = {
          title: '备份机器码',
          defaultPath: 'machine-id-backup.json',
          filters: [{ name: 'JSON', extensions: ['json'] }]
        }
        const owner = window()
        const selected = owner
          ? await dialog.showSaveDialog(owner, options)
          : await dialog.showSaveDialog(options)
        if (selected.canceled || !selected.filePath) return { success: false, cancelled: true }
        return (await machine.backupMachineIdToFile(value, selected.filePath))
          ? { success: true }
          : { success: false, error: '备份机器码失败' }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }
  )
  ipcMain.handle('machine-id:restore-from-file', async (): Promise<MachineIdResult> => {
    try {
      const options = {
        title: '恢复机器码',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'] as 'openFile'[]
      }
      const owner = window()
      const selected = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      return selected.canceled || !selected.filePaths[0]
        ? { success: false, cancelled: true }
        : machine.restoreMachineIdFromFile(selected.filePaths[0])
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
