import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui'
import { useTranslation } from '@/hooks/useTranslation'
import { X, Save, RefreshCw } from 'lucide-react'

interface SteeringEditorProps {
  filename: string
  onClose: () => void
  onSaved?: () => void
}

export function SteeringEditor({ filename, onClose, onSaved }: SteeringEditorProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modified, setModified] = useState(false)
  const { t } = useTranslation()
  const isEn = t('common.unknown') === 'Unknown'

  useEffect(() => {
    loadContent()
  }, [filename])

  const loadContent = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.readKiroSteeringFile(filename)
      if (result.success && result.content !== undefined) {
        setContent(result.content)
        setModified(false)
      } else {
        setError(result.error || (isEn ? 'Failed to read file' : '读取文件失败'))
      }
    } catch (err) {
      setError(isEn ? 'Failed to read file' : '读取文件失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const saveContent = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await window.api.saveKiroSteeringFile(filename, content)
      if (result.success) {
        setModified(false)
        onSaved?.()
      } else {
        setError(result.error || (isEn ? 'Failed to save file' : '保存文件失败'))
      }
    } catch (err) {
      setError(isEn ? 'Failed to save file' : '保存文件失败')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (modified) {
      if (
        confirm(
          isEn
            ? 'File modified. Close anyway? Unsaved changes will be lost.'
            : '文件已修改，确定要关闭吗？未保存的更改将丢失。'
        )
      ) {
        onClose()
      }
    } else {
      onClose()
    }
  }

  const handleChange = (value: string) => {
    setContent(value)
    setModified(true)
  }

  return createPortal(
    <div className="ui-dialog-overlay">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-transparent" onClick={handleClose} />

      {/* Dialog */}
      <div
        className="ui-dialog-panel w-[896px] max-w-[min(896px,calc(100vw-32px))] h-[80dvh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="ui-dialog-header flex-row items-center justify-between gap-2 border-b flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h2 className="text-title font-semibold min-w-0 break-words">
              {isEn ? 'Edit Steering File' : '编辑 Steering 文件'}
            </h2>
            <span className="text-body text-muted-foreground font-mono">{filename}</span>
            {modified && (
              <span className="text-caption text-warning">● {isEn ? 'Modified' : '已修改'}</span>
            )}
          </div>
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <Button
              variant="ghost"
              size="icon"
              onClick={loadContent}
              disabled={loading}
              title={isEn ? 'Refresh' : '刷新'}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={saveContent}
              disabled={saving || !modified}
            >
              <Save className="h-4 w-4 mr-0" />
              {saving ? (isEn ? 'Saving...' : '保存中...') : isEn ? 'Save' : '保存'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={isEn ? 'Close' : '关闭'}
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-destructive/10 text-destructive text-body">{error}</div>
        )}

        {/* Editor */}
        <div className="ui-dialog-body flex-auto min-h-0 py-3 h-full">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => handleChange(e.target.value)}
              className="w-full h-full font-mono text-body bg-muted border-0 resize-none focus:outline-none min-w-0 rounded-control border border-input bg-card px-2.5 focus:border-ring focus:ring-[3px] focus:ring-ring/20 py-2 min-h-[120px]"
              placeholder={isEn ? 'Edit steering rules here...' : '在此编辑 Steering 规则...'}
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <div className="ui-dialog-footer justify-start border-t text-caption text-muted-foreground">
          {isEn
            ? 'Tip: Steering files use Markdown format to define AI assistant behavior rules'
            : '提示：Steering 文件使用 Markdown 格式，用于定义 AI 助手的行为规则'}
        </div>
      </div>
    </div>,
    document.body
  )
}
