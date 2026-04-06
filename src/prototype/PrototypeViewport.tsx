import { useMemo, useRef, useState } from 'react'
import { CANVAS_MAX_HEIGHT } from './hybridZoom'
import { useHybridZoomStore } from './useHybridZoomStore'

export function PrototypeViewport() {
  const [debugOpen, setDebugOpen] = useState(false)
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

  const sceneStyle = useMemo(() => {
    return {
      transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${snapshot.cameraScale})`,
    }
  }, [panOffset.x, panOffset.y, snapshot.cameraScale])

  /** Node frame scales up to fill viewport, canvas reveals content inside */
  const hostNodeStyle = useMemo(() => {
    return {
      transform: `translate(-50%, -50%) scale(${snapshot.nodeScale})`,
      opacity: snapshot.handoffMode === 'child' ? 0.14 : 1,
      transition: 'opacity 160ms linear',
    }
  }, [snapshot.handoffMode, snapshot.nodeScale])

  /** Canvas height grows from 0 → CANVAS_MAX_HEIGHT, stretching the node frame */
  const canvasHeight = snapshot.nodeInflation * CANVAS_MAX_HEIGHT

  const miniNodes = [
    { id: 'a', x: 22, y: 20 },
    { id: 'b', x: 74, y: 28 },
    { id: 'c', x: 34, y: 66 },
    { id: 'd', x: 82, y: 72 },
  ]

  return (
    <div
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
            <div className="host-label">Node Alpha</div>
            {canvasHeight > 0 && (
              <div
                className="child-model"
                style={{ height: canvasHeight }}
              >
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
