import { randomUUID } from 'crypto'
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  lstat,
  realpath,
  unlink,
  rename,
  stat
} from 'fs/promises'
import { homedir } from 'os'
import { join, dirname, basename, resolve } from 'path'
import { parseTree, getNodeValue, modify, applyEdits, type ParseError } from 'jsonc-parser'
import {
  isRecord,
  KIRO_SETTING_KEYS,
  parseKiroSettings,
  type KiroSettings,
  type KiroSettingsResult,
  type McpConfig,
  type McpServerEdit
} from '../shared/kiroSettings'
import { DEFAULT_KIRO_RULES } from './kiroDefaultRules'

export function kiroSettingsPath(
  platform = process.platform,
  home = homedir(),
  env = process.env
): string {
  const base =
    platform === 'win32'
      ? env.APPDATA || join(home, 'AppData', 'Roaming')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : env.XDG_CONFIG_HOME || join(home, '.config')
  return join(base, 'Kiro', 'User', 'settings.json')
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseObject(text: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const tree = parseTree(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true })
  const value: unknown = tree && getNodeValue(tree)
  if (errors.length || !isRecord(value)) throw new Error('配置文件 JSON 无效，请先修复文件后重试')
  return value
}
function edit(text: string, key: (string | number)[], value: unknown, tabSize = 2): string {
  return applyEdits(
    text,
    modify(text, key, value, {
      formattingOptions: { insertSpaces: true, tabSize, eol: text.includes('\r\n') ? '\r\n' : '\n' }
    })
  )
}

