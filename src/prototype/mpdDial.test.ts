import { describe, it, expect, beforeEach } from 'vitest'
import { useHybridZoomStore } from './useHybridZoomStore'

const store = useHybridZoomStore

function reset() {
  store.setState(store.getInitialState())
}

/** Helper: zoom into Node Alpha so the current frame has mpdIds */
function enterNodeAlpha() {
  const s = store.getState()
  // Select and push into Node Alpha (which has mpdIds: ['alpha-internals', 'alpha-performance'])
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

  it('preserves mpdIds on the frame after switching', () => {
    enterNodeAlpha()
    store.getState().switchFrameMpd('alpha-performance')
    // mpdIds should still be available for switching back
    expect(store.getState().currentFrame().mpdIds).toEqual(['alpha-internals', 'alpha-performance'])
  })

  it('applies initialPanOffset when provided', () => {
    enterNodeAlpha()
    store.getState().switchFrameMpd('alpha-performance', { x: 42, y: -17 })
    expect(store.getState().currentFrame().panOffset).toEqual({ x: 42, y: -17 })
  })
})

describe('pushModel captures mpdIds from entry node', () => {
  beforeEach(reset)

  it('stores mpdIds when entry node has them', () => {
    store.getState().selectNode('node-alpha')
    store.getState().pushModel('alpha-internals', 'node-alpha')
    expect(store.getState().currentFrame().mpdIds).toEqual(['alpha-internals', 'alpha-performance'])
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
