import { create } from 'zustand'

/**
 * 全局任务中心
 *
 * 设计目标：把分散在各页面的"批量任务"（注册、订阅、Token 刷新、代理验活...）
 * 统一汇总到一个 store，由 TitleBar 显示总进度，侧栏抽屉显示明细。
 *
 * 任何长耗时任务调用方式：
 *   const id = useTaskStore.getState().createTask({...})
 *   useTaskStore.getState().updateTask(id, { progress: 50 })
 *   useTaskStore.getState().completeTask(id, { successCount: 95, failedCount: 5 })
 */

export type TaskKind = 'register-batch' | 'subscription-batch'

export type TaskStatus = 'running' | 'paused' | 'success' | 'failed' | 'cancelled'

export interface TaskEntry {
  id: string
  kind: TaskKind
  /** 用户可见的任务标题，例如 "注册 50 个账号" */
  title: string
  /** 副标题，例如 "MoEmail 模式，并发 5" */
  subtitle?: string
  status: TaskStatus
  /** 0-100 进度百分比 */
  progress: number
  /** 已完成数 */
  done: number
  /** 总数 */
  total: number
  /** 成功数 */
  successCount: number
  /** 失败数 */
  failedCount: number
  /** 最后一条日志/状态描述 */
  lastMessage?: string
  /** 错误信息（失败时） */
  error?: string
  /** 取消回调：调用方注册，UI 可点击取消按钮调用 */
  onCancel?: () => void
  /** 暂停回调（仅支持暂停的任务） */
  onPause?: () => void
  /** 恢复回调 */
  onResume?: () => void

  createdAt: number
  updatedAt: number
  finishedAt?: number
}

interface TasksState {
  tasks: Map<string, TaskEntry>
}

interface TasksActions {
  /** 创建任务并返回 id */
  createTask: (
    input: Omit<
      TaskEntry,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'status'
      | 'progress'
      | 'done'
      | 'successCount'
      | 'failedCount'
    > & {
      status?: TaskStatus
      progress?: number
      done?: number
      successCount?: number
      failedCount?: number
    }
  ) => string
  updateTask: (id: string, updates: Partial<TaskEntry>) => void
  completeTask: (
    id: string,
    summary?: { successCount?: number; failedCount?: number; error?: string }
  ) => void
  failTask: (id: string, error: string) => void
  cancelTask: (id: string) => void
  removeTask: (id: string) => void
  clearFinished: () => void
}

type TasksStore = TasksState & TasksActions

// C7: 持久化键
const STORAGE_KEY = 'kiro-task-history'
const MAX_PERSISTED = 200 // 最多持久化最近 200 条已完成任务

/** 持久化任务（仅完成的任务，运行中任务不存） */
function persistTasks(tasks: Map<string, TaskEntry>): void {
  try {
    const finished = Array.from(tasks.values())
      .filter((t) => t.status !== 'running' && t.status !== 'paused')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_PERSISTED)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(finished))
  } catch {
    /* ignore */
  }
}

function loadPersistedTasks(): Map<string, TaskEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as TaskEntry[]
    const map = new Map<string, TaskEntry>()
    for (const t of arr) {
      // 启动时强制把"运行中"标记为"取消"（应用重启时已运行任务必然中断）
      const status: TaskStatus =
        t.status === 'running' || t.status === 'paused' ? 'cancelled' : t.status
      map.set(t.id, { ...t, status })
    }
    return map
  } catch {
    return new Map()
  }
}

export const useTaskStore = create<TasksStore>()((set, get) => ({
  tasks: loadPersistedTasks(),

  createTask: (input) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const entry: TaskEntry = {
      id,
      kind: input.kind,
      title: input.title,
      subtitle: input.subtitle,
      status: input.status ?? 'running',
      progress: input.progress ?? 0,
      done: input.done ?? 0,
      total: input.total,
      successCount: input.successCount ?? 0,
      failedCount: input.failedCount ?? 0,
      lastMessage: input.lastMessage,
      error: input.error,
      onCancel: input.onCancel,
      onPause: input.onPause,
      onResume: input.onResume,
      createdAt: now,
      updatedAt: now
    }
    set((state) => {
      const next = new Map(state.tasks)
      next.set(id, entry)
      return { tasks: next }
    })
    return id
  },

  updateTask: (id, updates) => {
    set((state) => {
      const next = new Map(state.tasks)
      const existing = next.get(id)
      if (!existing || !['running', 'paused'].includes(existing.status)) return state
      next.set(id, { ...existing, ...updates, updatedAt: Date.now() })
      return { tasks: next }
    })
  },

  completeTask: (id, summary) => {
    set((state) => {
      const next = new Map(state.tasks)
      const existing = next.get(id)
      if (!existing || !['running', 'paused'].includes(existing.status)) return state
      const successCount = summary?.successCount ?? existing.successCount
      const failedCount = summary?.failedCount ?? existing.failedCount
      const status: TaskStatus = summary?.error
        ? 'failed'
        : failedCount > 0 && successCount === 0
          ? 'failed'
          : 'success'
      next.set(id, {
        ...existing,
        status,
        progress: 100,
        onCancel: undefined,
        onPause: undefined,
        onResume: undefined,
        successCount,
        failedCount,
        error: summary?.error,
        finishedAt: Date.now(),
        updatedAt: Date.now()
      })
      return { tasks: next }
    })
    persistTasks(get().tasks)
  },

  failTask: (id, error) => {
    set((state) => {
      const next = new Map(state.tasks)
      const existing = next.get(id)
      if (!existing || !['running', 'paused'].includes(existing.status)) return state
      next.set(id, {
        ...existing,
        status: 'failed',
        onCancel: undefined,
        onPause: undefined,
        onResume: undefined,
        error,
        finishedAt: Date.now(),
        updatedAt: Date.now()
      })
      return { tasks: next }
    })
    persistTasks(get().tasks)
  },

  cancelTask: (id) => {
    const task = get().tasks.get(id)
    if (!task || !['running', 'paused'].includes(task.status)) return
    set((state) => {
      const next = new Map(state.tasks)
      const existing = next.get(id)
      if (!existing || !['running', 'paused'].includes(existing.status)) return state
      next.set(id, {
        ...existing,
        status: 'cancelled',
        onCancel: undefined,
        onPause: undefined,
        onResume: undefined,
        finishedAt: Date.now(),
        updatedAt: Date.now()
      })
      return { tasks: next }
    })
    try {
      task.onCancel?.()
    } catch {
      /* ignore */
    }
    persistTasks(get().tasks)
  },

  removeTask: (id) => {
    set((state) => {
      const next = new Map(state.tasks)
      next.delete(id)
      return { tasks: next }
    })
    persistTasks(get().tasks)
  },

  clearFinished: () => {
    set((state) => {
      const next = new Map<string, TaskEntry>()
      for (const [id, t] of state.tasks) {
        if (t.status === 'running' || t.status === 'paused') {
          next.set(id, t)
        }
      }
      return { tasks: next }
    })
    persistTasks(get().tasks)
  }
}))
