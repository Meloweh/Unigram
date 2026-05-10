import { DEFAULT_EDGE, DEFAULT_NODE, type Connection, type CrossEffectLink, type Model, type ModelNode } from '../model/types'
import type { FlowEffect } from '../flow/types'
import type { EntityPatch, GraphProposalStep, TransformProposalEntry } from './forumTypes'

export interface ChangeTarget {
  kind: 'node' | 'edge' | 'transform'
  id: string
}

export interface ChangeDetail {
  id: string
  label: string
  before?: string
  after?: string
  target?: ChangeTarget
  lines?: string[]
  flowPreview?: FlowPreviewData
}

export interface ChangeGroup {
  id: string
  title: string
  action: GraphProposalStep['action']
  target?: ChangeTarget
  details: ChangeDetail[]
  defaultExpanded: boolean
}

export interface FlowPreviewData {
  nodeId: string
  beforeEffects: FlowEffect[]
  afterEffects: FlowEffect[]
  selectedEffectId?: string
  crossLinksBefore?: CrossEffectLink[]
  crossLinksAfter?: CrossEffectLink[]
}

export function changeGroupsForSteps(
  steps: readonly GraphProposalStep[],
  model: Model,
  models: ReadonlyMap<string, Model> = new Map([[model.id, model]]),
): ChangeGroup[] {
  return steps.map((step, index) => changeGroupForStep(step, index, model, models))
}

