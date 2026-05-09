import type { Connection, ConnectionReference, CrossEffectLink, ExternalMpdLink, ExternalRmmLink, Model, ModelNode } from '../model/types'
import type { BackgroundConfig, ThemeMode } from '../theme/types'

export type ForumRef =
  | 'diagram'
  | `node:${string}`
  | `edge:${string}`
  | `proposal:${string}`

export type VoteStance = 'agree' | 'disagree' | 'neutral'
export type TopicVoteValue = 'like' | 'dislike'

export type GraphProposalStatus = 'pending' | 'accepted' | 'stale' | 'applied' | 'blocked'

export type GraphProposalAction =
  | 'add-node'
  | 'add-node-edge'
  | 'add-edge'
  | 'add-rmm'
  | 'add-mpd'
  | 'remove-edge'
  | 'remove-node'
  | 'rename-node'
  | 'rename-edge'
  | 'rewire-edge'
  | 'commit-transform'
  | 'add-reference'
  | 'modify-references'
  | 'update-node-settings'
  | 'update-node-media'
  | 'update-flow-effects'
  | 'update-edge-settings'
  | 'chain'

export interface NodeGeometry {
  x: number
  y: number
  w: number
  h: number
}

export interface TransformProposalEntry {
  nodeId: string
  from: NodeGeometry
  to: NodeGeometry
}

export type EntityPatch<T extends object> = Partial<{ [K in keyof T]: T[K] | null }>

export type GraphProposalStep =
  | {
    action: 'add-node'
    newNodeLabel: string
    nodeId?: string
    geometry?: NodeGeometry
    shape?: ModelNode['shape']
    node?: ModelNode
  }
  | {
    action: 'add-node-edge'
    sourceNodeId: string
    newNodeLabel: string
    nodeId?: string
    edgeId?: string
    geometry?: NodeGeometry
    shape?: ModelNode['shape']
    node?: ModelNode
    edge?: Connection
  }
  | {
    action: 'add-edge'
    sourceNodeId: string
    targetNodeId: string
    edgeId?: string
    label?: string
    references?: ConnectionReference[]
    style?: Partial<Pick<Connection, 'kind' | 'dash' | 'arrowStyle' | 'color' | 'width' | 'labelFontSize' | 'cameraTracked'>>
    edge?: Connection
  }
  | { action: 'add-rmm'; nodeId: string; name: string; externalLink?: ExternalRmmLink }
  | { action: 'add-mpd'; nodeId: string; name: string; externalLink?: ExternalMpdLink }
  | { action: 'remove-edge'; edgeId: string }
  | { action: 'remove-node'; nodeId: string }
  | { action: 'rename-node'; nodeId: string; nextLabel: string }
  | { action: 'rename-edge'; edgeId: string; nextLabel: string }
  | { action: 'rewire-edge'; edgeId: string; nextTargetNodeId: string }
  | { action: 'commit-transform'; transforms: TransformProposalEntry[] }
  | { action: 'add-reference'; edgeId: string; reference: ConnectionReference }
  | { action: 'modify-references'; edgeId: string; references: ConnectionReference[] }
  | { action: 'update-node-settings'; nodeId: string; before?: EntityPatch<ModelNode>; after: EntityPatch<ModelNode> }
  | { action: 'update-node-media'; nodeId: string; before?: EntityPatch<ModelNode>; after: EntityPatch<ModelNode> }
  | {
    action: 'update-flow-effects'
    nodeId: string
    before?: EntityPatch<ModelNode>
    after: EntityPatch<ModelNode>
    crossLinksBefore?: CrossEffectLink[]
    crossLinksAfter?: CrossEffectLink[]
  }
  | { action: 'update-edge-settings'; edgeId: string; before?: EntityPatch<Connection>; after: EntityPatch<Connection> }

export type GraphProposalPayload =
  | GraphProposalStep
  | { action: 'chain'; steps: GraphProposalStep[] }

