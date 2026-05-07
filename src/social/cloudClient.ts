import type {
  ForumComment,
  ForumCommentInput,
  ForumRef,
  ForumThread,
  ForumTopic,
  ForumTopicInput,
  GraphProposal,
  GraphProposalStatus,
} from './forumTypes'

const SESSION_KEY = 'omnigram-social-session'

export interface DiagramSummary {
  id: string
  title: string
  topic?: string
  description?: string
  createdAt: string
  updatedAt: string
  visits: number
  popularity: number
}

export interface DiagramDetail extends DiagramSummary {
  bundleBase64?: string
}

export interface AuthUser {
  id: string
  username: string
}

export interface AuthResult {
  user: AuthUser
  token: string
}

export function storedAuthToken(): string {
  try {
    return window.localStorage.getItem(SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

export function storeAuthToken(token: string): void {
  try {
    window.localStorage.setItem(SESSION_KEY, token)
  } catch {
    /* localStorage can be unavailable */
  }
}

export function clearAuthToken(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {
    /* localStorage can be unavailable */
  }
}

export async function registerAccount(username: string, password: string): Promise<AuthResult> {
  return authPost('/api/auth/register', { username, password })
}

export async function loginAccount(username: string, password: string): Promise<AuthResult> {
  return authPost('/api/auth/login', { username, password })
}

export async function getCurrentAccount(): Promise<AuthUser | null> {
  const token = storedAuthToken()
  if (!token) return null
  const res = await fetch('/api/auth/me', { headers: authHeaders() })
  if (!res.ok) {
    clearAuthToken()
    return null
  }
  const body = await res.json() as { user?: AuthUser }
  return body.user ?? null
}

export async function logoutAccount(): Promise<void> {
  const token = storedAuthToken()
  if (token) {
    await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => undefined)
  }
  clearAuthToken()
}

async function authPost(url: string, body: { username: string; password: string }): Promise<AuthResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Authentication failed (${res.status})`)
  const result = await res.json() as AuthResult
  storeAuthToken(result.token)
  return result
}

function authHeaders(): HeadersInit {
  const token = storedAuthToken()
  return token ? { 'x-omnigram-session': token } : {}
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string }
    return body.error ?? ''
  } catch {
    return ''
  }
}

export async function searchCloudDiagrams(query: string): Promise<DiagramSummary[]> {
  const res = await fetch(`/api/diagrams?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const body = await res.json() as { diagrams?: DiagramSummary[] }
  return Array.isArray(body.diagrams) ? body.diagrams : []
}

export interface DiagramCreateInput {
  title: string
  topic?: string
  description?: string
}

export async function createCloudDiagram(input: string | DiagramCreateInput): Promise<DiagramSummary> {
  const payload = typeof input === 'string' ? { title: input } : input
  const res = await fetch('/api/diagrams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Diagram creation failed (${res.status})`)
  return await res.json() as DiagramSummary
}

export async function getCloudDiagram(id: string): Promise<DiagramDetail> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Diagram load failed (${res.status})`)
  return await res.json() as DiagramDetail
}

export async function saveCloudDiagram(
  id: string,
  payload: { title: string; bundleBase64: string },
): Promise<DiagramSummary> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Diagram save failed (${res.status})`)
  return await res.json() as DiagramSummary
}

export async function listForumTopics(diagramId: string, forumRef: ForumRef): Promise<ForumTopic[]> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics?forumRef=${encodeURIComponent(forumRef)}`,
  )
  if (!res.ok) throw new Error(`Forum topics failed (${res.status})`)
  const body = await res.json() as { topics?: ForumTopic[] }
  return Array.isArray(body.topics) ? body.topics : []
}

export async function createForumTopic(
  diagramId: string,
  input: ForumTopicInput,
): Promise<ForumTopic> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Forum post failed (${res.status})`)
  return await res.json() as ForumTopic
}

export async function getForumThread(diagramId: string, topicId: string): Promise<ForumThread> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics/${encodeURIComponent(topicId)}`,
  )
  if (!res.ok) throw new Error(`Forum thread failed (${res.status})`)
  return await res.json() as ForumThread
}

export async function addForumComment(
  diagramId: string,
  topicId: string,
  input: ForumCommentInput,
): Promise<ForumComment> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics/${encodeURIComponent(topicId)}/comments`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Forum comment failed (${res.status})`)
  return await res.json() as ForumComment
}

export async function listActiveProposals(diagramId: string): Promise<GraphProposal[]> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/forums/proposals`)
  if (!res.ok) throw new Error(`Proposal list failed (${res.status})`)
  const body = await res.json() as { proposals?: GraphProposal[] }
  return Array.isArray(body.proposals) ? body.proposals : []
}

export async function markProposalStatus(
  diagramId: string,
  proposalId: string,
  status: Extract<GraphProposalStatus, 'applied' | 'blocked'>,
  blockedReason?: string,
): Promise<GraphProposal> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(diagramId)}/forums/proposals/${encodeURIComponent(proposalId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, blockedReason }),
    },
  )
  if (!res.ok) throw new Error(`Proposal status failed (${res.status})`)
  return await res.json() as GraphProposal
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let raw = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i])
  return btoa(raw)
}

export function base64ToBlob(value: string, type = 'application/zip'): Blob {
  const raw = atob(value)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new Blob([bytes], { type })
}
