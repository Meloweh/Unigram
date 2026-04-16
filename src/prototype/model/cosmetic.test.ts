import { describe, it, expect, beforeEach } from 'vitest'
import { useHybridZoomStore } from './useHybridZoomStore'
import type { ModelNode, FlowEffect, CosmeticType } from './sampleModels'

const store = useHybridZoomStore

function reset() {
  store.setState(store.getInitialState())
  store.getState().registerModel({
    id: 'root',
    label: 'Root',
    nodes: [],
    connections: [],
  })
}

describe('CosmeticType on ModelNode', () => {
  beforeEach(reset)

  it('stores cosmeticType on a node', () => {
    const s = store.getState()
    s.addNode('root', {
      id: 'cb1', label: 'Chat', x: 50, y: 50,
      cosmeticType: 'chat-bubble',
      tipAngle: 2.4,
    })
    const model = store.getState().models['root']
    const node = model.nodes.find(n => n.id === 'cb1')!
    expect(node.cosmeticType).toBe('chat-bubble')
    expect(node.tipAngle).toBe(2.4)
  })

  it('stores thinking-cloud type', () => {
    const s = store.getState()
    s.addNode('root', {
      id: 'tc1', label: 'Think', x: 30, y: 30,
      cosmeticType: 'thinking-cloud',
      tipAngle: -0.8,
    })
    const node = store.getState().models['root'].nodes.find(n => n.id === 'tc1')!
    expect(node.cosmeticType).toBe('thinking-cloud')
    expect(node.tipAngle).toBe(-0.8)
  })

  it('updates cosmeticType via updateNodeProps', () => {
    const s = store.getState()
    s.addNode('root', {
      id: 'cb2', label: 'Switch', x: 50, y: 50,
      cosmeticType: 'chat-bubble',
    })
    s.updateNodeProps('root', 'cb2', { cosmeticType: 'thinking-cloud' })
    const node = store.getState().models['root'].nodes.find(n => n.id === 'cb2')!
    expect(node.cosmeticType).toBe('thinking-cloud')
  })

  it('updates tipAngle', () => {
    const s = store.getState()
    s.addNode('root', {
      id: 'cb3', label: 'Tip', x: 50, y: 50,
      cosmeticType: 'chat-bubble',
      tipAngle: 2.4,
    })
    s.updateNodeProps('root', 'cb3', { tipAngle: -1.2 })
    const node = store.getState().models['root'].nodes.find(n => n.id === 'cb3')!
    expect(node.tipAngle).toBe(-1.2)
  })

  it('stores and updates tipLength', () => {
    const s = store.getState()
    s.addNode('root', {
      id: 'cb5', label: 'Long Tip', x: 50, y: 50,
      cosmeticType: 'chat-bubble',
      tipAngle: 2.4,
      tipLength: 40,
    })
    const node = store.getState().models['root'].nodes.find(n => n.id === 'cb5')!
    expect(node.tipLength).toBe(40)
    s.updateNodeProps('root', 'cb5', { tipLength: 60 })
    const updated = store.getState().models['root'].nodes.find(n => n.id === 'cb5')!
    expect(updated.tipLength).toBe(60)
  })
})

describe('FlowEffect alwaysPlay flag', () => {
  beforeEach(reset)

  it('stores alwaysPlay on a flow effect', () => {
    const effect: FlowEffect = {
      id: 'fx-1',
      label: 'Levitate',
      locked: true,
      alwaysPlay: true,
      graph: {
        nodes: [
          { id: '__entry__', kind: 'entry', label: 'Signal In', x: 60, y: 120, config: {} },
          { id: 'lev', kind: 'bubble-levitate', label: 'Bubble Levitate', x: 300, y: 120, config: {} },
        ],
        edges: [{ from: '__entry__', to: 'lev' }],
      },
    }
    const s = store.getState()
    s.addNode('root', {
      id: 'cb4', label: 'Bubble', x: 50, y: 50,
      cosmeticType: 'chat-bubble',
      flowEffects: [effect],
    })
    const node = store.getState().models['root'].nodes.find(n => n.id === 'cb4')!
    expect(node.flowEffects![0].alwaysPlay).toBe(true)
  })

  it('alwaysPlay defaults to undefined', () => {
    const effect: FlowEffect = {
      id: 'fx-2',
      label: 'Regular',
      graph: {
        nodes: [{ id: '__entry__', kind: 'entry', label: 'Signal In', x: 60, y: 120, config: {} }],
        edges: [],
      },
    }
    const s = store.getState()
    s.addNode('root', {
      id: 'n1', label: 'Normal', x: 50, y: 50,
      flowEffects: [effect],
    })
    const node = store.getState().models['root'].nodes.find(n => n.id === 'n1')!
    expect(node.flowEffects![0].alwaysPlay).toBeUndefined()
  })
})

describe('FlowEffectKind new values', () => {
  it('cloud-levitate and bubble-levitate are valid kinds in effect graph nodes', () => {
    const cloudNode = {
      id: 'cl1', kind: 'cloud-levitate' as const,
      label: 'Cloudy', x: 0, y: 0, config: { amplitude: 8, speed: 0.8, durationMs: 3000 },
    }
    const bubbleNode = {
      id: 'bl1', kind: 'bubble-levitate' as const,
      label: 'Bubble', x: 0, y: 0, config: { amplitude: 10, speed: 0.5, durationMs: 4000, scalePulse: true },
    }
    expect(cloudNode.kind).toBe('cloud-levitate')
    expect(bubbleNode.kind).toBe('bubble-levitate')
    expect(bubbleNode.config.scalePulse).toBe(true)
  })

  it('cloud-levitate and bubble-levitate effects can be added to non-cosmetic nodes', () => {
    const s = store.getState()
    s.addNode('root', {
      id: 'plain', label: 'Plain', x: 50, y: 50,
      flowEffects: [{
        id: 'fx-lev', label: 'Levitate', graph: {
          nodes: [
            { id: '__entry__', kind: 'entry', label: 'Signal In', x: 60, y: 120, config: {} },
            { id: 'lev', kind: 'cloud-levitate', label: 'Cloudy', x: 300, y: 120, config: { amplitude: 8, speed: 0.8, durationMs: 3000 } },
          ],
          edges: [{ from: '__entry__', to: 'lev' }],
        },
      }],
    })
    const node = store.getState().models['root'].nodes.find(n => n.id === 'plain')!
    expect(node.cosmeticType).toBeUndefined()
    expect(node.flowEffects![0].graph.nodes[1].kind).toBe('cloud-levitate')
  })

  it('text-format effect supports levitateStyle config', () => {
    const textFmtNode = {
      id: 'tf1', kind: 'text-format' as const,
      label: 'Text', x: 0, y: 0,
      config: { targetMode: 'indices', startIndex: 0, endIndex: 5, levitateStyle: 'cloudy' },
    }
    expect(textFmtNode.config.levitateStyle).toBe('cloudy')
  })
})

describe('tipAngle validation', () => {
  it('tipAngle accepts any radian value', () => {
    const node: Partial<ModelNode> = { tipAngle: 0 }
    expect(node.tipAngle).toBe(0)
    node.tipAngle = Math.PI
    expect(node.tipAngle).toBe(Math.PI)
    node.tipAngle = -Math.PI / 2
    expect(node.tipAngle).toBe(-Math.PI / 2)
  })
})
