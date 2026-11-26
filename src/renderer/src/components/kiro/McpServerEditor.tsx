import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui'
import { useTranslation } from '@/hooks/useTranslation'
import { X, Save, Plus, Trash2 } from 'lucide-react'

interface McpServer {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface McpServerEditorProps {
  serverName?: string
  server?: McpServer
  onClose: () => void
  onSaved: () => void
}

export function McpServerEditor({ serverName, server, onClose, onSaved }: McpServerEditorProps) {
  const [name, setName] = useState(serverName || '')
  const [command, setCommand] = useState(server?.command || '')
  const [args, setArgs] = useState<string[]>(server?.args || [])
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>(
    server?.env ? Object.entries(server.env).map(([key, value]) => ({ key, value })) : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newArg, setNewArg] = useState('')

  const isEdit = !!serverName
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  const handleSave = async () => {
    if (!name.trim()) {
      setError(isEn ? 'Please enter server name' : '请输入服务器名称')
      return
    }
    if (!command.trim()) {
      setError(isEn ? 'Please enter command' : '请输入命令')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const serverConfig: McpServer = {
        command: command.trim(),
        args: args.filter((a) => a.trim()),
        env: envVars.reduce(
          (acc, { key, value }) => {
            if (key.trim()) {
              acc[key.trim()] = value
            }
            return acc
          },
          {} as Record<string, string>
        )
      }

      // 如果没有 args 或 env，不包含这些字段
      if (serverConfig.args?.length === 0) delete serverConfig.args
      if (Object.keys(serverConfig.env || {}).length === 0) delete serverConfig.env

      const result = await window.api.saveMcpServer(
        name.trim(),
        serverConfig,
        isEdit ? serverName : undefined
      )

      if (result.success) {
        onSaved()
        onClose()
      } else {
        setError(result.error || (isEn ? 'Save failed' : '保存失败'))
      }
    } catch (err) {
      setError(isEn ? 'Save failed' : '保存失败')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const addArg = () => {
    if (newArg.trim()) {
      setArgs([...args, newArg.trim()])
      setNewArg('')
    }
  }

  const removeArg = (index: number) => {
    setArgs(args.filter((_, i) => i !== index))
  }

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }])
  }

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...envVars]
    updated[index][field] = value
    setEnvVars(updated)
  }

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
  }

  return createPortal(
    <div className="ui-dialog-overlay">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />

      <div
        className="ui-dialog-panel w-[512px] max-w-[min(512px,calc(100vw-32px))]"
        role="dialog"
        aria-modal="true"
      >
        <div className="ui-dialog-header flex-row items-center justify-between gap-2 border-b flex-wrap">
          <h2 className="text-title font-semibold min-w-0 break-words">
            {isEdit
              ? isEn
                ? 'Edit MCP Server'
                : '编辑 MCP 服务器'
              : isEn
                ? 'Add MCP Server'
                : '添加 MCP 服务器'}
          </h2>
          <Button variant="ghost" size="icon" title={isEn ? 'Close' : '关闭'} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-destructive/10 text-destructive text-body">{error}</div>
        )}

        <div className="ui-dialog-body flex-auto min-h-0 py-3 space-y-4">
          {/* 服务器名称 */}
          <div>
            <label className="block text-body font-medium mb-1">
              {isEn ? 'Server Name' : '服务器名称'}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isEn ? 'e.g.: fetch, exa, context7' : '例如: fetch, exa, context7'}
              className="w-full border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
              disabled={isEdit}
            />
          </div>

          {/* 命令 */}
          <div>
            <label className="block text-body font-medium mb-1">{isEn ? 'Command' : '命令'}</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={isEn ? 'e.g.: uvx, npx, node' : '例如: uvx, npx, node'}
              className="w-full border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
            />
          </div>

          {/* 参数 */}
          <div>
            <label className="block text-body font-medium mb-1">
              {isEn ? 'Arguments' : '参数'}
            </label>
            <div className="space-y-2">
              {args.map((arg, index) => (
                <div key={index} className="flex gap-2">
                  <code className="flex-1 px-2 py-1 bg-muted rounded-control text-body">{arg}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeArg(index)}
                    title={isEn ? 'Delete' : '删除'}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newArg}
                  onChange={(e) => setNewArg(e.target.value)}
                  placeholder={isEn ? 'Add argument' : '添加参数'}
                  className="flex-1 border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                  onKeyDown={(e) => e.key === 'Enter' && addArg()}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={addArg}
                  title={isEn ? 'Add' : '添加'}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* 环境变量 */}
          <div>
            <label className="block text-body font-medium mb-1">
              {isEn ? 'Environment Variables' : '环境变量'}
            </label>
            <div className="space-y-2">
              {envVars.map((env, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={env.key}
                    onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                    placeholder={isEn ? 'Key' : '变量名'}
                    className="w-1/3 border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                  />
                  <input
                    type="text"
                    value={env.value}
                    onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                    placeholder={isEn ? 'Value' : '值'}
                    className="flex-1 border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeEnvVar(index)}
                    title={isEn ? 'Delete' : '删除'}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addEnvVar}>
                <Plus className="h-4 w-4 mr-0" />
                {isEn ? 'Add Env Var' : '添加环境变量'}
              </Button>
            </div>
          </div>
        </div>

        <div className="ui-dialog-footer border-t">
          <Button variant="outline" onClick={onClose}>
            {isEn ? 'Cancel' : '取消'}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-0" />
            {saving ? (isEn ? 'Saving...' : '保存中...') : isEn ? 'Save' : '保存'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
