import { toRgba } from './_helpers'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AccountAssignmentList } from './AccountAssignmentList'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../ui'
import { useAccountsStore } from '@/store/accounts'
import { useTranslation } from '@/hooks/useTranslation'
import type { Account, AccountTag } from '@/types/account'
import { X, Plus, Edit2, Trash2, Tag, Check, Palette } from 'lucide-react'

const noAccounts = new Map<string, Account>()
const noTags = new Map<string, AccountTag>()

interface TagManageDialogProps {
  isOpen: boolean
  onClose: () => void
}

// 预设颜色（带透明度）
const PRESET_COLORS = [
  { name: '红色', value: '#ffef4444' },
  { name: '橙色', value: '#fff97316' },
  { name: '黄色', value: '#ffeab308' },
  { name: '绿色', value: '#ff22c55e' },
  { name: '青色', value: '#ff06b6d4' },
  { name: '蓝色', value: '#ff3b82f6' },
  { name: '紫色', value: '#ff8b5cf6' },
  { name: '粉色', value: '#ffec4899' },
  { name: '灰色', value: '#ff6b7280' },
  // 半透明版本
  { name: '浅红', value: '#80ef4444' },
  { name: '浅绿', value: '#8022c55e' },
  { name: '浅蓝', value: '#803b82f6' },
  { name: '浅紫', value: '#808b5cf6' }
]

// 解析 ARGB 颜色
function parseArgb(color: string): { alpha: number; rgb: string } {
  // 支持格式: #AARRGGBB 或 #RRGGBB
  if (color.length === 9 && color.startsWith('#')) {
    const alpha = parseInt(color.slice(1, 3), 16)
    const rgb = '#' + color.slice(3)
    return { alpha, rgb }
  }
  return { alpha: 255, rgb: color }
}

// 转换为 ARGB 格式
function toArgb(rgb: string, alpha: number): string {
  const hex = rgb.startsWith('#') ? rgb.slice(1) : rgb
  const alphaHex = Math.round(alpha).toString(16).padStart(2, '0')
  return `#${alphaHex}${hex}`
}

