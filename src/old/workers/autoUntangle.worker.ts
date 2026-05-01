import { computeUntangledPositions } from '../viewport/autoUntangle'
import type { ModelNode, ModelConnection } from '../model/sampleModels'

export interface UntangleInput {
  nodes: ModelNode[]
  connections: ModelConnection[]
  vpW: number
  vpH: number
  gridSnapSize: number
}

export type UntangleOutput = Record<string, { x: number; y: number }> | null

self.addEventListener('message', (e: MessageEvent<UntangleInput>) => {
  const { nodes, connections, vpW, vpH, gridSnapSize } = e.data
  const result = computeUntangledPositions(nodes, connections, vpW, vpH, gridSnapSize)
  self.postMessage(result)
})
