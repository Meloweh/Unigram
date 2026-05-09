import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { ConnectionReference, Connection, NodeShape } from '../src/model/types'
import {
  computeAgreementRatio,
  parseForumRef,
  proposalContainsAction,
  proposalSteps,
  resolveExpiredProposalStatus,
  type ForumComment,
  type ForumCommentInput,
  type ForumRef,
  type ForumThread,
  type ForumTopic,
  type ForumTopicInput,
  type GraphProposal,
  type GraphProposalPayload,
  type GraphProposalStep,
  type GraphProposalStatus,
  type NodeGeometry,
  type SocialUserPreferences,
  type TopicVoteValue,
  type VoteStance,
} from '../src/social/forumTypes'

export interface StoredDiagram {
  id: string
  title: string
  topic?: string
  description?: string
  visibility?: 'public' | 'private'
  ownerUserId?: string
  sourceDiagramId?: string
  createdAt: string
  updatedAt: string
  visits: number
  popularity: number
  bundleBase64?: string
}

interface DiagramDb {
  diagrams: StoredDiagram[]
  topics: StoredForumTopic[]
  comments: ForumComment[]
  proposals: GraphProposal[]
  users: StoredUser[]
  sessions: StoredSession[]
  topicVotes: StoredTopicVote[]
  userPreferences: StoredUserPreference[]
}

interface StoredForumTopic {
  id: string
  diagramId: string
  forumRef: ForumRef
  title: string
  description: string
  author: string
  createdAt: string
  updatedAt: string
  views: number
  proposalId?: string
}

interface StoredUser {
  id: string
  username: string
  passwordSalt: string
  passwordHash: string
  createdAt: string
}

interface StoredSession {
  token: string
  userId: string
  createdAt: string
}

interface StoredTopicVote {
  diagramId: string
  topicId: string
  userId: string
  username: string
  vote: TopicVoteValue
  updatedAt: string
}

interface StoredUserPreference {
  userId: string
  preferences: SocialUserPreferences
  updatedAt: string
}

const DB_DIR = '.omnigram-cloud'
const DB_FILE = 'diagrams.json'
const MAX_BODY_BYTES = 40 * 1024 * 1024

export function diagramCloudPlugin(): Plugin {
  return {
    name: 'omnigram-diagram-cloud-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/auth', async (req, res) => {
        try {
          await handleAuthRequest(req, res)
        } catch (err) {
          if (err instanceof NotFoundError) {
            sendJson(res, 404, { error: err.message })
            return
          }
          if (err instanceof BadRequestError) {
            sendJson(res, 400, { error: err.message })
            return
          }
          console.error('Auth API failed:', err)
          sendJson(res, 500, { error: 'Internal auth error' })
        }
      })
      server.middlewares.use('/api/creative-diagrams', async (req, res) => {
        try {
          await handleCreativeDiagramsRequest(req, res)
        } catch (err) {
          if (err instanceof NotFoundError) {
            sendJson(res, 404, { error: err.message })
            return
          }
          if (err instanceof BadRequestError) {
            sendJson(res, 400, { error: err.message })
            return
          }
          console.error('Creative diagram API failed:', err)
          sendJson(res, 500, { error: 'Internal creative diagram error' })
        }
      })
      server.middlewares.use('/api/diagrams', async (req, res) => {
        try {
          await handleDiagramsRequest(req, res)
        } catch (err) {
          if (err instanceof NotFoundError) {
            sendJson(res, 404, { error: err.message })
            return
          }
          if (err instanceof BadRequestError) {
            sendJson(res, 400, { error: err.message })
            return
          }
          console.error('Diagram cloud API failed:', err)
          sendJson(res, 500, { error: 'Internal diagram cloud error' })
        }
      })
    },
  }
}

async function handleAuthRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://omnigram.local')
  const route = url.pathname.replace(/^\/+/, '')
  if (req.method === 'POST' && route === 'register') {
    const body = await readJsonBody<{ username?: unknown; password?: unknown }>(req)
    const result = await registerUser(body)
    sendJson(res, 201, result)
    return
  }
  if (req.method === 'POST' && route === 'login') {
    const body = await readJsonBody<{ username?: unknown; password?: unknown }>(req)
    const result = await loginUser(body)
    sendJson(res, 200, result)
    return
  }
  if (req.method === 'GET' && route === 'me') {
    const db = await readDb()
    const user = authenticatedUser(db, req)
    if (!user) throw new BadRequestError('Not logged in')
    sendJson(res, 200, { user: publicUser(db, user) })
    return
  }
  if (req.method === 'GET' && route === 'preferences') {
    const db = await readDb()
    const user = requireAuthenticatedUser(db, req)
    sendJson(res, 200, { preferences: preferencesForUser(db, user.id) })
    return
  }
  if (req.method === 'PUT' && route === 'preferences') {
    const db = await readDb()
    const user = requireAuthenticatedUser(db, req)
    const body = await readJsonBody<{ preferences?: unknown }>(req)
    const preferences = sanitizeUserPreferences(body.preferences)
    const existing = db.userPreferences.find((item) => item.userId === user.id)
    const now = new Date().toISOString()
    if (existing) {
      existing.preferences = preferences
      existing.updatedAt = now
    } else {
      db.userPreferences.push({ userId: user.id, preferences, updatedAt: now })
    }
    await writeDb(db)
    sendJson(res, 200, { preferences, user: publicUser(db, user) })
    return
  }
  if (req.method === 'POST' && route === 'logout') {
    const db = await readDb()
    const token = authToken(req)
    if (token) db.sessions = db.sessions.filter((session) => session.token !== token)
    await writeDb(db)
    sendJson(res, 200, { ok: true })
    return
  }
  sendJson(res, 405, { error: 'Method not allowed' })
}

