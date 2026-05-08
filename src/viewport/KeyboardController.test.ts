import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOmniStore } from '../model/store'
import { KeyboardController } from './KeyboardController'

beforeEach(() => {
  const model = { id: 'root', name: 'test', nodes: new Map(), edges: new Map() }
  useOmniStore.setState({
    model,
    models: new Map([['root', model]]),
    selectedIds: new Set(),
    selectedEdgeIds: new Set(),
    rev: 0,
    selRev: 0,
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('KeyboardController', () => {
  it('does not delete main-scene nodes while a modal owns keyboard input', () => {
    const controller = new KeyboardController()
    const id = useOmniStore.getState().addNode({ x: 0, y: 0 })
    useOmniStore.getState().select(id)
    const modal = document.createElement('div')
    modal.dataset.omnigramKeyboardScope = 'modal'
    document.body.appendChild(modal)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

    expect(useOmniStore.getState().model.nodes.has(id)).toBe(true)
    controller.destroy()
  })

  it('does not delete selected main-scene nodes from the keyboard', () => {
    const controller = new KeyboardController()
    const id = useOmniStore.getState().addNode({ x: 0, y: 0 })
    useOmniStore.getState().select(id)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

    expect(useOmniStore.getState().model.nodes.has(id)).toBe(true)
    controller.destroy()
  })

  it('still deletes selected connections from the keyboard', () => {
    const controller = new KeyboardController()
    const a = useOmniStore.getState().addNode({ x: 0, y: 0 })
    const b = useOmniStore.getState().addNode({ x: 10, y: 0 })
    const edge = useOmniStore.getState().addEdge(a, b)!
    useOmniStore.getState().selectEdge(edge)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

    expect(useOmniStore.getState().model.edges.has(edge)).toBe(false)
    expect(useOmniStore.getState().model.nodes.size).toBe(2)
    controller.destroy()
  })
})
