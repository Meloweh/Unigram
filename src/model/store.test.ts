import { beforeEach, describe, expect, it } from 'vitest'
import { useOmniStore } from './store'

beforeEach(() => {
  useOmniStore.setState({
    model: { id: 'root', name: 'test', nodes: new Map(), edges: new Map() },
    camera: { panX: 0, panY: 0, freeScale: 1 },
    selectedIds: new Set(),
    rev: 0,
    selRev: 0,
  })
  useOmniStore.getState().undoStack.clear()
})

describe('store', () => {
  it('adds and removes nodes', () => {
    const id = useOmniStore.getState().addNode({ x: 10, y: 20 })
    expect(useOmniStore.getState().model.nodes.size).toBe(1)
    useOmniStore.getState().removeNodes([id])
    expect(useOmniStore.getState().model.nodes.size).toBe(0)
  })

  it('cascades edge removal when an endpoint node is deleted', () => {
    const a = useOmniStore.getState().addNode({ x: 0, y: 0 })
    const b = useOmniStore.getState().addNode({ x: 50, y: 50 })
    const e = useOmniStore.getState().addEdge(a, b)
    expect(e).not.toBeNull()
    expect(useOmniStore.getState().model.edges.size).toBe(1)
    useOmniStore.getState().removeNodes([a])
    expect(useOmniStore.getState().model.edges.size).toBe(0)
  })

  it('rejects self-edges and edges to missing nodes', () => {
    const a = useOmniStore.getState().addNode({ x: 0, y: 0 })
    expect(useOmniStore.getState().addEdge(a, a)).toBeNull()
    expect(useOmniStore.getState().addEdge(a, 'missing')).toBeNull()
  })

  it('moveNodes updates positions and registers an undo transaction', () => {
    const id = useOmniStore.getState().addNode({ x: 10, y: 20 })
    const depthBefore = useOmniStore.getState().undoStack.depth
    useOmniStore.getState().moveNodes([{ id, x: 30, y: 40 }])
    const node = useOmniStore.getState().model.nodes.get(id)!
    expect(node.x).toBe(30)
    expect(node.y).toBe(40)
    expect(useOmniStore.getState().undoStack.depth).toBe(depthBefore + 1)
  })

  it('moveNodes ignores no-op moves (no undo entry)', () => {
    const id = useOmniStore.getState().addNode({ x: 10, y: 20 })
    const depthBefore = useOmniStore.getState().undoStack.depth
    useOmniStore.getState().moveNodes([{ id, x: 10, y: 20 }])
    expect(useOmniStore.getState().undoStack.depth).toBe(depthBefore)
  })

  it('undo/redo round-trips an add', () => {
    const id = useOmniStore.getState().addNode({ x: 0, y: 0 })
    expect(useOmniStore.getState().model.nodes.has(id)).toBe(true)
    useOmniStore.getState().undo()
    expect(useOmniStore.getState().model.nodes.has(id)).toBe(false)
    useOmniStore.getState().redo()
    expect(useOmniStore.getState().model.nodes.has(id)).toBe(true)
  })

  it('undo/redo round-trips a multi-patch transaction (cascading delete)', () => {
    const a = useOmniStore.getState().addNode({ x: 0, y: 0 })
    const b = useOmniStore.getState().addNode({ x: 1, y: 1 })
    useOmniStore.getState().addEdge(a, b)
    useOmniStore.getState().removeNodes([a])
    expect(useOmniStore.getState().model.nodes.size).toBe(1)
    expect(useOmniStore.getState().model.edges.size).toBe(0)
    useOmniStore.getState().undo()
    expect(useOmniStore.getState().model.nodes.size).toBe(2)
    expect(useOmniStore.getState().model.edges.size).toBe(1)
  })

  it('camera changes do NOT enter the undo stack', () => {
    useOmniStore.getState().addNode({ x: 0, y: 0 })
    const depthBefore = useOmniStore.getState().undoStack.depth
    useOmniStore.getState().setCamera({ panX: 100 })
    useOmniStore.getState().panBy(10, 10)
    expect(useOmniStore.getState().undoStack.depth).toBe(depthBefore)
  })

  it('selection updates bump selRev but not undo', () => {
    const id = useOmniStore.getState().addNode({ x: 0, y: 0 })
    const depthBefore = useOmniStore.getState().undoStack.depth
    const selBefore = useOmniStore.getState().selRev
    useOmniStore.getState().select(id)
    expect(useOmniStore.getState().selectedIds.has(id)).toBe(true)
    expect(useOmniStore.getState().selRev).toBe(selBefore + 1)
    expect(useOmniStore.getState().undoStack.depth).toBe(depthBefore)
  })

  it('rev increments on every committed transaction', () => {
    const r0 = useOmniStore.getState().rev
    useOmniStore.getState().addNode({ x: 0, y: 0 })
    expect(useOmniStore.getState().rev).toBe(r0 + 1)
    useOmniStore.getState().addNode({ x: 1, y: 1 })
    expect(useOmniStore.getState().rev).toBe(r0 + 2)
  })
})
