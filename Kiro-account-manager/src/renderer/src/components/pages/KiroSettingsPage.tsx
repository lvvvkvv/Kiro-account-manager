import { PageHeader } from '../layout/PageHeader'
import { useState, useEffect } from 'react'
import { Button, Toggle, Select } from '../ui'
import { useTranslation } from '@/hooks/useTranslation'
import { SteeringEditor, McpServerEditor } from '../kiro'
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  FolderOpen,
  Save,
  AlertCircle,
  Edit,
  Sparkles,
  Shield,
  Zap,
  Settings2,
  Terminal
} from 'lucide-react'

interface KiroSettings {
  agentAutonomy: string
  modelSelection: string
  enableDebugLogs: boolean
  enableTabAutocomplete: boolean
  enableCodebaseIndexing: boolean
  usageSummary: boolean
  codeReferences: boolean
  configureMCP: string
  trustedCommands: string[]
  trustedTools: Record<string, boolean>
  commandDenylist: string[]
  ignoreFiles: string[]
  mcpApprovedEnvVars: string[]
  // 通知设置
  notificationsActionRequired: boolean
  notificationsFailure: boolean
  notificationsSuccess: boolean
  notificationsBilling: boolean
}

interface McpServer {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface McpConfig {
  mcpServers: Record<string, McpServer>
}

// 默认禁止的危险命令
const defaultDenyCommands = [
  'rm -rf *',
  'rm -rf /',
  'rm -rf ~',
  'del /f /s /q *',
  'format',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'chown -R',
  '> /dev/sda',
  'wget * | sh',
  'curl * | sh',
  'shutdown',
  'reboot',
  'init 0',
  'init 6'
]

// Kiro 默认设置（与 Kiro IDE 内置默认值一致）
const defaultSettings: KiroSettings = {
  agentAutonomy: 'Autopilot',
  modelSelection: 'auto',
  enableDebugLogs: false,
  enableTabAutocomplete: false,
  enableCodebaseIndexing: false,
  usageSummary: true,
  codeReferences: false,
  configureMCP: 'Enabled',
  trustedCommands: [],
  trustedTools: {},
  commandDenylist: [],
  ignoreFiles: [],
  mcpApprovedEnvVars: [],
  notificationsActionRequired: true,
  notificationsFailure: false,
  notificationsSuccess: false,
  notificationsBilling: true
}

const autonomyOptionsZh = [
  { value: 'Autopilot', label: 'Autopilot (自动执行)', description: 'Agent 自动执行任务' },
  { value: 'Supervised', label: 'Supervised (需确认)', description: '每个步骤需要手动确认' }
]

const autonomyOptionsEn = [
  {
    value: 'Autopilot',
    label: 'Autopilot (Auto)',
    description: 'Agent executes tasks automatically'
  },
  {
    value: 'Supervised',
    label: 'Supervised (Confirm)',
    description: 'Manual confirmation for each step'
  }
]

const mcpOptionsZh = [
  { value: 'Enabled', label: '启用', description: '允许 MCP 服务器连接' },
  { value: 'Disabled', label: '禁用', description: '禁用所有 MCP 功能' }
]

const mcpOptionsEn = [
  { value: 'Enabled', label: 'Enabled', description: 'Allow MCP server connections' },
  { value: 'Disabled', label: 'Disabled', description: 'Disable all MCP features' }
]

export function KiroSettingsPage() {
  const [settings, setSettings] = useState<KiroSettings>(defaultSettings)
  const [mcpConfig, setMcpConfig] = useState<McpConfig>({ mcpServers: {} })
  const [steeringFiles, setSteeringFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<
    Array<{ id: string; name: string; description: string }>
  >([])
  const [loadingModels, setLoadingModels] = useState(false)

  const [expandedSections, setExpandedSections] = useState({
    agent: true,
    mcp: true,
    steering: true,
    commands: false
  })

  const [newTrustedCommand, setNewTrustedCommand] = useState('')
  const [newTrustedToolName, setNewTrustedToolName] = useState('')
  const [newDenyCommand, setNewDenyCommand] = useState('')
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [editingMcp, setEditingMcp] = useState<{ name?: string; server?: McpServer } | null>(null)
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const autonomyOptions = isEn ? autonomyOptionsEn : autonomyOptionsZh
  const mcpOptions = isEn ? mcpOptionsEn : mcpOptionsZh

  useEffect(() => {
    loadKiroSettings()
    loadAvailableModels()
  }, [])

  const loadAvailableModels = async () => {
    setLoadingModels(true)
    try {
      const result = await window.api.getKiroAvailableModels()
      if (result.models && result.models.length > 0) {
        setAvailableModels(result.models)
      }
    } catch (err) {
      console.error('Failed to load models:', err)
    } finally {
      setLoadingModels(false)
    }
  }

  const loadKiroSettings = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.getKiroSettings()
      if (result.settings) {
        // 过滤掉 undefined 值，避免覆盖默认值
        const filteredSettings = Object.fromEntries(
          Object.entries(result.settings).filter(([, v]) => v !== undefined)
        ) as Partial<KiroSettings>
        setSettings({ ...defaultSettings, ...filteredSettings })
      }
      if (result.mcpConfig) {
        setMcpConfig(result.mcpConfig as McpConfig)
      }
      if (result.steeringFiles) {
        setSteeringFiles(result.steeringFiles)
      }
    } catch (err) {
      setError(isEn ? 'Failed to load Kiro settings' : '加载 Kiro 设置失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    setError(null)
    try {
      await window.api.saveKiroSettings(settings as unknown as Record<string, unknown>)
    } catch (err) {
      setError(isEn ? 'Failed to save settings' : '保存设置失败')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const openKiroSettingsFile = async () => {
    // 打开 Kiro settings.json 文件
    try {
      await window.api.openKiroSettingsFile()
    } catch (err) {
      console.error(err)
    }
  }

  const openMcpConfig = async (type: 'user' | 'workspace') => {
    try {
      await window.api.openKiroMcpConfig(type)
    } catch (err) {
      console.error(err)
    }
  }

  const openSteeringFolder = async () => {
    try {
      await window.api.openKiroSteeringFolder()
    } catch (err) {
      console.error(err)
    }
  }

  const openSteeringFile = (filename: string) => {
    setEditingFile(filename)
  }

  const openSteeringFileExternal = async (filename: string) => {
    try {
      await window.api.openKiroSteeringFile(filename)
    } catch (err) {
      console.error(err)
    }
  }

  const createDefaultRules = async () => {
    try {
      const result = await window.api.createKiroDefaultRules()
      if (result.success) {
        // 重新加载设置以获取新创建的文件
        await loadKiroSettings()
      }
    } catch (err) {
      console.error(err)
    }
  }

  const deleteSteeringFile = async (filename: string) => {
    if (
      !confirm(
        isEn
          ? `Delete "${filename}"? This cannot be undone.`
          : `确定要删除 "${filename}" 吗？此操作无法撤销。`
      )
    ) {
      return
    }
    try {
      const result = await window.api.deleteKiroSteeringFile(filename)
      if (result.success) {
        await loadKiroSettings()
      } else {
        setError(result.error || (isEn ? 'Failed to delete file' : '删除文件失败'))
      }
    } catch (err) {
      console.error(err)
      setError(isEn ? 'Failed to delete file' : '删除文件失败')
    }
  }

  const deleteMcpServer = async (name: string) => {
    if (!confirm(isEn ? `Delete MCP server "${name}"?` : `确定要删除 MCP 服务器 "${name}" 吗？`)) {
      return
    }
    try {
      const result = await window.api.deleteMcpServer(name)
      if (result.success) {
        await loadKiroSettings()
      } else {
        setError(result.error || (isEn ? 'Failed to delete server' : '删除服务器失败'))
      }
    } catch (err) {
      console.error(err)
      setError(isEn ? 'Failed to delete server' : '删除服务器失败')
    }
  }

  const addTrustedCommand = () => {
    if (newTrustedCommand.trim()) {
      setSettings((prev) => ({
        ...prev,
        trustedCommands: [...prev.trustedCommands, newTrustedCommand.trim()]
      }))
      setNewTrustedCommand('')
    }
  }

  const removeTrustedCommand = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      trustedCommands: prev.trustedCommands.filter((_, i) => i !== index)
    }))
  }

