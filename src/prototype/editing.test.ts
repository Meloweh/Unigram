import { describe, it, expect, beforeEach } from 'vitest'
import { useHybridZoomStore, snapToGrid, GRID_SNAP } from './useHybridZoomStore'

const store = useHybridZoomStore

function reset() {
  store.setState(store.getInitialState())
}

describe('snapToGrid', () => {
  it('snaps to nearest grid point', () => {
    expect(snapToGrid(0)).toBe(0)
    expect(snapToGrid(GRID_SNAP)).toBe(GRID_SNAP)
    expect(snapToGrid(GRID_SNAP * 2.3)).toBe(GRID_SNAP * 2)
    expect(snapToGrid(GRID_SNAP * 2.6)).toBe(GRID_SNAP * 3)
  })

  it('snaps negative values', () => {
    expect(snapToGrid(-1)).toBeCloseTo(0)
    expect(snapToGrid(-GRID_SNAP * 0.6)).toBe(-GRID_SNAP)
  })
})

describe('moveNode', () => {
  beforeEach(reset)

  it('moves a node to snapped position', () => {
    const { moveNode, getModel } = store.getState()
    moveNode('alpha-internals', 'svc-a', 33, 47)
    const model = getModel('alpha-internals')!
    const svcA = model.nodes.find((n) => n.id === 'svc-a')!
    expect(svcA.x).toBe(snapToGrid(33))
    expect(svcA.y).toBe(snapToGrid(47))
  })

  it('no-ops for unknown model', () => {
    const { moveNode, getModel } = store.getState()
    moveNode('nonexistent', 'svc-a', 50, 50)
    expect(getModel('nonexistent')).toBeUndefined()
  })
})

describe('addNode', () => {
  beforeEach(reset)

  it('adds a node to the model with snapped position', () => {
    const { addNode, getModel } = store.getState()
    addNode('alpha-internals', { id: 'new-1', label: 'New', x: 51, y: 49 })
    const model = getModel('alpha-internals')!
    const added = model.nodes.find((n) => n.id === 'new-1')!
    expect(added).toBeTruthy()
    expect(added.x).toBe(snapToGrid(51))
    expect(added.y).toBe(snapToGrid(49))
    expect(added.label).toBe('New')
  })
})

describe('updateNodeLabel', () => {
  beforeEach(reset)

  it('updates a node label', () => {
    const { updateNodeLabel, getModel } = store.getState()
    updateNodeLabel('alpha-internals', 'svc-a', 'Renamed')
    const model = getModel('alpha-internals')!
    expect(model.nodes.find((n) => n.id === 'svc-a')!.label).toBe('Renamed')
  })
})

describe('removeNode', () => {
  beforeEach(reset)

  it('removes a node and its connections', () => {
    const { removeNode, getModel } = store.getState()
    const before = getModel('alpha-internals')!
    const connsBefore = before.connections.filter(
      (c) => c.from === 'svc-a' || c.to === 'svc-a',
    ).length
    expect(connsBefore).toBeGreaterThan(0)

    removeNode('alpha-internals', 'svc-a')
    const after = getModel('alpha-internals')!
    expect(after.nodes.find((n) => n.id === 'svc-a')).toBeUndefined()
    expect(after.connections.filter((c) => c.from === 'svc-a' || c.to === 'svc-a').length).toBe(0)
  })

  it('clears selection if removed node was selected', () => {
    const { selectNode, removeNode, currentFrame } = store.getState()
    // Navigate into alpha-internals first
    store.getState().pushModel('alpha-internals', 'node-alpha')
    store.getState().selectNode('svc-b')
    expect(store.getState().currentFrame().selectedNodeId).toBe('svc-b')

    store.getState().removeNode('alpha-internals', 'svc-b')
    expect(store.getState().currentFrame().selectedNodeId).toBeNull()
  })
})