async function handleDiagramsRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://omnigram.local')
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && segments[1] === 'creative-copies') {
    await handleCreativeCopiesRequest(req, res, segments[0])
    return
  }
  if (segments.length >= 2 && segments[1] === 'forums') {
    await handleForumRequest(req, res, segments, url)
    return
  }

  const id = segments[0] ?? ''
  if (req.method === 'GET' && id === '') {
    const query = url.searchParams.get('q') ?? ''
    const diagrams = await listDiagrams(query)
    sendJson(res, 200, { diagrams: diagrams.map(withoutBundle) })
    return
  }

  if (req.method === 'POST' && id === '') {
    const body = await readJsonBody<{ title?: unknown; topic?: unknown; description?: unknown }>(req)
    const title = typeof body.title === 'string' && body.title.trim().length > 0
      ? body.title.trim()
      : 'Untitled diagram'
    const topic = typeof body.topic === 'string' ? body.topic.trim() : undefined
    const description = typeof body.description === 'string' ? body.description.trim() : undefined
    const diagram = await createDiagram(title, {
      ...(topic ? { topic } : {}),
      ...(description ? { description } : {}),
    })
    sendJson(res, 201, withoutBundle(diagram))
    return
  }

  if (req.method === 'GET' && id !== '') {
    const diagram = await getDiagram(id)
    sendJson(res, 200, diagram)
    return
  }

  if (req.method === 'PUT' && id !== '') {
    const body = await readJsonBody<{ title?: unknown; bundleBase64?: unknown }>(req)
    const title = typeof body.title === 'string' ? body.title.trim() : undefined
    const bundleBase64 = typeof body.bundleBase64 === 'string' ? body.bundleBase64 : undefined
    const diagram = await updateDiagram(id, { title, bundleBase64 })
    sendJson(res, 200, withoutBundle(diagram))
    return
  }

  sendJson(res, 405, { error: 'Method not allowed' })
}

async function handleCreativeDiagramsRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://omnigram.local')
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length === 0 && req.method === 'GET') {
    sendJson(res, 200, { diagrams: await listCreativeDiagrams(req) })
    return
  }
  if (segments.length === 1 && req.method === 'GET') {
    sendJson(res, 200, await getCreativeDiagram(req, segments[0]))
    return
  }
  if (segments.length === 1 && req.method === 'PUT') {
    const body = await readJsonBody<{ title?: unknown; bundleBase64?: unknown }>(req)
    sendJson(res, 200, await updateCreativeDiagram(req, segments[0], body))
    return
  }
  sendJson(res, 405, { error: 'Method not allowed' })
}

async function handleCreativeCopiesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sourceDiagramId: string,
): Promise<void> {
  if (!sourceDiagramId) throw new BadRequestError('Source diagram is required')
  if (req.method === 'GET') {
    sendJson(res, 200, { diagrams: await listCreativeCopies(req, sourceDiagramId) })
    return
  }
  if (req.method === 'POST') {
    const body = await readJsonBody<{ title?: unknown; bundleBase64?: unknown }>(req)
    sendJson(res, 201, await createCreativeCopy(req, sourceDiagramId, body))
    return
  }
  sendJson(res, 405, { error: 'Method not allowed' })
}

async function handleForumRequest(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[],
  url: URL,
): Promise<void> {
  const diagramId = segments[0]
  const resource = segments[2]
  if (!diagramId || !resource) throw new BadRequestError('Invalid forum route')

  if (resource === 'topics' && segments.length === 3 && req.method === 'GET') {
    const ref = parseForumRef(url.searchParams.get('forumRef') ?? 'diagram')
    if (!ref) throw new BadRequestError('Invalid forum reference')
    const topics = await listForumTopics(req, diagramId, ref)
    sendJson(res, 200, { topics })
    return
  }

  if (resource === 'topics' && segments.length === 3 && req.method === 'POST') {
    const body = await readJsonBody<Partial<ForumTopicInput>>(req)
    const topic = await createForumTopic(req, diagramId, body)
    sendJson(res, 201, topic)
    return
  }

  if (resource === 'topics' && segments.length === 4 && req.method === 'GET') {
    const thread = await getForumThread(req, diagramId, segments[3])
    sendJson(res, 200, thread)
    return
  }

  if (resource === 'topics' && segments.length === 5 && segments[4] === 'vote' && req.method === 'POST') {
    const body = await readJsonBody<{ vote?: unknown }>(req)
    const topic = await voteForumTopic(req, diagramId, segments[3], body)
    sendJson(res, 200, topic)
    return
  }

  if (resource === 'topics' && segments.length === 5 && segments[4] === 'comments' && req.method === 'POST') {
    const body = await readJsonBody<Partial<ForumCommentInput>>(req)
    const comment = await createForumComment(req, diagramId, segments[3], body)
    sendJson(res, 201, comment)
    return
  }

  if (resource === 'social-scores' && segments.length === 3 && req.method === 'GET') {
    const scores = await listSocialScores(diagramId)
    sendJson(res, 200, scores)
    return
  }

  if (resource === 'proposals' && segments.length === 3 && req.method === 'GET') {
    const proposals = await listActiveProposals(diagramId)
    sendJson(res, 200, { proposals })
    return
  }

  if (resource === 'proposals' && segments.length === 4 && req.method === 'PUT') {
    const body = await readJsonBody<{ status?: unknown; blockedReason?: unknown }>(req)
    const proposal = await updateProposalStatus(diagramId, segments[3], body)
    sendJson(res, 200, proposal)
    return
  }

  sendJson(res, 405, { error: 'Method not allowed' })
}

