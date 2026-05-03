import { SCENE_H, SCENE_W } from './sceneConstants'
import type { CosmeticType, ModelNode, NodeShape } from '../model/types'

export const DEFAULT_COSMETIC_TIP_ANGLE = Math.PI * 0.75
export const DEFAULT_COSMETIC_TIP_LENGTH = 20

const COSMETIC_DEFAULT_PX = { w: 180, h: 100 }

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

export function cosmeticAabbPadPercent(node: Pick<ModelNode, 'shape' | 'cosmeticType' | 'tip' | 'tipAngle' | 'tipLength'>): { x: number; y: number } {
  if (!cosmeticTypeOf(node as Pick<ModelNode, 'shape' | 'cosmeticType'>)) return { x: 0, y: 0 }
  const { length } = cosmeticTip(node)
  return { x: (Math.max(0, length + 16) / SCENE_W) * 100, y: (Math.max(0, length + 16) / SCENE_H) * 100 }
}
