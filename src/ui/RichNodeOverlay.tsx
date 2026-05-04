import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { marked } from 'marked'
import type { ModelNode } from '../model/types'
import type { RichOverlayTarget, SceneRenderer } from '../scene/SceneRenderer'

const MAX_RICH_OVERLAYS = 10

export function RichNodeOverlay({ renderer }: { renderer: SceneRenderer | null }) {
  const [targets, setTargets] = useState<RichOverlayTarget[]>([])

  useEffect(() => {
    if (!renderer) return
    let raf = 0
    let lastKey = ''
    const tick = () => {
      const next = renderer.getRichOverlayTargets(MAX_RICH_OVERLAYS)
      const key = next
        .map((t) => `${t.id}:${Math.round(t.rect.left)}:${Math.round(t.rect.top)}:${Math.round(t.rect.width)}:${Math.round(t.rect.height)}:${t.node.mediaType}:${t.node.mediaSrc ?? ''}:${t.node.contentSource ?? ''}:${t.node.contentCollapsed ?? ''}`)
        .join('|')
      if (key !== lastKey) {
        lastKey = key
        setTargets(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [renderer])

  if (!renderer || targets.length === 0) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 8,
        pointerEvents: 'none',
      }}
    >
      {targets.map((target) => (
        <RichNode key={target.id} target={target} />
      ))}
    </div>
  )
}

function RichNode({ target }: { target: RichOverlayTarget }) {
  const { node, rect } = target
  if (!node.mediaType) return null
  const minReadable = rect.width >= 42 && rect.height >= 28
  if (!minReadable) return null
  return (
    <div
      data-testid={`rich-node-${node.id}`}
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        padding: Math.max(3, Math.min(12, Math.min(rect.width, rect.height) * 0.06)),
        borderRadius: Math.max(4, Math.min(12, Math.min(rect.width, rect.height) * 0.08)),
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <RichNodeContent node={node} />
    </div>
  )
}

function RichNodeContent({ node }: { node: ModelNode }) {
  switch (node.mediaType) {
    case 'image':
    case 'gif':
      return node.mediaSrc ? (
        <img
          src={node.mediaSrc}
          alt={node.label || node.mediaFileName || node.mediaType}
          draggable={false}
          style={mediaFillStyle('contain', 'none')}
        />
      ) : null
    case 'video':
      return node.mediaSrc ? (
        <video
          src={node.mediaSrc}
          controls
          preload="metadata"
          draggable={false}
          data-testid={`video-node-${node.id}`}
          style={mediaFillStyle('contain', 'auto')}
        />
      ) : <MediaPlaceholder label="Drop video here" />
    case 'audio':
      return (
        <div style={{ ...mediaFillStyle('cover', 'auto'), display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
          {node.audioCoverSrc && (
            <img
              src={node.audioCoverSrc}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: 0.7,
                pointerEvents: 'none',
              }}
            />
          )}
          {node.mediaSrc ? (
            <audio
              src={node.mediaSrc}
              controls
              preload="metadata"
              style={{ width: '100%', position: 'relative', pointerEvents: 'auto' }}
            />
          ) : (
            <MediaPlaceholder label="Drop audio here" />
          )}
        </div>
      )
    case 'markdown':
    case 'math':
      return <ContentPreview node={node} />
    default:
      return null
  }
}

function ContentPreview({ node }: { node: ModelNode }) {
  const html = useMemo(() => renderContentHtml(node), [node])
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        pointerEvents: 'auto',
        color: 'var(--ug-node-label)',
        font: `${node.contentFontSize ?? 0.85}rem system-ui, sans-serif`,
        lineHeight: 1.35,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function renderContentHtml(node: ModelNode): string {
  const source = node.contentSource ?? (typeof node.extra?.contentSource === 'string' ? node.extra.contentSource : '')
  if (!source.trim()) {
    return `<span style="color:var(--ug-text-muted)">${node.mediaType === 'math' ? 'Empty formula' : 'Empty markdown'}</span>`
  }
  const collapsed = node.contentCollapsed !== false
  if (node.mediaType === 'math') {
    const math = collapsed ? source.split('\n')[0] : source
    try {
      return DOMPurify.sanitize(katex.renderToString(math, { throwOnError: false, displayMode: !collapsed }))
    } catch {
      return DOMPurify.sanitize(`<span>${escapeHtml(math)}</span>`)
    }
  }
  if (collapsed) {
    const first = source.split('\n')[0]
    return DOMPurify.sanitize(`<span>${escapeHtml(first.slice(0, 120))}${first.length > 120 ? '...' : ''}</span>`)
  }
  return DOMPurify.sanitize(marked.parse(source) as string)
}

function MediaPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 8,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(255,255,255,0.32)',
        color: 'var(--ug-text-muted)',
        font: '600 12px system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  )
}

function mediaFillStyle(objectFit: 'contain' | 'cover', pointerEvents: 'auto' | 'none'): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    objectFit,
    borderRadius: 8,
    pointerEvents,
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
