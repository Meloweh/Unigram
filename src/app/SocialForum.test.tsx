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
    fireEvent.click(within(form).getByRole('button', { name: 'Add suggested diagram change' }))
    fireEvent.change(within(form).getByLabelText('Proposal source node'), { target: { value: 'Alpha' } })
    fireEvent.change(within(form).getByLabelText('Proposal target node'), { target: { value: 'Gamma' } })
    expect(within(form).queryByLabelText('New name')).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Append current diagram change' }))
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
    fireEvent.click(within(form).getByRole('button', { name: 'Add suggested diagram change' }))
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
    fireEvent.click(within(form).getByRole('button', { name: 'Add suggested diagram change' }))
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

  it('offers account settings from the account popover', async () => {
    const onOpenSettings = vi.fn()
    render(<SocialForumLayer diagramId="d1" renderer={null} onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('closes the account popover when clicking outside it', async () => {
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }))
    expect(await screen.findByRole('menuitem', { name: 'Log out' })).toBeVisible()
    fireEvent.pointerDown(screen.getByLabelText('Forum reference selector'))
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Log out' })).not.toBeInTheDocument())
  })

  it('returns home after logout', async () => {
    const onHome = vi.fn()
    render(<SocialForumLayer diagramId="d1" renderer={null} onHome={onHome} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }))
    await waitFor(() => expect(onHome).toHaveBeenCalledTimes(1))
  })

  it('sends optional label and references with add connection proposals', async () => {
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    await screen.findByRole('button', { name: 'Ada' })
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
    const form = screen.getByLabelText('Create forum post')
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Label a path' } })
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Add a referenced connection' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add suggested diagram change' }))
    fireEvent.change(within(form).getByLabelText('Suggested action'), { target: { value: 'add-edge' } })
    fireEvent.change(within(form).getByLabelText('Proposal source node'), { target: { value: 'Alpha' } })
    fireEvent.change(within(form).getByLabelText('Proposal target node'), { target: { value: 'Beta' } })
    fireEvent.change(within(form).getByLabelText('Connection label'), { target: { value: 'Evidence' } })
    fireEvent.change(within(form).getByLabelText('Connection references'), { target: { value: 'Paper | A. Example | https://example.test' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Append current diagram change' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      const post = calls.find(([url, init]) => url.toString().includes('/forums/topics') && init?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse(String(post?.[1]?.body)) as {
        proposal?: { action?: string; label?: string; references?: Array<{ title: string; citation: string; url: string }> }
      }
      expect(body.proposal?.action).toBe('add-edge')
      expect(body.proposal?.label).toBe('Evidence')
      expect(body.proposal?.references).toEqual([{ title: 'Paper', citation: 'A. Example', url: 'https://example.test' }])
    })
  })

  it('lets chain steps reference queued nodes as preview selector items', async () => {
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    await screen.findByRole('button', { name: 'Ada' })
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
    const form = screen.getByLabelText('Create forum post')
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Queue a small branch' } })
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Create two nodes and connect them' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add suggested diagram change' }))
    fireEvent.change(within(form).getByLabelText('Suggested action'), { target: { value: 'add-node' } })
    fireEvent.change(within(form).getByLabelText('New name'), { target: { value: 'n1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Append current diagram change' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Add suggested diagram change' }))
    fireEvent.change(within(form).getByLabelText('Suggested action'), { target: { value: 'add-node' } })
    fireEvent.change(within(form).getByLabelText('New name'), { target: { value: 'n2' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Append current diagram change' }))

    fireEvent.click(within(form).getByRole('button', { name: 'Add suggested diagram change' }))
    fireEvent.change(within(form).getByLabelText('Suggested action'), { target: { value: 'add-edge' } })
    const source = within(form).getByLabelText('Proposal source node')
    const target = within(form).getByLabelText('Proposal target node')
    fireEvent.change(source, { target: { value: 'n1' } })
    fireEvent.change(target, { target: { value: 'n2' } })
    expect(source.closest('.social-node-suggest')).toHaveClass('is-preview')
    expect(target.closest('.social-node-suggest')).toHaveClass('is-preview')
    fireEvent.click(within(form).getByRole('button', { name: 'Append current diagram change' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      const post = calls.find(([url, init]) => url.toString().includes('/forums/topics') && init?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse(String(post?.[1]?.body)) as {
        proposal?: {
          action?: string
          steps?: Array<{ action: string; nodeId?: string; sourceNodeId?: string; targetNodeId?: string }>
        }
      }
      expect(body.proposal?.action).toBe('chain')
      expect(body.proposal?.steps).toHaveLength(3)
      expect(body.proposal?.steps?.[2]).toMatchObject({
        action: 'add-edge',
        sourceNodeId: body.proposal?.steps?.[0].nodeId,
        targetNodeId: body.proposal?.steps?.[1].nodeId,
      })
    })
  })

  it('stashes post progress on outside click and discards it on Cancel', async () => {
    render(<SocialForumLayer diagramId="d1" renderer={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open forum' }))
    await screen.findByRole('button', { name: 'Ada' })
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
    let form = screen.getByLabelText('Create forum post')
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Draft title' } })
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Draft body' } })
    fireEvent.pointerDown(form.parentElement as HTMLElement)
    await waitFor(() => expect(screen.queryByLabelText('Create forum post')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    form = screen.getByLabelText('Create forum post')
    expect(within(form).getByLabelText('Title')).toHaveValue('Draft title')
    expect(within(form).getByLabelText('Description')).toHaveValue('Draft body')
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Create forum post')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    form = screen.getByLabelText('Create forum post')
    expect(within(form).getByLabelText('Title')).toHaveValue('')
    expect(within(form).getByLabelText('Description')).toHaveValue('')
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
