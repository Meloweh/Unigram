import { SCENE_H, SCENE_W } from './sceneConstants'
import type { CosmeticType, ModelNode, NodeShape } from '../model/types'

export const DEFAULT_COSMETIC_TIP_ANGLE = Math.PI * 0.75
export const DEFAULT_COSMETIC_TIP_LENGTH = 20
export const MIN_COSMETIC_TIP_LENGTH = 8
export const MAX_COSMETIC_TIP_LENGTH = 80

const COSMETIC_DEFAULT_PX = { w: 180, h: 100 }
const CLOUD_OUTLINE_CACHE_LIMIT = 512
const cloudOutlineCache = new Map<string, Array<[number, number]>>()

export function isCosmeticShape(shape: NodeShape): shape is CosmeticType {
  return shape === 'chat-bubble' || shape === 'thinking-cloud'
}

export function cosmeticTypeOf(node: Pick<ModelNode, 'shape' | 'cosmeticType'>): CosmeticType | undefined {
  return node.cosmeticType ?? (isCosmeticShape(node.shape) ? node.shape : undefined)
}

export function cosmeticShapeOf(type: CosmeticType): NodeShape {
  return type
}

export function cosmeticNodeDefaults(type: CosmeticType): Pick<ModelNode, 'shape' | 'cosmeticType' | 'w' | 'h' | 'tipAngle' | 'tipLength'> {
  const size = defaultCosmeticSizePercent()
  return {
    shape: cosmeticShapeOf(type),
    cosmeticType: type,
    w: size.w,
    h: size.h,
    tipAngle: DEFAULT_COSMETIC_TIP_ANGLE,
    tipLength: DEFAULT_COSMETIC_TIP_LENGTH,
  }
}

export function defaultCosmeticSizePercent(): { w: number; h: number } {
  return { w: (COSMETIC_DEFAULT_PX.w / SCENE_W) * 100, h: (COSMETIC_DEFAULT_PX.h / SCENE_H) * 100 }
}

export function cosmeticTip(node: Pick<ModelNode, 'tip' | 'tipAngle' | 'tipLength'>): { angle: number; length: number } {
  if (node.tipAngle != null || node.tipLength != null) {
    return {
      angle: node.tipAngle ?? DEFAULT_COSMETIC_TIP_ANGLE,
      length: node.tipLength ?? DEFAULT_COSMETIC_TIP_LENGTH,
    }
  }
  if (node.tip) {
    const x = node.tip.x
    const y = node.tip.y
    const length = Math.max(0, Math.hypot(x, y))
    if (length > 0) return { angle: Math.atan2(y, x), length }
  }
  return { angle: DEFAULT_COSMETIC_TIP_ANGLE, length: DEFAULT_COSMETIC_TIP_LENGTH }
}

export function chatBubblePathPoints(
  w: number,
  h: number,
  tipAngle: number,
  tipLength = DEFAULT_COSMETIC_TIP_LENGTH,
): {
  r: number
  isBottom: boolean
  baseX: number
  edgeY: number
  apexX: number
  apexY: number
  tipW: number
} {
  const r = Math.min(18, w / 4, h / 4)
  const tipW = Math.min(15, tipLength * 0.75)
  const cosA = Math.cos(tipAngle)
  const sinA = Math.sin(tipAngle)
  const isBottom = sinA >= 0
  const edgeY = isBottom ? h / 2 : -h / 2
  const centerY = 0
  let baseX: number
  if (Math.abs(sinA) > 0.05) {
    const t = (edgeY - centerY) / sinA
    baseX = t * cosA
  } else {
    baseX = 0
  }
  baseX = Math.max(-w / 2 + r + tipW, Math.min(w / 2 - r - tipW, baseX))
  return {
    r,
    isBottom,
    baseX,
    edgeY,
    apexX: baseX + tipLength * cosA,
    apexY: edgeY + tipLength * sinA,
    tipW,
  }
}

export function thinkingCloudTrail(
  w: number,
  h: number,
  tipAngle: number,
  tipLength = DEFAULT_COSMETIC_TIP_LENGTH,
): { cx: number; cy: number; r: number }[] {
  const cosA = Math.cos(tipAngle)
  const sinA = Math.sin(tipAngle)
  const rx = w * 0.5
  const ry = h * 0.5
  const denom = Math.sqrt((cosA * cosA) / (rx * rx) + (sinA * sinA) / (ry * ry))
  const edgeX = denom > 1e-9 ? cosA / denom : 0
  const edgeY = denom > 1e-9 ? sinA / denom : 0
  const scale = tipLength / DEFAULT_COSMETIC_TIP_LENGTH
  const radii = [8, 6, 4]
  return radii.map((r, i) => ({
    cx: edgeX + cosA * (10 + i * 14) * scale,
    cy: edgeY + sinA * (10 + i * 14) * scale,
    r,
  }))
}

export function cosmeticTipHandleLocalPx(
  type: CosmeticType,
  w: number,
  h: number,
  tipAngle = DEFAULT_COSMETIC_TIP_ANGLE,
  tipLength = DEFAULT_COSMETIC_TIP_LENGTH,
): { x: number; y: number } {
  if (type === 'chat-bubble') {
    const p = chatBubblePathPoints(w, h, tipAngle, tipLength)
    return { x: p.apexX, y: p.apexY }
  }
  const trail = thinkingCloudTrail(w, h, tipAngle, tipLength)
  const end = trail[trail.length - 1]
  return { x: end.cx, y: end.cy }
}