/** Mutations for the same file are serialized; unrelated resources can be read in parallel. */
export class KiroConfigFiles {
  readonly settingsPath: string
  readonly mcpPath: string
  readonly steeringPath: string
  private writes = new Map<string, Promise<unknown>>()
  constructor(home = homedir(), settings = kiroSettingsPath()) {
    this.settingsPath = settings
    this.mcpPath = join(home, '.kiro', 'settings', 'mcp.json')
    this.steeringPath = join(home, '.kiro', 'steering')
  }
  private mutate<T>(file: string, work: () => Promise<T>): Promise<T> {
    const task = (this.writes.get(file) || Promise.resolve()).catch(() => {}).then(work)
    this.writes.set(file, task)
    void task
      .finally(() => {
        if (this.writes.get(file) === task) this.writes.delete(file)
      })
      .catch(() => {})
    return task
  }
  private async text(file: string): Promise<string> {
    await this.writes.get(file)?.catch(() => {})
    return this.readText(file)
  }
  private async readText(file: string): Promise<string> {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      if (missing(error)) return '{}'
      throw error
    }
  }
  private async write(file: string, text: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    const mode = await stat(file).then(
      (info) => info.mode,
      (error) => {
        if (!missing(error)) throw error
        return 0o600
      }
    )
    try {
      await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode })
      await rename(temporary, file)
    } finally {
      await unlink(temporary).catch((error) => {
        if (!missing(error)) throw error
      })
    }
  }
  async load(section?: 'settings' | 'mcp' | 'steering'): Promise<KiroSettingsResult> {
    const result: KiroSettingsResult = {}
    const resources = section ? [section] : (['settings', 'mcp', 'steering'] as const)
    await Promise.all(
      resources.map(async (resource) => {
        try {
          if (resource === 'settings') {
            const raw = parseObject(await this.text(this.settingsPath))
            result.settings = parseKiroSettings(
              Object.fromEntries(
                Object.entries(KIRO_SETTING_KEYS).map(([key, diskKey]) => [key, raw[diskKey]])
              )
            )
          } else if (resource === 'mcp') {
            result.mcpConfig = this.parseMcp(await this.text(this.mcpPath))
          } else {
            try {
              const files = await readdir(this.steeringPath, { withFileTypes: true })
              result.steeringFiles = files
                .filter((file) => file.isFile() && file.name.endsWith('.md'))
                .map((file) => file.name)
            } catch (error) {
              if (!missing(error)) throw error
              result.steeringFiles = []
            }
          }
        } catch (error) {
          ;(result.errors ??= {})[resource] = message(error)
        }
      })
    )
    if (result.errors) result.error = Object.values(result.errors).join('\n')
    return result
  }
  private parseMcp(text: string): McpConfig {
    const raw = parseObject(text)
    if (raw.mcpServers === undefined) return { mcpServers: {} }
    if (!isRecord(raw.mcpServers) || !Object.values(raw.mcpServers).every(isRecord))
      throw new Error('MCP 服务器配置格式无效')
    const servers = raw.mcpServers
    for (const entry of Object.values(servers)) {
      if (
        !isRecord(entry) ||
        (entry.command !== undefined && typeof entry.command !== 'string') ||
        (entry.url !== undefined && typeof entry.url !== 'string') ||
        (entry.args !== undefined &&
          (!Array.isArray(entry.args) || !entry.args.every((v) => typeof v === 'string'))) ||
        (entry.env !== undefined &&
          (!isRecord(entry.env) || !Object.values(entry.env).every((v) => typeof v === 'string')))
      )
        throw new Error('MCP 服务器字段格式无效')
    }
    return { mcpServers: servers as McpConfig['mcpServers'] }
  }
  async saveSettings(input: Partial<KiroSettings>): Promise<void> {
    const settings = parseKiroSettings(input)
    await this.mutate(this.settingsPath, async () => {
      let text = await this.readText(this.settingsPath)
      parseObject(text)
      for (const key of Object.keys(settings) as (keyof KiroSettings)[])
        text = edit(text, [KIRO_SETTING_KEYS[key]], settings[key], 4)
      await this.write(this.settingsPath, text)
    })
  }
  async saveMcp(name: string, config: McpServerEdit, oldName?: string): Promise<void> {
    if (
      !name?.trim() ||
      !isRecord(config) ||
      typeof config.command !== 'string' ||
      !config.command.trim()
    )
      throw new Error('MCP 名称或命令无效')
    this.parseMcp(JSON.stringify({ mcpServers: { [name]: config } }))
    await this.mutate(this.mcpPath, async () => {
      let text = await this.readText(this.mcpPath)
      const { mcpServers } = this.parseMcp(text)
      const sourceName = oldName || name
      const existing = mcpServers[sourceName]
      if (existing?.url && !existing.command) throw new Error('请在配置文件中编辑远程 MCP 服务器')
      if (oldName && oldName !== name && Object.hasOwn(mcpServers, name))
        throw new Error('MCP 服务器名称已存在')
      const updated = {
        ...existing,
        command: config.command.trim(),
        args: config.args,
        env: config.env
      }
      // Undefined removes fields explicitly cleared by the editor without discarding unexposed settings.
      const clean = Object.fromEntries(
        Object.entries(updated).filter(([, value]) => value !== undefined)
      )
      if (oldName && oldName !== name) text = edit(text, ['mcpServers', oldName], undefined)
      text = edit(text, ['mcpServers', name], clean)
      await this.write(this.mcpPath, text)
    })
  }
  async deleteMcp(name: string): Promise<void> {
    await this.mutate(this.mcpPath, async () => {
      const text = await this.readText(this.mcpPath)
      const { mcpServers } = this.parseMcp(text)
      if (!Object.hasOwn(mcpServers, name)) throw new Error('服务器不存在')
      await this.write(this.mcpPath, edit(text, ['mcpServers', name], undefined))
    })
  }
  async ensureMcp(file = this.mcpPath): Promise<string> {
    await this.mutate(file, async () => {
      await mkdir(dirname(file), { recursive: true })
      try {
        await writeFile(file, JSON.stringify({ mcpServers: {} }, null, 2), { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    })
    return file
  }
  async ensureSettings(): Promise<string> {
    await this.mutate(this.settingsPath, async () => {
      await mkdir(dirname(this.settingsPath), { recursive: true })
      try {
        await writeFile(
          this.settingsPath,
          JSON.stringify(
            {
              'workbench.colorTheme': 'Kiro Light',
              'kiroAgent.modelSelection': 'claude-haiku-4.5'
            },
            null,
            4
          ),
          { flag: 'wx' }
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    })
    return this.settingsPath
  }
  private async rulePath(filename: string): Promise<string> {
    if (
      typeof filename !== 'string' ||
      !filename.endsWith('.md') ||
      filename !== basename(filename) ||
      /[\\/:]/.test(filename) ||
      filename.includes('\0') ||
      filename === '.md'
    )
      throw new Error('规则文件名无效')
    const file = join(this.steeringPath, filename)
    try {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('规则文件必须为目录内的普通文件')
      const [base, target] = await Promise.all([realpath(this.steeringPath), realpath(file)])
      if (dirname(target) !== resolve(base)) throw new Error('规则文件超出允许目录')
    } catch (error) {
      if (!missing(error)) throw error
    }
    return file
  }
  async openRule(filename: string): Promise<string> {
    const file = await this.rulePath(filename)
    await lstat(file)
    return file
  }
  async readRule(filename: string): Promise<string> {
    const file = await this.rulePath(filename)
    await this.writes.get(file)?.catch(() => {})
    return readFile(file, 'utf8')
  }
  async saveRule(filename: string, content: string): Promise<void> {
    if (typeof content !== 'string') throw new Error('规则内容无效')
    const file = await this.rulePath(filename)
    await this.mutate(file, async () => {
      await this.rulePath(filename)
      await this.write(file, content)
    })
  }
  async deleteRule(filename: string): Promise<void> {
    const file = await this.rulePath(filename)
    await this.mutate(file, async () => {
      await this.rulePath(filename)
      await unlink(file)
    })
  }
  async createRules(): Promise<string> {
    const file = await this.rulePath('rules.md')
    await this.mutate(file, async () => {
      await this.rulePath('rules.md')
      await mkdir(this.steeringPath, { recursive: true })
      try {
        await writeFile(file, DEFAULT_KIRO_RULES, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    })
    return file
  }
  async ensureSteeringFolder(): Promise<string> {
    await mkdir(this.steeringPath, { recursive: true })
    return this.steeringPath
  }
}