export function changeGroupForStep(
  step: GraphProposalStep,
  index: number,
  model: Model,
  models: ReadonlyMap<string, Model> = new Map([[model.id, model]]),
): ChangeGroup {
  const nodeName = (id: string) => model.nodes.get(id)?.label.trim() || id
  const edgeName = (id: string) => {
    const edge = model.edges.get(id)
    return edge ? `${nodeName(edge.from)} -> ${nodeName(edge.to)}` : id
  }
  const id = `${index + 1}-${step.action}`
  switch (step.action) {
    case 'add-node': {
      const node = step.node
      const nodeId = step.nodeId ?? `proposal-node-${index + 1}`
      const title = `Add node "${step.newNodeLabel}"`
      return withDefaults({
        id,
        title,
        action: step.action,
        target: { kind: 'node', id: nodeId },
        details: node
          ? nodeSnapshotDetails(node, model, models, nodeId)
          : [
            detail('shape', 'Shape', undefined, labelize(step.shape ?? DEFAULT_NODE.shape), { kind: 'node', id: nodeId }),
            detail('geometry', 'Geometry', undefined, geometryLabel(step.geometry), { kind: 'node', id: nodeId }),
          ],
      })
    }
    case 'add-node-edge': {
      const nodeId = step.nodeId ?? `proposal-node-${index + 1}`
      const edgeId = step.edgeId ?? `proposal-edge-${index + 1}`
      return withDefaults({
        id,
        title: `Add "${step.newNodeLabel}" from ${nodeName(step.sourceNodeId)}`,
        action: step.action,
        target: { kind: 'node', id: nodeId },
        details: [
          ...(step.node ? nodeSnapshotDetails(step.node, model, models, nodeId) : []),
          ...edgeSnapshotDetails(step.edge ?? {
          ...DEFAULT_EDGE,
          id: edgeId,
          from: step.sourceNodeId,
          to: nodeId,
        }, { kind: 'edge', id: edgeId }),
        ],
      })
    }
    case 'add-edge': {
      const edgeId = step.edgeId ?? `proposal-edge-${index + 1}`
      return withDefaults({
        id,
        title: `Connect ${nodeName(step.sourceNodeId)} -> ${nodeName(step.targetNodeId)}`,
        action: step.action,
        target: { kind: 'edge', id: edgeId },
        details: edgeSnapshotDetails({
          ...DEFAULT_EDGE,
          ...(step.edge ?? {}),
          ...(step.style ?? {}),
          id: edgeId,
          from: step.sourceNodeId,
          to: step.targetNodeId,
          ...(step.label ? { label: step.label } : {}),
          ...(step.references ? { references: step.references } : {}),
        }, { kind: 'edge', id: edgeId }),
      })
    }
    case 'add-rmm':
      return withDefaults({
        id,
        title: `Add RMM "${step.name}" to ${nodeName(step.nodeId)}`,
        action: step.action,
        target: { kind: 'node', id: step.nodeId },
        details: [detail('rmm', 'RMM dimension', undefined, step.externalLink ? `${step.name} (linked graph)` : step.name, { kind: 'node', id: step.nodeId })],
      })
    case 'add-mpd':
      return withDefaults({
        id,
        title: `Add MPD "${step.name}" to ${nodeName(step.nodeId)}`,
        action: step.action,
        target: { kind: 'node', id: step.nodeId },
        details: [detail('mpd', 'MPD dimension', undefined, step.externalLink ? `${step.name} (linked graph)` : step.name, { kind: 'node', id: step.nodeId })],
      })
    case 'remove-edge':
      return withDefaults({ id, title: `Remove ${edgeName(step.edgeId)}`, action: step.action, target: { kind: 'edge', id: step.edgeId }, details: [] })
    case 'remove-node':
      return withDefaults({ id, title: `Remove ${nodeName(step.nodeId)}`, action: step.action, target: { kind: 'node', id: step.nodeId }, details: [] })
    case 'rename-node':
      return withDefaults({
        id,
        title: `Rename ${nodeName(step.nodeId)} to "${step.nextLabel}"`,
        action: step.action,
        target: { kind: 'node', id: step.nodeId },
        details: [detail('label', 'Label', nodeName(step.nodeId), step.nextLabel, { kind: 'node', id: step.nodeId })],
      })
    case 'rename-edge':
      return withDefaults({
        id,
        title: `Rename ${edgeName(step.edgeId)} to "${step.nextLabel}"`,
        action: step.action,
        target: { kind: 'edge', id: step.edgeId },
        details: [detail('label', 'Label', model.edges.get(step.edgeId)?.label ?? '', step.nextLabel, { kind: 'edge', id: step.edgeId })],
      })
    case 'rewire-edge':
      return withDefaults({
        id,
        title: `Rewire ${edgeName(step.edgeId)} to ${nodeName(step.nextTargetNodeId)}`,
        action: step.action,
        target: { kind: 'edge', id: step.edgeId },
        details: [detail('target', 'Target', model.edges.get(step.edgeId)?.to, step.nextTargetNodeId, { kind: 'edge', id: step.edgeId })],
      })
    case 'commit-transform':
      return withDefaults({
        id,
        title: `Commit ${step.transforms.length} layout ${step.transforms.length === 1 ? 'change' : 'changes'}`,
        action: step.action,
        target: transformTarget(step.transforms),
        details: step.transforms.map((entry, i) => transformDetail(entry, i)),
      })
    case 'add-reference':
      return withDefaults({
        id,
        title: `Add reference to ${edgeName(step.edgeId)}`,
        action: step.action,
        target: { kind: 'edge', id: step.edgeId },
        details: [detail('reference', 'Reference', undefined, referenceLabel(step.reference), { kind: 'edge', id: step.edgeId })],
      })
    case 'modify-references':
      return withDefaults({
        id,
        title: `Modify references on ${edgeName(step.edgeId)}`,
        action: step.action,
        target: { kind: 'edge', id: step.edgeId },
        details: [detail('references', 'References', referenceCount(model.edges.get(step.edgeId)?.references), referenceCount(step.references), { kind: 'edge', id: step.edgeId })],
      })
    case 'update-node-settings':
      return withDefaults({
        id,
        title: `Update settings on ${nodeName(step.nodeId)}`,
        action: step.action,
        target: { kind: 'node', id: step.nodeId },
        details: patchDetails(step.before, step.after, { kind: 'node', id: step.nodeId }),
      })
    case 'update-node-media':
      return withDefaults({
        id,
        title: `Update media on ${nodeName(step.nodeId)}`,
        action: step.action,
        target: { kind: 'node', id: step.nodeId },
        details: patchDetails(step.before, step.after, { kind: 'node', id: step.nodeId }),
      })
    case 'update-flow-effects':
      return withDefaults({
        id,
        title: `Update flow effects on ${nodeName(step.nodeId)}`,
        action: step.action,
        target: { kind: 'node', id: step.nodeId },
        details: flowEffectDiffDetails(
          step.before?.flowEffects as FlowEffect[] | null | undefined,
          step.after.flowEffects as FlowEffect[] | null | undefined,
          { kind: 'node', id: step.nodeId },
          step.crossLinksBefore,
          step.crossLinksAfter,
          step.before?.linkedNodeIds as string[] | null | undefined,
          step.after.linkedNodeIds as string[] | null | undefined,
        ),
      })
    case 'update-edge-settings':
      return withDefaults({
        id,
        title: `Update settings on ${edgeName(step.edgeId)}`,
        action: step.action,
        target: { kind: 'edge', id: step.edgeId },
        details: patchDetails(step.before, step.after, { kind: 'edge', id: step.edgeId }),
      })
  }
}

