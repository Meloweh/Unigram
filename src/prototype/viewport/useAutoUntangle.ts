import { useState, useCallback, useRef, useEffect } from 'react'
import type { Model } from './sampleModels'
import { computeUntangledPositions } from './autoUntangle'
import { SCENE_W, SCENE_H } from './sceneConstants'

export function useAutoUntangle(
  model: Model,
  frameModelId: string,
  gridSnap: number,
  beginMoveNode: (modelId: string) => void,
  moveNodes: (modelId: string, moves: { nodeId: string; x: number; y: number }[]) => void,
) {
  const [isUntangling, setIsUntangling] = useState(false)
  const untangleRaf = useRef<number>(0)

  const handleUntangle = useCallback(() => {
    if (isUntangling) return
    const targets = computeUntangledPositions(model.nodes, model.connections, SCENE_W, SCENE_H, gridSnap)
    if (!targets) return // already untangled

    beginMoveNode(frameModelId) // snapshot for undo
    setIsUntangling(true)

    // Capture stable data for the animation closure
    const nodeIds = model.nodes.map(n => n.id)
    const starts: Record<string, { x: number; y: number }> = {}
    for (const n of model.nodes) starts[n.id] = { x: n.x, y: n.y }
    const modelId = frameModelId

    const duration = 800 // ms
    const t0 = performance.now()

    const animate = (now: number) => {
      const elapsed = now - t0
      const raw = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const p = 1 - Math.pow(1 - raw, 3)

      const moves: { nodeId: string; x: number; y: number }[] = []
      for (const id of nodeIds) {
        const s = starts[id], e = targets[id]
        if (!s || !e) continue
        moves.push({
          nodeId: id,
          x: s.x + (e.x - s.x) * p,
          y: s.y + (e.y - s.y) * p,
        })
      }
      moveNodes(modelId, moves)

      if (raw < 1) {
        untangleRaf.current = requestAnimationFrame(animate)
      } else {
        setIsUntangling(false)
      }
    }
    untangleRaf.current = requestAnimationFrame(animate)
  }, [isUntangling, model, frameModelId, beginMoveNode, moveNodes, gridSnap])

  // Cleanup raf on unmount
  useEffect(() => () => cancelAnimationFrame(untangleRaf.current), [])

  return { isUntangling, setIsUntangling, untangleRaf, handleUntangle }
}
