import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { type Model, type ModelNode } from './sampleModels'
import { useHybridZoomStore } from './useHybridZoomStore'
import { CAMERA_SCALE_FINAL } from './hybridZoom'
import { resolveBackground } from './backgrounds'
import { renderFormattedLabel } from './labelFormatting'
import { chatBubblePath, chatBubbleClipPath, thinkingCloudPath, thinkingCloudTrail } from './cosmeticShapes'
import { shapeSvgPoints } from './edgeAnchoring'
import { NODE_MIN_W, NODE_MIN_H } from './sceneConstants'
import { ChildModelPreview } from './ChildModelPreview'
import { marked } from 'marked'
import katex from 'katex'
import DOMPurify from 'dompurify'

/** A single node that can expand its canvas when zooming */
export function SceneNode({
  node,
  posX,
  posY,
  isSelected,
  isMultiSelected,
  isZooming,
  progress,
  childModel,
  vpSize,
  onSelect,
  onDoubleClick,
  onDragStart,
  onConnectionDragStart,
  isDragging,
  isEditing,
  isFlowActive,
  isFlowRunning,
  onFinishEditing,
  onLiveEditLabel,
  onResize,
  defaultCellColor,
  defaultMembraneColor,
  onSetMedia,
  onToggleCollapse,
  onResizeDragStart,
  onTipDrag,
}: {
  node: ModelNode
  posX: number
  posY: number
  isSelected: boolean
  isMultiSelected?: boolean
  isZooming: boolean
  progress: number
  childModel: Model | undefined
  vpSize: { w: number; h: number }
  onSelect: () => void
  onDoubleClick: () => void
  onDragStart: (e: React.PointerEvent) => void
  onConnectionDragStart: (e: React.PointerEvent) => void
  isDragging: boolean
  isEditing: boolean
  isFlowActive: boolean
  isFlowRunning: boolean
  onFinishEditing: (label: string) => void
  onLiveEditLabel: (label: string) => void
  onResize: (size: { w: number; h: number }) => void
  defaultCellColor: string
  defaultMembraneColor: string
  onSetMedia?: (mediaSrc: string, mediaFileName: string) => void
  onToggleCollapse?: () => void
  onResizeDragStart?: (dir: string, e: React.PointerEvent) => void
  onTipDrag?: (tipAngle: number, tipLength: number) => void
}) {
  const labelRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const finishedRef = useRef(false)
  const [baseSize, setBaseSize] = useState({ w: NODE_MIN_W, h: NODE_MIN_H })

  // Audio recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const onSetMediaRef = useRef(onSetMedia)
  onSetMediaRef.current = onSetMedia

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const reader = new FileReader()
        reader.onload = () => {
          if (reader.result && onSetMediaRef.current) {
            onSetMediaRef.current(reader.result as string, 'recording.webm')
          }
        }
        reader.readAsDataURL(blob)
        setIsRecording(false)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      // Microphone access denied or unavailable
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  // Measure label size (both for display and editing)
  const measureLabel = useCallback(() => {
    const el = isEditing ? editRef.current : labelRef.current
    if (!el) return
    // Cloud nodes need extra padding to keep text inside the puffy outline
    const isCloud = node.cosmeticType === 'thinking-cloud'
    const pad = isCloud ? 100 : 32 + 4
    const vPad = isCloud ? 80 : 28 + 4
    setBaseSize({
      w: Math.max(NODE_MIN_W, el.scrollWidth + pad),
      h: Math.max(NODE_MIN_H, el.scrollHeight + vPad),
    })
  }, [isEditing, node.cosmeticType])

  useEffect(() => {
    if (progress > 0) return
    measureLabel()
  }, [node.label, measureLabel, progress])

  // Override base size with custom nodeWidth/nodeHeight if specified
  // Cosmetic nodes: always grow to fit content (use max of specified and measured)
  const effectiveBase = node.cosmeticType ? {
    w: Math.max(node.nodeWidth ?? NODE_MIN_W, baseSize.w),
    h: Math.max(node.nodeHeight ?? NODE_MIN_H, baseSize.h),
  } : {
    w: node.nodeWidth ?? baseSize.w,
    h: node.nodeHeight ?? baseSize.h,
  }

  // Report measured size to parent for anchor computation
  useEffect(() => {
    onResize(effectiveBase)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBase.w, effectiveBase.h])

  const targetW = vpSize.w / CAMERA_SCALE_FINAL
  const targetH = vpSize.h / CAMERA_SCALE_FINAL

  let nodeW = effectiveBase.w + (targetW - effectiveBase.w) * progress
  let nodeH = effectiveBase.h + (targetH - effectiveBase.h) * progress

  const shape = node.shape ?? 'rounded-rect'

  // Circle enforces equal dimensions
  if (shape === 'circle' && progress === 0) {
    const maxDim = Math.max(nodeW, nodeH)
    nodeW = maxDim
    nodeH = maxDim
  }

  const chromeFade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1

  // Node style properties with theme-aware defaults
  const cellColor = node.cellColor ?? defaultCellColor
  const membraneColor = node.membraneColor ?? defaultMembraneColor
  const membraneVisible = node.membraneVisible !== false

  // Parse hex to rgb components for alpha blending with chromeFade
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '')
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    }
  }
  const cellRgb = hexToRgb(cellColor)
  const memRgb = hexToRgb(membraneColor)
  // Lighter shade for gradient end
  const cellEndRgb = {
    r: Math.max(0, cellRgb.r - 21),
    g: Math.max(0, cellRgb.g - 15),
    b: Math.max(0, cellRgb.b - 8),
  }

  // Shape-specific clip-path for complex shapes
  const clipPaths: Partial<Record<string, string>> = {
    diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
    parallelogram: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)',
    triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  }
  const clipPath = clipPaths[shape]

  // Shape-specific border-radius
  let borderRadius: number | string = 18 * chromeFade
  if (shape === 'rectangle') borderRadius = 0
  else if (shape === 'oval' || shape === 'circle') borderRadius = '50%'

  const shadow = chromeFade > 0.01
    ? `0 10px 30px rgba(19, 41, 73, ${0.2 * chromeFade})`
    : 'none'

  // Positioning styles (shared for both approaches)
  const positionStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${posX}%`,
    top: `${posY}%`,
    transition: isDragging ? 'none' : 'left 0.35s cubic-bezier(0.25,0.1,0.25,1), top 0.35s cubic-bezier(0.25,0.1,0.25,1)',
    width: nodeW,
    minWidth: shape === 'circle' ? nodeW : effectiveBase.w,
    height: nodeH,
    minHeight: shape === 'circle' ? nodeH : effectiveBase.h,
    transform: 'translate(-50%, -50%)',
    zIndex: isZooming ? 10 : 1,
  }

  // Visual styles for the article
  const vizStyle: React.CSSProperties = {
    borderColor: clipPath ? 'transparent'
      : (membraneVisible || isSelected)
        ? `rgba(${isSelected ? '14, 79, 143' : `${memRgb.r}, ${memRgb.g}, ${memRgb.b}`}, ${chromeFade})`
      : 'transparent',
    background: chromeFade > 0.01
      ? `linear-gradient(145deg, rgba(${cellRgb.r},${cellRgb.g},${cellRgb.b},${chromeFade}), rgba(${cellEndRgb.r},${cellEndRgb.g},${cellEndRgb.b},${chromeFade}))`
      : 'transparent',
    boxShadow: clipPath ? 'none' : shadow,
    filter: clipPath && chromeFade > 0.01
      ? `drop-shadow(${shadow})${isSelected ? ' drop-shadow(0 0 8px var(--ug-flow-glow)) drop-shadow(0 0 16px var(--ug-flow-glow))' : ''}`
      : undefined,
    borderRadius,
    clipPath,
    padding: chromeFade > 0.01 ? `${14 * chromeFade}px ${16 * chromeFade}px` : 0,
  }

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && editRef.current) {
      finishedRef.current = false
      const el = editRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      // Auto-size height for multiline content
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
      measureLabel()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

  const getEditText = (): string => {
    if (!editRef.current) return ''
    return editRef.current.value.replace(/\n+$/, '')
  }

  const handleInput = () => {
    if (editRef.current) {
      editRef.current.style.height = 'auto'
      editRef.current.style.height = editRef.current.scrollHeight + 'px'
    }
    measureLabel()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      finishedRef.current = true
      onFinishEditing(getEditText())
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      finishedRef.current = true
      onFinishEditing('')
    }
    // Shift+Enter inserts a line break (default textarea behavior)
  }

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  // Apply playStart whenever it changes or the media element mounts
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (node.playStart != null) {
      el.currentTime = node.playStart
    }
  }, [node.playStart, node.mediaSrc])

  const handleMediaTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) => {
    const el = e.currentTarget
    if (node.playEnd != null && el.currentTime >= node.playEnd) {
      el.pause()
      el.currentTime = node.playStart ?? 0
    }
  }, [node.playEnd, node.playStart])

  const articleContent = (
    <>
      {/* Media content for media node types */}
      {node.mediaType && node.mediaSrc && chromeFade > 0.01 && (
        <div className="media-node-content" style={{ opacity: chromeFade }}>
          {node.mediaType === 'image' && (
            <img src={node.mediaSrc} alt={node.label || 'Image'} draggable={false} />
          )}
          {node.mediaType === 'gif' && (
            <img src={node.mediaSrc} alt={node.label || 'GIF'} draggable={false} />
          )}
          {node.mediaType === 'audio' && (
            <div className="media-audio-wrapper">
              {node.audioCoverSrc && (
                <img src={node.audioCoverSrc} alt="Cover" className="media-audio-cover" draggable={false} />
              )}
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={node.mediaSrc}
                controls={!isFlowRunning}
                preload="metadata"
                onTimeUpdate={handleMediaTimeUpdate}
                onPointerDown={(e) => e.stopPropagation()}
                className={isFlowRunning ? 'flow-hidden-media' : undefined}
              />
            </div>
          )}
          {node.mediaType === 'video' && (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={node.mediaSrc}
              controls={!isFlowRunning}
              preload="metadata"
              draggable={false}
              onTimeUpdate={handleMediaTimeUpdate}
              onPointerDown={(e) => {
                // Only block left-click in the native controls bar (~40px from bottom)
                // so node dragging and connection drawing still work on the video surface
                if (e.button === 0) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const yInElement = e.clientY - rect.top
                  if (yInElement > rect.height - 40) {
                    e.stopPropagation()
                  }
                }
              }}
            />
          )}
        </div>
      )}
      {/* Markdown / Math content */}
      {(node.mediaType === 'markdown' || node.mediaType === 'math') && chromeFade > 0.01 && (
        <div className="content-node-wrapper" style={{ opacity: chromeFade, fontSize: `${node.contentFontSize ?? 0.85}rem` }}>
          <div
            className="content-node-chevron"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.() }}
          >
            {node.contentCollapsed !== false ? '▸' : '▾'}
          </div>
          {node.contentCollapsed !== false ? (
            <div className="content-node-preview">
              {node.contentSource
                ? (node.mediaType === 'math'
                  ? (() => { try { return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(node.contentSource.split('\n')[0], { throwOnError: false }) }} /> } catch { return <span className="content-node-fallback">{node.contentSource.split('\n')[0]}</span> } })()
                  : <span>{node.contentSource.split('\n')[0].slice(0, 60)}{node.contentSource.split('\n')[0].length > 60 ? '…' : ''}</span>)
                : <span className="content-node-empty">{node.mediaType === 'markdown' ? 'Empty markdown' : 'Empty formula'}</span>}
            </div>
          ) : (
            <div
              className={`content-node-body content-node-${node.mediaType}`}
              dangerouslySetInnerHTML={{
                __html: node.contentSource
                  ? (node.mediaType === 'markdown'
                    ? DOMPurify.sanitize(marked.parse(node.contentSource) as string)
                    : (() => { try { return katex.renderToString(node.contentSource!, { throwOnError: false, displayMode: true }) } catch { return `<span class="content-node-fallback">${node.contentSource}</span>` } })())
                  : `<span class="content-node-empty">${node.mediaType === 'markdown' ? 'Empty markdown' : 'Empty formula'}</span>`,
              }}
            />
          )}
        </div>
      )}
      {/* Empty media placeholder (or audio with cover but no audio yet) */}
      {node.mediaType && node.mediaType !== 'markdown' && node.mediaType !== 'math' && !node.mediaSrc && chromeFade > 0.01 && (
        <div className="media-node-placeholder" style={{ opacity: chromeFade }}>
          {node.mediaType === 'audio' && node.audioCoverSrc ? (
            <img src={node.audioCoverSrc} alt="Cover" className="media-audio-cover" draggable={false}
              style={{ maxHeight: '60%', objectFit: 'cover', borderRadius: 6 }} />
          ) : (
            <span className="media-node-placeholder-icon">
              {node.mediaType === 'image' ? '🖼' : node.mediaType === 'gif' ? '🎞' : node.mediaType === 'audio' ? (isRecording ? '⏺' : '🔊') : '🎬'}
            </span>
          )}
          <span className="media-node-placeholder-text">
            {isRecording ? 'Recording…' : node.mediaType === 'audio' && node.audioCoverSrc ? 'Drop audio or record' : `Drop ${node.mediaType} here`}
          </span>
          {node.mediaType === 'audio' && onSetMedia && (
            <button
              className="media-record-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); isRecording ? stopRecording() : startRecording() }}
            >
              {isRecording ? '⏹ Stop' : '⏺ Record'}
            </button>
          )}
        </div>
      )}
      {isEditing ? (
        <textarea
          ref={editRef}
          className="host-label host-label-editing"
          defaultValue={node.label}
          rows={1}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onSelect={() => {
            const el = editRef.current
            if (el && el.selectionStart !== el.selectionEnd) {
              useHybridZoomStore.getState().setLabelSelection({ start: el.selectionStart, end: el.selectionEnd })
            } else {
              useHybridZoomStore.getState().setLabelSelection(null)
            }
          }}
          onBlur={(e) => {
            // If focus is moving to a sidebar element, keep editing alive
            const related = e.relatedTarget as HTMLElement | null
            if (related?.closest('.sidebar')) {
              // Re-focus the textarea after a tick so selection is preserved
              setTimeout(() => editRef.current?.focus(), 0)
              return
            }
            useHybridZoomStore.getState().setLabelSelection(null)
            if (!finishedRef.current) {
              finishedRef.current = true
              onFinishEditing(getEditText())
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          ref={labelRef}
          className={`host-label${node.label.includes('\n') ? ' multiline' : ''}`}
          style={{
            opacity: chromeFade,
            visibility: chromeFade > 0.01 ? 'visible' : 'hidden',
            ...((node.mediaType === 'markdown' || node.mediaType === 'math') && node.contentSource ? { display: 'none' } : {}),
          }}
        >
          {renderFormattedLabel(node.label, node.textFormats)}
        </div>
      )}
      {isZooming && childModel && (() => {
        const childCosmetics = useHybridZoomStore.getState().modelCosmetics[childModel.id]
        const childBg = childCosmetics?.background
        const childBgStyle = childBg ? resolveBackground(childBg) : undefined
        return (
          <div className="child-model" style={childBg?.type !== 'image' ? childBgStyle : undefined}>
            {childBg?.type === 'image' && childBg.value && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 0,
                  backgroundImage: `url(${childBg.value})`,
                  backgroundSize: childBg.fit === 'tile' ? 'auto' : (childBg.fit ?? 'cover'),
                  backgroundPosition: 'center',
                  backgroundRepeat: childBg.fit === 'tile' ? 'repeat' : 'no-repeat',
                  opacity: childBg.opacity ?? 1,
                  filter: childBg.blur ? `blur(${childBg.blur}px)` : undefined,
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* Particles omitted in mini-view — PixiJS can't reliably resize inside an animating container.
                Full particle effect activates after RMM handoff. */}
            <ChildModelPreview
              model={childModel}
              scale={nodeW / vpSize.w}
              vpSize={vpSize}
            />
          </div>
        )
      })()}
    </>
  )

  const articleEventHandlers = {
    onClick: (event: React.MouseEvent) => { event.stopPropagation(); onSelect() },
    onDoubleClick: (event: React.MouseEvent) => { event.stopPropagation(); if (!isEditing) onDoubleClick() },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button === 0 && !isEditing) onDragStart(e)
      else if (e.button === 2) onConnectionDragStart(e)
    },
  }

  // Resize handles — shown when selected, not editing, not zooming, not during flow
  const showResizeHandles = isSelected && !isEditing && !isFlowRunning && progress === 0 && !!onResizeDragStart
  const resizeHandles = showResizeHandles ? (() => {
    const HANDLE = 8 // corner handle size
    const EDGE = 6  // edge handle thickness
    const handleStyle = (cursor: string, extra: React.CSSProperties): React.CSSProperties => ({
      position: 'absolute',
      zIndex: 20,
      cursor,
      ...extra,
    })
    const dirs: { dir: string; cursor: string; style: React.CSSProperties }[] = [
      // Edges
      { dir: 'n', cursor: 'n-resize', style: { top: -EDGE / 2, left: HANDLE, right: HANDLE, height: EDGE } },
      { dir: 's', cursor: 's-resize', style: { bottom: -EDGE / 2, left: HANDLE, right: HANDLE, height: EDGE } },
      { dir: 'w', cursor: 'w-resize', style: { left: -EDGE / 2, top: HANDLE, bottom: HANDLE, width: EDGE } },
      { dir: 'e', cursor: 'e-resize', style: { right: -EDGE / 2, top: HANDLE, bottom: HANDLE, width: EDGE } },
      // Corners
      { dir: 'nw', cursor: 'nw-resize', style: { top: -HANDLE / 2, left: -HANDLE / 2, width: HANDLE, height: HANDLE } },
      { dir: 'ne', cursor: 'ne-resize', style: { top: -HANDLE / 2, right: -HANDLE / 2, width: HANDLE, height: HANDLE } },
      { dir: 'sw', cursor: 'sw-resize', style: { bottom: -HANDLE / 2, left: -HANDLE / 2, width: HANDLE, height: HANDLE } },
      { dir: 'se', cursor: 'se-resize', style: { bottom: -HANDLE / 2, right: -HANDLE / 2, width: HANDLE, height: HANDLE } },
    ]
    return dirs.map(({ dir, cursor, style }) => (
      <div
        key={`resize-${dir}`}
        style={handleStyle(cursor, style)}
        onPointerDown={(e) => { if (e.button === 0) onResizeDragStart(dir, e) }}
      />
    ))
  })() : null

  // Tip drag handle — shown when cosmetic node is selected, not during flow
  const showTipHandle = isSelected && !isEditing && !isFlowRunning && progress === 0 && !!node.cosmeticType && !!onTipDrag

  // Compute tip handle position for cosmetic nodes
  const tipHandlePos = useMemo(() => {
    if (!node.cosmeticType) return { x: 0, y: 0 }
    const angle = node.tipAngle ?? Math.PI * 0.75
    const tipLen = node.tipLength ?? 20
    if (node.cosmeticType === 'chat-bubble') {
      const r = Math.min(18, nodeW / 4, nodeH / 4)
      const tipW = Math.min(15, tipLen * 0.75)
      const cosA = Math.cos(angle), sinA = Math.sin(angle)
      const isBottom = sinA >= 0
      const edgeY = isBottom ? nodeH : 0
      const centerX = nodeW / 2, centerY = nodeH / 2
      let baseX: number
      if (Math.abs(sinA) > 0.05) {
        const t = (edgeY - centerY) / sinA
        baseX = centerX + t * cosA
      } else {
        baseX = centerX
      }
      baseX = Math.max(r + tipW, Math.min(nodeW - r - tipW, baseX))
      return { x: baseX + tipLen * cosA, y: edgeY + tipLen * sinA }
    } else {
      // thinking-cloud: position at the outermost trail circle
      const trail = thinkingCloudTrail(nodeW, nodeH, angle, tipLen)
      const last = trail[trail.length - 1]
      return last ? { x: last.cx, y: last.cy } : { x: 0, y: 0 }
    }
  }, [node.cosmeticType, node.tipAngle, node.tipLength, nodeW, nodeH])

  const handleTipPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !onTipDrag) return
    e.stopPropagation()
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      // Get cursor position relative to node top-left
      const wrapperEl = target.parentElement
      if (!wrapperEl) return
      const rect = wrapperEl.getBoundingClientRect()
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top
      // Compute angle from node center to cursor (continuous)
      const dx = cx - nodeW / 2
      const dy = cy - nodeH / 2
      const newAngle = Math.atan2(dy, dx)
      // Compute distance from node edge to cursor along that direction
      const dist = Math.sqrt(dx * dx + dy * dy)
      const cosA = Math.cos(newAngle), sinA = Math.sin(newAngle)
      let edgeDist: number
      if (node.cosmeticType === 'thinking-cloud') {
        const rx = nodeW / 2, ry = nodeH / 2
        const denom = Math.sqrt((cosA * cosA) / (rx * rx) + (sinA * sinA) / (ry * ry))
        edgeDist = denom > 1e-9 ? 1 / denom : Math.min(rx, ry)
      } else {
        const tx = Math.abs(cosA) > 1e-9 ? (nodeW / 2) / Math.abs(cosA) : Infinity
        const ty = Math.abs(sinA) > 1e-9 ? (nodeH / 2) / Math.abs(sinA) : Infinity
        edgeDist = Math.min(tx, ty)
      }
      const newTipLength = Math.max(8, Math.min(80, dist - edgeDist))
      onTipDrag(newAngle, newTipLength)
    }
    const onUp = () => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onTipDrag, nodeW, nodeH, node.cosmeticType])

  const tipHandle = showTipHandle ? (
    <div
      style={{
        position: 'absolute',
        left: tipHandlePos.x - 5,
        top: tipHandlePos.y - 5,
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: 'rgba(14, 79, 143, 0.8)',
        border: '2px solid white',
        cursor: 'grab',
        pointerEvents: 'auto',
        zIndex: 25,
      }}
      onPointerDown={handleTipPointerDown}
    />
  ) : null

  // Cosmetic nodes (chat-bubble, thinking-cloud) use custom SVG rendering
  if (node.cosmeticType && chromeFade > 0.01) {
    const tipAng = node.tipAngle ?? Math.PI * 0.75
    const tipLen = node.tipLength ?? 20
    const memStroke = isSelected && !isFlowRunning
      ? `rgba(14, 79, 143, ${chromeFade})`
      : `rgba(${memRgb.r}, ${memRgb.g}, ${memRgb.b}, ${chromeFade})`
    const fillGrad = `linear-gradient(145deg, rgba(${cellRgb.r},${cellRgb.g},${cellRgb.b},${chromeFade}), rgba(${cellEndRgb.r},${cellEndRgb.g},${cellEndRgb.b},${chromeFade}))`

    if (node.cosmeticType === 'chat-bubble') {
      const pathD = chatBubblePath(nodeW, nodeH, tipAng, tipLen)
      const svgPad = Math.max(25, tipLen + 10) // extra space for the tip
      return (
        <div data-node-wrapper={node.id} style={{ ...positionStyle, pointerEvents: 'none' }}>
          {membraneVisible && (
            <svg
              style={{
                position: 'absolute',
                left: -svgPad,
                top: -svgPad,
                width: nodeW + svgPad * 2,
                height: nodeH + svgPad * 2,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              <g transform={`translate(${svgPad},${svgPad})`}>
                {isSelected && !isFlowRunning && (
                  <>
                    <defs>
                      <filter id={`sel-glow-${node.id}`} x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="5" />
                      </filter>
                    </defs>
                    <path
                      d={pathD}
                      fill="none"
                      stroke="rgba(245, 158, 11, 0.6)"
                      strokeWidth={7}
                      strokeLinejoin="round"
                      filter={`url(#sel-glow-${node.id})`}
                    />
                  </>
                )}
                <path
                  d={pathD}
                  fill={`rgba(${cellRgb.r},${cellRgb.g},${cellRgb.b},${chromeFade})`}
                  stroke={memStroke}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              </g>
            </svg>
          )}
          <article
            className={`host-node${isSelected && !isFlowRunning ? ' focused' : ''}`}
            data-node-id={node.id}
            style={{
              ...vizStyle,
              borderColor: 'transparent',
              background: membraneVisible ? 'transparent' : fillGrad,
              boxShadow: 'none',
              clipPath: chatBubbleClipPath(nodeW, nodeH),
              position: 'relative',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'auto',
            }}
            {...articleEventHandlers}
          >
            {articleContent}
          </article>
          {tipHandle}
          {resizeHandles}
        </div>
      )
    }

    if (node.cosmeticType === 'thinking-cloud') {
      const cloudD = thinkingCloudPath(nodeW, nodeH)
      const trail = thinkingCloudTrail(nodeW, nodeH, tipAng, tipLen)
      const svgPad = Math.max(30, tipLen * 2.5 + 10)
      return (
        <div data-node-wrapper={node.id} style={{ ...positionStyle, pointerEvents: 'none' }}>
          {membraneVisible && (
            <svg
              style={{
                position: 'absolute',
                left: -svgPad,
                top: -svgPad,
                width: nodeW + svgPad * 2,
                height: nodeH + svgPad * 2,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              <g transform={`translate(${svgPad},${svgPad})`}>
                <path
                  d={cloudD}
                  fill={`rgba(${cellRgb.r},${cellRgb.g},${cellRgb.b},${chromeFade})`}
                  stroke={memStroke}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                {trail.map((c, i) => (
                  <circle
                    key={i}
                    cx={c.cx}
                    cy={c.cy}
                    r={c.r}
                    fill={`rgba(${cellRgb.r},${cellRgb.g},${cellRgb.b},${chromeFade * 0.7})`}
                    stroke={memStroke}
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            </svg>
          )}
          <article
            className={`host-node${isSelected && !isFlowRunning ? ' focused' : ''}`}
            data-node-id={node.id}
            style={{
              ...vizStyle,
              borderColor: 'transparent',
              background: membraneVisible ? 'transparent' : fillGrad,
              boxShadow: 'none',
              borderRadius: '50%',
              padding: '35px 45px',
              boxSizing: 'border-box' as const,
              position: 'relative',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'auto',
            }}
            {...articleEventHandlers}
          >
            {articleContent}
          </article>
          {tipHandle}
          {resizeHandles}
        </div>
      )
    }
  }

  // Polygon shapes use a wrapper div so the SVG border is not clipped
  if (clipPath) {
    return (
      <div style={{ ...positionStyle, pointerEvents: 'none' }}>
        {chromeFade > 0.01 && membraneVisible && (
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <polygon
              points={shapeSvgPoints(shape, nodeW, nodeH)}
              fill="none"
              stroke={isSelected
                ? `rgba(14, 79, 143, ${chromeFade})`
                : `rgba(${memRgb.r}, ${memRgb.g}, ${memRgb.b}, ${chromeFade})`}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {isMultiSelected && (
          <svg
            style={{
              position: 'absolute',
              left: -5,
              top: -5,
              width: 'calc(100% + 10px)',
              height: 'calc(100% + 10px)',
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <polygon
              points={shapeSvgPoints(shape, nodeW + 10, nodeH + 10)}
              fill="none"
              stroke="rgba(37, 99, 235, 0.7)"
              strokeWidth={2}
              strokeDasharray="6 4"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <article
          className={`host-node${isSelected ? ' focused' : ''}${isFlowActive ? ' flow-active' : ''}`}
          data-node-id={node.id}
          style={{
            ...vizStyle,
            position: 'relative',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'auto',
          }}
          {...articleEventHandlers}
        >
          {articleContent}
        </article>
        {resizeHandles}
      </div>
    )
  }

  return (
    <article
      className={`host-node${isSelected ? ' focused' : ''}${isMultiSelected ? ' multi-selected' : ''}${isFlowActive ? ' flow-active' : ''}`}
      data-node-id={node.id}
      style={{ ...positionStyle, ...vizStyle }}
      {...articleEventHandlers}
    >
      {articleContent}
      {resizeHandles}
    </article>
  )
}
