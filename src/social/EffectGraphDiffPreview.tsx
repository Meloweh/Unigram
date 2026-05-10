import { useId, useMemo, useState } from 'react'
import type { EffectEdge, EffectNode, FlowEffect, FlowEffectKind } from '../flow/types'
import type { CrossEffectLink, Model } from '../model/types'
import type { FlowPreviewData } from './proposalDisplay'

const NODE_W = 160
const NODE_H = 56
const MARGIN = 42
const PANE_GAP = 96
const ENTRY_NODE_ID = '__entry__'

type EffectStatus = 'added' | 'changed' | 'removed' | 'unchanged'
type PaneId = 'primary' | 'peer'

interface RenderNode {
  pane: PaneId
  effectId: string
  node: EffectNode
  status: EffectStatus
  x: number
  y: number
}

interface RenderEdge {
  pane: PaneId
  edge: EffectEdge
  status: EffectStatus
  x1: number
  y1: number
  x2: number
  y2: number
}

interface PaneLayout {
  effect: FlowEffect
  before?: FlowEffect
  after?: FlowEffect
  pane: PaneId
  title: string
  offsetX: number
  offsetY: number
  width: number
  height: number
  nodes: RenderNode[]
  edges: RenderEdge[]
}

const KIND_COLORS: Record<FlowEffectKind, string> = {
  wait: '#6366f1',
  move: '#10b981',
  scale: '#34d399',
  color: '#f59e0b',
  jitter: '#fb923c',
  float: '#67e8f9',
  emerge: '#a3e635',
  dismiss: '#fb923c',
  'cloud-levitate': '#94a3b8',
  'bubble-levitate': '#7dd3fc',
  repeater: '#facc15',
  camera: '#818cf8',
  break: '#f87171',
  'text-format': '#e879f9',
  'text-generator': '#c084fc',
  record: '#dc2626',
  'obs-record': '#ef4444',
  'handoff-rmm': '#a78bfa',
  'return-rmm': '#c084fc',
  'handoff-mpd': '#2dd4bf',
  spawn: '#ec4899',
  'spawn-circular': '#f472b6',
  expand: '#22c55e',
  collapse: '#ef4444',
}

const KIND_LABELS: Record<FlowEffectKind, string> = {
  wait: 'Wait',
  move: 'Move',
  scale: 'Scale',
  color: 'Color',
  jitter: 'Jitter',
  float: 'Float',
  emerge: 'Emerge',
  dismiss: 'Dismiss',
  'cloud-levitate': 'Cloudy Levitate',
  'bubble-levitate': 'Soap Bubble Levitate',
  repeater: 'Repeater',
  camera: 'Camera',
  break: 'Break Apart',
  'text-format': 'Text Format',
  'text-generator': 'Text Generator',
  record: 'Record',
  'obs-record': 'OBS Record',
  'handoff-rmm': 'Handoff to RMM',
  'return-rmm': 'Return from RMM',
  'handoff-mpd': 'Handoff to MPD',
  spawn: 'Spawn',
  'spawn-circular': 'Spawn Circular',
  expand: 'Expand',
  collapse: 'Collapse',
}

