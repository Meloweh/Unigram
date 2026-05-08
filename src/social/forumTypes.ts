import type { Connection, ConnectionReference, Model, ModelNode } from '../model/types'
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

export type GraphProposalPayload =
  | { action: 'add-node'; newNodeLabel: string }
  | { action: 'add-node-edge'; sourceNodeId: string; newNodeLabel: string }
  | { action: 'add-edge'; sourceNodeId: string; targetNodeId: string; label?: string; references?: ConnectionReference[] }
  | { action: 'add-rmm'; nodeId: string; name: string }
  | { action: 'add-mpd'; nodeId: string; name: string }
  | { action: 'remove-edge'; edgeId: string }
  | { action: 'remove-node'; nodeId: string }
  | { action: 'rename-node'; nodeId: string; nextLabel: string }
  | { action: 'rename-edge'; edgeId: string; nextLabel: string }
  | { action: 'rewire-edge'; edgeId: string; nextTargetNodeId: string }
  | { action: 'commit-transform'; transforms: TransformProposalEntry[] }
  | { action: 'add-reference'; edgeId: string; reference: ConnectionReference }
  | { action: 'modify-references'; edgeId: string; references: ConnectionReference[] }

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
  }
}

export function proposalNodeTarget(proposal: GraphProposal, model: Model): ModelNode | null {
  switch (proposal.payload.action) {
    case 'add-node':
    case 'commit-transform':
      return null
    case 'add-node-edge':
      return model.nodes.get(proposal.payload.sourceNodeId) ?? null
    case 'add-rmm':
    case 'add-mpd':
      return model.nodes.get(proposal.payload.nodeId) ?? null
    case 'remove-node':
    case 'rename-node':
      return model.nodes.get(proposal.payload.nodeId) ?? null
    case 'add-edge':
      return model.nodes.get(proposal.payload.sourceNodeId) ?? model.nodes.get(proposal.payload.targetNodeId) ?? null
    case 'remove-edge':
    case 'rename-edge':
    case 'add-reference':
    case 'modify-references':
    case 'rewire-edge': {
      const edge = model.edges.get(proposal.payload.edgeId)
      return edge ? model.nodes.get(edge.from) ?? model.nodes.get(edge.to) ?? null : null
    }
  }
}

export function proposalEdgeTarget(proposal: GraphProposal, model: Model): Connection | null {
  switch (proposal.payload.action) {
    case 'remove-edge':
    case 'rename-edge':
    case 'add-reference':
    case 'modify-references':
    case 'rewire-edge':
      return model.edges.get(proposal.payload.edgeId) ?? null
    case 'add-edge':
      return findEdgeBetween(model, proposal.payload.sourceNodeId, proposal.payload.targetNodeId)
    case 'add-node-edge':
    case 'add-node':
    case 'add-rmm':
    case 'add-mpd':
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
