import { describe, it, expect, beforeEach } from 'vitest'
import { useHybridZoomStore } from './useHybridZoomStore'

const store = useHybridZoomStore

function seedModels() {
  const s = store.getState()
  s.registerModel({ id: 'root', label: 'Root', nodes: [
    { id: 'node-alpha', label: 'Node Alpha', x: 50, y: 50, childModelId: 'alpha-internals' },
  ], connections: [] })
  s.registerModel({ id: 'alpha-internals', label: 'Alpha Internals', nodes: [
    { id: 'svc-a', label: 'Service A', x: 20, y: 25 },
    { id: 'svc-b', label: 'Service B', x: 70, y: 20 },
    { id: 'gw', label: 'Gateway', x: 75, y: 65 },
  ], connections: [{ from: 'svc-a', to: 'svc-b' }] })
  s.registerModel({ id: 'alpha-performance', label: 'Alpha Performance', nodes: [
    { id: 'gw', label: 'Gateway', x: 40, y: 75 },
  ], connections: [] })
}

function reset() {
  store.setState(store.getInitialState())
  seedModels()
}

/** Helper: zoom into Node Alpha so the current frame has mpdIds */
function enterNodeAlpha() {
  const s = store.getState()
  // Give Node Alpha mpdIds (both as MPD entries) so frame-level dial works after zoom
  s.updateNodeProps('root', 'node-alpha', { mpdIds: ['alpha-internals', 'alpha-performance'] })
  // Select and push into Node Alpha via childModelId (RMM)
  s.selectNode('node-alpha')
  s.pushModel('alpha-internals', 'node-alpha')
}

describe('switchFrameMpd', () => {
  beforeEach(reset)

  it('switches the current frame modelId to an alternative dimension', () => {
    enterNodeAlpha()
    expect(store.getState().currentFrame().modelId).toBe('alpha-internals')

    store.getState().switchFrameMpd('alpha-performance')
    expect(store.getState().currentFrame().modelId).toBe('alpha-performance')
  })

  it('no-ops when target is not in mpdIds', () => {
    enterNodeAlpha()
    store.getState().switchFrameMpd('nonexistent-model')
    expect(store.getState().currentFrame().modelId).toBe('alpha-internals')
  })

  it('no-ops when already on the requested dimension', () => {
    enterNodeAlpha()
    const stackBefore = store.getState().stack.length
    store.getState().switchFrameMpd('alpha-internals')
    // Stack should be unchanged
    expect(store.getState().stack.length).toBe(stackBefore)
    expect(store.getState().currentFrame().modelId).toBe('alpha-internals')
  })

  it('clears selection for non-twin nodes on switch', () => {
    enterNodeAlpha()
    store.getState().selectNode('svc-a')
    store.getState().panBy(100, 50)
    expect(store.getState().currentFrame().selectedNodeId).toBe('svc-a')

    store.getState().switchFrameMpd('alpha-performance')
    // svc-a does not exist in alpha-performance, so selection is cleared
    expect(store.getState().currentFrame().selectedNodeId).toBeNull()
    expect(store.getState().currentFrame().panOffset).toEqual({ x: 0, y: 0 })
  })

  it('preserves selection for twin nodes on switch', () => {
    enterNodeAlpha()
    // 'gw' exists in both alpha-internals and alpha-performance
    store.getState().selectNode('gw')
    store.getState().switchFrameMpd('alpha-performance')
    expect(store.getState().currentFrame().selectedNodeId).toBe('gw')
  })

  it('clears unzip popup on switch', () => {
    enterNodeAlpha()
    store.getState().openUnzip('svc-a->svc-b', 50, 50)
    expect(store.getState().unzipPopup).not.toBeNull()

    store.getState().switchFrameMpd('alpha-performance')
    expect(store.getState().unzipPopup).toBeNull()
  })

  it('no-ops at root level (no mpdIds)', () => {
    // At root, no mpdIds on the frame
    store.getState().switchFrameMpd('alpha-internals')
    expect(store.getState().currentFrame().modelId).toBe('root')
  })

  it('allows switching back after switching dimensions', () => {
    enterNodeAlpha()
    store.getState().switchFrameMpd('alpha-performance')
    expect(store.getState().currentFrame().modelId).toBe('alpha-performance')
    // Switch back to original
    store.getState().switchFrameMpd('alpha-internals')
    expect(store.getState().currentFrame().modelId).toBe('alpha-internals')
  })

  it('applies initialPanOffset when provided', () => {
    enterNodeAlpha()
    store.getState().switchFrameMpd('alpha-performance', { x: 42, y: -17 })
    expect(store.getState().currentFrame().panOffset).toEqual({ x: 42, y: -17 })
  })
})

