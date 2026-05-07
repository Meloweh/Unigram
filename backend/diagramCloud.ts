import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  computeAgreementRatio,
  parseForumRef,
  proposalForumRef,
  resolveExpiredProposalStatus,
  type ForumComment,
  type ForumCommentInput,
  type ForumRef,
  type ForumThread,
  type ForumTopic,
  type ForumTopicInput,
  type GraphProposal,
  type GraphProposalPayload,
  type GraphProposalStatus,
  type VoteStance,
} from '../src/social/forumTypes'

export interface StoredDiagram {
  id: string
  title: string
  topic?: string
  description?: string
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
    sendJson(res, 200, { user: publicUser(user) })
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
    const topics = await listForumTopics(diagramId, ref)
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
    const thread = await getForumThread(diagramId, segments[3])
    sendJson(res, 200, thread)
    return
  }

  if (resource === 'topics' && segments.length === 5 && segments[4] === 'comments' && req.method === 'POST') {
    const body = await readJsonBody<Partial<ForumCommentInput>>(req)
    const comment = await createForumComment(req, diagramId, segments[3], body)
    sendJson(res, 201, comment)
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
  const all = db.diagrams
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
  const diagram = db.diagrams.find((item) => item.id === id)
  if (!diagram) throw new NotFoundError('Diagram not found')
  diagram.visits += 1
  diagram.updatedAt = new Date().toISOString()
  await writeDb(db)
  return diagram
}

async function updateDiagram(id: string, patch: { title?: string; bundleBase64?: string }): Promise<StoredDiagram> {
  const db = await readDb()
  const diagram = db.diagrams.find((item) => item.id === id)
  if (!diagram) throw new NotFoundError('Diagram not found')
  if (patch.title && patch.title.length > 0) diagram.title = patch.title
  if (patch.bundleBase64 !== undefined) diagram.bundleBase64 = patch.bundleBase64
  diagram.updatedAt = new Date().toISOString()
  diagram.popularity = Math.max(diagram.popularity, diagram.visits)
  await writeDb(db)
  return diagram
}

async function listForumTopics(diagramId: string, forumRef: ForumRef): Promise<ForumTopic[]> {
  const db = await readDb()
  ensureDiagram(db, diagramId)
  const changed = refreshProposalStatuses(db, diagramId)
  const topics = db.topics
    .filter((topic) => topic.diagramId === diagramId && topic.forumRef === forumRef)
    .map((topic) => summarizeTopic(db, topic))
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
  const diagram = ensureDiagram(db, diagramId)
  const user = requireAuthenticatedUser(db, req)
  const title = cleanRequired(body.title, 'Topic title')
  const description = cleanRequired(body.description, 'Topic description')
  const now = new Date().toISOString()
  const proposalPayload = body.proposal ? sanitizeProposalPayload(body.proposal) : null
  const proposalId = proposalPayload ? randomUUID() : undefined
  const forumRef = proposalId
    ? proposalForumRef(proposalId)
    : sanitizeForumRef(body.forumRef ?? 'diagram')
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
  return summarizeTopic(db, topic)
}

async function getForumThread(diagramId: string, topicId: string): Promise<ForumThread> {
  const db = await readDb()
  ensureDiagram(db, diagramId)
  const changed = refreshProposalStatuses(db, diagramId)
  const topic = db.topics.find((item) => item.diagramId === diagramId && item.id === topicId)
  if (!topic) throw new NotFoundError('Forum topic not found')
  topic.views += 1
  topic.updatedAt = new Date().toISOString()
  await writeDb(db)
  void changed
  return {
    topic: summarizeTopic(db, topic),
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
  ensureDiagram(db, diagramId)
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

async function listActiveProposals(diagramId: string): Promise<GraphProposal[]> {
  const db = await readDb()
  ensureDiagram(db, diagramId)
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
  ensureDiagram(db, diagramId)
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
  return { diagrams: [], topics: [], comments: [], proposals: [], users: [], sessions: [] }
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
  return { user: publicUser(user), token: session.token }
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
  return { user: publicUser(user), token: session.token }
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

function publicUser(user: StoredUser) {
  return { id: user.id, username: user.username }
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

function summarizeTopic(db: DiagramDb, topic: StoredForumTopic): ForumTopic {
  const comments = db.comments.filter((comment) => comment.topicId === topic.id)
  const proposal = topic.proposalId
    ? db.proposals.find((item) => item.id === topic.proposalId)
    : undefined
  return {
    ...topic,
    commentCount: comments.length,
    agreementRatio: computeAgreementRatio(commentsForAgreement(topic, comments)),
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
    const next = resolveExpiredProposalStatus(proposal, computeAgreementRatio(commentsForAgreement(topic, comments)), nowMs)
    if (next !== proposal.status) {
      proposal.status = next
      changed = true
    }
  }
  return changed
}

function commentsForAgreement(
  topic: StoredForumTopic,
  comments: Pick<ForumComment, 'author' | 'stance'>[],
): Pick<ForumComment, 'author' | 'stance'>[] {
  if (!topic.proposalId) return comments
  return [{ author: topic.author, stance: 'agree' }, ...comments]
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
  switch (value.action) {
    case 'add-node':
      return {
        action: value.action,
        newNodeLabel: cleanRequired(value.newNodeLabel, 'New node label'),
      }
    case 'add-node-edge':
      return {
        action: value.action,
        sourceNodeId: cleanRequired(value.sourceNodeId, 'Source node'),
        newNodeLabel: cleanRequired(value.newNodeLabel, 'New node label'),
      }
    case 'add-edge':
      return {
        action: value.action,
        sourceNodeId: cleanRequired(value.sourceNodeId, 'Source node'),
        targetNodeId: cleanRequired(value.targetNodeId, 'Target node'),
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
    default:
      throw new BadRequestError('Unsupported proposal action')
  }
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
