import type {
  ForumComment,
  ForumCommentInput,
  ForumRef,
  ForumThread,
  ForumTopic,
  ForumTopicInput,
  GraphProposal,
  GraphProposalStatus,
  EntitySocialScores,
  SocialUserPreferences,
  TopicVoteValue,
} from './forumTypes'

const CSRF_KEY = 'omnigram-social-csrf'

export interface DiagramSummary {
  id: string
  title: string
  topic?: string
  description?: string
  visibility?: 'public' | 'private'
  ownerUserId?: string
  sourceDiagramId?: string
  sourceTitle?: string
  createdAt: string
  updatedAt: string
  visits: number
  popularity: number
  contentHash?: string
}

export interface DiagramDetail extends DiagramSummary {
  bundleBase64?: string
}

export interface DiagramSuggestion {
  kind: 'last-visited' | 'most-popular' | 'personalized'
  title: string
  reason: string
  diagram?: DiagramSummary
}

export interface CreativeDiagramSummary extends DiagramSummary {
  visibility: 'private'
  ownerUserId: string
  sourceDiagramId: string
  sourceContentHash?: string
  sourceCurrentContentHash?: string
  sourceIsCurrent?: boolean
}

export interface CreativeDiagramDetail extends CreativeDiagramSummary {
  bundleBase64?: string
  sourceBaseBundleBase64?: string
}

export interface AuthUser {
  id: string
  username: string
  email: string
  emailVerified: boolean
  reputation: number
  preferences: SocialUserPreferences
}

export interface AuthResult {
  user: AuthUser
  csrfToken: string
}

export interface DevVerificationMessage {
  id: string
  userId: string
  username: string
  to: string
  subject: string
  body: string
  code?: string
  createdAt: string
  expiresAt?: string
}

export class AuthRequiredError extends Error {
  constructor(message = 'Login required') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

function storedCsrfToken(): string {
  try {
    return window.localStorage.getItem(CSRF_KEY) ?? ''
  } catch {
    return ''
  }
}

function storeCsrfToken(token: string): void {
  try {
    if (window.localStorage.getItem(CSRF_KEY) === token) return
    window.localStorage.setItem(CSRF_KEY, token)
    window.dispatchEvent(new CustomEvent('omnigram-auth-changed'))
  } catch {
    /* localStorage can be unavailable */
  }
}

function clearCsrfToken(): void {
  try {
    if (!window.localStorage.getItem(CSRF_KEY)) return
    window.localStorage.removeItem(CSRF_KEY)
    window.dispatchEvent(new CustomEvent('omnigram-auth-changed'))
  } catch {
    /* localStorage can be unavailable */
  }
}

export async function registerAccount(username: string, email: string, password: string): Promise<AuthResult> {
  return authPost('/api/auth/register', { username, email, password })
}

export async function loginAccount(login: string, password: string): Promise<AuthResult> {
  return authPost('/api/auth/login', { login, password })
}

export async function getCurrentAccount(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me')
  if (!res.ok) {
    clearCsrfToken()
    return null
  }
  const body = await res.json() as { user?: AuthUser; csrfToken?: string }
  if (body.csrfToken) storeCsrfToken(body.csrfToken)
  return body.user ?? null
}

export async function logoutAccount(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => undefined)
  clearCsrfToken()
}

export async function logoutAllAccounts(): Promise<void> {
  await fetch('/api/auth/logout-all', { method: 'POST', headers: authHeaders() })
  clearCsrfToken()
}

export async function verifyEmail(code: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Email verification failed (${res.status})`)
  const body = await res.json() as { user?: AuthUser }
  if (!body.user) throw new Error('Email verification failed')
  window.dispatchEvent(new CustomEvent('omnigram-auth-changed'))
  return body.user
}

export async function resendVerificationEmail(): Promise<AuthUser> {
  const res = await fetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Verification resend failed (${res.status})`)
  const body = await res.json() as { user?: AuthUser }
  if (!body.user) throw new Error('Verification resend failed')
  return body.user
}