export function cosmeticTipFromLocalPoint(
  type: CosmeticType,
  w: number,
  h: number,
  localX: number,
  localY: number,
): { angle: number; length: number } {
  const angle = Math.atan2(localY, localX)
  const dist = Math.hypot(localX, localY)
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  let bodyDist: number
  let extraScale = 1
  if (type === 'chat-bubble') {
    const tx = Math.abs(cosA) > 1e-6 ? (w / 2) / Math.abs(cosA) : Infinity
    const ty = Math.abs(sinA) > 1e-6 ? (h / 2) / Math.abs(sinA) : Infinity
    bodyDist = Math.min(tx, ty)
  } else {
    const rx = w * 0.5
    const ry = h * 0.5
    const denom = Math.sqrt((cosA * cosA) / (rx * rx) + (sinA * sinA) / (ry * ry))
    bodyDist = denom > 1e-9 ? 1 / denom : 0
    extraScale = DEFAULT_COSMETIC_TIP_LENGTH / 38
  }
  const raw = (dist - bodyDist) * extraScale
  return { angle, length: clampTipLength(raw) }
}

function clampTipLength(length: number): number {
  return Math.max(MIN_COSMETIC_TIP_LENGTH, Math.min(MAX_COSMETIC_TIP_LENGTH, length))
}

export function thinkingCloudOutlinePoints(w: number, h: number, stepsPerPuff = 8): Array<[number, number]> {
  const key = `${Math.round(w * 10) / 10}|${Math.round(h * 10) / 10}|${stepsPerPuff}`
  const cached = cloudOutlineCache.get(key)
  if (cached) return cached
  const rx = w * 0.46
  const ry = h * 0.46
  const puffCount = 8
  const junctions: Array<[number, number]> = []
  for (let i = 0; i < puffCount; i++) {
    const jitter = 0.06 * Math.sin(i * 2.1 + 0.5)
    const angle = (i / puffCount) * Math.PI * 2 - Math.PI / 2 + jitter
    junctions.push([rx * Math.cos(angle), ry * Math.sin(angle)])
  }

  const points: Array<[number, number]> = [junctions[0]]
  for (let i = 0; i < puffCount; i++) {
    const from = junctions[i]
    const to = junctions[(i + 1) % puffCount]
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const chord = Math.hypot(dx, dy)
    const sizeVar = 1 + 0.25 * Math.sin(i * 2.3) + 0.1 * Math.sin(i * 3.7 + 1)
    const radius = Math.max(chord * 0.5 + 0.1, chord * 0.58 * sizeVar)
    const arc = circularArcPoints(from, to, radius, stepsPerPuff)
    for (let j = 1; j < arc.length; j++) points.push(arc[j])
  }
  cloudOutlineCache.set(key, points)
  if (cloudOutlineCache.size > CLOUD_OUTLINE_CACHE_LIMIT) {
    const first = cloudOutlineCache.keys().next().value as string | undefined
    if (first) cloudOutlineCache.delete(first)
  }
  return points
}

function circularArcPoints(from: [number, number], to: [number, number], radius: number, steps: number): Array<[number, number]> {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const chord = Math.hypot(dx, dy)
  if (chord <= 0.001 || chord > radius * 2) return [from, to]
  const midX = (from[0] + to[0]) / 2
  const midY = (from[1] + to[1]) / 2
  const halfChord = chord / 2
  const centerOffset = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord))
  const perpX = -dy / chord
  const perpY = dx / chord
  const candidates: Array<[number, number]> = [
    [midX + perpX * centerOffset, midY + perpY * centerOffset],
    [midX - perpX * centerOffset, midY - perpY * centerOffset],
  ]
  let best: Array<[number, number]> | null = null
  let bestOutward = -Infinity
  for (const center of candidates) {
    const sampled = sampleClockwiseSmallArc(from, to, center, radius, Math.max(2, steps))
    const mid = sampled[Math.floor(sampled.length / 2)]
    const outward = Math.hypot(mid[0], mid[1]) - Math.hypot(midX, midY)
    if (outward > bestOutward) {
      bestOutward = outward
      best = sampled
    }
  }
  return best ?? [from, to]
}

function sampleClockwiseSmallArc(
  from: [number, number],
  to: [number, number],
  center: [number, number],
  radius: number,
  steps: number,
): Array<[number, number]> {
  const start = Math.atan2(from[1] - center[1], from[0] - center[0])
  const end = Math.atan2(to[1] - center[1], to[0] - center[0])
  let delta = end - start
  while (delta < 0) delta += Math.PI * 2
  if (delta > Math.PI) delta -= Math.PI * 2
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const angle = start + (delta * i) / steps
    pts.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius])
  }
  return pts
}

export function cosmeticAabbPadPercent(node: Pick<ModelNode, 'shape' | 'cosmeticType' | 'tip' | 'tipAngle' | 'tipLength'>): { x: number; y: number } {
  if (!cosmeticTypeOf(node as Pick<ModelNode, 'shape' | 'cosmeticType'>)) return { x: 0, y: 0 }
  const { length } = cosmeticTip(node)
  return { x: (Math.max(0, length + 16) / SCENE_W) * 100, y: (Math.max(0, length + 16) / SCENE_H) * 100 }
}