export interface GraphProposal {
  id: string
  diagramId: string
  topicId: string
  action: GraphProposalAction
  payload: GraphProposalPayload
  status: GraphProposalStatus
  createdAt: string
  expiresAt: string
  appliedAt?: string
  blockedReason?: string
}

export interface ForumTopic {
  id: string
  diagramId: string
  forumRef: ForumRef
  title: string
  description: string
  author: string
  createdAt: string
  updatedAt: string
  views: number
  commentCount: number
  agreementRatio: number
  score: number
  viewerVote?: TopicVoteValue | null
  proposalId?: string
  proposal?: GraphProposal
}

export interface ForumComment {
  id: string
  diagramId: string
  topicId: string
  parentId?: string
  author: string
  body: string
  stance: VoteStance
  createdAt: string
}

export interface ForumThread {
  topic: ForumTopic
  comments: ForumComment[]
}

export interface SocialUserPreferences {
  themeMode?: ThemeMode
  background?: BackgroundConfig
}

export interface EntitySocialScores {
  nodeScores: Record<string, number>
  edgeScores: Record<string, number>
  nodeVotes?: Record<string, VoteBreakdown>
  edgeVotes?: Record<string, VoteBreakdown>
}

export interface VoteBreakdown {
  positive: number
  negative: number
}

export interface ForumTopicInput {
  forumRef: ForumRef
  title: string
  description: string
  author?: string
  proposal?: GraphProposalPayload
}

export interface ForumCommentInput {
  author?: string
  body: string
  parentId?: string
  stance?: VoteStance
}

export function diagramForumRef(): ForumRef {
  return 'diagram'
}

export function nodeForumRef(nodeId: string): ForumRef {
  return `node:${nodeId}`
}

export function edgeForumRef(edgeId: string): ForumRef {
  return `edge:${edgeId}`
}

export function proposalForumRef(proposalId: string): ForumRef {
  return `proposal:${proposalId}`
}

export function parseForumRef(ref: string): ForumRef | null {
  if (ref === 'diagram') return ref
  const match = ref.match(/^(node|edge|proposal):(.+)$/)
  if (!match) return null
  return ref as ForumRef
}

export function forumRefLabel(ref: ForumRef, model: Model): string {
  if (ref === 'diagram') return 'Diagram forum'
  if (ref.startsWith('node:')) {
    const id = ref.slice('node:'.length)
    const node = model.nodes.get(id)
    return node?.label || node?.id || 'Node forum'
  }
  if (ref.startsWith('edge:')) {
    const id = ref.slice('edge:'.length)
    const edge = model.edges.get(id)
    if (!edge) return 'Connection forum'
    const from = model.nodes.get(edge.from)
    const to = model.nodes.get(edge.to)
    return `${from?.label || edge.from} → ${to?.label || edge.to}`
  }
  return 'Proposal forum'
}

export function computeAgreementRatio(comments: readonly Pick<ForumComment, 'author' | 'stance'>[]): number {
  const latest = new Map<string, VoteStance>()
  for (const comment of comments) {
    const author = comment.author.trim().toLowerCase()
    if (!author) continue
    if (comment.stance === 'neutral') latest.delete(author)
    else latest.set(author, comment.stance)
  }
  let agree = 0
  let disagree = 0
  for (const stance of latest.values()) {
    if (stance === 'agree') agree++
    else if (stance === 'disagree') disagree++
  }
  const total = agree + disagree
  return total === 0 ? 0 : agree / total
}

export function resolveExpiredProposalStatus(
  proposal: Pick<GraphProposal, 'status' | 'expiresAt'>,
  agreementRatio: number,
  nowMs = Date.now(),
): GraphProposalStatus {
  if (proposal.status !== 'pending') return proposal.status
  const expiresAt = new Date(proposal.expiresAt).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt > nowMs) return 'pending'
  return agreementRatio >= 1 / 3 ? 'accepted' : 'stale'
}

