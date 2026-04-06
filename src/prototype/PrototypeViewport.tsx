import { useEffect, useMemo, useRef, useState } from 'react'
import { CAMERA_SCALE_FINAL } from './hybridZoom'
import { useHybridZoomStore } from './useHybridZoomStore'

/** Base node dimensions (label only, no canvas) */
const NODE_BASE_W = 320
const NODE_BASE_H = 48

export function PrototypeViewport() {
  const [debugOpen, setDebugOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 1400, h: 900 })
  const {
    selectedNodeId,
    snapshot,
    isDragging,
    isPaused,
    panOffset,
    selectNode,
    clearSelection,
    zoomIn,
    zoomOut,
    pause,
    beginDrag,
    endDrag,
    panBy,
  } = useHybridZoomStore()

  const lastPointer = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setVpSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const sceneStyle = useMemo(() => {
    return {
      transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${snapshot.cameraScale})`,
    }
  }, [panOffset.x, panOffset.y, snapshot.cameraScale])

  // At handoff: nodeActualSize * cameraScale = viewportSize
  // So target actual size = vpSize / CAMERA_SCALE_FINAL
  const targetW = vpSize.w / CAMERA_SCALE_FINAL
  const targetH = vpSize.h / CAMERA_SCALE_FINAL

  const p = snapshot.nodeInflation // 0→1
  const nodeW = NODE_BASE_W + (targetW - NODE_BASE_W) * p
  const nodeH = NODE_BASE_H + (targetH - NODE_BASE_H) * p

  // Chrome (label, border, padding, bg) fades in the last 30%
  const chromeFade = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1

  const hostNodeStyle: React.CSSProperties = {
    width: nodeW,
    height: nodeH,
    transform: 'translate(-50%, -50%)',
    borderColor: `rgba(54, 95, 143, ${chromeFade})`,
    background: chromeFade > 0.01
      ? `linear-gradient(145deg, rgba(244,248,253,${chromeFade}), rgba(223,233,245,${chromeFade}))`
      : 'transparent',
    boxShadow: chromeFade > 0.01
      ? `0 10px 30px rgba(19, 41, 73, ${0.2 * chromeFade})`
      : 'none',
    borderRadius: 18 * chromeFade,
    padding: chromeFade > 0.01 ? `${14 * chromeFade}px ${16 * chromeFade}px` : 0,
    opacity: snapshot.handoffMode === 'child' ? 0.14 : 1,
    transition: 'opacity 160ms linear',
  }

  const miniNodes = [
    { id: 'a', x: 22, y: 20 },
    { id: 'b', x: 74, y: 28 },
    { id: 'c', x: 34, y: 66 },
    { id: 'd', x: 82, y: 72 },
  ]

  return (
    <div
      ref={viewportRef}
      className={`viewport ${isDragging ? 'dragging' : ''}`}
        onWheel={(event) => {
          event.preventDefault()
          if (event.deltaY < 0) {
            zoomIn()
          } else {
            zoomOut()
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return
          }
          beginDrag()
          lastPointer.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerMove={(event) => {
          if (!isDragging || !lastPointer.current) {
            return
          }
          const dx = event.clientX - lastPointer.current.x
          const dy = event.clientY - lastPointer.current.y
          panBy(dx, dy)
          lastPointer.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={() => {
          endDrag()
          lastPointer.current = null
          pause()
        }}
        onPointerLeave={() => {
          endDrag()
          lastPointer.current = null
        }}
        onDoubleClick={() => {
          if (selectedNodeId) {
            clearSelection()
            return
          }
          selectNode('node-alpha')
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            clearSelection()
          }
        }}
      >
        <div className="debug-overlay">
          <div className="prototype-stats compact">
            <span>Selection: {selectedNodeId ?? 'none'}</span>
            <span>Progress: {snapshot.progress.toFixed(2)}</span>
            <span>Mode: {snapshot.handoffMode}</span>
            <button
              className="debug-toggle"
              type="button"
              onClick={() => {
                setDebugOpen((value) => !value)
              }}
            >
              {debugOpen ? 'Hide Debug' : 'Show Debug'}
            </button>
          </div>
          {debugOpen && (
            <div className="prototype-stats details">
              <span>Camera scale: {snapshot.cameraScale.toFixed(2)}</span>
              <span>Node inflation: {snapshot.nodeInflation.toFixed(2)}</span>
              <span>Transition: {isPaused ? 'paused' : 'active'}</span>
              <span>Pan X: {panOffset.x.toFixed(1)}</span>
              <span>Pan Y: {panOffset.y.toFixed(1)}</span>
            </div>
          )}
        </div>
        {!selectedNodeId && (
          <div className="empty-hint">No selected node. Double-click to reselect prototype node.</div>
        )}
        <div className="scene" style={sceneStyle}>
          <article
            className={`host-node ${selectedNodeId ? 'focused' : ''}`}
            style={hostNodeStyle}
            onClick={(event) => {
              event.stopPropagation()
              selectNode('node-alpha')
            }}
          >
            {chromeFade > 0.01 && (
              <div className="host-label" style={{ opacity: chromeFade }}>Node Alpha</div>
            )}
            {p > 0 && (
              <div className="child-model">
                <div className="child-grid">
                  <div
                    className="mini-connection"
                    style={{
                      left: `${miniNodes[0].x}%`,
                      top: `${miniNodes[0].y}%`,
                      width: '48%',
                      transform: 'rotate(8deg)',
                    }}
                  />
                  <div
                    className="mini-connection"
                    style={{
                      left: `${miniNodes[2].x}%`,
                      top: `${miniNodes[2].y}%`,
                      width: '42%',
                      transform: 'rotate(-14deg)',
                    }}
                  />
                  {miniNodes.map((node) => (
                    <div
                      key={node.id}
                      className="mini-node"
                      style={{ left: `${node.x}%`, top: `${node.y}%` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </article>
        </div>
      </div>
  )
}