function withDefaults(group: Omit<ChangeGroup, 'defaultExpanded'>): ChangeGroup {
  return { ...group, defaultExpanded: group.details.length > 1 }
}

function detail(
  id: string,
  label: string,
  before: unknown,
  after: unknown,
  target?: ChangeTarget,
  lines?: string[],
  flowPreview?: FlowPreviewData,
): ChangeDetail {
  return {
    id,
    label,
    ...(before !== undefined ? { before: formatValue(before) } : {}),
    ...(after !== undefined ? { after: formatValue(after) } : {}),
    ...(target ? { target } : {}),
    ...(lines && lines.length > 0 ? { lines } : {}),
    ...(flowPreview ? { flowPreview } : {}),
  }
}

function nodeSnapshotDetails(
  node: ModelNode,
  model: Model,
  models: ReadonlyMap<string, Model>,
  nodeId: string,
): ChangeDetail[] {
  const target = { kind: 'node', id: nodeId } as const
  const details: ChangeDetail[] = [
    detail('type', 'Node type', undefined, nodeTypeLabel(node), target),
    detail('shape', 'Shape', undefined, labelize(node.shape), target),
    detail('geometry', 'Geometry', undefined, geometryLabel(node), target),
  ]
  if (node.label.trim()) details.push(detail('label', 'Label', undefined, node.label.trim(), target))
  if (node.cellColor !== DEFAULT_NODE.cellColor) details.push(detail('cellColor', 'Fill color', undefined, node.cellColor, target))
  if (node.membraneColor !== DEFAULT_NODE.membraneColor) details.push(detail('membraneColor', 'Border color', undefined, node.membraneColor, target))
  if (node.hideDuringFlow) details.push(detail('hideDuringFlow', 'Hide while flow plays', undefined, true, target))
  if (node.cameraTracked) details.push(detail('cameraTracked', 'Tracked by camera', undefined, true, target))
  if (node.locked) details.push(detail('locked', 'Locked', undefined, true, target))
  if (node.tipAngle != null) details.push(detail('tipAngle', 'Tip angle', undefined, `${round(node.tipAngle)} rad`, target))
  if (node.tipLength != null) details.push(detail('tipLength', 'Tip length', undefined, round(node.tipLength), target))
  if (node.mediaType) details.push(detail('media', 'Media', undefined, mediaLabel(node), target))
  if (node.childModelId) details.push(detail('rmm', 'RMM dimension', undefined, modelLabel(models, node.childModelId, node.externalRmmLink?.diagramTitle), target))
  for (const dimensionId of node.mpdDimensions ?? []) {
    if (dimensionId === model.id || dimensionId === node.childModelId) continue
    details.push(detail(`mpd-${dimensionId}`, 'MPD dimension', undefined, modelLabel(models, dimensionId, node.externalMpdLinks?.[dimensionId]?.diagramTitle), target))
  }
  if (node.textFormats?.length) details.push(detail('textFormats', 'Text formatting', undefined, `${node.textFormats.length} ranges`, target))
  details.push(...flowEffectAddedDetails(node.flowEffects, target))
  return details
}

function edgeSnapshotDetails(edge: Connection, target: ChangeTarget): ChangeDetail[] {
  const details: ChangeDetail[] = [
    detail('endpoints', 'Endpoints', undefined, `${edge.from} -> ${edge.to}`, target),
  ]
  if (edge.label) details.push(detail('label', 'Label', undefined, edge.label, target))
  if (edge.kind && edge.kind !== DEFAULT_EDGE.kind) details.push(detail('kind', 'Connection type', undefined, edge.kind, target))
  if (edge.dash && edge.dash !== DEFAULT_EDGE.dash) details.push(detail('dash', 'Dash style', undefined, edge.dash, target))
  if (edge.arrowStyle && edge.arrowStyle !== DEFAULT_EDGE.arrowStyle) details.push(detail('arrowStyle', 'Arrow style', undefined, edge.arrowStyle, target))
  if (edge.color !== DEFAULT_EDGE.color) details.push(detail('color', 'Color', undefined, edge.color, target))
  if (edge.width !== DEFAULT_EDGE.width) details.push(detail('width', 'Width', undefined, edge.width, target))
  if (edge.cameraTracked) details.push(detail('cameraTracked', 'Tracked by camera', undefined, true, target))
  if (edge.references?.length) details.push(detail('references', 'References', undefined, referenceCount(edge.references), target))
  return details
}