// 转换为 CSS rgba
export function TagManageDialog({ isOpen, onClose }: TagManageDialogProps): React.ReactNode {
  const { tags, accounts, addTag, updateTag, removeTag, addTagToAccounts, removeTagFromAccounts } =
    useAccountsStore(
      useShallow((state) => ({
        tags: isOpen ? state.tags : noTags,
        accounts: isOpen ? state.accounts : noAccounts,
        addTag: state.addTag,
        updateTag: state.updateTag,
        removeTag: state.removeTag,
        addTagToAccounts: state.addTagToAccounts,
        removeTagFromAccounts: state.removeTagFromAccounts
      }))
    )
  const { actualLanguage } = useTranslation()
  const isEn = actualLanguage === 'en'

  // 编辑状态
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#ff3b82f6')
  const [editAlpha, setEditAlpha] = useState(255)

  // 新建状态
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [newAlpha, setNewAlpha] = useState(255)

  // 分配账号状态
  const [assigningTagId, setAssigningTagId] = useState<string | null>(null)

  const { tagCounts, untagged } = useMemo(() => {
    const counts = new Map<string, number>()
    let untagged = 0
    for (const account of accounts.values()) {
      if (!account.tags.length) untagged++
      for (const tag of account.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
    return { tagCounts: counts, untagged }
  }, [accounts])
  const { assigned, available } = useMemo(() => {
    const assigned: Account[] = [],
      available: Account[] = []
    if (assigningTagId)
      for (const account of accounts.values())
        (account.tags.includes(assigningTagId) ? assigned : available).push(account)
    return { assigned, available }
  }, [accounts, assigningTagId])

  // 创建标签
  const handleCreate = (): void => {
    if (!newName.trim()) return
    const argbColor = toArgb(newColor, newAlpha)
    addTag({
      name: newName.trim(),
      color: argbColor
    })
    setNewName('')
    setNewColor('#3b82f6')
    setNewAlpha(255)
    setIsCreating(false)
  }

  // 开始编辑
  const handleStartEdit = (tag: AccountTag): void => {
    setEditingId(tag.id)
    setEditName(tag.name)
    const { alpha, rgb } = parseArgb(tag.color)
    setEditColor(rgb)
    setEditAlpha(alpha)
  }

  // 保存编辑
  const handleSaveEdit = (): void => {
    if (!editingId || !editName.trim()) return
    const argbColor = toArgb(editColor, editAlpha)
    updateTag(editingId, {
      name: editName.trim(),
      color: argbColor
    })
    setEditingId(null)
  }

  // 删除标签
  const handleDelete = (id: string, name: string): void => {
    const count = tagCounts.get(id) || 0
    const msg =
      count > 0
        ? `确定要删除标签「${name}」吗？\n该标签已应用于 ${count} 个账号，删除后将从这些账号移除。`
        : `确定要删除标签「${name}」吗？`
    if (confirm(msg)) {
      removeTag(id)
    }
  }

  const tagList = useMemo(() => Array.from(tags.values()), [tags])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />

      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="TagManageDialog-title"
        className="ui-dialog-panel rounded-dialog"
      >
        <CardHeader className="ui-dialog-header px-6 pt-5 pb-3 space-y-0">
          <div className="flex items-center justify-between gap-2">
            <CardTitle id="TagManageDialog-title" className="text-title flex items-center gap-2">
              <Tag className="h-5 w-5" />
              {isEn ? 'Tag Management' : '标签管理'}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              title={isEn ? 'Close' : '关闭'}
              onClick={onClose}
              className="rounded-control hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="ui-dialog-body p-0 px-6 pb-5 space-y-4">
          {/* 统计信息 */}
          <div className="flex gap-4 text-body text-muted-foreground">
            <span>{isEn ? `${tagList.length} tags` : `共 ${tagList.length} 个标签`}</span>
            <span>•</span>
            <span>{isEn ? `${untagged} untagged` : `${untagged} 个未标记账号`}</span>
          </div>

          {/* 新建标签 */}
          {isCreating ? (
            <div className="p-4 border rounded-panel space-y-3 bg-muted/30">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded border cursor-pointer flex items-center justify-center"
                  style={{ backgroundColor: toRgba(toArgb(newColor, newAlpha)) }}
                >
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <input
                  type="text"
                  placeholder={isEn ? 'Tag name' : '标签名称'}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 px-2.5 py-1 border rounded-control text-body min-w-0 h-control"
                  autoFocus
                />
              </div>

              {/* 透明度滑块 */}
              <div className="flex items-center gap-3">
                <Palette className="h-4 w-4 text-muted-foreground" />
                <span className="text-body text-muted-foreground w-16">
                  {isEn ? 'Opacity' : '透明度'}
                </span>
                <input
                  type="range"
                  min="0"
                  max="255"
                  value={newAlpha}
                  onChange={(e) => setNewAlpha(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-body w-12 text-right">
                  {Math.round((newAlpha / 255) * 100)}%
                </span>
              </div>

              {/* 预设颜色 */}
              <div className="flex flex-wrap gap-1">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset.value}
                    className="w-6 h-6 rounded border transition-transform"
                    style={{ backgroundColor: toRgba(preset.value) }}
                    onClick={() => {
                      const { alpha, rgb } = parseArgb(preset.value)
                      setNewColor(rgb)
                      setNewAlpha(alpha)
                    }}
                    title={preset.name}
                  />
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsCreating(false)}>
                  {isEn ? 'Cancel' : '取消'}
                </Button>
                <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
                  <Check className="h-4 w-4 " />
                  {isEn ? 'Create' : '创建'}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 " />
              {isEn ? 'New Tag' : '新建标签'}
            </Button>
          )}

          {/* 标签列表 */}
          <div className="space-y-2">
            {tagList.map((tag) => (
              <div
                key={tag.id}
                className="p-3 border rounded-panel hover:bg-muted/30 transition-colors"
              >
                {editingId === tag.id ? (
                  // 编辑模式
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded border cursor-pointer flex items-center justify-center"
                        style={{ backgroundColor: toRgba(toArgb(editColor, editAlpha)) }}
                      >
                        <input
                          type="color"
                          value={editColor}
                          onChange={(e) => setEditColor(e.target.value)}
                          className="w-full h-full opacity-0 cursor-pointer"
                        />
                      </div>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 border rounded-control text-body min-w-0 h-control"
                        autoFocus
                      />
                    </div>

                    {/* 透明度滑块 */}
                    <div className="flex items-center gap-3">
                      <span className="text-body text-muted-foreground w-16">
                        {isEn ? 'Opacity' : '透明度'}
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="255"
                        value={editAlpha}
                        onChange={(e) => setEditAlpha(parseInt(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-body w-12 text-right">
                        {Math.round((editAlpha / 255) * 100)}%
                      </span>
                    </div>

                    {/* 预设颜色 */}
                    <div className="flex flex-wrap gap-1">
                      {PRESET_COLORS.map((preset) => (
                        <button
                          key={preset.value}
                          className="w-6 h-6 rounded border transition-transform"
                          style={{ backgroundColor: toRgba(preset.value) }}
                          onClick={() => {
                            const { alpha, rgb } = parseArgb(preset.value)
                            setEditColor(rgb)
                            setEditAlpha(alpha)
                          }}
                          title={preset.name}
                        />
                      ))}
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                        取消
                      </Button>
                      <Button size="sm" onClick={handleSaveEdit}>
                        保存
                      </Button>
                    </div>
                  </div>
                ) : assigningTagId === tag.id ? (
                  // 分配账号模式
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 h-5 px-[7px] rounded-full text-badge font-medium text-white"
                        style={{ backgroundColor: toRgba(tag.color) }}
                      >
                        {tag.name}
                      </span>
                      <span className="text-body text-muted-foreground">
                        - 选择要添加标签的账号
                      </span>
                    </div>

                    {/* 已标记的账号 */}
                    {assigned.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-caption text-muted-foreground">
                          {isEn ? 'Tagged accounts:' : '已标记的账号：'}
                        </p>
                        <AccountAssignmentList
                          items={assigned}
                          renderItem={(acc) => (
                            <span
                              key={acc.id}
                              className="inline-flex items-center gap-1 h-5 px-[7px] rounded-full text-badge"
                              style={{ backgroundColor: toRgba(tag.color), color: 'white' }}
                            >
                              {acc.email}
                              <button
                                onClick={() => removeTagFromAccounts([acc.id], tag.id)}
                                className="hover:opacity-70"
                                title={isEn ? 'Remove tag' : '移除标签'}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )}
                        />
                      </div>
                    )}

                    {/* 可添加标签的账号 */}
                    {available.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-caption text-muted-foreground">
                          {isEn ? 'Click to add tag:' : '点击添加标签：'}
                        </p>
                        <AccountAssignmentList
                          items={available}
                          renderItem={(acc) => (
                            <button
                              key={acc.id}
                              onClick={() => addTagToAccounts([acc.id], tag.id)}
                              className="inline-flex items-center h-5 px-[7px] bg-muted hover:bg-primary/20 rounded-full text-badge transition-colors"
                            >
                              {acc.email}
                            </button>
                          )}
                        />
                      </div>
                    )}

                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => setAssigningTagId(null)}>
                        完成
                      </Button>
                    </div>
                  </div>
                ) : (
                  // 显示模式
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-flex items-center gap-1 h-5 px-[7px] rounded-full text-badge font-medium text-white shrink-0"
                      style={{ backgroundColor: toRgba(tag.color) }}
                    >
                      {tag.name}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {tagCounts.get(tag.id) || 0} 个账号
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setAssigningTagId(tag.id)}
                        title={isEn ? 'Manage accounts' : '管理账号'}
                      >
                        <Tag className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleStartEdit(tag)}
                        title={isEn ? 'Edit' : '编辑'}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(tag.id, tag.name)}
                        title={isEn ? 'Delete' : '删除'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {tagList.length === 0 && !isCreating && (
              <div className="text-center py-8 text-muted-foreground">
                <Tag className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>{isEn ? 'No tags' : '暂无标签'}</p>
                <p className="text-body">
                  {isEn
                    ? 'Click the button above to create your first tag'
                    : '点击上方按钮创建第一个标签'}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
