import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from '@/hooks/useTranslation'
import {
  Activity,
  X,
  Pause,
  Play,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ListChecks,
  Network,
  UserPlus,
  CreditCard,
  RefreshCw,
  Zap,
  Loader2
} from 'lucide-react'
import { useTaskStore, type TaskEntry, type TaskKind } from '@/store/tasks'
import { Button, Badge } from '../ui'
import { cn } from '@/lib/utils'

const KIND_ICONS: Record<TaskKind, React.ElementType> = {
  'register-batch': UserPlus,
  'subscription-batch': CreditCard,
  'overage-batch': Zap,
  'proxy-validation': Network,
  'token-refresh': RefreshCw,
  'account-check': RefreshCw,
  other: ListChecks
}

/**
 * 任务中心入口：TitleBar 上的小徽章按钮
 * 点击展开任务列表抽屉
 */
export function TaskCenterButton(): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const [open, setOpen] = useState(false)
  const tasks = useTaskStore((s) => s.tasks)

  const { activeCount, finishedCount, hasFailure, totalProgress } = useMemo(() => {
    let active = 0,
      finished = 0,
      hasFail = false
    let totalDone = 0,
      totalAll = 0
    for (const t of tasks.values()) {
      if (t.status === 'running' || t.status === 'paused') {
        active++
        totalDone += t.done
        totalAll += t.total
      } else {
        finished++
        if (t.status === 'failed') hasFail = true
      }
    }
    return {
      activeCount: active,
      finishedCount: finished,
      hasFailure: hasFail,
      totalProgress: totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
    }
  }, [tasks])

  if (tasks.size === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={isEn ? 'Task Center' : '任务中心'}
        className={cn(
          'flex items-center gap-1.5 px-2 h-7 rounded-control text-caption transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'hover:bg-muted',
          activeCount > 0
            ? 'text-primary'
            : hasFailure
              ? 'text-danger-text'
              : 'text-muted-foreground'
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {activeCount > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Activity className="h-4 w-4" />
        )}
        {activeCount > 0 && <span className="tabular-nums font-medium">{activeCount}</span>}
        {activeCount > 0 && totalProgress > 0 && (
          <span className="opacity-60 tabular-nums">{totalProgress}%</span>
        )}
        {activeCount === 0 && finishedCount > 0 && (
          <span className="tabular-nums opacity-60">{finishedCount}</span>
        )}
      </button>

      <TaskCenterDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}

interface TaskCenterDrawerProps {
  open: boolean
  onClose: () => void
}

function TaskCenterDrawer({ open, onClose }: TaskCenterDrawerProps): React.ReactNode {
  const { t: translate } = useTranslation()
  const isEn = translate('common.unknown') === 'Unknown'
  const tasks = useTaskStore((s) => s.tasks)
  const cancelTask = useTaskStore((s) => s.cancelTask)
  const removeTask = useTaskStore((s) => s.removeTask)
  const clearFinished = useTaskStore((s) => s.clearFinished)

  // 取消所有正在进行的任务
  const cancelAllActive = (): void => {
    const active = Array.from(tasks.values()).filter(
      (t) => t.status === 'running' || t.status === 'paused'
    )
    if (active.length === 0) return
    if (
      !confirm(
        isEn
          ? `Cancel ${active.length} running task(s)?`
          : `取消正在进行的 ${active.length} 个任务？`
      )
    )
      return
    for (const t of active) cancelTask(t.id)
  }
  const activeCount = Array.from(tasks.values()).filter(
    (t) => t.status === 'running' || t.status === 'paused'
  ).length

  const sortedTasks = useMemo(() => {
    return Array.from(tasks.values()).sort((a, b) => {
      // 活动的排前面
      const aActive = a.status === 'running' || a.status === 'paused'
      const bActive = b.status === 'running' || b.status === 'paused'
      if (aActive !== bActive) return aActive ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [tasks])

  // 通过 Portal 渲染到 document.body：避免被 TitleBar 的 -webkit-app-region: drag
  // 拖拽区吞掉点击，也避免受 titlebar 堆叠上下文 / overflow 影响导致按钮点不动
  return createPortal(
    <AnimatePresence>
      {open && (
        // no-drag 确保抽屉内所有按钮在 Windows 下可点击
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[9998] bg-[var(--overlay)]"
            data-task-backdrop
            onClick={onClose}
          />
          {/* 抽屉 */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 z-[9999] w-[420px] max-w-full overflow-hidden rounded-l-dialog border-l bg-card text-card-foreground shadow-[var(--dialog-shadow)] flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-center-title"
          >
            {/* 头部 */}
            <div className="relative shrink-0 border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-text-secondary" />
                <h2 id="task-center-title" className="text-section">
                  {isEn ? 'Task Center' : '任务中心'}
                </h2>
                <Badge variant="secondary" className="tabular-nums">
                  {sortedTasks.length}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {activeCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelAllActive}
                    className="text-destructive hover:text-destructive"
                    title={
                      isEn
                        ? `Cancel all ${activeCount} running tasks`
                        : `取消所有 ${activeCount} 个正在进行的任务`
                    }
                  >
                    <XCircle className="h-4 w-4" />
                    {isEn ? 'Cancel all' : '全部取消'}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearFinished}>
                  <Trash2 className="h-4 w-4" />
                  {isEn ? 'Clear finished' : '清理已完成'}
                </Button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={isEn ? 'Close' : '关闭'}
                  className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-control text-text-secondary hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {sortedTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
                  <ListChecks className="h-10 w-10 opacity-30 mb-3" />
                  <p className="text-sm">{isEn ? 'No tasks' : '暂无任务'}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onCancel={() => cancelTask(task.id)}
                      onRemove={() => removeTask(task.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

interface TaskRowProps {
  task: TaskEntry
  onCancel: () => void
  onRemove: () => void
}

function TaskRow({ task, onCancel, onRemove }: TaskRowProps): React.ReactNode {
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'
  const Icon = KIND_ICONS[task.kind] || ListChecks
  const isActive = task.status === 'running' || task.status === 'paused'
  const elapsed = (task.finishedAt || Date.now()) - task.createdAt

  const statusBadge = (() => {
    switch (task.status) {
      case 'running':
        return <Badge variant="secondary">{isEn ? 'Running' : '运行中'}</Badge>
      case 'paused':
        return (
          <Badge variant="outline" className="border-transparent bg-warning-soft text-warning-text">
            {isEn ? 'Paused' : '已暂停'}
          </Badge>
        )
      case 'success':
        return <Badge variant="success">{isEn ? 'Done' : '已完成'}</Badge>
      case 'failed':
        return <Badge variant="destructive">{isEn ? 'Failed' : '失败'}</Badge>
      case 'cancelled':
        return (
          <Badge variant="outline" className="text-muted-foreground">
            {isEn ? 'Cancelled' : '已取消'}
          </Badge>
        )
    }
  })()

  return (
    <div className="rounded-panel border bg-card p-4" data-task-id={task.id}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'p-2 rounded-control flex-shrink-0',
            task.status === 'success' && 'bg-success-soft text-success-text',
            task.status === 'failed' && 'bg-danger-soft text-danger-text',
            task.status === 'cancelled' && 'bg-muted text-muted-foreground',
            isActive && 'bg-muted text-text-secondary'
          )}
        >
          {task.status === 'running' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : task.status === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : task.status === 'failed' ? (
            <XCircle className="h-4 w-4" />
          ) : task.status === 'paused' ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body font-medium truncate" title={task.title}>
              {task.title}
            </p>
            {statusBadge}
          </div>
          {task.subtitle && (
            <p className="text-caption text-muted-foreground truncate mt-0.5" title={task.subtitle}>
              {task.subtitle}
            </p>
          )}

          {/* 进度条 */}
          {(task.total > 0 || isActive) && (
            <div className="mt-2 space-y-1">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    task.status === 'failed' && 'bg-destructive',
                    task.status === 'success' && 'bg-success',
                    isActive && 'bg-primary',
                    task.status === 'cancelled' && 'bg-muted-foreground'
                  )}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-caption text-muted-foreground tabular-nums">
                <span>
                  {task.done}/{task.total}
                  {task.successCount > 0 && (
                    <span className="text-success-text ml-1.5">✓{task.successCount}</span>
                  )}
                  {task.failedCount > 0 && (
                    <span className="text-danger-text ml-1">✗{task.failedCount}</span>
                  )}
                </span>
                <span>{formatDuration(elapsed)}</span>
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {task.error && (
            <div className="mt-2 flex items-start gap-1.5 text-caption text-danger-text">
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <span className="break-all">{task.error}</span>
            </div>
          )}

          {/* 最后日志 */}
          {task.lastMessage && !task.error && (
            <p
              className="text-caption text-muted-foreground mt-1 truncate"
              title={task.lastMessage}
            >
              {task.lastMessage}
            </p>
          )}

          {/* 操作 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {task.status === 'running' && task.onPause && (
              <Button size="sm" variant="ghost" onClick={task.onPause}>
                <Pause className="h-4 w-4" /> {isEn ? 'Pause' : '暂停'}
              </Button>
            )}
            {task.status === 'paused' && task.onResume && (
              <Button size="sm" variant="ghost" onClick={task.onResume}>
                <Play className="h-4 w-4" /> {isEn ? 'Resume' : '恢复'}
              </Button>
            )}
            {isActive && (
              <Button
                size="sm"
                variant="ghost"
                className=" text-destructive hover:text-destructive"
                onClick={onCancel}
              >
                <XCircle className="h-4 w-4" /> {isEn ? 'Cancel' : '取消'}
              </Button>
            )}
            {!isActive && (
              <Button size="sm" variant="ghost" onClick={onRemove}>
                <Trash2 className="h-4 w-4" /> {isEn ? 'Remove' : '移除'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