function patchDetails<T extends object>(
  before: EntityPatch<T> | undefined,
  after: EntityPatch<T>,
  target: ChangeTarget,
): ChangeDetail[] {
  const details: ChangeDetail[] = []
  for (const key of Object.keys(after as Record<string, unknown>)) {
    details.push(detail(key, fieldLabel(key), (before as Record<string, unknown> | undefined)?.[key], (after as Record<string, unknown>)[key], target))
  }
  return details
}

function flowEffectAddedDetails(effects: FlowEffect[] | undefined, target: ChangeTarget): ChangeDetail[] {
  if (!effects?.length) return []
  return effects.map((effect, index) => detail(
    `flow-${effect.id || index}`,
    'Flow effect',
    undefined,
    flowEffectSummary(effect),
    target,
    undefined,
    {
      nodeId: target.id,
      beforeEffects: [],
      afterEffects: effects,
      selectedEffectId: effect.id,
    },
  ))
}

function flowEffectDiffDetails(
  before: FlowEffect[] | null | undefined,
  after: FlowEffect[] | null | undefined,
  target: ChangeTarget,
  crossLinksBefore: CrossEffectLink[] | undefined,
  crossLinksAfter: CrossEffectLink[] | undefined,
  linkedNodeIdsBefore?: string[] | null,
  linkedNodeIdsAfter?: string[] | null,
): ChangeDetail[] {
  const beforeEffects = before ?? []
  const afterEffects = after ?? []
  const previous = new Map(beforeEffects.map((effect, index) => [effect.id || `before-${index}`, effect]))
  const next = new Map(afterEffects.map((effect, index) => [effect.id || `after-${index}`, effect]))
  const details: ChangeDetail[] = []
  for (const [id, effect] of next) {
    const old = previous.get(id)
    if (!old) {
      details.push(detail(
        `flow-add-${id}`,
        'Added effect',
        undefined,
        flowEffectSummary(effect),
        target,
        undefined,
        {
          nodeId: target.id,
          beforeEffects,
          afterEffects,
          selectedEffectId: effect.id,
          crossLinksBefore,
          crossLinksAfter,
        },
      ))
    } else if (JSON.stringify(old) !== JSON.stringify(effect)) {
      details.push(detail(
        `flow-change-${id}`,
        'Changed effect',
        flowEffectSummary(old),
        flowEffectSummary(effect),
        target,
        undefined,
        {
          nodeId: target.id,
          beforeEffects,
          afterEffects,
          selectedEffectId: effect.id,
          crossLinksBefore,
          crossLinksAfter,
        },
      ))
    }
  }
  for (const [id, effect] of previous) {
    if (!next.has(id)) {
      details.push(detail(
        `flow-remove-${id}`,
        'Removed effect',
        flowEffectSummary(effect),
        undefined,
        target,
        undefined,
        {
          nodeId: target.id,
          beforeEffects,
          afterEffects,
          selectedEffectId: effect.id,
          crossLinksBefore,
          crossLinksAfter,
        },
      ))
    }
  }
  if (crossLinksBefore || crossLinksAfter) {
    const linkedEffectId = firstCrossLinkedEffectId(target.id, beforeEffects, afterEffects, crossLinksBefore, crossLinksAfter)
    details.push(detail(
      'crossLinks',
      'Cross-links',
      `${crossLinksBefore?.length ?? 0}`,
      `${crossLinksAfter?.length ?? 0}`,
      target,
      undefined,
      {
        nodeId: target.id,
        beforeEffects,
        afterEffects,
        selectedEffectId: linkedEffectId,
        crossLinksBefore,
        crossLinksAfter,
      },
    ))
  }
  if (JSON.stringify(linkedNodeIdsBefore ?? []) !== JSON.stringify(linkedNodeIdsAfter ?? [])) {
    details.push(detail(
      'linkedNodes',
      'Linked nodes',
      `${linkedNodeIdsBefore?.length ?? 0}`,
      `${linkedNodeIdsAfter?.length ?? 0}`,
      target,
      undefined,
      {
        nodeId: target.id,
        beforeEffects,
        afterEffects,
        selectedEffectId: afterEffects[0]?.id ?? beforeEffects[0]?.id,
        crossLinksBefore,
        crossLinksAfter,
      },
    ))
  }
  return details
}

