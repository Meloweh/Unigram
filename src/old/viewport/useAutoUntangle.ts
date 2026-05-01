import { useState, useCallback, useRef, useEffect } from 'react'
import type { Model } from '../model/sampleModels'
import { computeUntangledPositions } from './autoUntangle'
import { SCENE_W, SCENE_H } from '../scene/sceneConstants'
import { runInWorker } from '../workers/workerManager'
import type { UntangleInput, UntangleOutput } from '../workers/autoUntangle.worker'

/** Try creating an untangle worker; returns null in test environments */
function createUntangleWorker(): Worker | null {
  try {
    return new Worker(new URL('../workers/autoUntangle.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function useAutoUntangle(
  model: Model,
  frameModelId: string,
  gridSnap: number,
  beginMoveNode: (modelId: string) => void,
  moveNodes: (modelId: string, moves: { nodeId: string; x: number; y: number }[]) => void,
) {
  const [isUntangling, setIsUntangling] = useState(false)
  const untangleRaf = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)

  const handleUntangle = useCallback(() => {
    if (isUntangling) return

    setIsUntangling(true)

    // Capture model data before async computation
    const nodes = model.nodes
    const connections = model.connections
    const modelId = frameModelId

    function animateResult(targets: Record<string, { x: number; y: number }>) {
      beginMoveNode(modelId) // snapshot for undo
      const nodeIds = nodes.map(n => n.id)
      const starts: Record<string, { x: number; y: number }> = {}
      for (const n of nodes) starts[n.id] = { x: n.x, y: n.y }

      const duration = 800 // ms
      const t0 = performance.now()

      const animate = (now: number) => {
        const elapsed = now - t0
        const raw = Math.min(elapsed / duration, 1)
        const p = 1 - Math.pow(1 - raw, 3) // ease-out cubic

        const moves: { nodeId: string; x: number; y: number }[] = []
        for (const id of nodeIds) {
          const s = starts[id], e = targets[id]
          if (!s || !e) continue
          moves.push({ nodeId: id, x: s.x + (e.x - s.x) * p, y: s.y + (e.y - s.y) * p })
        }
        moveNodes(modelId, moves)

        if (raw < 1) {
          untangleRaf.current = requestAnimationFrame(animate)
        } else {
          setIsUntangling(false)
        }
      }
      untangleRaf.current = requestAnimationFrame(animate)
    }

    // Try Worker-based async computation
    const worker = createUntangleWorker()
    if (worker) {
      abortRef.current = new AbortController()
      const input: UntangleInput = { nodes, connections, vpW: SCENE_W, vpH: SCENE_H, gridSnapSize: gridSnap }
      runInWorker<UntangleInput, UntangleOutput>(worker, input, abortRef.current.signal)
        .then((targets) => {
          worker.terminate()
          if (targets) {
            animateResult(targets)
          } else {
            setIsUntangling(false) // already untangled
          }
        })
        .catch(() => {
          worker.terminate()
          setIsUntangling(false)
        })
    } else {
      // Synchronous fallback (test environment)
      const targets = computeUntangledPositions(nodes, connections, SCENE_W, SCENE_H, gridSnap)
      if (targets) {
        animateResult(targets)
      } else {
        setIsUntangling(false)
      }
    }
  }, [isUntangling, model, frameModelId, beginMoveNode, moveNodes, gridSnap])

  // Cleanup raf and abort worker on unmount
  useEffect(() => () => {
    cancelAnimationFrame(untangleRaf.current)
    abortRef.current?.abort()
  }, [])

  return { isUntangling, setIsUntangling, untangleRaf, handleUntangle }
}
