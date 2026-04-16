import { useMemo } from 'react'
import { type Model, type ModelNode } from './sampleModels'
import { useHybridZoomStore } from './useHybridZoomStore'
import { resolvePalette } from './themes'
import { computeEdgeAnchors } from './edgeAnchoring'

/** Preview of child model content inside a node canvas */
export function ChildModelPreview({ model, scale, vpSize }: { model: Model; scale: number; vpSize: { w: number; h: number } }) {
  const appThemeMode = useHybridZoomStore((s) => s.appThemeMode)
  const palette = resolvePalette(appThemeMode)
  const identity = (n: ModelNode) => ({ x: n.x, y: n.y })
  const anchors = useMemo(
    () => computeEdgeAnchors(model.nodes, model.connections, vpSize.w, vpSize.h, identity),
    [model, vpSize],
  )

  return (
    <>
      <svg className="child-preview-connections">
        <defs>
          <marker id="arrowhead-preview" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(37, 96, 149, 0.45)" />
          </marker>
        </defs>
        {model.connections.map((c) => {
          const key = `${c.from}->${c.to}`
          const a = anchors[key]
          if (!a) return null
          const dxPx = (a.tx - a.fx) * vpSize.w / 100
          const dyPx = (a.ty - a.fy) * vpSize.h / 100
          const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
          const arrowLenPx = 16
          let tx = a.tx, ty = a.ty
          if (lenPx > arrowLenPx * 2) {
            const ratio = arrowLenPx / lenPx
            tx = a.tx - (a.tx - a.fx) * ratio
            ty = a.ty - (a.ty - a.fy) * ratio
          }
          return (
            <line
              key={`${c.from}-${c.to}`}
              x1={`${a.fx}%`} y1={`${a.fy}%`}
              x2={`${tx}%`} y2={`${ty}%`}
              strokeWidth={2 * scale}
              markerEnd="url(#arrowhead-preview)"
            />
          )
        })}
      </svg>
      {model.nodes.map((node) => {
        const shape = node.shape ?? 'rounded-rect'
        const previewClipPaths: Partial<Record<string, string>> = {
          diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
          hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
          parallelogram: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)',
          triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
        }
        const pClip = previewClipPaths[shape]
        let pRadius: string | number = 14
        if (shape === 'rectangle') pRadius = 0
        else if (shape === 'oval' || shape === 'circle') pRadius = '50%'

        const cellColor = node.cellColor ?? palette.nodeCell
        const memColor = node.membraneColor ?? palette.nodeMembrane
        const memVisible = node.membraneVisible !== false

        const hexToRgb = (hex: string) => {
          const h = hex.replace('#', '')
          return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) }
        }
        const cRgb = hexToRgb(cellColor)
        const cEnd = { r: Math.max(0, cRgb.r - 21), g: Math.max(0, cRgb.g - 15), b: Math.max(0, cRgb.b - 8) }

        const shapeStyle: React.CSSProperties = {
          borderRadius: pRadius,
          clipPath: pClip,
          borderColor: pClip ? 'transparent' : memVisible ? memColor : 'transparent',
          background: `linear-gradient(145deg, rgb(${cRgb.r},${cRgb.g},${cRgb.b}), rgb(${cEnd.r},${cEnd.g},${cEnd.b}))`,
          ...(shape === 'circle' ? { aspectRatio: '1', minWidth: 'fit-content' } : {}),
        }

        const labelContent = node.label.includes('\n')
          ? node.label.split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))
          : node.label

        const posStyle: React.CSSProperties = {
          left: `${node.x}%`,
          top: `${node.y}%`,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }

        if (pClip && memVisible) {
          const svgPolygonPoints: Record<string, string> = {
            diamond: '50,0 100,50 50,100 0,50',
            hexagon: '25,0 75,0 100,50 75,100 25,100 0,50',
            parallelogram: '15,0 100,0 85,100 0,100',
            triangle: '50,0 100,100 0,100',
          }
          return (
            <div
              key={node.id}
              className="child-scene-node-wrapper"
              style={posStyle}
            >
              <svg
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polygon
                  points={svgPolygonPoints[shape] ?? ''}
                  fill="none"
                  stroke={memColor}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div
                className="child-scene-node"
                style={{
                  position: 'relative',
                  left: 0,
                  top: 0,
                  transform: 'none',
                  ...shapeStyle,
                }}
              >
                {labelContent}
              </div>
            </div>
          )
        }

        return (
          <div
            key={node.id}
            className="child-scene-node"
            style={{ ...posStyle, ...shapeStyle }}
          >
            {labelContent}
          </div>
        )
      })}
    </>
  )
}
