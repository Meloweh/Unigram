import type { ConnectionType, ConnectionArrowStyle, ConnectionDashStyle } from '../model/sampleModels'

/** Connection line that bows outward into a zipper-bag shape during unzip */
export function ConnectionLine({
  fromX, fromY, toX, toY, hasEvidence, connectionType, flowProgress, gapProgress, vpSize, popupSize, connectionAngle,
  strokeColor, strokeWidth: customStrokeWidth, strokeDash, arrowStyle,
}: {
  fromX: number; fromY: number
  toX: number; toY: number
  hasEvidence: boolean
  connectionType?: ConnectionType
  flowProgress?: number
  gapProgress: number
  vpSize: { w: number; h: number }
  popupSize: { w: number; h: number } | null
  connectionAngle: number
  strokeColor?: string
  strokeWidth?: number
  strokeDash?: ConnectionDashStyle
  arrowStyle?: ConnectionArrowStyle
}) {
  const isFlow = connectionType === 'flow'
  const lineClass = isFlow
    ? 'connection-line flow'
    : hasEvidence ? 'connection-line has-evidence' : 'connection-line'

  // Custom style overrides
  const customStyle: React.CSSProperties = {}
  if (strokeColor) customStyle.stroke = strokeColor
  if (customStrokeWidth != null) customStyle.strokeWidth = customStrokeWidth
  if (strokeDash && strokeDash !== 'solid') {
    const dashMap: Record<string, string> = { dashed: '8 4', dotted: '2 4', 'dash-dot': '8 4 2 4' }
    customStyle.strokeDasharray = dashMap[strokeDash]
  }

  // Resolve marker
  function resolveMarker(): string {
    const style = arrowStyle ?? 'standard'
    if (style === 'none') return ''
    if (style === 'standard') {
      if (strokeColor) return `url(#arrowhead-custom-${CSS.escape(strokeColor)})`
      return isFlow ? 'url(#arrowhead-flow)' : hasEvidence ? 'url(#arrowhead-evidence)' : 'url(#arrowhead)'
    }
    const color = strokeColor || (isFlow ? '#f59e0b' : hasEvidence ? 'rgba(37, 96, 149, 0.65)' : 'rgba(37, 96, 149, 0.45)')
    return `url(#arrowhead-${style}-${CSS.escape(color)})`
  }
  const marker = resolveMarker()

  if (gapProgress < 0.001) {
    // Shorten line so it ends at arrowhead base (refX=0).
    const effStrokeWidth = customStrokeWidth ?? (isFlow ? 3 : 2)
    const dxPx = (toX - fromX) * vpSize.w / 100
    const dyPx = (toY - fromY) * vpSize.h / 100
    const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
    const arrowLenPx = 8 * effStrokeWidth
    let adjToX = toX, adjToY = toY
    if (marker && lenPx > arrowLenPx * 2) {
      const ratio = arrowLenPx / lenPx
      adjToX = toX - (toX - fromX) * ratio
      adjToY = toY - (toY - fromY) * ratio
    }
    return (
      <>
        <line
          x1={`${fromX}%`} y1={`${fromY}%`}
          x2={`${adjToX}%`} y2={`${adjToY}%`}
          className={lineClass}
          markerEnd={marker || undefined}
          style={customStyle}
        />
        {isFlow && flowProgress != null && flowProgress > 0 && (
          <line
            x1={`${fromX}%`} y1={`${fromY}%`}
            x2={`${adjToX}%`} y2={`${adjToY}%`}
            className="connection-line flow-anim"
            strokeDasharray={`${lenPx}`}
            strokeDashoffset={`${lenPx * (1 - flowProgress)}`}
          />
        )}
      </>
    )
  }

  // Compute in screen-pixel space for correct aspect-ratio perpendicular
  const fxPx = fromX * vpSize.w / 100
  const fyPx = fromY * vpSize.h / 100
  const txPx = toX * vpSize.w / 100
  const tyPx = toY * vpSize.h / 100

  const dxPx = txPx - fxPx
  const dyPx = tyPx - fyPx
  const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
  if (lenPx < 1) return null

  // Unit vectors in pixel space
  const alongX = dxPx / lenPx
  const alongY = dyPx / lenPx
  const perpX = -alongY
  const perpY = alongX

  // Shorten the target end by the arrowhead length (only if an arrowhead is rendered)
  const arrowLenPx = 16
  let adjTxPx = txPx, adjTyPx = tyPx
  if (marker && lenPx > arrowLenPx * 2) {
    adjTxPx = txPx - alongX * arrowLenPx
    adjTyPx = tyPx - alongY * arrowLenPx
  }

  const midXPx = (fxPx + txPx) / 2
  const midYPx = (fyPx + tyPx) / 2

  const padding = 16

  function buildTrackForPopup(sign: number): string {
    const hw = (popupSize!.w / 2 + padding) * gapProgress
    const hh = (popupSize!.h / 2 + padding) * gapProgress

    let t = Infinity
    if (Math.abs(alongX) > 1e-9) t = Math.min(t, hw / Math.abs(alongX))
    if (Math.abs(alongY) > 1e-9) t = Math.min(t, hh / Math.abs(alongY))
    t = Math.min(t, lenPx / 2 - 1)
    if (t <= 0) return `M ${fxPx} ${fyPx} L ${txPx} ${tyPx}`

    const entAbs = { x: midXPx - alongX * t, y: midYPx - alongY * t }
    const extAbs = { x: midXPx + alongX * t, y: midYPx + alongY * t }

    const extRx = alongX * t, extRy = alongY * t
    const eps = 0.5
    let exitEdge: number
    if (Math.abs(extRx - hw) < eps) exitEdge = 1
    else if (Math.abs(extRx + hw) < eps) exitEdge = 3
    else if (Math.abs(extRy - hh) < eps) exitEdge = 2
    else exitEdge = 0
    const entryEdge = (exitEdge + 2) % 4

    const cornerPos: [number, number][] = [
      [midXPx - hw, midYPx - hh],
      [midXPx + hw, midYPx - hh],
      [midXPx + hw, midYPx + hh],
      [midXPx - hw, midYPx + hh],
    ]

    const cwIdx: number[] = []
    let e = entryEdge
    while (true) {
      cwIdx.push((e + 1) % 4)
      e = (e + 1) % 4
      if (e === exitEdge) break
    }
    const ccwIdx: number[] = []
    e = entryEdge
    while (true) {
      ccwIdx.push(e)
      e = (e - 1 + 4) % 4
      if (e === exitEdge) break
    }

    const cwPerp = cwIdx.reduce((s, ci) =>
      s + (cornerPos[ci][0] - midXPx) * perpX + (cornerPos[ci][1] - midYPx) * perpY, 0)
    const myIdx = (cwPerp * sign > 0) ? cwIdx : ccwIdx
    const myCorners = myIdx.map(ci => ({ x: cornerPos[ci][0], y: cornerPos[ci][1] }))

    if (myCorners.length === 0) {
      return `M ${fxPx} ${fyPx} L ${txPx} ${tyPx}`
    }

    const wp = [
      { x: fxPx, y: fyPx },
      entAbs,
      ...myCorners,
      extAbs,
      { x: adjTxPx, y: adjTyPx },
    ]

    const cr = Math.min(hw, hh, 28)
    let path = `M ${wp[0].x} ${wp[0].y}`
    for (let i = 1; i < wp.length; i++) {
      if (i < wp.length - 1) {
        const prev = wp[i - 1], curr = wp[i], next = wp[i + 1]
        let dx1 = curr.x - prev.x, dy1 = curr.y - prev.y
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
        let dx2 = next.x - curr.x, dy2 = next.y - curr.y
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
        if (len1 < 0.5 || len2 < 0.5) { path += ` L ${curr.x} ${curr.y}`; continue }
        dx1 /= len1; dy1 /= len1
        dx2 /= len2; dy2 /= len2
        const r = Math.min(cr, len1 / 2, len2 / 2)
        path += ` L ${curr.x - dx1 * r} ${curr.y - dy1 * r}`
        path += ` Q ${curr.x} ${curr.y} ${curr.x + dx2 * r} ${curr.y + dy2 * r}`
      } else {
        path += ` L ${wp[i].x} ${wp[i].y}`
      }
    }
    return path
  }

  function buildFallbackTrack(sign: number): string {
    const bow = Math.min(lenPx * 0.18, 110) * gapProgress
    const cpx = midXPx + perpX * bow * sign
    const cpy = midYPx + perpY * bow * sign
    const sAx = fxPx + alongX * lenPx * 0.30
    const sAy = fyPx + alongY * lenPx * 0.30
    const sBx = fxPx + alongX * lenPx * 0.70
    const sBy = fyPx + alongY * lenPx * 0.70
    return `M ${fxPx} ${fyPx} L ${sAx} ${sAy} Q ${cpx} ${cpy} ${sBx} ${sBy} L ${adjTxPx} ${adjTyPx}`
  }

  const hasPopup = popupSize && popupSize.w > 0 && popupSize.h > 0
  const d1 = hasPopup ? buildTrackForPopup(+1) : buildFallbackTrack(+1)
  const d2 = hasPopup ? buildTrackForPopup(-1) : buildFallbackTrack(-1)

  return (
    <>
      <path d={d1} className={lineClass} fill="none" markerEnd={marker || undefined} style={customStyle} />
      <path d={d2} className={lineClass} fill="none" style={customStyle} />
    </>
  )
}
