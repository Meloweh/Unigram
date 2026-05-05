import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { marked } from 'marked'
import type { ModelNode } from '../model/types'
import type { RichOverlayTarget, SceneRenderer } from '../scene/SceneRenderer'
import { NODE_STROKE_WIDTH } from '../scene/nodeStyle'

const MAX_RICH_OVERLAYS = 10

export function RichNodeOverlay({ renderer }: { renderer: SceneRenderer | null }) {
  const [targets, setTargets] = useState<RichOverlayTarget[]>([])
  const elementById = useRef(new Map<string, HTMLDivElement>())
  const latestTargetById = useRef(new Map<string, RichOverlayTarget>())

  useEffect(() => {
    if (!renderer) return
    let raf = 0
    let lastKey = ''
    const tick = () => {
      const next = renderer.getRichOverlayTargets(MAX_RICH_OVERLAYS)
      latestTargetById.current = new Map(next.map((target) => [target.id, target]))
      for (const target of next) {
        const element = elementById.current.get(target.id)
        if (element) syncRichNodeElement(element, target)
      }
      const key = next
        .map((t) => `${t.id}:${Math.round(t.rect.width)}:${Math.round(t.rect.height)}:${t.selected ? 1 : 0}:${t.node.shape}:${t.node.mediaType}:${t.node.mediaSrc ?? ''}:${t.node.audioCoverSrc ?? ''}:${t.node.contentSource ?? ''}:${t.node.contentCollapsed ?? ''}`)
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

  const bindElement = (id: string) => (element: HTMLDivElement | null) => {
    if (!element) {
      elementById.current.delete(id)
      return
    }
    elementById.current.set(id, element)
    const target = latestTargetById.current.get(id)
    if (target) syncRichNodeElement(element, target)
  }

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
        <RichNode key={target.id} target={target} bindElement={bindElement(target.id)} />
      ))}
    </div>
  )
}

function RichNode({ target, bindElement }: { target: RichOverlayTarget; bindElement: (element: HTMLDivElement | null) => void }) {
  const { node, rect } = target
  if (!node.mediaType) return null
  const visualMedia = isFilledVisualMedia(node)
  const displayRect = visualMedia ? rect : richNodeVisual(target).rect
  const minReadable = displayRect.width >= 42 && displayRect.height >= 28
  if (!minReadable) return null
  return (
    <div
      ref={bindElement}
      data-testid={`rich-node-${node.id}`}
      style={richNodeContainerStyle(target)}
    >
      <RichNodeContent node={node} interactive={target.selected} />
    </div>
  )
}

function RichNodeContent({ node, interactive }: { node: ModelNode; interactive: boolean }) {
  switch (node.mediaType) {
    case 'image':
    case 'gif':
      return node.mediaSrc ? (
        <img
          src={node.mediaSrc}
          alt={node.label || node.mediaFileName || node.mediaType}
          draggable={false}
          style={mediaFillStyle('cover', 'none')}
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
          style={mediaFillStyle('cover', interactive ? 'auto' : 'none')}
        />
      ) : null
    case 'audio':
      return (
        <div style={{ ...mediaFillStyle('cover', interactive ? 'auto' : 'none'), display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
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
                borderRadius: 'inherit',
                pointerEvents: 'none',
              }}
            />
          )}
          {node.mediaSrc ? (
            <audio
              src={node.mediaSrc}
              controls
              preload="metadata"
              style={{ width: '100%', position: 'relative', pointerEvents: interactive ? 'auto' : 'none' }}
            />
          ) : (
            null
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

function mediaFillStyle(objectFit: 'contain' | 'cover', pointerEvents: 'auto' | 'none'): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit,
    borderRadius: 0,
    pointerEvents,
  }
}

function richNodeContainerStyle(target: RichOverlayTarget): CSSProperties {
  const visual = richNodeVisual(target)
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: visual.rect.width,
    height: visual.rect.height,
    transform: `translate3d(${visual.rect.left}px, ${visual.rect.top}px, 0)`,
    padding: visual.padding,
    backgroundColor: visual.backgroundColor,
    borderRadius: visual.borderRadius,
    boxShadow: visual.boxShadow,
    clipPath: visual.clipPath,
    overflow: 'hidden',
    pointerEvents: 'none',
    willChange: 'transform, width, height',
  }
}

function syncRichNodeElement(element: HTMLDivElement, target: RichOverlayTarget): void {
  const visual = richNodeVisual(target)
  const style = element.style
  style.transform = `translate3d(${visual.rect.left}px, ${visual.rect.top}px, 0)`
  style.width = `${visual.rect.width}px`
  style.height = `${visual.rect.height}px`
  style.padding = `${visual.padding}px`
  style.backgroundColor = visual.backgroundColor ?? ''
  style.borderRadius = visual.borderRadius
  style.boxShadow = visual.boxShadow ?? ''
  style.clipPath = visual.clipPath ?? ''
}

function richNodeVisual(target: RichOverlayTarget): {
  rect: RichOverlayTarget['rect']
  padding: number
  backgroundColor?: string
  boxShadow?: string
  borderRadius: string
  clipPath?: string
} {
  const { node, rect } = target
  const visualMedia = isFilledVisualMedia(node)
  const borderWidth = visualMedia ? mediaOverlayInset(target) : 0
  const displayRect = visualMedia ? rect : insetRect(rect, borderWidth)
  const corner = mediaCornerStyle(node, rect, 0)
  return {
    rect: displayRect,
    padding: visualMedia ? 0 : Math.max(3, Math.min(12, Math.min(displayRect.width, displayRect.height) * 0.06)),
    backgroundColor: visualMedia ? '#000' : undefined,
    boxShadow: borderWidth > 0 ? `inset 0 0 0 ${borderWidth}px ${target.membraneColor}` : undefined,
    borderRadius: corner.borderRadius,
    clipPath: corner.clipPath,
  }
}

function isFilledVisualMedia(node: ModelNode): boolean {
  return !!node.mediaSrc && (node.mediaType === 'image' || node.mediaType === 'gif' || node.mediaType === 'video')
}

function mediaOverlayInset(target: RichOverlayTarget): number {
  if (target.node.membraneVisible === false) return 0
  return NODE_STROKE_WIDTH * target.scale
}

function insetRect(rect: RichOverlayTarget['rect'], inset: number): RichOverlayTarget['rect'] {
  const safe = safeOverlayInset(rect, inset)
  return {
    left: rect.left + safe,
    top: rect.top + safe,
    width: rect.width - safe * 2,
    height: rect.height - safe * 2,
  }
}

function safeOverlayInset(rect: RichOverlayTarget['rect'], inset: number): number {
  const maxInset = Math.max(0, Math.min(rect.width, rect.height) / 2 - 1)
  return Math.min(inset, maxInset)
}

function mediaCornerStyle(node: ModelNode, outerRect: RichOverlayTarget['rect'], inset: number): { borderRadius: string; clipPath?: string } {
  switch (node.shape) {
    case 'rectangle':
      return { borderRadius: '0px' }
    case 'circle':
    case 'oval':
      return { borderRadius: '50%' }
    case 'diamond':
      return { borderRadius: '0px', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }
    case 'hexagon':
      return { borderRadius: '0px', clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' }
    case 'parallelogram':
      return { borderRadius: '0px', clipPath: 'polygon(18% 0%, 100% 0%, 82% 100%, 0% 100%)' }
    case 'triangle':
      return { borderRadius: '0px', clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }
    default:
      return { borderRadius: `${Math.max(0, Math.min(outerRect.width, outerRect.height) * 0.18 - inset)}px` }
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
