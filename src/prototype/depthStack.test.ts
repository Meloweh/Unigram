import { useHybridZoomStore } from './useHybridZoomStore'

const { getState } = useHybridZoomStore

function resetStore() {
  getState().clearSelection()
  // Replace entire stack with fresh root
  useHybridZoomStore.setState({
    stack: [
      {
        modelId: 'root',
        entryNodeId: null,
        snapshot: { progress: 0, nodeProgress: 0, cameraScale: 1, nodeInflation: 0, handoffMode: 'host' as const },
        selectedNodeId: null,
        panOffset: { x: 0, y: 0 },
      },
    ],
    isPaused: false,
    isDragging: false,
  })
}

beforeEach(resetStore)

describe('depth stack', () => {
  it('starts with a single root frame at depth 0', () => {
    const { stack, currentFrame } = getState()
    expect(stack).toHaveLength(1)
    expect(currentFrame().modelId).toBe('root')
    expect(currentFrame().entryNodeId).toBeNull()
  })

  it('pushModel adds a child frame', () => {
    getState().pushModel('alpha-internals', 'node-alpha')
    const { stack, currentFrame } = getState()
    expect(stack).toHaveLength(2)
    expect(currentFrame().modelId).toBe('alpha-internals')
    expect(currentFrame().entryNodeId).toBe('node-alpha')
    expect(currentFrame().snapshot.progress).toBe(0)
  })

  it('pushModel preserves parent frame', () => {
    getState().selectNode('node-alpha')
    // Zoom in a bit on the parent so it has non-zero state
    getState().zoomIn()
    getState().pushModel('alpha-internals', 'node-alpha')
    const { stack } = getState()
    expect(stack[0].modelId).toBe('root')
    expect(stack[0].selectedNodeId).toBe('node-alpha')
    expect(stack[0].snapshot.progress).toBeGreaterThan(0)
  })

  it('zoom out at bottom of child pops back to parent', () => {
    getState().pushModel('alpha-internals', 'node-alpha')
    expect(getState().stack).toHaveLength(2)
    // Zoom out — child is at progress 0, so it should pop
    getState().zoomOut()
    expect(getState().stack).toHaveLength(1)
    expect(getState().currentFrame().modelId).toBe('root')
  })

  it('zoom out at root bottom does not pop below 1 frame', () => {
    getState().selectNode('node-alpha')
    getState().zoomOut()
    expect(getState().stack).toHaveLength(1)
    expect(getState().currentFrame().modelId).toBe('root')
  })

  it('supports multi-level push and sequential pop', () => {
    getState().pushModel('alpha-internals', 'node-alpha')
    getState().pushModel('svc-a-internals', 'svc-a')
    expect(getState().stack).toHaveLength(3)
    expect(getState().currentFrame().modelId).toBe('svc-a-internals')

    // Pop back to alpha-internals
    getState().zoomOut()
    expect(getState().stack).toHaveLength(2)
    expect(getState().currentFrame().modelId).toBe('alpha-internals')

    // Pop back to root
    getState().zoomOut()
    expect(getState().stack).toHaveLength(1)
    expect(getState().currentFrame().modelId).toBe('root')
  })

  it('selectNode and clearSelection operate on top frame only', () => {
    getState().pushModel('alpha-internals', 'node-alpha')
    getState().selectNode('svc-a')
    expect(getState().currentFrame().selectedNodeId).toBe('svc-a')
    // Parent frame should be unaffected
    expect(getState().stack[0].selectedNodeId).toBeNull()

    getState().clearSelection()
    expect(getState().currentFrame().selectedNodeId).toBeNull()
  })

  it('zoomIn requires a selected node', () => {
    const before = getState().currentFrame().snapshot.progress
    getState().zoomIn()
    expect(getState().currentFrame().snapshot.progress).toBe(before)
  })

  it('selectNode mid-zoom resets nodeProgress but keeps camera progress', () => {
    getState().selectNode('node-alpha')
    // Zoom in several steps
    for (let i = 0; i < 5; i++) getState().zoomIn()
    const progressBefore = getState().currentFrame().snapshot.progress
    expect(progressBefore).toBeGreaterThan(0.3)

    // Switch to a different node
    getState().selectNode('node-alpha') // same model, simulates switch
    const frame = getState().currentFrame()
    expect(frame.snapshot.progress).toBe(progressBefore) // camera holds
    expect(frame.snapshot.nodeProgress).toBe(0) // node inflation reset
    expect(frame.snapshot.nodeInflation).toBe(0)
  })

  it('zoomIn during catch-up only advances nodeProgress', () => {
    getState().selectNode('node-alpha')
    for (let i = 0; i < 5; i++) getState().zoomIn()
    const cameraBefore = getState().currentFrame().snapshot.progress

    // Switch node — resets nodeProgress
    getState().selectNode('node-alpha')
    expect(getState().currentFrame().snapshot.nodeProgress).toBe(0)

    // Zoom in — should only advance nodeProgress, camera holds
    getState().zoomIn()
    const frame = getState().currentFrame()
    expect(frame.snapshot.progress).toBe(cameraBefore) // camera unchanged
    expect(frame.snapshot.nodeProgress).toBeGreaterThan(0) // node catching up
    expect(frame.snapshot.nodeProgress).toBeLessThan(cameraBefore)
  })
})
