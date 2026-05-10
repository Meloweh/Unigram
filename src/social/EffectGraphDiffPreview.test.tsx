import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FlowEffect } from '../flow/types'
import { DEFAULT_NODE, type Model } from '../model/types'
import { EffectGraphDiffPreview } from './EffectGraphDiffPreview'

describe('EffectGraphDiffPreview', () => {
  it('renders the linked peer node pane even before cross-links exist', () => {
    const hostEffect: FlowEffect = {
      id: 'host-fx',
      label: 'Host FX',
      graph: {
        nodes: [{ id: '__entry__', kind: 'wait', x: 0, y: 0, params: { ms: 0 }, label: 'Start' }],
        edges: [],
      },
    }
    const peerEffect: FlowEffect = {
      id: 'peer-fx',
      label: 'Peer FX',
      graph: {
        nodes: [{ id: '__entry__', kind: 'move', x: 0, y: 0, params: { dx: 5, dy: 0, ms: 300 }, label: 'Move' }],
        edges: [],
      },
    }
    const model: Model = {
      id: 'root',
      name: 'Root',
      nodes: new Map([
        ['a', { ...DEFAULT_NODE, id: 'a', label: 'Host', x: 10, y: 10, linkedNodeIds: ['b'], flowEffects: [hostEffect] }],
        ['b', { ...DEFAULT_NODE, id: 'b', label: 'Peer', x: 30, y: 10, linkedNodeIds: ['a'], flowEffects: [peerEffect] }],
      ]),
      edges: new Map(),
    }

    render(
      <EffectGraphDiffPreview
        preview={{ nodeId: 'a', beforeEffects: [], afterEffects: [hostEffect], selectedEffectId: 'host-fx' }}
        model={model}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Host FX').length).toBeGreaterThan(0)
    expect(screen.getByText('Peer · Peer FX')).toBeInTheDocument()
    expect(screen.getByText('Move')).toBeInTheDocument()
  })

  it('renders model cross-links when preview metadata only selects linked panes', () => {
    const hostEffect: FlowEffect = {
      id: 'host-fx',
      label: 'Host FX',
      graph: {
        nodes: [{ id: 'out', kind: 'wait', x: 0, y: 0, params: { ms: 0 }, label: 'Out' }],
        edges: [],
      },
    }
    const peerEffect: FlowEffect = {
      id: 'peer-fx',
      label: 'Peer FX',
      graph: {
        nodes: [{ id: 'in', kind: 'move', x: 0, y: 0, params: { dx: 5, dy: 0, ms: 300 }, label: 'In' }],
        edges: [],
      },
    }
    const model: Model = {
      id: 'root',
      name: 'Root',
      nodes: new Map([
        ['a', { ...DEFAULT_NODE, id: 'a', label: 'Host', x: 10, y: 10, linkedNodeIds: ['b'], flowEffects: [hostEffect] }],
        ['b', { ...DEFAULT_NODE, id: 'b', label: 'Peer', x: 30, y: 10, linkedNodeIds: ['a'], flowEffects: [peerEffect] }],
      ]),
      edges: new Map(),
      crossLinks: [{
        id: 'xl',
        from: { nodeId: 'a', effectId: 'host-fx', effectNodeId: 'out' },
        to: { nodeId: 'b', effectId: 'peer-fx', effectNodeId: 'in' },
      }],
    }
    const { container } = render(
      <EffectGraphDiffPreview
        preview={{ nodeId: 'a', beforeEffects: [], afterEffects: [hostEffect], selectedEffectId: 'host-fx' }}
        model={model}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Peer · Peer FX')).toBeInTheDocument()
    expect(container.querySelectorAll('.effect-diff-cross-link')).toHaveLength(1)
    expect(screen.getByText('1 visible link')).toBeInTheDocument()
  })

  it('renders cross-links between effect nodes in the visible split panes', () => {
    const hostEffect: FlowEffect = {
      id: 'host-fx',
      label: 'New effect',
      graph: {
        nodes: [
          { id: '__entry__', kind: 'wait', x: 0, y: 0, params: { ms: 0 }, label: 'Wait' },
          { id: 'jitter-node', kind: 'jitter', x: 120, y: 180, params: { amplitude: 4, ms: 400 }, label: 'Jitter' },
        ],
        edges: [{ from: '__entry__', to: 'jitter-node' }],
      },
    }
    const peerEffect: FlowEffect = {
      id: 'peer-fx',
      label: 'New effect',
      graph: {
        nodes: [
          { id: '__entry__', kind: 'wait', x: 0, y: 0, params: { ms: 0 }, label: 'Wait' },
          { id: 'scale-node', kind: 'scale', x: 160, y: 360, params: { scale: 1.2, ms: 300 }, label: 'Scale' },
        ],
        edges: [],
      },
    }
    const model: Model = {
      id: 'root',
      name: 'Root',
      nodes: new Map([
        ['a', { ...DEFAULT_NODE, id: 'a', label: 'Host', x: 10, y: 10, linkedNodeIds: ['b'], flowEffects: [hostEffect] }],
        ['b', { ...DEFAULT_NODE, id: 'b', label: 'Peer', x: 30, y: 10, linkedNodeIds: ['a'], flowEffects: [peerEffect] }],
      ]),
      edges: new Map(),
      crossLinks: [{
        id: 'xl-jitter-scale',
        from: { nodeId: 'a', effectId: 'host-fx', effectNodeId: 'jitter-node' },
        to: { nodeId: 'b', effectId: 'peer-fx', effectNodeId: 'scale-node' },
      }],
    }
    const { container } = render(
      <EffectGraphDiffPreview
        preview={{ nodeId: 'a', beforeEffects: [], afterEffects: [hostEffect], selectedEffectId: 'host-fx' }}
        model={model}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Peer · New effect')).toBeInTheDocument()
    expect(screen.getByText('Jitter')).toBeInTheDocument()
    expect(screen.getByText('Scale')).toBeInTheDocument()
    expect(container.querySelectorAll('.effect-diff-cross-link')).toHaveLength(1)
    expect(screen.getByText('1 visible link')).toBeInTheDocument()
  })
})