export async function changePassword(currentPassword: string, nextPassword: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ currentPassword, nextPassword }),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Password change failed (${res.status})`)
  const body = await res.json() as { user?: AuthUser }
  if (!body.user) throw new Error('Password change failed')
  return body.user
}

export async function listDevVerificationMessages(): Promise<DevVerificationMessage[]> {
  const res = await fetch('/api/auth/dev-inbox')
  if (!res.ok) throw new Error((await errorMessage(res)) || `Dev inbox failed (${res.status})`)
  const body = await res.json() as { messages?: DevVerificationMessage[] }
  return Array.isArray(body.messages) ? body.messages : []
}

export async function getUserPreferences(): Promise<SocialUserPreferences | null> {
  const res = await fetch('/api/auth/preferences', { headers: authHeaders() })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || res.status === 404) return null
    throw new Error(`Preferences load failed (${res.status})`)
  }
  const body = await res.json() as { preferences?: SocialUserPreferences | null; csrfToken?: string }
  if (body.csrfToken) storeCsrfToken(body.csrfToken)
  return body.preferences ?? null
}

export async function saveUserPreferences(preferences: SocialUserPreferences): Promise<SocialUserPreferences> {
  if (!storedCsrfToken()) return preferences
  const res = await fetch('/api/auth/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ preferences }),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Preferences save failed (${res.status})`)
  const body = await res.json() as { preferences?: SocialUserPreferences }
  return body.preferences ?? {}
}

async function authPost(url: string, body: { username?: string; email?: string; login?: string; password: string }): Promise<AuthResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Authentication failed (${res.status})`)
  const result = await res.json() as AuthResult
  storeCsrfToken(result.csrfToken)
  return result
}

function authHeaders(): HeadersInit {
  const token = storedCsrfToken()
  return token ? { 'x-omnigram-csrf': token } : {}
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

export async function listDiagramSuggestions(): Promise<DiagramSuggestion[]> {
  const res = await fetch('/api/diagrams/suggestions', { headers: authHeaders() })
  if (!res.ok) throw new Error(`Suggestions failed (${res.status})`)
  const body = await res.json() as { suggestions?: DiagramSuggestion[] }
  return Array.isArray(body.suggestions) ? body.suggestions : []
}

export async function listMpdCandidates(input: {
  nodeLabel: string
  query: string
  excludeDiagramId?: string
}): Promise<DiagramSummary[]> {
  const params = new URLSearchParams()
  params.set('nodeLabel', input.nodeLabel)
  params.set('q', input.query)
  if (input.excludeDiagramId) params.set('excludeDiagramId', input.excludeDiagramId)
  const res = await fetch(`/api/diagrams/mpd-candidates?${params.toString()}`)
  if (!res.ok) throw new Error(`MPD candidates failed (${res.status})`)
  const body = await res.json() as { diagrams?: DiagramSummary[] }
  return Array.isArray(body.diagrams) ? body.diagrams : []
}

export const listGraphLinkCandidates = listMpdCandidates

export interface DiagramCreateInput {
  title: string
  topic?: string
  description?: string
}

export async function createCloudDiagram(input: string | DiagramCreateInput): Promise<DiagramSummary> {
  const payload = typeof input === 'string' ? { title: input } : input
  const res = await fetch('/api/diagrams', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Diagram creation failed (${res.status})`)
  return await res.json() as DiagramSummary
}

export async function getCloudDiagram(id: string): Promise<DiagramDetail> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(id)}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`Diagram load failed (${res.status})`)
  return await res.json() as DiagramDetail
}

export async function saveCloudDiagram(
  id: string,
  payload: { title: string; bundleBase64: string },
): Promise<DiagramSummary> {
  if (!storedCsrfToken()) throw new AuthRequiredError()
  const res = await fetch(`/api/diagrams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Diagram save failed (${res.status})`)
  return await res.json() as DiagramSummary
}