  const addDenyCommand = () => {
    if (newDenyCommand.trim()) {
      setSettings((prev) => ({
        ...prev,
        commandDenylist: [...prev.commandDenylist, newDenyCommand.trim()]
      }))
      setNewDenyCommand('')
    }
  }

  const addDefaultDenyCommands = () => {
    setSettings((prev) => {
      // 过滤掉已存在的命令
      const newCommands = defaultDenyCommands.filter((cmd) => !prev.commandDenylist.includes(cmd))
      return {
        ...prev,
        commandDenylist: [...prev.commandDenylist, ...newCommands]
      }
    })
  }

  const removeDenyCommand = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      commandDenylist: prev.commandDenylist.filter((_, i) => i !== index)
    }))
  }

  if (loading) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto text-body">
      {/* 页面头部 */}
      <PageHeader
        icon={<Sparkles />}
        title={<>{isEn ? 'Kiro Settings' : 'Kiro 设置'}</>}
        subtitle={
          <>
            {isEn
              ? 'Manage Kiro IDE config, MCP servers and user rules'
              : '管理 Kiro IDE 的配置、MCP 服务器和用户规则'}
          </>
        }
        actions={
          <div className="ui-toolbar">
            <Button variant="outline" size="sm" onClick={loadKiroSettings} className="bg-card">
              <RefreshCw className="h-4 w-4 mr-0" />
              {isEn ? 'Refresh' : '刷新'}
            </Button>
            <Button variant="outline" size="sm" onClick={openKiroSettingsFile} className="bg-card">
              <ExternalLink className="h-4 w-4 mr-0" />
              {isEn ? 'Open File' : '打开设置文件'}
            </Button>
            <Button size="sm" onClick={saveSettings} disabled={saving}>
              <Save className="h-4 w-4 mr-0" />
              {saving ? (isEn ? 'Saving...' : '保存中...') : isEn ? 'Save' : '保存设置'}
            </Button>
          </div>
        }
      />
      <div className="space-y-7 px-6 pt-4 pb-6">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-panel">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Agent 设置 */}
        <section className="ui-section">
          <div
            className="cursor-pointer rounded-control hover:bg-muted/30 transition-colors"
            onClick={() => toggleSection('agent')}
          >
            <h2 className="ui-section-title flex min-h-7 items-center justify-between gap-2 [&_svg]:text-muted-foreground">
              <div className="flex items-center gap-3">
                <Settings2 className="h-4 w-4 text-primary" />
                <span>{isEn ? 'Agent Settings' : 'Agent 设置'}</span>
              </div>
              {expandedSections.agent ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </h2>
          </div>
          {expandedSections.agent && (
            <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row):not(.ui-setting-group)]:p-4 [&>p]:p-4 [&>div:not(.ui-setting-row):not(.ui-setting-group)_.ui-setting-row]:px-0">
              {/* Agent Autonomy */}
              <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                <div>
                  <p className="font-medium">{isEn ? 'Agent Autonomy' : 'Agent 自主模式'}</p>
                  <p className="text-caption text-muted-foreground">
                    {isEn
                      ? 'Determines whether the agent will ask for accept/reject at each checkpoint in the workflow.'
                      : '决定 Agent 在工作流的每个检查点是否要求接受/拒绝'}
                  </p>
                </div>
                <Select
                  value={settings.agentAutonomy}
                  options={autonomyOptions}
                  onChange={(value) => setSettings((prev) => ({ ...prev, agentAutonomy: value }))}
                  className="w-[200px]"
                />
              </div>

              {/* Model Selection */}
              <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                <div className="flex-1 mr-4">
                  <p className="font-medium">{isEn ? 'Model Selection' : '模型选择'}</p>
                  <p className="text-caption text-muted-foreground">
                    {isEn
                      ? 'Select model to use for agent operations.'
                      : '选择 Agent 操作使用的模型'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {availableModels.length > 0 ? (
                    <Select
                      value={settings.modelSelection}
                      options={availableModels.map((m) => ({
                        value: m.id,
                        label: m.name || m.id,
                        description: m.description
                      }))}
                      onChange={(value) =>
                        setSettings((prev) => ({ ...prev, modelSelection: value }))
                      }
                      className="w-[240px]"
                    />
                  ) : (
                    <input
                      type="text"
                      value={settings.modelSelection}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, modelSelection: e.target.value }))
                      }
                      placeholder="claude-haiku-4.5"
                      className="w-[240px] border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={loadAvailableModels}
                    disabled={loadingModels}
                    title={isEn ? 'Refresh models' : '刷新模型列表'}
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingModels ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {/* Toggle Options */}
              <div className="ui-setting-group divide-y">
                <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                  <div>
                    <p className="font-medium">
                      {isEn ? 'Enable Tab Autocomplete' : 'Tab 自动补全'}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Tab Autocomplete allows Kiro Agent to provide code suggestions in the editor as you type.'
                        : 'Tab 自动补全允许 Kiro Agent 在输入时提供代码建议'}
                    </p>
                  </div>
                  <Toggle
                    checked={settings.enableTabAutocomplete}
                    onChange={(checked) =>
                      setSettings((prev) => ({ ...prev, enableTabAutocomplete: checked }))
                    }
                  />
                </div>

                <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                  <div>
                    <p className="font-medium">{isEn ? 'Usage Summary' : '使用统计'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Display usage summary and elapsed time for agent executions.'
                        : '显示 Agent 执行的用量摘要和耗时'}
                    </p>
                  </div>
                  <Toggle
                    checked={settings.usageSummary}
                    onChange={(checked) =>
                      setSettings((prev) => ({ ...prev, usageSummary: checked }))
                    }
                  />
                </div>

                <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                  <div>
                    <p className="font-medium">
                      {isEn ? 'Code References: Reference Tracker' : '代码引用追踪'}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Allow Kiro to generate code with code references. Sometimes code generated by Kiro may be similar to publicly available code.'
                        : '允许 Kiro 生成带代码引用的代码。Kiro 生成的代码可能与公开可用代码相似。'}
                    </p>
                  </div>
                  <Toggle
                    checked={settings.codeReferences}
                    onChange={(checked) =>
                      setSettings((prev) => ({ ...prev, codeReferences: checked }))
                    }
                  />
                </div>

                <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                  <div>
                    <p className="font-medium">
                      {isEn ? 'Enable Codebase Indexing' : '代码库索引'}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Enable Repo Indexing (Experimental). This is an experimental feature which does not work with multi-folder workspaces.'
                        : '启用仓库索引（实验性）。这是一个实验性功能，不支持多文件夹工作区。'}
                    </p>
                  </div>
                  <Toggle
                    checked={settings.enableCodebaseIndexing}
                    onChange={(checked) =>
                      setSettings((prev) => ({ ...prev, enableCodebaseIndexing: checked }))
                    }
                  />
                </div>

                <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                  <div>
                    <p className="font-medium">{isEn ? 'Enable Debug Logs' : '调试日志'}</p>
                    <p className="text-caption text-muted-foreground">
                      {isEn
                        ? 'Enable Kiro Debug Logs in the Output panel.'
                        : '在输出面板启用 Kiro 调试日志'}
                    </p>
                  </div>
                  <Toggle
                    checked={settings.enableDebugLogs}
                    onChange={(checked) =>
                      setSettings((prev) => ({ ...prev, enableDebugLogs: checked }))
                    }
                  />
                </div>
              </div>

              {/* 通知设置 */}
              <div className="pt-4">
                <p className="font-medium mb-3">{isEn ? 'Notifications' : '通知设置'}</p>
                <div className="space-y-3">
                  <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                    <div>
                      <p className="font-medium">
                        {isEn ? 'Agent: Action Required' : 'Agent: 需要操作'}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {isEn
                          ? 'Show desktop notification when the agent requires input, e.g. for a shell command.'
                          : 'Agent 需要输入时显示桌面通知，如执行 Shell 命令时'}
                      </p>
                    </div>
                    <Toggle
                      checked={settings.notificationsActionRequired}
                      onChange={(checked) =>
                        setSettings((prev) => ({ ...prev, notificationsActionRequired: checked }))
                      }
                    />
                  </div>
                  <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                    <div>
                      <p className="font-medium">{isEn ? 'Agent: Failure' : 'Agent: 失败'}</p>
                      <p className="text-caption text-muted-foreground">
                        {isEn
                          ? 'Show desktop notification when the agent encounters an unexpected failure.'
                          : 'Agent 遇到意外失败时显示桌面通知'}
                      </p>
                    </div>
                    <Toggle
                      checked={settings.notificationsFailure}
                      onChange={(checked) =>
                        setSettings((prev) => ({ ...prev, notificationsFailure: checked }))
                      }
                    />
                  </div>
                  <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                    <div>
                      <p className="font-medium">{isEn ? 'Agent: Success' : 'Agent: 成功'}</p>
                      <p className="text-caption text-muted-foreground">
                        {isEn
                          ? 'Show desktop notifications when the agent successfully completes a task.'
                          : 'Agent 成功完成任务时显示桌面通知'}
                      </p>
                    </div>
                    <Toggle
                      checked={settings.notificationsSuccess}
                      onChange={(checked) =>
                        setSettings((prev) => ({ ...prev, notificationsSuccess: checked }))
                      }
                    />
                  </div>
                  <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                    <div>
                      <p className="font-medium">{isEn ? 'Billing' : '账单'}</p>
                      <p className="text-caption text-muted-foreground">
                        {isEn
                          ? 'Show in-app notifications for billing and usage events (usage resets, low resources, overages).'
                          : '显示账单和用量事件的应用内通知（用量重置、资源不足、超额）'}
                      </p>
                    </div>
                    <Toggle
                      checked={settings.notificationsBilling}
                      onChange={(checked) =>
                        setSettings((prev) => ({ ...prev, notificationsBilling: checked }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* MCP 设置 */}
        <section className="ui-section">
          <div
            className="cursor-pointer rounded-control hover:bg-muted/30 transition-colors"
            onClick={() => toggleSection('mcp')}
          >
            <h2 className="ui-section-title flex min-h-7 items-center justify-between gap-2 [&_svg]:text-muted-foreground">
              <div className="flex items-center gap-3">
                <Zap className="h-4 w-4 text-primary" />
                <span>{isEn ? 'MCP Servers' : 'MCP 服务器'}</span>
                <span className="inline-flex h-5 items-center px-[7px] text-badge font-medium rounded-full bg-muted text-muted-foreground">
                  {Object.keys(mcpConfig.mcpServers).length}
                </span>
              </div>
              {expandedSections.mcp ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </h2>
          </div>
          {expandedSections.mcp && (
            <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row):not(.ui-setting-group)]:p-4 [&>p]:p-4 [&>div:not(.ui-setting-row):not(.ui-setting-group)_.ui-setting-row]:px-0">
              <div className="ui-setting-row [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1 [&>div:first-child]:basis-[220px]">
                <div>
                  <p className="font-medium">{isEn ? 'Enable MCP' : '启用 MCP'}</p>
                  <p className="text-caption text-muted-foreground">
                    {isEn
                      ? 'Allow connections to external tools and data sources'
                      : '允许连接外部工具和数据源'}
                  </p>
                </div>
                <Select
                  value={settings.configureMCP}
                  options={mcpOptions}
                  onChange={(value) => setSettings((prev) => ({ ...prev, configureMCP: value }))}
                />
              </div>

              <div className="pt-4">
                <p className="font-medium mb-2">
                  {isEn ? 'Configured MCP Servers' : '已配置的 MCP 服务器'}
                </p>
                {Object.keys(mcpConfig.mcpServers).length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    {isEn ? 'No MCP servers configured' : '暂无配置的 MCP 服务器'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(mcpConfig.mcpServers).map(([name, server]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between p-2 bg-muted rounded-control"
                      >
                        <div className="min-w-0 flex-1 break-all">
                          <p className="font-medium text-body">{name}</p>
                          <p className="text-caption text-muted-foreground font-mono">
                            {server.command}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            className="flex shrink-0 items-center justify-center hover:bg-muted transition-colors h-control w-control p-0 rounded-control [&_svg]:size-4"
                            onClick={() => setEditingMcp({ name, server })}
                            title={isEn ? 'Edit' : '编辑'}
                          >
                            <Edit className="h-4 w-4 text-primary" />
                          </button>
                          <button
                            className="flex shrink-0 items-center justify-center hover:bg-muted transition-colors h-control w-control p-0 rounded-control [&_svg]:size-4"
                            onClick={() => deleteMcpServer(name)}
                            title={isEn ? 'Delete' : '删除'}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setEditingMcp({})}>
                  <Plus className="h-4 w-4 mr-0" />
                  {isEn ? 'Add MCP Server' : '添加 MCP 服务器'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openMcpConfig('user')}>
                  <FolderOpen className="h-4 w-4 mr-0" />
                  {isEn ? 'User MCP Config' : '用户 MCP 配置'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openMcpConfig('workspace')}>
                  <FolderOpen className="h-4 w-4 mr-0" />
                  {isEn ? 'Workspace MCP Config' : '工作区 MCP 配置'}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Steering 用户规则 */}
        <section className="ui-section">
          <div
            className="cursor-pointer rounded-control hover:bg-muted/30 transition-colors"
            onClick={() => toggleSection('steering')}
          >
            <h2 className="ui-section-title flex min-h-7 items-center justify-between gap-2 [&_svg]:text-muted-foreground">
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-primary" />
                <span>{isEn ? 'User Rules (Steering)' : '用户规则 (Steering)'}</span>
                <span className="inline-flex h-5 items-center px-[7px] text-badge font-medium rounded-full bg-muted text-muted-foreground">
                  {steeringFiles.length} {isEn ? 'files' : '个文件'}
                </span>
              </div>
              {expandedSections.steering ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </h2>
          </div>
          {expandedSections.steering && (
            <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row):not(.ui-setting-group)]:p-4 [&>p]:p-4 [&>div:not(.ui-setting-row):not(.ui-setting-group)_.ui-setting-row]:px-0">
              <p className="text-caption text-muted-foreground">
                {isEn
                  ? 'Steering files define AI assistant behavior rules and context'
                  : 'Steering 文件用于定义 AI 助手的行为规则和上下文'}
              </p>

              {steeringFiles.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  {isEn ? 'No steering files' : '暂无 Steering 文件'}
                </p>
              ) : (
                <div className="space-y-2">
                  {steeringFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 bg-muted rounded-control"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-body font-mono min-w-0 flex-1 break-all">{file}</span>
                      <button
                        className="flex shrink-0 items-center justify-center hover:bg-muted transition-colors h-control w-control p-0 rounded-control [&_svg]:size-4"
                        onClick={() => openSteeringFile(file)}
                        title={isEn ? 'Edit internally' : '内部编辑'}
                      >
                        <Edit className="h-4 w-4 text-primary" />
                      </button>
                      <button
                        className="flex shrink-0 items-center justify-center hover:bg-muted transition-colors h-control w-control p-0 rounded-control [&_svg]:size-4"
                        onClick={() => openSteeringFileExternal(file)}
                        title={isEn ? 'Open externally' : '外部打开'}
                      >
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button
                        className="flex shrink-0 items-center justify-center hover:bg-muted transition-colors h-control w-control p-0 rounded-control [&_svg]:size-4"
                        onClick={() => deleteSteeringFile(file)}
                        title={isEn ? 'Delete' : '删除'}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={createDefaultRules}>
                  <Plus className="h-4 w-4 mr-0" />
                  {isEn ? 'Create Rules' : '创建规则文件'}
                </Button>
                <Button variant="outline" size="sm" onClick={openSteeringFolder}>
                  <FolderOpen className="h-4 w-4 mr-0" />
                  {isEn ? 'Open Steering Folder' : '打开 Steering 目录'}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 命令设置 */}
        <section className="ui-section">
          <div
            className="cursor-pointer rounded-control hover:bg-muted/30 transition-colors"
            onClick={() => toggleSection('commands')}
          >
            <h2 className="ui-section-title flex min-h-7 items-center justify-between gap-2 [&_svg]:text-muted-foreground">
              <div className="flex items-center gap-3">
                <Terminal className="h-4 w-4 text-primary" />
                <span>{isEn ? 'Command Config' : '命令配置'}</span>
              </div>
              {expandedSections.commands ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </h2>
          </div>
          {expandedSections.commands && (
            <div className="rounded-panel border bg-card divide-y [&>div:not(.ui-setting-row):not(.ui-setting-group)]:p-4 [&>p]:p-4 [&>div:not(.ui-setting-row):not(.ui-setting-group)_.ui-setting-row]:px-0">
              {/* Trusted Commands */}
              <div className="p-4 rounded-panel bg-muted/50 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-primary" />
                  <p className="font-medium">{isEn ? 'Trusted Commands' : '信任的命令'}</p>
                </div>
                <p className="text-caption text-muted-foreground mb-3">
                  {isEn
                    ? 'These commands will auto-execute without confirmation'
                    : '这些命令将自动执行，无需确认'}
                </p>
                <div className="space-y-2">
                  {settings.trustedCommands.map((cmd, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all px-2 py-1 bg-muted rounded-control text-body">
                        {cmd}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTrustedCommand(index)}
                        title={isEn ? 'Delete' : '删除'}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={newTrustedCommand}
                      onChange={(e) => setNewTrustedCommand(e.target.value)}
                      placeholder={isEn ? 'e.g.: npm *' : '如: npm *'}
                      className="flex-1 border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                      onKeyDown={(e) => e.key === 'Enter' && addTrustedCommand()}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={addTrustedCommand}
                      title={isEn ? 'Add' : '添加'}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Trusted Tools */}
              <div className="p-4 rounded-panel bg-muted/50 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-primary" />
                  <p className="font-medium">{isEn ? 'Trusted Tools' : '信任的工具'}</p>
                </div>
                <p className="text-caption text-muted-foreground mb-3">
                  {isEn
                    ? 'Tools to auto-accept if requested by the Agent. Each tool name maps to a boolean indicating whether it should be trusted.'
                    : '当 Agent 请求使用这些工具时自动批准。每个工具名称对应是否信任的布尔值。'}
                </p>
                <div className="space-y-2">
                  {Object.entries(settings.trustedTools).map(([name, trusted]) => (
                    <div key={name} className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all px-2 py-1 bg-muted rounded-control text-body">
                        {name}
                      </code>
                      <Toggle
                        checked={trusted}
                        onChange={(checked) =>
                          setSettings((prev) => ({
                            ...prev,
                            trustedTools: { ...prev.trustedTools, [name]: checked }
                          }))
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSettings((prev) => {
                            const tools = { ...prev.trustedTools }
                            delete tools[name]
                            return { ...prev, trustedTools: tools }
                          })
                        }}
                        title={isEn ? 'Delete' : '删除'}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={newTrustedToolName}
                      onChange={(e) => setNewTrustedToolName(e.target.value)}
                      placeholder={isEn ? 'Tool name' : '工具名称'}
                      className="flex-1 border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTrustedToolName.trim()) {
                          setSettings((prev) => ({
                            ...prev,
                            trustedTools: {
                              ...prev.trustedTools,
                              [newTrustedToolName.trim()]: true
                            }
                          }))
                          setNewTrustedToolName('')
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        if (newTrustedToolName.trim()) {
                          setSettings((prev) => ({
                            ...prev,
                            trustedTools: {
                              ...prev.trustedTools,
                              [newTrustedToolName.trim()]: true
                            }
                          }))
                          setNewTrustedToolName('')
                        }
                      }}
                      title={isEn ? 'Add' : '添加'}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Command Denylist */}
              <div className="p-4 rounded-panel bg-destructive/5 border border-destructive/20">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <p className="font-medium text-destructive">
                    {isEn ? 'Blocked Commands' : '禁止的命令'}
                  </p>
                </div>
                <p className="text-caption text-muted-foreground mb-3">
                  {isEn
                    ? 'These commands always require manual confirmation'
                    : '这些命令总是需要手动确认'}
                </p>
                <div className="space-y-2">
                  {settings.commandDenylist.map((cmd, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all px-2 py-1 bg-muted rounded-control text-body">
                        {cmd}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeDenyCommand(index)}
                        title={isEn ? 'Delete' : '删除'}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={newDenyCommand}
                      onChange={(e) => setNewDenyCommand(e.target.value)}
                      placeholder={isEn ? 'e.g.: rm -rf *' : '如: rm -rf *'}
                      className="flex-1 border bg-background text-body min-w-0 rounded-control border-input bg-card px-2.5 focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 h-control py-1"
                      onKeyDown={(e) => e.key === 'Enter' && addDenyCommand()}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={addDenyCommand}
                      title={isEn ? 'Add' : '添加'}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addDefaultDenyCommands}
                    className="mt-2"
                  >
                    <Plus className="h-4 w-4 mr-0" />
                    {isEn ? 'Add Default Blocked' : '添加默认禁止命令'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Steering 文件编辑器 */}
        {editingFile && (
          <SteeringEditor
            filename={editingFile}
            onClose={() => setEditingFile(null)}
            onSaved={loadKiroSettings}
          />
        )}

        {/* MCP 服务器编辑器 */}
        {editingMcp && (
          <McpServerEditor
            serverName={editingMcp.name}
            server={editingMcp.server}
            onClose={() => setEditingMcp(null)}
            onSaved={loadKiroSettings}
          />
        )}
      </div>
    </div>
  )
}
