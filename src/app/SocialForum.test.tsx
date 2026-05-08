import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialForumLayer } from './SocialForum'
import { useOmniStore } from '../model/store'

beforeEach(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })
  window.localStorage.setItem('omnigram-social-session', 'test-token')
  const model = { id: 'root', name: 'social test', nodes: new Map(), edges: new Map() }
  useOmniStore.setState({
    model,
    models: new Map([['root', model]]),
    camera: { panX: 0, panY: 0, freeScale: 1 },
    selectedIds: new Set(),
    selectedEdgeIds: new Set(),
    rev: 0,
    selRev: 0,
    defaultConnectionKind: 'flow',
    clipboard: null,
    lastPasteAt: 0,
    pickMode: null,
  })
  const a = useOmniStore.getState().addNode({ id: 'a', x: 10, y: 10, label: 'Alpha' })
  const b = useOmniStore.getState().addNode({ id: 'b', x: 30, y: 10, label: 'Beta' })
  useOmniStore.getState().addEdge(a, b, { id: 'edge-ab' })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    if (url.includes('/api/auth/me')) {
      return jsonResponse({ user: { id: 'u1', username: 'Ada' } })
    }
    if (url.includes('/forums/proposals')) {
      return jsonResponse({ proposals: [] })
    }
    if (url.includes('/forums/topics') && init?.method === 'POST') {
      return jsonResponse({
        id: 'topic-1',
        diagramId: 'd1',
        forumRef: 'diagram',
        title: 'Add beta path',
        description: 'Try a new branch',
        author: 'Ada',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        views: 0,
        commentCount: 0,
        agreementRatio: 0,
        proposalId: 'p1',
      }, 201)
    }
    if (url.includes('/forums/topics')) {
      return jsonResponse({ topics: [] })
    }
    return jsonResponse({})
  }))
})

describe('SocialForumLayer', () => {
  it('opens the curtain with selector, mini view, and post button', async () => {
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    expect(await screen.findByLabelText('Forum reference selector')).toBeVisible()
    expect(screen.getByLabelText('Mini diagram view')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Post' })).toBeVisible()
  })

  it('creates a proposal topic from the post modal', async () => {
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    await screen.findByRole('button', { name: 'Ada' })
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
    const form = screen.getByLabelText('Create forum post')
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Add beta path' } })
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Try a new branch' } })
    fireEvent.click(within(form).getByLabelText('Suggest diagram change'))
    fireEvent.change(within(form).getByLabelText('Proposal source node'), { target: { value: 'Alpha' } })
    fireEvent.change(within(form).getByLabelText('Proposal target node'), { target: { value: 'Gamma' } })
    expect(within(form).queryByLabelText('New name')).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      const post = calls.find(([url, init]) => url.toString().includes('/forums/topics') && init?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse(String(post?.[1]?.body)) as {
        forumRef?: string
        proposal?: { action?: string; newNodeLabel?: string }
      }
      expect(body.forumRef).toBe('diagram')
      expect(body.proposal?.action).toBe('add-node-edge')
      expect(body.proposal?.newNodeLabel).toBe('Gamma')
    })
  })

  it('keeps standalone Add Node proposals available when the graph has nodes', async () => {
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    await screen.findByRole('button', { name: 'Ada' })
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
    const form = screen.getByLabelText('Create forum post')
    fireEvent.click(within(form).getByLabelText('Suggest diagram change'))
    const action = within(form).getByLabelText('Suggested action')
    expect(within(action).getByRole('option', { name: 'Add Node' })).toBeInTheDocument()
    expect(within(action).getByRole('option', { name: 'Add node and connection' })).toBeInTheDocument()
  })

  it('restricts proposal actions to Add Node when the graph is empty', async () => {
    const model = { id: 'root', name: 'empty test', nodes: new Map(), edges: new Map() }
    useOmniStore.getState().loadModel(model)
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    await screen.findByRole('button', { name: 'Ada' })
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
    const form = screen.getByLabelText('Create forum post')
    fireEvent.click(within(form).getByLabelText('Suggest diagram change'))
    const action = within(form).getByLabelText('Suggested action')
    expect(action).toHaveValue('add-node')
    expect(within(action).getByRole('option', { name: 'Add Node' })).toBeInTheDocument()
    expect(within(action).queryByRole('option', { name: 'Add node and connection' })).not.toBeInTheDocument()
  })

  it('opens the forum selector on the current graph selection', async () => {
    useOmniStore.getState().selectMany(['a', 'b'], ['edge-ab'])
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    expect(await screen.findByLabelText('Source')).toHaveValue('Alpha')
    expect(screen.getByLabelText('Target')).toHaveValue('Beta')
    expect(screen.getByLabelText('Connection selector')).toHaveTextContent('→')
  })

  it('restores the graph camera when the forum curtain closes', async () => {
    useOmniStore.getState().setCamera({ panX: 120, panY: -70, freeScale: 1.6 })
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    await screen.findByLabelText('Forum reference selector')
    useOmniStore.getState().setCamera({ panX: -900, panY: 400, freeScale: 0.2 })
    fireEvent.click(screen.getByRole('button', { name: 'View graph' }))
    expect(useOmniStore.getState().camera).toEqual({ panX: 120, panY: -70, freeScale: 1.6 })
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