describe('addConnection', () => {
  beforeEach(reset)

  it('adds a connection', () => {
    const { addConnection, getModel } = store.getState()
    addConnection('alpha-internals', { from: 'svc-b', to: 'db' })
    const model = getModel('alpha-internals')!
    expect(model.connections.some((c) => c.from === 'svc-b' && c.to === 'db')).toBe(true)
  })

  it('prevents duplicate connections', () => {
    const { addConnection, getModel } = store.getState()
    const before = getModel('alpha-internals')!.connections.length
    // svc-a -> svc-b already exists
    addConnection('alpha-internals', { from: 'svc-a', to: 'svc-b' })
    expect(getModel('alpha-internals')!.connections.length).toBe(before)
  })
})

describe('removeConnection', () => {
  beforeEach(reset)

  it('removes a connection', () => {
    const { removeConnection, getModel } = store.getState()
    removeConnection('alpha-internals', 'svc-a', 'svc-b')
    const model = getModel('alpha-internals')!
    expect(model.connections.some((c) => c.from === 'svc-a' && c.to === 'svc-b')).toBe(false)
  })
})

describe('undo / redo', () => {
  beforeEach(reset)

  it('undo restores previous model state after addNode', () => {
    const s = store.getState()
    const before = s.getModel('alpha-internals')!.nodes.length
    s.addNode('alpha-internals', { id: 'tmp', label: 'Tmp', x: 50, y: 50 })
    expect(store.getState().getModel('alpha-internals')!.nodes.length).toBe(before + 1)

    store.getState().undo('alpha-internals')
    expect(store.getState().getModel('alpha-internals')!.nodes.length).toBe(before)
  })

  it('redo re-applies after undo', () => {
    const s = store.getState()
    const before = s.getModel('alpha-internals')!.nodes.length
    s.addNode('alpha-internals', { id: 'tmp', label: 'Tmp', x: 50, y: 50 })
    store.getState().undo('alpha-internals')
    store.getState().redo('alpha-internals')
    expect(store.getState().getModel('alpha-internals')!.nodes.length).toBe(before + 1)
  })

  it('redo stack is cleared on new mutation', () => {
    const s = store.getState()
    s.addNode('alpha-internals', { id: 'tmp1', label: 'A', x: 10, y: 10 })
    store.getState().undo('alpha-internals')
    // New mutation should clear redo
    store.getState().addNode('alpha-internals', { id: 'tmp2', label: 'B', x: 20, y: 20 })
    store.getState().redo('alpha-internals')
    // Redo should be empty — tmp1 should not reappear
    expect(store.getState().getModel('alpha-internals')!.nodes.find((n) => n.id === 'tmp1')).toBeUndefined()
  })

  it('undo no-ops when stack is empty', () => {
    const before = JSON.stringify(store.getState().getModel('alpha-internals'))
    store.getState().undo('alpha-internals')
    expect(JSON.stringify(store.getState().getModel('alpha-internals'))).toBe(before)
  })

  it('moveNode does not push undo, beginMoveNode does', () => {
    const s = store.getState()
    const original = s.getModel('alpha-internals')!.nodes.find((n) => n.id === 'svc-a')!
    const origX = original.x

    // Move without beginMoveNode — no undo entry
    s.moveNode('alpha-internals', 'svc-a', 60, 60)
    store.getState().undo('alpha-internals')
    // Should still be at 60 (no undo available)
    expect(store.getState().getModel('alpha-internals')!.nodes.find((n) => n.id === 'svc-a')!.x).toBe(snapToGrid(60))

    // Reset and try with beginMoveNode
    reset()
    store.getState().beginMoveNode('alpha-internals')
    store.getState().moveNode('alpha-internals', 'svc-a', 60, 60)
    store.getState().undo('alpha-internals')
    expect(store.getState().getModel('alpha-internals')!.nodes.find((n) => n.id === 'svc-a')!.x).toBe(origX)
  })
})
