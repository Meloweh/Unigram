import { useCallback, useRef, useState } from 'react'
import type { ModelNode, ModelConnection } from '../model/sampleModels'

export interface BenchmarkState {
  isRunning: boolean
  nodeCount: number
  connectionCount: number
}

const BATCH_SIZE = 50       // nodes per tick
const CONNECTIONS_PER = 2   // connections per new node (to random earlier nodes)
const TICK_MS = 200         // ms between batches
const FPS_FLOOR = 15        // auto-stop when FPS drops below this
const GRID_COLS = 20        // layout grid columns

/** Generates unique IDs for benchmark nodes */
let benchSeq = 0
function benchId() { return `bench-${++benchSeq}` }

export function useBenchmark(
  modelId: string,
  addNodeBatch: (modelId: string, nodes: ModelNode[], connections: ModelConnection[]) => void,
  fpsRef: React.RefObject<number>,
) {
  const [state, setState] = useState<BenchmarkState>({ isRunning: false, nodeCount: 0, connectionCount: 0 })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nodeIdsRef = useRef<string[]>([])

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setState(s => ({ ...s, isRunning: false }))
  }, [])

  const start = useCallback(() => {
    if (state.isRunning) { stop(); return }

    benchSeq = 0
    nodeIdsRef.current = []
    setState({ isRunning: true, nodeCount: 0, connectionCount: 0 })

    timerRef.current = setInterval(() => {
      // Auto-stop on low FPS
      if (fpsRef.current < FPS_FLOOR && nodeIdsRef.current.length > BATCH_SIZE) {
        stop()
        return
      }

      const newNodes: ModelNode[] = []
      const newConns: ModelConnection[] = []
      const existingIds = nodeIdsRef.current

      for (let i = 0; i < BATCH_SIZE; i++) {
        const id = benchId()
        const idx = existingIds.length + i
        const col = idx % GRID_COLS
        const row = Math.floor(idx / GRID_COLS)
        newNodes.push({
          id,
          label: `N${idx}`,
          x: 5 + col * 4.5,
          y: 5 + row * 4.5,
        })

        // Connect to random earlier nodes
        const pool = [...existingIds, ...newNodes.slice(0, i).map(n => n.id)]
        for (let c = 0; c < CONNECTIONS_PER && pool.length > 0; c++) {
          const targetIdx = Math.floor(Math.random() * pool.length)
          newConns.push({ from: id, to: pool[targetIdx] })
          pool.splice(targetIdx, 1) // no duplicate connections to same target
        }
      }

      nodeIdsRef.current = [...existingIds, ...newNodes.map(n => n.id)]
      addNodeBatch(modelId, newNodes, newConns)
      setState({
        isRunning: true,
        nodeCount: nodeIdsRef.current.length,
        connectionCount: 0, // we'll update from model
      })
    }, TICK_MS)
  }, [state.isRunning, modelId, addNodeBatch, fpsRef, stop])

  return { benchmarkState: state, startBenchmark: start, stopBenchmark: stop }
}