export function proposalActionLabel(proposal: Pick<GraphProposal, 'action'> | GraphProposalPayload): string {
  switch (proposal.action) {
    case 'add-node': return 'Add node'
    case 'add-node-edge': return 'Add node'
    case 'add-edge': return 'Add connection'
    case 'add-rmm': return 'Add RMM'
    case 'add-mpd': return 'Add MPD'
    case 'remove-edge': return 'Remove connection'
    case 'remove-node': return 'Remove node'
    case 'rename-node': return 'Rename node'
    case 'rename-edge': return 'Rename connection'
    case 'rewire-edge': return 'Rewire connection'
    case 'commit-transform': return 'Commit transform'
    case 'add-reference': return 'Add reference'
    case 'modify-references': return 'Modify references'
    case 'update-node-settings': return 'Update node settings'
    case 'update-node-media': return 'Update node media'
    case 'update-flow-effects': return 'Update flow effects'
    case 'update-edge-settings': return 'Update connection settings'
    case 'chain': return 'Change chain'
  }
}

export function proposalSteps(payload: GraphProposalPayload): GraphProposalStep[] {
  return payload.action === 'chain' ? payload.steps : [payload]
}

export function proposalContainsAction(payload: GraphProposalPayload, action: GraphProposalAction): boolean {
  if (payload.action === action) return true
  return payload.action === 'chain' && payload.steps.some((step) => step.action === action)
}

export function proposalNodeTarget(proposal: GraphProposal, model: Model): ModelNode | null {
  const step = proposalSteps(proposal.payload).find((item) => {
    switch (item.action) {
      case 'add-node':
      case 'commit-transform':
        return false
      default:
        return true
    }
  })
  if (!step) return null
  switch (step.action) {
    case 'add-node':
    case 'commit-transform':
      return null
    case 'add-node-edge':
      return model.nodes.get(step.sourceNodeId) ?? null
    case 'add-rmm':
    case 'add-mpd':
    case 'update-node-settings':
    case 'update-node-media':
    case 'update-flow-effects':
      return model.nodes.get(step.nodeId) ?? null
    case 'remove-node':
    case 'rename-node':
      return model.nodes.get(step.nodeId) ?? null
    case 'add-edge':
      return model.nodes.get(step.sourceNodeId) ?? model.nodes.get(step.targetNodeId) ?? null
    case 'remove-edge':
    case 'rename-edge':
    case 'add-reference':
    case 'modify-references':
    case 'update-edge-settings':
    case 'rewire-edge': {
      const edge = model.edges.get(step.edgeId)
      return edge ? model.nodes.get(edge.from) ?? model.nodes.get(edge.to) ?? null : null
    }
  }
}

export function proposalEdgeTarget(proposal: GraphProposal, model: Model): Connection | null {
  const step = proposalSteps(proposal.payload).find((item) => {
    switch (item.action) {
      case 'remove-edge':
      case 'rename-edge':
      case 'add-reference':
      case 'modify-references':
      case 'rewire-edge':
      case 'update-edge-settings':
      case 'add-edge':
        return true
      default:
        return false
    }
  })
  if (!step) return null
  switch (step.action) {
    case 'remove-edge':
    case 'rename-edge':
    case 'add-reference':
    case 'modify-references':
    case 'rewire-edge':
    case 'update-edge-settings':
      return model.edges.get(step.edgeId) ?? null
    case 'add-edge':
      return findEdgeBetween(model, step.sourceNodeId, step.targetNodeId)
    case 'add-node-edge':
    case 'add-node':
    case 'add-rmm':
    case 'add-mpd':
    case 'update-node-settings':
    case 'update-node-media':
    case 'update-flow-effects':
    case 'remove-node':
    case 'rename-node':
    case 'commit-transform':
      return null
  }
}

export function findEdgeBetween(model: Model, from: string, to: string): Connection | null {
  for (const edge of model.edges.values()) {
    if (edge.from === from && edge.to === to) return edge
  }
  return null
}
