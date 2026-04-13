import { useState, useCallback, useRef, useEffect } from 'react'
import { marked } from 'marked'
import katex from 'katex'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'

export function ContentEditor({
  contentType,
  source,
  onSave,
  onClose,
}: {
  contentType: 'markdown' | 'math'
  source: string
  onSave: (source: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(source)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSave = useCallback(() => {
    onSave(text)
  }, [text, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.stopPropagation()
      handleSave()
    }
  }, [onClose, handleSave])

  const renderPreview = (): string => {
    if (!text) return `<span class="content-editor-empty">Start typing to see preview…</span>`
    if (contentType === 'markdown') {
      return DOMPurify.sanitize(marked.parse(text) as string)
    }
    try {
      return katex.renderToString(text, { throwOnError: false, displayMode: true })
    } catch {
      return `<span class="content-node-fallback">${DOMPurify.sanitize(text)}</span>`
    }
  }

  return (
    <div
      className="content-editor-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="content-editor-modal" onKeyDown={handleKeyDown}>
        <div className="content-editor-header">
          <span className="content-editor-title">
            {contentType === 'markdown' ? 'Edit Markdown' : 'Edit Math Formula'}
          </span>
          <div className="content-editor-header-actions">
            <button className="content-editor-save-btn" onClick={handleSave}>Save</button>
            <button className="content-editor-close-btn" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="content-editor-body">
          <textarea
            ref={textareaRef}
            className="content-editor-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={contentType === 'markdown' ? '# Heading\n\n**Bold** text, *italic*, `code`...' : 'E = mc^2'}
            spellCheck={false}
          />
          <div
            className={`content-editor-preview content-node-${contentType}`}
            dangerouslySetInnerHTML={{ __html: renderPreview() }}
          />
        </div>
        <div className="content-editor-footer">
          <span className="content-editor-hint">
            {contentType === 'markdown' ? 'Supports Markdown syntax' : 'Supports LaTeX math syntax'}
            {' · Ctrl+Enter to save · Esc to cancel'}
          </span>
        </div>
      </div>
    </div>
  )
}
