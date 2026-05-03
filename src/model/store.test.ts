import { beforeEach, describe, expect, it } from 'vitest'
import { useOmniStore } from './store'

beforeEach(() => {
  useOmniStore.setState({
    model: { id: 'root', name: 'test', nodes: new Map(), edges: new Map() },
    camera: { panX: 0, panY: 0, freeScale: 1 },
    selectedIds: new Set(),
    rev: 0,
    selRev: 0,
    defaultConnectionKind: 'flow',
    clipboard: null,
    lastPasteAt: 0,
    pickMode: null,
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

  it('defaultConnectionKind starts at "flow" and round-trips through setter', () => {
    expect(useOmniStore.getState().defaultConnectionKind).toBe('flow')
    useOmniStore.getState().setDefaultConnectionKind('default')
    expect(useOmniStore.getState().defaultConnectionKind).toBe('default')
    useOmniStore.getState().setDefaultConnectionKind('flow')
    expect(useOmniStore.getState().defaultConnectionKind).toBe('flow')
  })

  it('addEdge respects partial.kind so callers can author flow edges', () => {
    const a = useOmniStore.getState().addNode({ x: 0, y: 0 })
    const b = useOmniStore.getState().addNode({ x: 50, y: 50 })
    const id = useOmniStore.getState().addEdge(a, b, { kind: 'flow' })!
    const e = useOmniStore.getState().model.edges.get(id)!
    expect(e.kind).toBe('flow')
  })

  it('copySelection captures selected nodes + only fully-internal edges', () => {
    const s = useOmniStore.getState()
    const a = s.addNode({ x: 0, y: 0 })
    const b = s.addNode({ x: 10, y: 0 })
    const c = s.addNode({ x: 20, y: 0 })
    s.addEdge(a, b)        // both endpoints in selection
    s.addEdge(b, c)        // c is NOT selected — must be excluded
    s.selectMany([a, b])
    s.copySelection()
    const clip = useOmniStore.getState().clipboard!
    expect(clip).not.toBeNull()
    expect(clip.nodes.map((n) => n.id).sort()).toEqual([a, b].sort())
    expect(clip.edges).toHaveLength(1)
    expect(clip.edges[0].from).toBe(a)
    expect(clip.edges[0].to).toBe(b)
  })

  it('pasteClipboard creates new ids, offsets coords, and re-wires edges', () => {
    const s = useOmniStore.getState()
    const a = s.addNode({ x: 0, y: 0 })
    const b = s.addNode({ x: 10, y: 0 })
    s.addEdge(a, b)
    s.selectMany([a, b])
    s.copySelection()
    const newIds = useOmniStore.getState().pasteClipboard()
    expect(newIds).toHaveLength(2)
    expect(newIds.every((id) => id !== a && id !== b)).toBe(true)
    const m = useOmniStore.getState().model
    expect(m.nodes.size).toBe(4)
    expect(m.edges.size).toBe(2)
    // Pasted nodes are offset by +4/+4 (DEFAULT_GRID_SNAP).
    const pasted = newIds.map((id) => m.nodes.get(id)!)
    expect(pasted[0].x).toBe(4)
    expect(pasted[1].x).toBe(14)
    // The pasted edge references the new ids, not the originals.
    const pastedEdge = [...m.edges.values()].find((e) => newIds.includes(e.from))!
    expect(newIds).toContain(pastedEdge.from)
    expect(newIds).toContain(pastedEdge.to)
  })

  it('pasteClipboard throttles back-to-back calls', () => {
    const s = useOmniStore.getState()
    const a = s.addNode({ x: 0, y: 0 })
    s.selectMany([a])
    s.copySelection()
    const first = useOmniStore.getState().pasteClipboard()
    const second = useOmniStore.getState().pasteClipboard()
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0) // throttled within 500 ms window
  })

  it('pasteClipboard with no clipboard is a no-op', () => {
    const out = useOmniStore.getState().pasteClipboard()
    expect(out).toEqual([])
    expect(useOmniStore.getState().model.nodes.size).toBe(0)
  })

  it('addChildModel registers a fresh model and links it; removeChildModel unlinks but keeps the model', () => {
    const s = useOmniStore.getState()
    const a = s.addNode({ x: 0, y: 0 })
    const childId = s.addChildModel(a)!
    expect(childId).toBeTruthy()
    expect(useOmniStore.getState().model.nodes.get(a)?.childModelId).toBe(childId)
    expect(useOmniStore.getState().models.get(childId)).toBeDefined()
    // Idempotent: second call returns null since a child is already linked.
    expect(useOmniStore.getState().addChildModel(a)).toBeNull()
    useOmniStore.getState().removeChildModel(a)
    expect(useOmniStore.getState().model.nodes.get(a)?.childModelId).toBeUndefined()
    // Registered model survives so undo can re-link.
    expect(useOmniStore.getState().models.get(childId)).toBeDefined()
  })

  it('linkNodes is symmetric and idempotent; unlinkNodes prunes both ends and any cross-links', () => {
    const s = useOmniStore.getState()
    const a = s.addNode({ x: 0, y: 0 })
    const b = s.addNode({ x: 10, y: 10 })
    s.linkNodes(a, b)
    expect(useOmniStore.getState().model.nodes.get(a)?.linkedNodeIds).toEqual([b])
    expect(useOmniStore.getState().model.nodes.get(b)?.linkedNodeIds).toEqual([a])
    // Idempotent — repeat link adds no patches and keeps lists at length 1.
    const depthBefore = useOmniStore.getState().undoStack.depth
    useOmniStore.getState().linkNodes(a, b)
    expect(useOmniStore.getState().model.nodes.get(a)?.linkedNodeIds?.length).toBe(1)
    expect(useOmniStore.getState().undoStack.depth).toBe(depthBefore)

    const linkId = useOmniStore.getState().addCrossLink(
      { nodeId: a, effectId: 'fx-a' },
      { nodeId: b, effectId: 'fx-b' },
    )!
    expect(linkId).toBeTruthy()
    expect(useOmniStore.getState().model.crossLinks?.length).toBe(1)
    // Duplicate cross-link returns existing id, no new entry.
    const dup = useOmniStore.getState().addCrossLink(
      { nodeId: a, effectId: 'fx-a' },
      { nodeId: b, effectId: 'fx-b' },
    )
    expect(dup).toBe(linkId)
    expect(useOmniStore.getState().model.crossLinks?.length).toBe(1)

    useOmniStore.getState().unlinkNodes(a, b)
    expect(useOmniStore.getState().model.nodes.get(a)?.linkedNodeIds).toEqual([])
    expect(useOmniStore.getState().model.nodes.get(b)?.linkedNodeIds).toEqual([])
    expect(useOmniStore.getState().model.crossLinks?.length).toBe(0)
  })

  it('addCrossLink rejects when hosts are not linked', () => {
    const s = useOmniStore.getState()
    const a = s.addNode({ x: 0, y: 0 })
    const b = s.addNode({ x: 10, y: 10 })
    const id = useOmniStore.getState().addCrossLink(
      { nodeId: a, effectId: 'fx-a' },
      { nodeId: b, effectId: 'fx-b' },
    )
    expect(id).toBeNull()
  })

  it('setGrid round-trips appearance through the model', () => {
    const s = useOmniStore.getState()
    s.setGrid({ enabled: true, snap: true, sizePercent: 5, appearance: 'dots' })
    expect(useOmniStore.getState().model.grid).toMatchObject({
      enabled: true,
      snap: true,
      sizePercent: 5,
      appearance: 'dots',
    })
    s.setGrid({ appearance: 'tile' })
    expect(useOmniStore.getState().model.grid?.appearance).toBe('tile')
  })
})
