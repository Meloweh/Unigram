import { describe, expect, it, beforeEach } from 'vitest'
import { useOmniStore } from '../model/store'

describe('store selector stability — model.crossLinks', () => {
  beforeEach(() => {
    // Fresh empty model so crossLinks starts undefined.
    useOmniStore.getState().loadModel({
      id: 'sel-test',
      name: 'sel-test',
      nodes: new Map(),
      edges: new Map(),
    })
  })

  it('reading model.crossLinks twice returns the same reference (or both undefined)', () => {
    const a = useOmniStore.getState().model.crossLinks
    const b = useOmniStore.getState().model.crossLinks
    expect(a).toBe(b)
  })

  it('after addCrossLink the array is the same reference until next mutation', () => {
    const store = useOmniStore.getState()
    const n1 = store.addNode({ x: 0, y: 0 })
    const n2 = store.addNode({ x: 10, y: 10 })
    // Link the two so addCrossLink accepts the pair.
    store.linkNodes(n1, n2)
    store.addCrossLink({ nodeId: n1, effectId: 'e1' }, { nodeId: n2, effectId: 'e2' })
    const a = useOmniStore.getState().model.crossLinks
    const b = useOmniStore.getState().model.crossLinks
    expect(a).toBe(b)
    expect(a?.length).toBe(1)
  })
})