function firstCrossLinkedEffectId(
  nodeId: string,
  beforeEffects: FlowEffect[],
  afterEffects: FlowEffect[],
  crossLinksBefore: CrossEffectLink[] | undefined,
  crossLinksAfter: CrossEffectLink[] | undefined,
): string | undefined {
  const known = new Set([...beforeEffects, ...afterEffects].map((effect) => effect.id))
  for (const link of [...(crossLinksAfter ?? []), ...(crossLinksBefore ?? [])]) {
    const effectId = link.from.nodeId === nodeId
      ? link.from.effectId
      : link.to.nodeId === nodeId
        ? link.to.effectId
        : undefined
    if (effectId && known.has(effectId)) return effectId
  }
  return afterEffects[0]?.id ?? beforeEffects[0]?.id
}

function flowEffectSummary(effect: FlowEffect): string {
  const name = effect.label || effect.id || 'Effect'
  return `${name} (${effect.graph.nodes.length} nodes, ${effect.graph.edges.length} wires)`
}

function transformDetail(entry: TransformProposalEntry, index: number): ChangeDetail {
  return detail(
    `transform-${entry.nodeId}-${index}`,
    `Transform ${entry.nodeId}`,
    geometryLabel(entry.from),
    geometryLabel(entry.to),
    { kind: 'transform', id: entry.nodeId },
  )
}

function transformTarget(transforms: readonly TransformProposalEntry[]): ChangeTarget | undefined {
  return transforms.length === 1 ? { kind: 'transform', id: transforms[0].nodeId } : undefined
}

function nodeTypeLabel(node: ModelNode): string {
  if (node.mediaType) return `${labelize(node.mediaType)} media`
  if (node.cosmeticType) return labelize(node.cosmeticType)
  return 'Graph node'
}

function mediaLabel(node: ModelNode): string {
  return [labelize(node.mediaType ?? 'media'), node.mediaFileName ?? node.mediaSrc].filter(Boolean).join(' - ')
}

function modelLabel(models: ReadonlyMap<string, Model>, id: string, fallback?: string): string {
  return fallback || models.get(id)?.name || id
}

function referenceLabel(ref: { title: string; citation: string; url: string }): string {
  return [ref.title, ref.citation, ref.url].filter(Boolean).join(' | ')
}

function referenceCount(refs: unknown[] | undefined): string {
  const count = refs?.length ?? 0
  return `${count} ${count === 1 ? 'reference' : 'references'}`
}

function geometryLabel(value: Partial<Pick<ModelNode, 'x' | 'y' | 'w' | 'h'>> | undefined): string {
  if (!value) return 'default'
  return `x ${round(value.x ?? 50)}, y ${round(value.y ?? 50)}, w ${round(value.w ?? DEFAULT_NODE.w)}, h ${round(value.h ?? DEFAULT_NODE.h)}`
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    cellColor: 'Fill color',
    membraneColor: 'Border color',
    membraneVisible: 'Show border',
    hideDuringFlow: 'Hide while flow plays',
    cameraTracked: 'Tracked by camera',
    tipAngle: 'Tip angle',
    tipLength: 'Tip length',
    childModelId: 'RMM dimension',
    mpdDimensions: 'MPD dimensions',
    externalMpdLinks: 'External MPD links',
    externalRmmLink: 'External RMM link',
    mediaType: 'Media type',
    mediaSrc: 'Media source',
    mediaFileName: 'Media file',
    flowEffects: 'Flow effects',
    linkedNodeIds: 'Linked nodes',
    kind: 'Connection type',
    dash: 'Dash style',
    arrowStyle: 'Arrow style',
    labelFontSize: 'Label size',
  }
  return labels[key] ?? labelize(key)
}

function labelize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value === null) return 'none'
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number') return String(round(value))
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
