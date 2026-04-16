/** Build a single closed SVG path for a chat-bubble (rounded rect body + triangular tip).
 *  The tip is integrated into the body path so no membrane gap appears at the junction. */
export function chatBubblePath(w: number, h: number, tipAngle: number, tipLength = 20): string {
  const r = Math.min(18, w / 4, h / 4) // corner radius
  const tipW = Math.min(15, tipLength * 0.75) // half-width of base
  const cosA = Math.cos(tipAngle), sinA = Math.sin(tipAngle)
  // Determine if tip is on bottom or top edge (positive sin = downward in y-down coords)
  const isBottom = sinA >= 0
  const edgeY = isBottom ? h : 0
  const centerX = w / 2, centerY = h / 2

  // Find where the ray from center at tipAngle hits the chosen horizontal edge
  let baseX: number
  if (Math.abs(sinA) > 0.05) {
    const t = (edgeY - centerY) / sinA
    baseX = centerX + t * cosA
  } else {
    baseX = centerX
  }
  baseX = Math.max(r + tipW, Math.min(w - r - tipW, baseX))

  // Tip apex: extend from base in the direction of tipAngle
  const apexX = baseX + tipLength * cosA
  const apexY = edgeY + tipLength * sinA

  // --- Top edge (left to right) ---
  let topEdge = `L${w - r},0`
  if (!isBottom) {
    const lb = Math.max(r, baseX - tipW)
    const rb = Math.min(w - r, baseX + tipW)
    topEdge = `L${lb},0 L${apexX.toFixed(1)},${apexY.toFixed(1)} L${rb},0 L${w - r},0`
  }

  // --- Bottom edge (right to left) ---
  let bottomEdge = `L${r},${h}`
  if (isBottom) {
    const lb = Math.max(r, baseX - tipW)
    const rb = Math.min(w - r, baseX + tipW)
    bottomEdge = `L${rb},${h} L${apexX.toFixed(1)},${apexY.toFixed(1)} L${lb},${h} L${r},${h}`
  }

  return [
    `M${r},0`,
    topEdge,
    `Q${w},0 ${w},${r}`,
    `L${w},${h - r}`,
    `Q${w},${h} ${w - r},${h}`,
    bottomEdge,
    `Q0,${h} 0,${h - r}`,
    `L0,${r}`,
    `Q0,0 ${r},0`,
    'Z',
  ].join(' ')
}

/** Build the main cloud body path (bumpy outline) for a thinking-cloud node.
 *  Uses arc-based puffs: junction points sit on a base ellipse, and circular
 *  arcs between them bulge outward — producing puffy lobes with no gear-like
 *  inward valleys. */
export function thinkingCloudPath(w: number, h: number): string {
  const cx = w / 2, cy = h / 2
  // Base ellipse — junction points sit here; arcs bulge outward past them
  const rx = w * 0.46, ry = h * 0.46
  const n = 8 // number of puffs — 8 gives a natural cartoon-cloud look

  // Junction points between puffs, sitting on the base ellipse
  // Slight angular jitter for organic feel
  const junctions: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const jitter = 0.06 * Math.sin(i * 2.1 + 0.5)
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + jitter
    junctions.push([
      cx + rx * Math.cos(angle),
      cy + ry * Math.sin(angle),
    ])
  }

  // Build path using circular arcs between junction points
  const d: string[] = [`M${junctions[0][0].toFixed(1)},${junctions[0][1].toFixed(1)}`]
  for (let i = 0; i < n; i++) {
    const j1 = junctions[i]
    const j2 = junctions[(i + 1) % n]
    const dx = j2[0] - j1[0], dy = j2[1] - j1[1]
    const chord = Math.sqrt(dx * dx + dy * dy)
    // Vary arc radius per puff for size variation (smaller radius = puffier arc)
    const sizeVar = 1 + 0.25 * Math.sin(i * 2.3) + 0.1 * Math.sin(i * 3.7 + 1)
    // Arc radius: ~55-65% of chord gives nicely puffy semicircular arcs
    const arcR = Math.max(chord * 0.5 + 0.1, chord * 0.58 * sizeVar)
    // sweep-flag=1 (CW) + large-arc-flag=0 makes arcs bulge outward
    d.push(`A${arcR.toFixed(1)},${arcR.toFixed(1)} 0 0,1 ${j2[0].toFixed(1)},${j2[1].toFixed(1)}`)
  }
  d.push('Z')
  return d.join(' ')
}

/** Positions and radii of the 3 trailing thought-bubbles for a thinking-cloud.
 *  Returns [{cx, cy, r}, ...] from largest (nearest body) to smallest (farthest). */
export function thinkingCloudTrail(
  w: number, h: number, tipAngle: number, tipLength = 20,
): { cx: number; cy: number; r: number }[] {
  const centerX = w / 2, centerY = h / 2
  const cosA = Math.cos(tipAngle), sinA = Math.sin(tipAngle)
  // Cloud body is roughly elliptical — find where ray hits its edge
  const rx = w * 0.5, ry = h * 0.5
  const denom = Math.sqrt((cosA * cosA) / (rx * rx) + (sinA * sinA) / (ry * ry))
  const edgeX = denom > 1e-9 ? centerX + cosA / denom : centerX
  const edgeY = denom > 1e-9 ? centerY + sinA / denom : centerY
  // Trail circles extend from edge outward; spacing scales with tipLength, radii stay fixed
  const scale = tipLength / 20
  const radii = [8, 6, 4]
  return radii.map((r, i) => ({
    cx: edgeX + cosA * (10 + i * 14) * scale,
    cy: edgeY + sinA * (10 + i * 14) * scale,
    r,
  }))
}

/** Chat-bubble clip-path CSS string (excludes the tip from content area). */
export function chatBubbleClipPath(w: number, h: number): string {
  // Just clip to the rounded-rect body, tip extends outside
  const r = Math.min(18, w / 4, h / 4)
  const rPctX = (r / w) * 100, rPctY = (r / h) * 100
  return `inset(0% 0% 0% 0% round ${rPctX}% / ${rPctY}%)`
}