export async function listCreativeDiagrams(): Promise<CreativeDiagramSummary[]> {
  const res = await fetch('/api/creative-diagrams', { headers: authHeaders() })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Creative graph list failed (${res.status})`)
  const body = await res.json() as { diagrams?: CreativeDiagramSummary[] }
  return Array.isArray(body.diagrams) ? body.diagrams : []
}

export async function listCreativeCopies(sourceDiagramId: string): Promise<CreativeDiagramSummary[]> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(sourceDiagramId)}/creative-copies`,
    { headers: authHeaders() },
  )
  if (!res.ok) throw new Error((await errorMessage(res)) || `Creative copy list failed (${res.status})`)
  const body = await res.json() as { diagrams?: CreativeDiagramSummary[] }
  return Array.isArray(body.diagrams) ? body.diagrams : []
}

export async function createCreativeCopy(
  sourceDiagramId: string,
  input: { title: string; bundleBase64?: string },
): Promise<CreativeDiagramSummary> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(sourceDiagramId)}/creative-copies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Creative copy creation failed (${res.status})`)
  return await res.json() as CreativeDiagramSummary
}

export async function getCreativeDiagram(id: string): Promise<CreativeDiagramDetail> {
  const res = await fetch(`/api/creative-diagrams/${encodeURIComponent(id)}`, { headers: authHeaders() })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Creative graph load failed (${res.status})`)
  return await res.json() as CreativeDiagramDetail
}

export async function saveCreativeDiagram(
  id: string,
  payload: { title: string; bundleBase64: string; sourceContentHash?: string; sourceBaseBundleBase64?: string },
): Promise<CreativeDiagramSummary> {
  const res = await fetch(`/api/creative-diagrams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Creative graph save failed (${res.status})`)
  return await res.json() as CreativeDiagramSummary
}

export async function deleteCreativeDiagram(id: string): Promise<void> {
  const res = await fetch(`/api/creative-diagrams/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Creative graph removal failed (${res.status})`)
}

export async function listForumTopics(diagramId: string, forumRef: ForumRef): Promise<ForumTopic[]> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics?forumRef=${encodeURIComponent(forumRef)}`,
    { headers: authHeaders() },
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
  if (!res.ok) throw new Error((await errorMessage(res)) || `Forum post failed (${res.status})`)
  return await res.json() as ForumTopic
}

export async function updateForumTopic(
  diagramId: string,
  topicId: string,
  input: { title: string; description: string },
): Promise<ForumTopic> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics/${encodeURIComponent(topicId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Forum post update failed (${res.status})`)
  return await res.json() as ForumTopic
}

export async function deleteForumTopic(diagramId: string, topicId: string): Promise<void> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics/${encodeURIComponent(topicId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error((await errorMessage(res)) || `Forum post deletion failed (${res.status})`)
}

export async function getForumThread(diagramId: string, topicId: string): Promise<ForumThread> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics/${encodeURIComponent(topicId)}`,
    { headers: authHeaders() },
  )
  if (!res.ok) throw new Error(`Forum thread failed (${res.status})`)
  return await res.json() as ForumThread
}

export async function voteForumTopic(
  diagramId: string,
  topicId: string,
  vote: TopicVoteValue | null,
): Promise<ForumTopic> {
  const res = await fetch(
    `/api/diagrams/${encodeURIComponent(diagramId)}/forums/topics/${encodeURIComponent(topicId)}/vote`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ vote }),
    },
  )
  if (!res.ok) throw new Error((await errorMessage(res)) || `Topic vote failed (${res.status})`)
  return await res.json() as ForumTopic
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

export async function listSocialScores(diagramId: string): Promise<EntitySocialScores> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/forums/social-scores`)
  if (!res.ok) throw new Error(`Social scores failed (${res.status})`)
  const body = await res.json() as Partial<EntitySocialScores>
  return {
    nodeScores: body.nodeScores ?? {},
    edgeScores: body.edgeScores ?? {},
    nodeVotes: body.nodeVotes ?? {},
    edgeVotes: body.edgeVotes ?? {},
  }
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
      headers: { 'content-type': 'application/json', ...authHeaders() },
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
