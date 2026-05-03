import type { CosmeticType } from '../model/types'
import type { FlowEffect } from './types'

export function defaultCosmeticEffect(type: CosmeticType): FlowEffect {
  if (type === 'thinking-cloud') {
    return {
      id: `fx-cosmetic-${type}`,
      label: 'Cloudy Levitate',
      locked: true,
      alwaysPlay: true,
      graph: {
        nodes: [
          { id: 'cosmetic-root', kind: 'cloud-levitate', params: { ampX: 0.35, ampY: 0.75, freq: 0.8, ms: 3000 }, x: 300, y: 120 },
        ],
        edges: [],
      },
    }
  }
  return {
    id: `fx-cosmetic-${type}`,
    label: 'Soap Bubble Levitate',
    locked: true,
    alwaysPlay: true,
    graph: {
      nodes: [
        { id: 'cosmetic-root', kind: 'bubble-levitate', params: { ampY: 0.9, scaleAmp: 0.03, scalePulse: 1, freq: 0.5, ms: 4000 }, x: 300, y: 120 },
      ],
      edges: [],
    },
  }
}
