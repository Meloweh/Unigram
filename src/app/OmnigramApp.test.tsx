import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OmnigramApp } from './OmnigramApp'
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
  const model = { id: 'root', name: 'Public graph', nodes: new Map(), edges: new Map() }
  useOmniStore.setState({
    model,
    models: new Map([['root', model]]),
    selectedIds: new Set(),
    selectedEdgeIds: new Set(),
    rev: 0,
    selRev: 0,
  })
})

describe('OmnigramApp creative mode rail', () => {
  it('opens a creative copy chooser for logged-in users', async () => {
    window.localStorage.setItem('omnigram-social-session', 'test-token')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('/api/auth/preferences')) return jsonResponse({ preferences: {} })
      if (url.includes('/api/auth/me')) {
        return jsonResponse({ user: { id: 'u1', username: 'Ada', reputation: 0, preferences: {} } })
      }
      if (url.includes('/api/diagrams/d1/creative-copies')) {
        return jsonResponse({
          diagrams: [{
            id: 'c1',
            title: 'Private copy',
            visibility: 'private',
            ownerUserId: 'u1',
            sourceDiagramId: 'd1',
            sourceTitle: 'Public graph',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            visits: 0,
            popularity: 0,
          }],
        })
      }
      return jsonResponse({})
    }))

    render(
      <OmnigramApp
        cloudDiagramId="d1"
        sourceDiagramTitle="Public graph"
        onOpenCreativeDiagram={vi.fn()}
        chrome={{ sidebars: false, toolbar: false, devPanel: false, fps: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Creative Mode' }))

    expect(await screen.findByRole('dialog', { name: 'Choose creative copy' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Private copy/ })).toBeVisible()
  })

  it('requires login before opening Creative Mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    render(
      <OmnigramApp
        cloudDiagramId="d1"
        sourceDiagramTitle="Public graph"
        onOpenCreativeDiagram={vi.fn()}
        chrome={{ sidebars: false, toolbar: false, devPanel: false, fps: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Creative Mode' }))

    expect(await screen.findByRole('dialog', { name: 'Creative Mode login' })).toBeVisible()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