describe('pushModel does not inherit mpdIds from entry node', () => {
  beforeEach(reset)

  it('leaves mpdIds undefined (MPDs are handled at node level)', () => {
    store.getState().updateNodeProps('root', 'node-alpha', { mpdIds: ['alpha-internals', 'alpha-performance'] })
    store.getState().selectNode('node-alpha')
    store.getState().pushModel('alpha-internals', 'node-alpha')
    expect(store.getState().currentFrame().mpdIds).toBeUndefined()
  })

  it('leaves mpdIds undefined when entry node has none', () => {
    // First zoom into alpha-internals
    store.getState().selectNode('node-alpha')
    store.getState().pushModel('alpha-internals', 'node-alpha')
    // Then zoom into svc-b (no mpdIds)
    store.getState().selectNode('svc-b')
    store.getState().pushModel('svc-b', 'svc-b')
    expect(store.getState().currentFrame().mpdIds).toBeUndefined()
  })
})

describe('switchNodeMpd with multiple MPDs', () => {
  beforeEach(reset)

  it('switches to each MPD independently', () => {
    // Setup: 4 MPDs on node-alpha (default + 3 dimensions)
    const s = store.getState()
    s.registerModel({ id: 'mpd-default', label: 'Default', nodes: [], connections: [] })
    s.registerModel({ id: 'mpd-1', label: 'MPD 1', nodes: [{ id: 'node-alpha', label: 'A', x: 50, y: 50 }], connections: [] })
    s.registerModel({ id: 'mpd-2', label: 'MPD 2', nodes: [{ id: 'node-alpha', label: 'A', x: 50, y: 50 }], connections: [] })
    s.registerModel({ id: 'mpd-3', label: 'MPD 3', nodes: [{ id: 'node-alpha', label: 'A', x: 50, y: 50 }], connections: [] })
    s.updateNodeProps('root', 'node-alpha', { mpdIds: ['mpd-default', 'mpd-1', 'mpd-2', 'mpd-3'] })
    s.selectNode('node-alpha')

    const mpdIds = ['mpd-default', 'mpd-1', 'mpd-2', 'mpd-3']

    // Switch to MPD 1
    store.getState().switchNodeMpd('mpd-1', mpdIds)
    expect(store.getState().currentFrame().modelId).toBe('mpd-1')
    expect(store.getState().currentFrame().nodeMpdOriginalModelId).toBe('root')

    // Switch directly to MPD 2 (from MPD 1)
    store.getState().switchNodeMpd('mpd-2', mpdIds)
    expect(store.getState().currentFrame().modelId).toBe('mpd-2')
    expect(store.getState().currentFrame().nodeMpdOriginalModelId).toBe('root')

    // Switch directly to MPD 3 (from MPD 2)
    store.getState().switchNodeMpd('mpd-3', mpdIds)
    expect(store.getState().currentFrame().modelId).toBe('mpd-3')
    expect(store.getState().currentFrame().nodeMpdOriginalModelId).toBe('root')

    // Switch back to default (original model)
    store.getState().switchNodeMpd('root', mpdIds)
    expect(store.getState().currentFrame().modelId).toBe('root')
    expect(store.getState().currentFrame().nodeMpdOriginalModelId).toBeUndefined()

    // Switch directly to MPD 3 (from default)
    store.getState().switchNodeMpd('mpd-3', mpdIds)
    expect(store.getState().currentFrame().modelId).toBe('mpd-3')
  })

  it('adds content independently to each MPD model', () => {
    const s = store.getState()
    s.registerModel({ id: 'mpd-default', label: 'Default', nodes: [], connections: [] })
    s.registerModel({ id: 'mpd-1', label: 'MPD 1', nodes: [{ id: 'node-alpha', label: 'A', x: 50, y: 50 }], connections: [] })
    s.registerModel({ id: 'mpd-2', label: 'MPD 2', nodes: [{ id: 'node-alpha', label: 'A', x: 50, y: 50 }], connections: [] })
    s.updateNodeProps('root', 'node-alpha', { mpdIds: ['mpd-default', 'mpd-1', 'mpd-2'] })
    s.selectNode('node-alpha')

    const mpdIds = ['mpd-default', 'mpd-1', 'mpd-2']

    // Switch to MPD 1 and add a node
    store.getState().switchNodeMpd('mpd-1', mpdIds)
    store.getState().addNode('mpd-1', { id: 'extra-1', label: 'Extra 1', x: 20, y: 20 })

    // Switch to MPD 2 — should NOT see the node from MPD 1
    store.getState().switchNodeMpd('mpd-2', mpdIds)
    const mpd2Model = store.getState().models['mpd-2']
    expect(mpd2Model.nodes.find(n => n.id === 'extra-1')).toBeUndefined()
    expect(store.getState().currentFrame().modelId).toBe('mpd-2')

    // MPD 1 should still have its extra node
    const mpd1Model = store.getState().models['mpd-1']
    expect(mpd1Model.nodes.find(n => n.id === 'extra-1')).toBeDefined()
  })
})