async function listDiagrams(query: string): Promise<StoredDiagram[]> {
  const db = await readDb()
  const q = query.trim().toLowerCase()
  const all = db.diagrams.filter(isPublicDiagram)
  const filtered = q.length === 0
    ? all
    : all.filter((diagram) => diagram.title.toLowerCase().includes(q))
  return filtered
    .sort((a, b) => b.popularity - a.popularity || b.visits - a.visits || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
}

async function createDiagram(
  title: string,
  metadata: { topic?: string; description?: string } = {},
): Promise<StoredDiagram> {
  const db = await readDb()
  const now = new Date().toISOString()
  const diagram: StoredDiagram = {
    id: randomUUID(),
    title,
    visibility: 'public',
    ...metadata,
    createdAt: now,
    updatedAt: now,
    visits: 0,
    popularity: 0,
  }
  db.diagrams.push(diagram)
  await writeDb(db)
  return diagram
}

async function getDiagram(id: string): Promise<StoredDiagram> {
  const db = await readDb()
  const diagram = ensurePublicDiagram(db, id)
  diagram.visits += 1
  diagram.updatedAt = new Date().toISOString()
  await writeDb(db)
  return diagram
}

async function updateDiagram(id: string, patch: { title?: string; bundleBase64?: string }): Promise<StoredDiagram> {
  const db = await readDb()
  const diagram = ensurePublicDiagram(db, id)
  if (patch.title && patch.title.length > 0) diagram.title = patch.title
  if (patch.bundleBase64 !== undefined) diagram.bundleBase64 = patch.bundleBase64
  diagram.updatedAt = new Date().toISOString()
  diagram.popularity = Math.max(diagram.popularity, diagram.visits)
  await writeDb(db)
  return diagram
}

async function listForumTopics(req: IncomingMessage, diagramId: string, forumRef: ForumRef): Promise<ForumTopic[]> {
  const db = await readDb()
  ensurePublicDiagram(db, diagramId)
  const viewer = authenticatedUser(db, req)
  const changed = refreshProposalStatuses(db, diagramId)
  const topics = db.topics
    .filter((topic) => topic.diagramId === diagramId && topic.forumRef === forumRef)
    .map((topic) => summarizeTopic(db, topic, viewer))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
  if (changed) await writeDb(db)
  return topics
}

async function createForumTopic(
  req: IncomingMessage,
  diagramId: string,
  body: Partial<ForumTopicInput>,
): Promise<ForumTopic> {
  const db = await readDb()
  const diagram = ensurePublicDiagram(db, diagramId)
  const user = requireAuthenticatedUser(db, req)
  const title = cleanRequired(body.title, 'Topic title')
  const description = cleanRequired(body.description, 'Topic description')
  const now = new Date().toISOString()
  const proposalPayload = body.proposal ? sanitizeProposalPayload(body.proposal) : null
  const statusChanged = refreshProposalStatuses(db, diagramId)
  if (proposalPayload && proposalContainsAction(proposalPayload, 'commit-transform') && hasActiveTransformProposal(db, diagramId)) {
    if (statusChanged) await writeDb(db)
    throw new BadRequestError('Only one active layout change proposal is allowed per diagram')
  }
  const proposalId = proposalPayload ? randomUUID() : undefined
  const forumRef = sanitizeForumRef(body.forumRef ?? 'diagram')
  const topic: StoredForumTopic = {
    id: randomUUID(),
    diagramId,
    forumRef,
    title,
    description,
    author: user.username,
    createdAt: now,
    updatedAt: now,
    views: 0,
    ...(proposalId ? { proposalId } : {}),
  }
  db.topics.push(topic)
  if (proposalPayload && proposalId) {
    db.proposals.push({
      id: proposalId,
      diagramId,
      topicId: topic.id,
      action: proposalPayload.action,
      payload: proposalPayload,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    })
  }
  diagram.updatedAt = now
  await writeDb(db)
  return summarizeTopic(db, topic, user)
}

function hasActiveTransformProposal(db: DiagramDb, diagramId: string): boolean {
  return db.proposals.some((proposal) =>
    proposal.diagramId === diagramId &&
    proposalContainsAction(proposal.payload, 'commit-transform') &&
    (proposal.status === 'pending' || proposal.status === 'accepted')
  )
}

async function getForumThread(req: IncomingMessage, diagramId: string, topicId: string): Promise<ForumThread> {
  const db = await readDb()
  ensurePublicDiagram(db, diagramId)
  const viewer = authenticatedUser(db, req)
  const changed = refreshProposalStatuses(db, diagramId)
  const topic = db.topics.find((item) => item.diagramId === diagramId && item.id === topicId)
  if (!topic) throw new NotFoundError('Forum topic not found')
  topic.views += 1
  topic.updatedAt = new Date().toISOString()
  await writeDb(db)
  void changed
  return {
    topic: summarizeTopic(db, topic, viewer),
    comments: db.comments
      .filter((comment) => comment.diagramId === diagramId && comment.topicId === topicId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }
}

async function createForumComment(
  req: IncomingMessage,
  diagramId: string,
  topicId: string,
  body: Partial<ForumCommentInput>,
): Promise<ForumComment> {
  const db = await readDb()
  ensurePublicDiagram(db, diagramId)
  const user = requireAuthenticatedUser(db, req)
  const topic = db.topics.find((item) => item.diagramId === diagramId && item.id === topicId)
  if (!topic) throw new NotFoundError('Forum topic not found')
  const now = new Date().toISOString()
  const comment: ForumComment = {
    id: randomUUID(),
    diagramId,
    topicId,
    ...(typeof body.parentId === 'string' && body.parentId.trim() ? { parentId: body.parentId.trim() } : {}),
    author: user.username,
    body: cleanRequired(body.body, 'Comment body'),
    stance: normalizeStance(body.stance),
    createdAt: now,
  }
  db.comments.push(comment)
  topic.updatedAt = now
  refreshProposalStatuses(db, diagramId)
  await writeDb(db)
  return comment
}

async function voteForumTopic(
  req: IncomingMessage,
  diagramId: string,
  topicId: string,
  body: { vote?: unknown },
): Promise<ForumTopic> {
  const db = await readDb()
  ensurePublicDiagram(db, diagramId)
  const user = requireAuthenticatedUser(db, req)
  const topic = db.topics.find((item) => item.diagramId === diagramId && item.id === topicId)
  if (!topic) throw new NotFoundError('Forum topic not found')
  if (topic.author.toLowerCase() === user.username.toLowerCase()) {
    return summarizeTopic(db, topic, user)
  }
  const vote = normalizeTopicVote(body.vote)
  const now = new Date().toISOString()
  db.topicVotes = db.topicVotes.filter((item) =>
    !(item.diagramId === diagramId && item.topicId === topicId && item.userId === user.id)
  )
  if (vote) {
    db.topicVotes.push({
      diagramId,
      topicId,
      userId: user.id,
      username: user.username,
      vote,
      updatedAt: now,
    })
  }
  await writeDb(db)
  return summarizeTopic(db, topic, user)
}

async function listSocialScores(diagramId: string): Promise<{
  nodeScores: Record<string, number>
  edgeScores: Record<string, number>
  nodeVotes: Record<string, { positive: number; negative: number }>
  edgeVotes: Record<string, { positive: number; negative: number }>
}> {
  const db = await readDb()
  ensurePublicDiagram(db, diagramId)
  refreshProposalStatuses(db, diagramId)
  const nodeScores: Record<string, number> = {}
  const edgeScores: Record<string, number> = {}
  const nodeVotes: Record<string, { positive: number; negative: number }> = {}
  const edgeVotes: Record<string, { positive: number; negative: number }> = {}
  for (const topic of db.topics.filter((item) => item.diagramId === diagramId)) {
    const score = topicScore(db, topic.id)
    const votes = topicVoteBreakdown(db, topic.id)
    if (topic.forumRef.startsWith('node:')) {
      const id = topic.forumRef.slice('node:'.length)
      addScore(nodeScores, id, score)
      addVotes(nodeVotes, id, votes)
    } else if (topic.forumRef.startsWith('edge:')) {
      const id = topic.forumRef.slice('edge:'.length)
      addScore(edgeScores, id, score)
      addVotes(edgeVotes, id, votes)
    }
    const proposal = topic.proposalId ? db.proposals.find((item) => item.id === topic.proposalId) : undefined
    if (!proposal) continue
    const support = Math.round(computeAgreementRatio(commentsForAgreement(topic, db.comments.filter((c) => c.topicId === topic.id))) * 4)
    const activity = score + support
    for (const payload of proposalSteps(proposal.payload)) {
      switch (payload.action) {
      case 'add-node-edge':
        addScore(nodeScores, payload.sourceNodeId, activity)
        addVotes(nodeVotes, payload.sourceNodeId, votes)
        break
      case 'add-edge':
        addScore(nodeScores, payload.sourceNodeId, Math.ceil(activity / 2))
        addScore(nodeScores, payload.targetNodeId, Math.ceil(activity / 2))
        addVotes(nodeVotes, payload.sourceNodeId, votes)
        addVotes(nodeVotes, payload.targetNodeId, votes)
        break
      case 'add-rmm':
      case 'add-mpd':
      case 'remove-node':
      case 'rename-node':
        addScore(nodeScores, payload.nodeId, activity)
        addVotes(nodeVotes, payload.nodeId, votes)
        break
      case 'remove-edge':
      case 'rename-edge':
      case 'add-reference':
      case 'modify-references':
      case 'rewire-edge':
        addScore(edgeScores, payload.edgeId, activity)
        addVotes(edgeVotes, payload.edgeId, votes)
        break
      case 'commit-transform':
        for (const transform of payload.transforms) {
          addScore(nodeScores, transform.nodeId, Math.max(1, activity))
          addVotes(nodeVotes, transform.nodeId, votes)
        }
        break
      case 'add-node':
        break
      }
    }
  }
  return { nodeScores, edgeScores, nodeVotes, edgeVotes }
}

async function listActiveProposals(diagramId: string): Promise<GraphProposal[]> {
  const db = await readDb()
  ensurePublicDiagram(db, diagramId)
  const changed = refreshProposalStatuses(db, diagramId)
  const proposals = db.proposals
    .filter((proposal) =>
      proposal.diagramId === diagramId &&
      (proposal.status === 'pending' || proposal.status === 'accepted')
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (changed) await writeDb(db)
  return proposals
}

async function updateProposalStatus(
  diagramId: string,
  proposalId: string,
  body: { status?: unknown; blockedReason?: unknown },
): Promise<GraphProposal> {
  const db = await readDb()
  ensurePublicDiagram(db, diagramId)
  const proposal = db.proposals.find((item) => item.diagramId === diagramId && item.id === proposalId)
  if (!proposal) throw new NotFoundError('Proposal not found')
  const status = normalizeProposalStatus(body.status)
  if (status !== 'applied' && status !== 'blocked') {
    throw new BadRequestError('Only applied or blocked status updates are accepted')
  }
  proposal.status = status
  proposal.appliedAt = new Date().toISOString()
  if (status === 'blocked') {
    proposal.blockedReason = typeof body.blockedReason === 'string'
      ? body.blockedReason.trim() || 'Proposal could not be applied'
      : 'Proposal could not be applied'
  } else {
    delete proposal.blockedReason
  }
  await writeDb(db)
  return proposal
}

function withoutBundle(diagram: StoredDiagram): Omit<StoredDiagram, 'bundleBase64'> {
  const { bundleBase64, ...summary } = diagram
  void bundleBase64
  return summary
}

function isPublicDiagram(diagram: StoredDiagram): boolean {
  return diagram.visibility !== 'private'
}

function creativeSummary(db: DiagramDb, diagram: StoredDiagram): Omit<StoredDiagram, 'bundleBase64'> & { sourceTitle?: string } {
  const sourceTitle = diagram.sourceDiagramId
    ? db.diagrams.find((item) => item.id === diagram.sourceDiagramId)?.title
    : undefined
  return {
    ...withoutBundle(diagram),
    ...(sourceTitle ? { sourceTitle } : {}),
  }
}

async function listCreativeDiagrams(req: IncomingMessage): Promise<Array<Omit<StoredDiagram, 'bundleBase64'> & { sourceTitle?: string }>> {
  const db = await readDb()
  const user = requireAuthenticatedUser(db, req)
  return db.diagrams
    .filter((diagram) => diagram.visibility === 'private' && diagram.ownerUserId === user.id)
    .map((diagram) => creativeSummary(db, diagram))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function listCreativeCopies(
  req: IncomingMessage,
  sourceDiagramId: string,
): Promise<Array<Omit<StoredDiagram, 'bundleBase64'> & { sourceTitle?: string }>> {
  const db = await readDb()
  const user = requireAuthenticatedUser(db, req)
  ensurePublicDiagram(db, sourceDiagramId)
  return db.diagrams
    .filter((diagram) =>
      diagram.visibility === 'private' &&
      diagram.ownerUserId === user.id &&
      diagram.sourceDiagramId === sourceDiagramId
    )
    .map((diagram) => creativeSummary(db, diagram))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function createCreativeCopy(
  req: IncomingMessage,
  sourceDiagramId: string,
  body: { title?: unknown; bundleBase64?: unknown },
): Promise<Omit<StoredDiagram, 'bundleBase64'> & { sourceTitle?: string }> {
  const db = await readDb()
  const user = requireAuthenticatedUser(db, req)
  const source = ensurePublicDiagram(db, sourceDiagramId)
  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : `${source.title} creative copy`
  const bundleBase64 = typeof body.bundleBase64 === 'string' ? body.bundleBase64 : source.bundleBase64
  const now = new Date().toISOString()
  const diagram: StoredDiagram = {
    id: randomUUID(),
    title,
    visibility: 'private',
    ownerUserId: user.id,
    sourceDiagramId: source.id,
    createdAt: now,
    updatedAt: now,
    visits: 0,
    popularity: 0,
    ...(bundleBase64 ? { bundleBase64 } : {}),
  }
  db.diagrams.push(diagram)
  await writeDb(db)
  return creativeSummary(db, diagram)
}

async function getCreativeDiagram(
  req: IncomingMessage,
  id: string,
): Promise<StoredDiagram & { sourceTitle?: string }> {
  const db = await readDb()
  const user = requireAuthenticatedUser(db, req)
  const diagram = ensureOwnedCreativeDiagram(db, id, user.id)
  diagram.visits += 1
  diagram.updatedAt = new Date().toISOString()
  await writeDb(db)
  const sourceTitle = diagram.sourceDiagramId
    ? db.diagrams.find((item) => item.id === diagram.sourceDiagramId)?.title
    : undefined
  return {
    ...diagram,
    ...(sourceTitle ? { sourceTitle } : {}),
  }
}

async function updateCreativeDiagram(
  req: IncomingMessage,
  id: string,
  patch: { title?: unknown; bundleBase64?: unknown },
): Promise<Omit<StoredDiagram, 'bundleBase64'> & { sourceTitle?: string }> {
  const db = await readDb()
  const user = requireAuthenticatedUser(db, req)
  const diagram = ensureOwnedCreativeDiagram(db, id, user.id)
  if (typeof patch.title === 'string' && patch.title.trim()) diagram.title = patch.title.trim()
  if (typeof patch.bundleBase64 === 'string') diagram.bundleBase64 = patch.bundleBase64
  diagram.updatedAt = new Date().toISOString()
  await writeDb(db)
  return creativeSummary(db, diagram)
}

async function readDb(): Promise<DiagramDb> {
  const file = dbPath()
  try {
    const raw = await readFile(file, 'utf8')
    if (raw.trim().length === 0) return emptyDb()
    const parsed = JSON.parse(raw) as Partial<DiagramDb>
    return {
      diagrams: Array.isArray(parsed.diagrams) ? parsed.diagrams : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      topicVotes: Array.isArray(parsed.topicVotes) ? parsed.topicVotes : [],
      userPreferences: Array.isArray(parsed.userPreferences) ? parsed.userPreferences : [],
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyDb()
    }
    throw err
  }
}

async function writeDb(db: DiagramDb): Promise<void> {
  await mkdir(join(process.cwd(), DB_DIR), { recursive: true })
  const file = dbPath()
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

function dbPath(): string {
  return join(process.cwd(), DB_DIR, DB_FILE)
}

function emptyDb(): DiagramDb {
  return {
    diagrams: [],
    topics: [],
    comments: [],
    proposals: [],
    users: [],
    sessions: [],
    topicVotes: [],
    userPreferences: [],
  }
}

async function registerUser(body: { username?: unknown; password?: unknown }) {
  const db = await readDb()
  const username = cleanUsername(body.username)
  const password = cleanPassword(body.password)
  if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    throw new BadRequestError('Username is already taken')
  }
  const now = new Date().toISOString()
  const salt = randomUUID()
  const user: StoredUser = {
    id: randomUUID(),
    username,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    createdAt: now,
  }
  db.users.push(user)
  const session = createSession(user)
  db.sessions.push(session)
  await writeDb(db)
  return { user: publicUser(db, user), token: session.token }
}

async function loginUser(body: { username?: unknown; password?: unknown }) {
  const db = await readDb()
  const username = cleanUsername(body.username)
  const password = cleanPassword(body.password)
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase())
  if (!user || !passwordMatches(password, user)) throw new BadRequestError('Invalid username or password')
  const session = createSession(user)
  db.sessions.push(session)
  await writeDb(db)
  return { user: publicUser(db, user), token: session.token }
}

function createSession(user: StoredUser): StoredSession {
  return { token: randomUUID(), userId: user.id, createdAt: new Date().toISOString() }
}

function authenticatedUser(db: DiagramDb, req: IncomingMessage): StoredUser | null {
  const token = authToken(req)
  if (!token) return null
  const session = db.sessions.find((item) => item.token === token)
  if (!session) return null
  return db.users.find((item) => item.id === session.userId) ?? null
}

function requireAuthenticatedUser(db: DiagramDb, req: IncomingMessage): StoredUser {
  const user = authenticatedUser(db, req)
  if (!user) throw new BadRequestError('Login required')
  return user
}

function authToken(req: IncomingMessage): string | null {
  const direct = req.headers['x-omnigram-session']
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim() || null
  return null
}

function publicUser(db: DiagramDb, user: StoredUser) {
  return {
    id: user.id,
    username: user.username,
    reputation: reputationForUser(db, user),
    preferences: preferencesForUser(db, user.id),
  }
}

function cleanUsername(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestError('Username is required')
  const trimmed = value.trim()
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(trimmed)) {
    throw new BadRequestError('Username must be 3-24 letters, numbers, "_" or "-"')
  }
  return trimmed
}

function cleanPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 6) {
    throw new BadRequestError('Password must be at least 6 characters')
  }
  return value
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function passwordMatches(password: string, user: StoredUser): boolean {
  const actual = Buffer.from(hashPassword(password, user.passwordSalt), 'hex')
  const expected = Buffer.from(user.passwordHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function ensureDiagram(db: DiagramDb, id: string): StoredDiagram {
  const diagram = db.diagrams.find((item) => item.id === id)
  if (!diagram) throw new NotFoundError('Diagram not found')
  return diagram
}

function ensurePublicDiagram(db: DiagramDb, id: string): StoredDiagram {
  const diagram = ensureDiagram(db, id)
  if (!isPublicDiagram(diagram)) throw new NotFoundError('Diagram not found')
  return diagram
}

function ensureOwnedCreativeDiagram(db: DiagramDb, id: string, userId: string): StoredDiagram {
  const diagram = db.diagrams.find((item) =>
    item.id === id &&
    item.visibility === 'private' &&
    item.ownerUserId === userId
  )
  if (!diagram) throw new NotFoundError('Creative graph not found')
  return diagram
}

function summarizeTopic(db: DiagramDb, topic: StoredForumTopic, viewer?: StoredUser | null): ForumTopic {
  const comments = db.comments.filter((comment) => comment.topicId === topic.id)
  const proposal = topic.proposalId
    ? db.proposals.find((item) => item.id === topic.proposalId)
    : undefined
  const viewerVote = viewer
    ? db.topicVotes.find((vote) => vote.topicId === topic.id && vote.userId === viewer.id)?.vote ?? null
    : null
  return {
    ...topic,
    commentCount: comments.length,
    agreementRatio: computeAgreementRatio(commentsForAgreement(topic, comments)),
    score: topicScore(db, topic.id),
    viewerVote,
    ...(proposal ? { proposal } : {}),
  }
}

function refreshProposalStatuses(db: DiagramDb, diagramId: string, nowMs = Date.now()): boolean {
  let changed = false
  for (const proposal of db.proposals) {
    if (proposal.diagramId !== diagramId || proposal.status !== 'pending') continue
    const topic = db.topics.find((item) => item.id === proposal.topicId)
    if (!topic) continue
    const comments = db.comments.filter((comment) => comment.topicId === proposal.topicId)
    const agreementRatio = computeAgreementRatio(commentsForAgreement(topic, comments))
    const independentScore = proposalAgreementScore(topic, comments)
    const next = independentScore >= 1
      ? resolveExpiredProposalStatus(proposal, agreementRatio, nowMs)
      : resolveExpiredProposalStatus(proposal, 0, nowMs)
    if (next !== proposal.status) {
      proposal.status = next
      changed = true
    }
  }
  return changed
}

function proposalAgreementScore(topic: StoredForumTopic, comments: Pick<ForumComment, 'author' | 'stance'>[]): number {
  const latest = new Map<string, VoteStance>()
  const author = topic.author.trim().toLowerCase()
  for (const comment of comments) {
    const key = comment.author.trim().toLowerCase()
    if (!key || key === author) continue
    if (comment.stance === 'neutral') latest.delete(key)
    else latest.set(key, comment.stance)
  }
  let score = 0
  for (const stance of latest.values()) score += stance === 'agree' ? 1 : -1
  return score
}

function commentsForAgreement(
  topic: StoredForumTopic,
  comments: Pick<ForumComment, 'author' | 'stance'>[],
): Pick<ForumComment, 'author' | 'stance'>[] {
  if (!topic.proposalId) return comments
  return [{ author: topic.author, stance: 'agree' }, ...comments]
}

function topicScore(db: DiagramDb, topicId: string): number {
  let score = 0
  for (const vote of db.topicVotes) {
    if (vote.topicId !== topicId) continue
    score += vote.vote === 'like' ? 1 : -1
  }
  return score
}

function reputationForUser(db: DiagramDb, user: StoredUser): number {
  const authoredTopicIds = new Set(
    db.topics
      .filter((topic) => topic.author.toLowerCase() === user.username.toLowerCase())
      .map((topic) => topic.id),
  )
  let score = 0
  for (const vote of db.topicVotes) {
    if (!authoredTopicIds.has(vote.topicId)) continue
    score += vote.vote === 'like' ? 1 : -1
  }
  return score
}

function preferencesForUser(db: DiagramDb, userId: string): SocialUserPreferences {
  return db.userPreferences.find((item) => item.userId === userId)?.preferences ?? {}
}

function addScore(target: Record<string, number>, id: string, score: number): void {
  if (!id || score === 0) return
  target[id] = (target[id] ?? 0) + score
}

function addVotes(
  target: Record<string, { positive: number; negative: number }>,
  id: string,
  votes: { positive: number; negative: number },
): void {
  if (!id || (votes.positive === 0 && votes.negative === 0)) return
  const current = target[id] ?? { positive: 0, negative: 0 }
  target[id] = {
    positive: current.positive + votes.positive,
    negative: current.negative + votes.negative,
  }
}

function topicVoteBreakdown(db: DiagramDb, topicId: string): { positive: number; negative: number } {
  let positive = 0
  let negative = 0
  for (const vote of db.topicVotes) {
    if (vote.topicId !== topicId) continue
    if (vote.vote === 'like') positive++
    else negative++
  }
  return { positive, negative }
}

function cleanRequired(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new BadRequestError(`${label} is required`)
  const trimmed = value.trim()
  if (!trimmed) throw new BadRequestError(`${label} is required`)
  return trimmed
}

function sanitizeForumRef(value: unknown): ForumRef {
  if (typeof value !== 'string') throw new BadRequestError('Forum reference is required')
  const ref = parseForumRef(value)
  if (!ref) throw new BadRequestError('Invalid forum reference')
  return ref
}

function normalizeStance(value: unknown): VoteStance {
  return value === 'agree' || value === 'disagree' || value === 'neutral' ? value : 'neutral'
}

function normalizeTopicVote(value: unknown): TopicVoteValue | null {
  if (value === null || value === undefined || value === '') return null
  if (value === 'like' || value === 'dislike') return value
  throw new BadRequestError('Invalid topic vote')
}

function normalizeProposalStatus(value: unknown): GraphProposalStatus {
  if (
    value === 'pending' ||
    value === 'accepted' ||
    value === 'stale' ||
    value === 'applied' ||
    value === 'blocked'
  ) {
    return value
  }
  throw new BadRequestError('Invalid proposal status')
}

function sanitizeProposalPayload(value: unknown): GraphProposalPayload {
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw new BadRequestError('Invalid proposal payload')
  }
  if (value.action === 'chain') {
    if (!Array.isArray(value.steps) || value.steps.length === 0) throw new BadRequestError('Change chain is required')
    if (value.steps.length > 80) throw new BadRequestError('Change chain is too large')
    return { action: 'chain', steps: value.steps.map((step) => sanitizeProposalStep(step)) }
  }
  return sanitizeProposalStep(value)
}

function sanitizeProposalStep(value: unknown): GraphProposalStep {
  if (!isRecord(value) || typeof value.action !== 'string' || value.action === 'chain') {
    throw new BadRequestError('Invalid proposal step')
  }
  switch (value.action) {
    case 'add-node':
      return {
        action: value.action,
        newNodeLabel: cleanRequired(value.newNodeLabel, 'New node label'),
        ...optionalIdField('nodeId', value.nodeId),
        ...optionalGeometryField(value.geometry),
        ...optionalShapeField(value.shape),
      }
    case 'add-node-edge':
      return {
        action: value.action,
        sourceNodeId: cleanRequired(value.sourceNodeId, 'Source node'),
        newNodeLabel: cleanRequired(value.newNodeLabel, 'New node label'),
        ...optionalIdField('nodeId', value.nodeId),
        ...optionalIdField('edgeId', value.edgeId),
        ...optionalGeometryField(value.geometry),
        ...optionalShapeField(value.shape),
      }
    case 'add-edge': {
      const style = sanitizeEdgeStyle(value.style)
      return {
        action: value.action,
        sourceNodeId: cleanRequired(value.sourceNodeId, 'Source node'),
        targetNodeId: cleanRequired(value.targetNodeId, 'Target node'),
        ...optionalIdField('edgeId', value.edgeId),
        ...(typeof value.label === 'string' && value.label.trim()
          ? { label: value.label.trim().slice(0, 160) }
          : {}),
        ...(Array.isArray(value.references) && value.references.length > 0
          ? { references: value.references.slice(0, 50).map((item) => sanitizeReference(item)) }
          : {}),
        ...(style ? { style } : {}),
      }
    }
    case 'add-rmm':
      return {
        action: value.action,
        nodeId: cleanRequired(value.nodeId, 'Node'),
        name: cleanRequired(value.name, 'RMM name'),
      }
    case 'add-mpd':
      return {
        action: value.action,
        nodeId: cleanRequired(value.nodeId, 'Node'),
        name: cleanRequired(value.name, 'MPD name'),
      }
    case 'remove-edge':
      return {
        action: value.action,
        edgeId: cleanRequired(value.edgeId, 'Connection'),
      }
    case 'remove-node':
      return {
        action: value.action,
        nodeId: cleanRequired(value.nodeId, 'Node'),
      }
    case 'rename-node':
      return {
        action: value.action,
        nodeId: cleanRequired(value.nodeId, 'Node'),
        nextLabel: cleanRequired(value.nextLabel, 'New node name'),
      }
    case 'rename-edge':
      return {
        action: value.action,
        edgeId: cleanRequired(value.edgeId, 'Connection'),
        nextLabel: cleanRequired(value.nextLabel, 'New connection name'),
      }
    case 'rewire-edge':
      return {
        action: value.action,
        edgeId: cleanRequired(value.edgeId, 'Connection'),
        nextTargetNodeId: cleanRequired(value.nextTargetNodeId, 'New target node'),
      }
    case 'add-reference':
      return {
        action: value.action,
        edgeId: cleanRequired(value.edgeId, 'Connection'),
        reference: sanitizeReference(value.reference),
      }
    case 'modify-references': {
      if (!Array.isArray(value.references)) throw new BadRequestError('References are required')
      if (value.references.length > 50) throw new BadRequestError('Reference list is too large')
      return {
        action: value.action,
        edgeId: cleanRequired(value.edgeId, 'Connection'),
        references: value.references.map((item) => sanitizeReference(item)),
      }
    }
    case 'commit-transform': {
      if (!Array.isArray(value.transforms) || value.transforms.length === 0) {
        throw new BadRequestError('Transform list is required')
      }
      if (value.transforms.length > 2000) throw new BadRequestError('Transform list is too large')
      return {
        action: value.action,
        transforms: value.transforms.map((item) => sanitizeTransformEntry(item)),
      }
    }
    default:
      throw new BadRequestError('Unsupported proposal action')
  }
}

function optionalIdField<K extends 'nodeId' | 'edgeId'>(key: K, value: unknown): Partial<Record<K, string>> {
  if (typeof value !== 'string' || !value.trim()) return {}
  return { [key]: value.trim().slice(0, 160) } as Partial<Record<K, string>>
}

function optionalGeometryField(value: unknown): { geometry?: NodeGeometry } {
  return isRecord(value) ? { geometry: sanitizeGeometry(value, 'Node geometry') } : {}
}

function optionalShapeField(value: unknown): { shape?: NodeShape } {
  if (typeof value !== 'string') return {}
  if (
    value === 'rectangle' ||
    value === 'rounded-rect' ||
    value === 'circle' ||
    value === 'oval' ||
    value === 'diamond' ||
    value === 'hexagon' ||
    value === 'parallelogram' ||
    value === 'triangle' ||
    value === 'chat-bubble' ||
    value === 'thinking-cloud'
  ) {
    return { shape: value }
  }
  return {}
}

function sanitizeEdgeStyle(value: unknown): Partial<Pick<Connection, 'kind' | 'dash' | 'arrowStyle' | 'color' | 'width' | 'labelFontSize' | 'cameraTracked'>> | undefined {
  if (!isRecord(value)) return undefined
  const style: Partial<Pick<Connection, 'kind' | 'dash' | 'arrowStyle' | 'color' | 'width' | 'labelFontSize' | 'cameraTracked'>> = {}
  if (value.kind === 'default' || value.kind === 'flow') style.kind = value.kind
  if (value.dash === 'solid' || value.dash === 'dashed' || value.dash === 'dotted' || value.dash === 'dash-dot') style.dash = value.dash
  if (
    value.arrowStyle === 'none' ||
    value.arrowStyle === 'standard' ||
    value.arrowStyle === 'triangle' ||
    value.arrowStyle === 'filled-triangle' ||
    value.arrowStyle === 'line-arrow' ||
    value.arrowStyle === 'stealth' ||
    value.arrowStyle === 'diamond' ||
    value.arrowStyle === 'circle'
  ) style.arrowStyle = value.arrowStyle
  if (typeof value.color === 'string' && value.color.trim()) style.color = value.color.trim().slice(0, 64)
  if (value.width !== undefined) style.width = cleanFinite(value.width, 'Connection width')
  if (value.labelFontSize !== undefined) style.labelFontSize = cleanFinite(value.labelFontSize, 'Connection label size')
  if (typeof value.cameraTracked === 'boolean') style.cameraTracked = value.cameraTracked
  return Object.keys(style).length > 0 ? style : undefined
}

function sanitizeReference(value: unknown): ConnectionReference {
  if (!isRecord(value)) throw new BadRequestError('Reference is required')
  return {
    title: cleanRequired(value.title, 'Reference title'),
    citation: typeof value.citation === 'string' ? value.citation.trim().slice(0, 1000) : '',
    url: typeof value.url === 'string' ? value.url.trim().slice(0, 2000) : '',
  }
}

function sanitizeTransformEntry(value: unknown): { nodeId: string; from: NodeGeometry; to: NodeGeometry } {
  if (!isRecord(value)) throw new BadRequestError('Invalid transform entry')
  return {
    nodeId: cleanRequired(value.nodeId, 'Node'),
    from: sanitizeGeometry(value.from, 'Previous geometry'),
    to: sanitizeGeometry(value.to, 'Next geometry'),
  }
}

function sanitizeGeometry(value: unknown, label: string): NodeGeometry {
  if (!isRecord(value)) throw new BadRequestError(`${label} is required`)
  return {
    x: cleanFinite(value.x, `${label} x`),
    y: cleanFinite(value.y, `${label} y`),
    w: cleanFinite(value.w, `${label} width`),
    h: cleanFinite(value.h, `${label} height`),
  }
}

function cleanFinite(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new BadRequestError(`${label} is invalid`)
  return n
}

function sanitizeUserPreferences(value: unknown): SocialUserPreferences {
  if (!isRecord(value)) return {}
  const preferences: SocialUserPreferences = {}
  if (typeof value.themeMode === 'string' && value.themeMode.length <= 64) {
    preferences.themeMode = value.themeMode as SocialUserPreferences['themeMode']
  }
  if (isRecord(value.background) && typeof value.background.type === 'string' && typeof value.background.value === 'string') {
    const type = value.background.type
    if (type !== 'gradient' && type !== 'solid' && type !== 'image' && type !== 'pattern') return preferences
    const background: NonNullable<SocialUserPreferences['background']> = {
      type,
      value: value.background.value.slice(0, 4000),
    }
    if (typeof value.background.fit === 'string') background.fit = value.background.fit as NonNullable<SocialUserPreferences['background']>['fit']
    if (typeof value.background.opacity === 'number') background.opacity = value.background.opacity
    if (typeof value.background.blur === 'number') background.blur = value.background.blur
    preferences.background = background
  }
  return preferences
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_BODY_BYTES) throw new BadRequestError('Request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new BadRequestError('Invalid JSON request body')
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(raw))
  res.end(raw)
}

class NotFoundError extends Error {}
class BadRequestError extends Error {}