export function EffectGraphDiffPreview({
  preview,
  model,
  onClose,
}: {
  preview: FlowPreviewData
  model: Model
  onClose: () => void
}) {
  const markerId = useId().replace(/[^a-z0-9_-]/gi, '')
  const initialEffectId = preview.selectedEffectId ?? preview.afterEffects[0]?.id ?? preview.beforeEffects[0]?.id ?? ''
  const [selectedEffectId, setSelectedEffectId] = useState(initialEffectId)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)

  const data = useMemo(
    () => buildPreviewLayout(preview, model, selectedEffectId),
    [model, preview, selectedEffectId],
  )
  const selectedNode = data.nodes.find((node) => nodeKey(node) === selectedNodeKey) ?? data.nodes.find((node) => node.pane === 'primary') ?? data.nodes[0]
  const selectedBefore = selectedNode ? data.beforeNode(selectedNode) : null
  const selectedAfter = selectedNode ? data.afterNode(selectedNode) : null

  return (
    <div className="effect-diff-preview" role="dialog" aria-label="Effect graph preview">
      <header>
        <button type="button" className="social-thread-back" onClick={onClose}>Back</button>
        <div>
          <h3>Effect graph preview</h3>
          <p>{data.title}</p>
        </div>
      </header>
      <div className="effect-diff-preview-body">
        <div className="effect-diff-canvas-wrap">
          <svg className="effect-diff-canvas" viewBox={`0 0 ${data.width} ${data.height}`} role="img" aria-label="Projected effect graph changes">
            <defs>
              <pattern id={`effect-grid-${markerId}`} width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="14" cy="14" r="1" fill="rgba(80, 125, 166, 0.28)" />
              </pattern>
              <marker id={`effect-arrow-${markerId}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
              </marker>
            </defs>
            <rect width={data.width} height={data.height} fill={`url(#effect-grid-${markerId})`} />
            {data.panes.map((pane) => (
              <g key={pane.pane}>
                <text className="effect-diff-pane-title" x={pane.offsetX} y={24}>{pane.title}</text>
                {pane.edges.map((edge) => (
                  <path
                    key={`${pane.pane}-${edgeKey(edge.edge)}-${edge.status}`}
                    className={`effect-diff-wire ${edge.status}`}
                    d={curvePath(edge.x1, edge.y1, edge.x2, edge.y2)}
                    markerEnd={`url(#effect-arrow-${markerId})`}
                  />
                ))}
                {pane.nodes.map((node) => (
                  <g
                    key={nodeKey(node)}
                    className={`effect-diff-node ${node.status} ${nodeKey(node) === selectedNodeKey ? 'selected' : ''}`}
                    transform={`translate(${node.x},${node.y})`}
                    onClick={() => setSelectedNodeKey(nodeKey(node))}
                  >
                    <rect width={NODE_W} height={NODE_H} rx={node.node.id === ENTRY_NODE_ID ? 28 : 8} />
                    <text className="effect-diff-kind" x={NODE_W / 2} y={22} fill={KIND_COLORS[node.node.kind]}>
                      {node.node.id === ENTRY_NODE_ID ? 'SIGNAL IN' : KIND_LABELS[node.node.kind].toUpperCase()}
                    </text>
                    <text className="effect-diff-label" x={NODE_W / 2} y={40}>
                      {node.node.label?.trim() || KIND_LABELS[node.node.kind]}
                    </text>
                  </g>
                ))}
              </g>
            ))}
            {data.crossLinks.map((link) => (
              <path
                key={link.id}
                className={`effect-diff-cross-link ${link.status}`}
                d={curvePath(link.x1, link.y1, link.x2, link.y2)}
                markerEnd={`url(#effect-arrow-${markerId})`}
              />
            ))}
          </svg>
        </div>
        <aside className="effect-diff-inspector" aria-label="Effect change inspector">
          <section>
            <h4>Effects</h4>
            <div className="effect-diff-effect-list">
              {data.effectChoices.map((effect) => (
                <button
                  key={effect.id}
                  type="button"
                  className={effect.id === selectedEffectId ? 'active' : ''}
                  onClick={() => {
                    setSelectedEffectId(effect.id)
                    setSelectedNodeKey(null)
                  }}
                >
                  {effect.label || effect.id}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Changes</h4>
            <div className="effect-diff-change-list">
              {data.nodes.map((node) => (
                <button
                  key={nodeKey(node)}
                  type="button"
                  className={nodeKey(node) === nodeKey(selectedNode) ? 'active' : ''}
                  onClick={() => setSelectedNodeKey(nodeKey(node))}
                >
                  <span>{statusLabel(node.status)}</span>
                  {KIND_LABELS[node.node.kind]} {node.node.label ? `· ${node.node.label}` : ''}
                </button>
              ))}
            </div>
          </section>
          <section className="effect-diff-settings">
            <h4>Settings</h4>
            {selectedNode ? (
              <EffectNodeSettings before={selectedBefore} after={selectedAfter} status={selectedNode.status} />
            ) : (
              <p>No effect node selected.</p>
            )}
          </section>
          <section className="effect-diff-settings">
            <h4>Cross-links</h4>
            <p>{data.crossLinks.length} visible {data.crossLinks.length === 1 ? 'link' : 'links'}</p>
          </section>
        </aside>
      </div>
    </div>
  )
}

function EffectNodeSettings({
  before,
  after,
  status,
}: {
  before: EffectNode | null
  after: EffectNode | null
  status: EffectStatus
}) {
  const node = after ?? before
  if (!node) return null
  const beforeParams = before?.params ?? {}
  const afterParams = after?.params ?? {}
  const paramKeys = [...new Set([...Object.keys(beforeParams), ...Object.keys(afterParams)])].sort()
  return (
    <dl>
      <div>
        <dt>Status</dt>
        <dd>{statusLabel(status)}</dd>
      </div>
      <div>
        <dt>Kind</dt>
        <dd>{KIND_LABELS[node.kind]}</dd>
      </div>
      <div>
        <dt>Label</dt>
        <dd>{formatBeforeAfter(before?.label ?? '', after?.label ?? '')}</dd>
      </div>
      {paramKeys.map((key) => (
        <div key={key}>
          <dt>{labelize(key)}</dt>
          <dd>{formatBeforeAfter(beforeParams[key], afterParams[key])}</dd>
        </div>
      ))}
      {node.kind === 'spawn' && (
        <div>
          <dt>Spawn items</dt>
          <dd>{formatBeforeAfter(before?.spawnItems?.length ?? 0, after?.spawnItems?.length ?? 0)}</dd>
        </div>
      )}
    </dl>
  )
}

function buildPreviewLayout(preview: FlowPreviewData, model: Model, selectedEffectId: string) {
  const effectsById = new Map<string, FlowEffect>()
  for (const effect of preview.beforeEffects) effectsById.set(effect.id, effect)
  for (const effect of preview.afterEffects) effectsById.set(effect.id, effect)
  const effectChoices = [...effectsById.values()]
  const effectId = selectedEffectId && effectsById.has(selectedEffectId)
    ? selectedEffectId
    : effectChoices[0]?.id ?? ''
  const before = preview.beforeEffects.find((effect) => effect.id === effectId)
  const after = preview.afterEffects.find((effect) => effect.id === effectId)
  const primaryEffect = after ?? before ?? emptyEffect(effectId)
  const peer = resolvePeerEffect(preview, model, effectId)
  const primaryBounds = effectBounds(primaryEffect, before)
  const peerBounds = peer ? effectBounds(peer.effect) : { width: 0, height: 0, minX: 0, minY: 0 }
  const primaryWidth = Math.max(420, primaryBounds.width + MARGIN * 2)
  const primaryHeight = Math.max(360, primaryBounds.height + MARGIN * 2)
  const peerWidth = peer ? Math.max(420, peerBounds.width + MARGIN * 2) : 0
  const height = Math.max(420, primaryHeight, peer ? peerBounds.height + MARGIN * 2 : 0)
  const primaryPane = buildPaneLayout({
    pane: 'primary',
    title: primaryEffect.label || 'Effect graph',
    effect: primaryEffect,
    before,
    after,
    offsetX: MARGIN - primaryBounds.minX,
    offsetY: MARGIN - primaryBounds.minY + 18,
  })
  const panes = [primaryPane]
  let peerPane: PaneLayout | null = null
  if (peer) {
    peerPane = buildPaneLayout({
      pane: 'peer',
      title: `${peer.nodeLabel} · ${peer.effect.label || peer.effect.id}`,
      effect: peer.effect,
      offsetX: primaryWidth + PANE_GAP + MARGIN - peerBounds.minX,
      offsetY: MARGIN - peerBounds.minY + 18,
    })
    panes.push(peerPane)
  }
  const nodes = panes.flatMap((pane) => pane.nodes)
  const crossLinks = peer && peerPane
    ? buildCrossLinkLines(preview, model, preview.nodeId, primaryPane, peerPane, peer.nodeId)
    : []
  return {
    title: primaryEffect.label || effectId || 'Flow effect',
    width: Math.max(520, primaryWidth + (peer ? PANE_GAP + peerWidth : 0)),
    height,
    panes,
    nodes,
    crossLinks,
    effectChoices,
    beforeNode: (renderNode: RenderNode) => {
      const pane = renderNode.pane === 'primary' ? primaryPane : peerPane
      return pane?.before?.graph.nodes.find((node) => node.id === renderNode.node.id) ?? null
    },
    afterNode: (renderNode: RenderNode) => {
      const pane = renderNode.pane === 'primary' ? primaryPane : peerPane
      return pane?.after?.graph.nodes.find((node) => node.id === renderNode.node.id) ?? (renderNode.status === 'removed' ? null : renderNode.node)
    },
  }
}

function buildPaneLayout(input: {
  pane: PaneId
  title: string
  effect: FlowEffect
  before?: FlowEffect
  after?: FlowEffect
  offsetX: number
  offsetY: number
}): PaneLayout {
  const nodeStatus = diffNodes(input.before, input.after, input.effect)
  const nodes = [...nodeStatus.values()].map((item) => ({
    pane: input.pane,
    effectId: input.effect.id,
    node: item.node,
    status: item.status,
    x: item.node.x + input.offsetX,
    y: item.node.y + input.offsetY,
  }))
  const nodeIndex = new Map(nodes.map((node) => [node.node.id, node]))
  const edges = diffEdges(input.before, input.after, input.effect)
    .map((item): RenderEdge | null => {
      const from = nodeIndex.get(item.edge.from)
      const to = nodeIndex.get(item.edge.to)
      if (!from || !to) return null
      const a = portPosition(from, 'out', item.edge.fromPort)
      const b = portPosition(to, 'in', item.edge.toPort)
      return { pane: input.pane, edge: item.edge, status: item.status, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    })
    .filter((edge): edge is RenderEdge => edge != null)
  const bounds = effectBounds(input.effect, input.before)
  return {
    ...input,
    width: bounds.width,
    height: bounds.height,
    nodes,
    edges,
  }
}

function diffNodes(before: FlowEffect | undefined, after: FlowEffect | undefined, fallback: FlowEffect): Map<string, { node: EffectNode; status: EffectStatus }> {
  const beforeNodes = new Map((before?.graph.nodes ?? []).map((node) => [node.id, node]))
  const afterNodes = new Map((after?.graph.nodes ?? []).map((node) => [node.id, node]))
  const visibleNodes = after ? afterNodes : new Map(fallback.graph.nodes.map((node) => [node.id, node]))
  const result = new Map<string, { node: EffectNode; status: EffectStatus }>()
  for (const [id, node] of visibleNodes) {
    const old = beforeNodes.get(id)
    const status: EffectStatus = !old ? 'added' : JSON.stringify(old) !== JSON.stringify(node) ? 'changed' : 'unchanged'
    result.set(id, { node, status })
  }
  for (const [id, node] of beforeNodes) {
    if (!visibleNodes.has(id)) result.set(id, { node, status: 'removed' })
  }
  return result
}

function diffEdges(before: FlowEffect | undefined, after: FlowEffect | undefined, fallback: FlowEffect): Array<{ edge: EffectEdge; status: EffectStatus }> {
  const beforeEdges = new Map((before?.graph.edges ?? []).map((edge) => [edgeKey(edge), edge]))
  const afterEdges = new Map((after?.graph.edges ?? []).map((edge) => [edgeKey(edge), edge]))
  const visibleEdges = after ? afterEdges : new Map(fallback.graph.edges.map((edge) => [edgeKey(edge), edge]))
  const result: Array<{ edge: EffectEdge; status: EffectStatus }> = []
  for (const [key, edge] of visibleEdges) {
    result.push({ edge, status: beforeEdges.has(key) ? 'unchanged' : 'added' })
  }
  for (const [key, edge] of beforeEdges) {
    if (!visibleEdges.has(key)) result.push({ edge, status: 'removed' })
  }
  return result
}

function buildCrossLinkLines(
  preview: FlowPreviewData,
  model: Model,
  hostNodeId: string,
  primaryPane: PaneLayout,
  peerPane: PaneLayout,
  peerNodeId: string,
): Array<{ id: string; status: EffectStatus; x1: number; y1: number; x2: number; y2: number }> {
  const { before, after } = crossLinkMaps(preview, model)
  const all = new Map([...before, ...after])
  const lines: Array<{ id: string; status: EffectStatus; x1: number; y1: number; x2: number; y2: number }> = []
  for (const [id, link] of all) {
    const status: EffectStatus = !before.has(id) ? 'added' : !after.has(id) ? 'removed' : JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)) ? 'changed' : 'unchanged'
    const endpoints = crossLinkEndpoints(link, hostNodeId, primaryPane, peerPane, peerNodeId)
    if (endpoints) lines.push({ id, status, ...endpoints })
  }
  return lines
}

function crossLinkEndpoints(
  link: CrossEffectLink,
  hostNodeId: string,
  primaryPane: PaneLayout,
  peerPane: PaneLayout,
  peerNodeId: string,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const primaryFrom = link.from.nodeId === hostNodeId
  const primaryTo = link.to.nodeId === hostNodeId
  const peerFrom = link.from.nodeId === peerNodeId
  const peerTo = link.to.nodeId === peerNodeId
  if (!((primaryFrom && peerTo) || (peerFrom && primaryTo))) return null
  const fromPane = primaryFrom ? primaryPane : peerPane
  const toPane = primaryTo ? primaryPane : peerPane
  const from = effectNodeForLink(fromPane, link.from.effectNodeId)
  const to = effectNodeForLink(toPane, link.to.effectNodeId)
  if (!from || !to) return null
  const a = portPosition(from, 'out')
  const b = portPosition(to, 'in')
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

function resolvePeerEffect(preview: FlowPreviewData, model: Model, effectId: string): { nodeId: string; nodeLabel: string; effect: FlowEffect } | null {
  const links = allCrossLinks(preview, model)
  for (const link of links) {
    const sourceIsHost = link.from.nodeId === preview.nodeId && link.from.effectId === effectId
    const targetIsHost = link.to.nodeId === preview.nodeId && link.to.effectId === effectId
    if (!sourceIsHost && !targetIsHost) continue
    const peerRef = sourceIsHost ? link.to : link.from
    const peerNode = model.nodes.get(peerRef.nodeId)
    const effect = peerNode?.flowEffects?.find((item) => item.id === peerRef.effectId) ?? placeholderEffect(peerRef.effectId, peerRef.effectNodeId)
    return { nodeId: peerRef.nodeId, nodeLabel: peerNode?.label || peerRef.nodeId, effect }
  }
  const hostNode = model.nodes.get(preview.nodeId)
  const peerNodeId = hostNode?.linkedNodeIds?.[0]
  const peerNode = peerNodeId ? model.nodes.get(peerNodeId) : null
  if (peerNodeId && peerNode) {
    const effect = peerNode.flowEffects?.[0] ?? placeholderEffect(`linked-${peerNodeId}`)
    return { nodeId: peerNodeId, nodeLabel: peerNode.label || peerNodeId, effect }
  }
  return null
}

function allCrossLinks(preview: FlowPreviewData, model: Model): CrossEffectLink[] {
  const { before, after } = crossLinkMaps(preview, model)
  const links = new Map<string, CrossEffectLink>()
  for (const link of before.values()) links.set(link.id, link)
  for (const link of after.values()) links.set(link.id, link)
  return [...links.values()]
}

function crossLinkMaps(
  preview: FlowPreviewData,
  model: Model,
): { before: Map<string, CrossEffectLink>; after: Map<string, CrossEffectLink> } {
  if (preview.crossLinksBefore === undefined && preview.crossLinksAfter === undefined) {
    const links = model.crossLinks ?? []
    return {
      before: new Map(links.map((link) => [link.id, link])),
      after: new Map(links.map((link) => [link.id, link])),
    }
  }
  return {
    before: new Map((preview.crossLinksBefore ?? []).map((link) => [link.id, link])),
    after: new Map((preview.crossLinksAfter ?? []).map((link) => [link.id, link])),
  }
}

function effectNodeForLink(pane: PaneLayout, nodeId?: string): RenderNode | null {
  if (nodeId) return pane.nodes.find((node) => node.node.id === nodeId) ?? null
  return pane.nodes.find((node) => node.node.id === ENTRY_NODE_ID) ?? pane.nodes[0] ?? null
}

function effectBounds(effect: FlowEffect, extra?: FlowEffect): { minX: number; minY: number; width: number; height: number } {
  const nodes = [...effect.graph.nodes, ...(extra?.graph.nodes ?? [])]
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 320, height: 220 }
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + NODE_W))
  const maxY = Math.max(...nodes.map((node) => node.y + NODE_H))
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

function portPosition(node: RenderNode, side: 'in' | 'out', port: 'default' | 'circuit' = 'default'): { x: number; y: number } {
  const isRepeater = node.node.kind === 'repeater'
  const xLocal = isRepeater
    ? (port === 'circuit' ? NODE_W * 0.75 : NODE_W * 0.25)
    : NODE_W / 2
  const yLocal = side === 'out' ? NODE_H : 0
  return { x: node.x + xLocal, y: node.y + yLocal }
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

function edgeKey(edge: EffectEdge): string {
  return `${edge.from}:${edge.fromPort ?? 'default'}->${edge.to}:${edge.toPort ?? 'default'}`
}

function nodeKey(node: RenderNode | undefined): string {
  return node ? `${node.pane}:${node.effectId}:${node.node.id}` : ''
}

function emptyEffect(id: string): FlowEffect {
  return { id: id || 'effect', label: id || 'Effect', graph: { nodes: [], edges: [] } }
}

function placeholderEffect(effectId: string, effectNodeId?: string): FlowEffect {
  const nodeId = effectNodeId ?? ENTRY_NODE_ID
  return {
    id: effectId,
    label: effectId || 'Linked effect',
    graph: {
      nodes: [{
        id: nodeId,
        kind: 'wait',
        x: 0,
        y: 0,
        params: { ms: 0 },
        label: nodeId === ENTRY_NODE_ID ? 'Signal in' : nodeId,
      }],
      edges: [],
    },
  }
}

function statusLabel(status: EffectStatus): string {
  switch (status) {
    case 'added': return 'Added'
    case 'changed': return 'Changed'
    case 'removed': return 'Removed'
    case 'unchanged': return 'Unchanged'
  }
}

function formatBeforeAfter(before: unknown, after: unknown): string {
  const beforeText = formatValue(before)
  const afterText = formatValue(after)
  if (beforeText === afterText) return afterText
  if (!beforeText) return afterText
  if (!afterText) return `${beforeText} -> none`
  return `${beforeText} -> ${afterText}`
}

function formatValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number') return String(Math.round(value * 100) / 100)
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function labelize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}
