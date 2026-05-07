import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('/api/diagrams?q=Existing')) {
        return jsonResponse({
          diagrams: [{
            id: 'd-existing',
            title: 'Existing',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            visits: 2,
            popularity: 2,
          }],
        })
      }
      return jsonResponse({ diagrams: [] })
    }))
  })

  it('renders the social diagram search without an empty-title create action', () => {
    render(<App />)
    expect(screen.getByRole('textbox', { name: /search diagrams/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\+ new/i })).not.toBeInTheDocument()
  })

  it('shows + New only for non-existing typed titles', async () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: /search diagrams/i }), { target: { value: 'Fresh' } })
    expect(await screen.findByRole('button', { name: /\+ new/i })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: /search diagrams/i }), { target: { value: 'Existing' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: /\+ new/i })).not.toBeInTheDocument())
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
