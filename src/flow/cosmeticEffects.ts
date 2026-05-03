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
          { id: 'cosmetic-root', kind: 'cloud-levitate', params: { ampX: 0.1667, ampY: 0.7407, rotAmp: 1.5, speed: 0.8, ms: 25000 }, x: 300, y: 120 },
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
        { id: 'cosmetic-root', kind: 'bubble-levitate', params: { ampX: 0.3125, ampY: 0.9259, scaleAmp: 0.03, scalePulse: 1, speed: 0.5, ms: 10000 }, x: 300, y: 120 },
      ],
      edges: [],
    },
  }
}
