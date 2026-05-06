import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { DiagramSummary } from '../social/cloudClient'
import { createCloudDiagram, searchCloudDiagrams } from '../social/cloudClient'

interface SocialHomeProps {
  onOpenDiagram: (diagram: DiagramSummary) => Promise<void>
}

export function SocialHome({ onOpenDiagram }: SocialHomeProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DiagramSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const newTitle = useMemo(() => query.trim() || 'Untitled diagram', [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const timeout = window.setTimeout(() => {
      void searchCloudDiagrams(query)
        .then((items) => {
          if (!cancelled) setResults(items)
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query])

  const open = async (diagram: DiagramSummary) => {
    setOpeningId(diagram.id)
    setError(null)
    try {
      await onOpenDiagram(diagram)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open diagram')
    } finally {
      setOpeningId(null)
    }
  }

  const createNew = async () => {
    setOpeningId('__new__')
    setError(null)
    try {
      const diagram = await createCloudDiagram(newTitle)
      await onOpenDiagram(diagram)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create diagram')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <main style={pageStyle}>
      <section style={searchShellStyle} aria-label="Diagram search">
        <div style={brandRowStyle}>
          <div style={brandMarkStyle}>O</div>
          <div>
            <h1 style={titleStyle}>Omnigram</h1>
            <p style={subtitleStyle}>Search diagrams by title or start a new shared graph.</p>
          </div>
        </div>

        <label style={searchLabelStyle}>
          <span style={searchLabelTextStyle}>Search diagrams</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a title..."
            style={searchInputStyle}
          />
        </label>

        <div style={resultsPanelStyle}>
          <div style={resultsHeaderStyle}>
            <span>Results</span>
            {loading && <span style={mutedStyle}>Searching...</span>}
          </div>
          {error && <div style={errorStyle}>{error}</div>}
          {!error && results.map((diagram) => (
            <button
              key={diagram.id}
              type="button"
              onClick={() => void open(diagram)}
              disabled={openingId !== null}
              style={resultButtonStyle}
            >
              <span style={resultTitleStyle}>{diagram.title}</span>
              <span style={resultMetaStyle}>
                {diagram.visits} visits · updated {formatDate(diagram.updatedAt)}
              </span>
            </button>
          ))}
          {!loading && !error && results.length === 0 && (
            <div style={emptyStyle}>No matching diagrams yet.</div>
          )}
          <button
            type="button"
            onClick={() => void createNew()}
            disabled={openingId !== null}
            style={{ ...resultButtonStyle, ...newButtonStyle }}
          >
            <span style={resultTitleStyle}>+ New</span>
            <span style={resultMetaStyle}>Create “{newTitle}”</span>
          </button>
        </div>
      </section>

      <aside style={placeholderPanelStyle} aria-label="Future suggestions">
        <h2 style={sectionTitleStyle}>Suggestions</h2>
        <PlaceholderCard title="Most popular" text="Prepared for ranked public diagrams." />
        <PlaceholderCard title="Personalized" text="Prepared for account-based recommendations." />
        <PlaceholderCard title="Last visited" text="Prepared for local and cloud visit history." />
      </aside>
    </main>
  )
}

function PlaceholderCard({ title, text }: { title: string; text: string }) {
  return (
    <div style={placeholderCardStyle}>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 720px) minmax(260px, 360px)',
  alignItems: 'start',
  justifyContent: 'center',
  gap: 24,
  padding: '56px 32px',
  background: 'linear-gradient(135deg, #edf5fc, #dfeaf5)',
  color: '#17314f',
  boxSizing: 'border-box',
}

const searchShellStyle: CSSProperties = {
  display: 'grid',
  gap: 22,
}

const brandRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
}

const brandMarkStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  display: 'grid',
  placeItems: 'center',
  background: '#365f8f',
  color: '#fff',
  font: '700 24px system-ui, sans-serif',
}

const titleStyle: CSSProperties = {
  margin: 0,
  font: '700 34px system-ui, sans-serif',
}

const subtitleStyle: CSSProperties = {
  margin: '4px 0 0',
  color: '#4a6e90',
  font: '15px system-ui, sans-serif',
}

const searchLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
}

const searchLabelTextStyle: CSSProperties = {
  font: '700 13px system-ui, sans-serif',
  color: '#365f8f',
}

const searchInputStyle: CSSProperties = {
  height: 52,
  border: '1px solid #b9cde2',
  borderRadius: 8,
  padding: '0 16px',
  font: '18px system-ui, sans-serif',
  outline: 'none',
  background: '#fff',
  color: '#17314f',
  boxShadow: '0 8px 24px rgba(19, 41, 73, 0.08)',
}

const resultsPanelStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 10,
  border: '1px solid #c8d8ea',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.72)',
  boxShadow: '0 10px 30px rgba(19, 41, 73, 0.10)',
}

const resultsHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 6px 8px',
  color: '#365f8f',
  font: '700 13px system-ui, sans-serif',
}

const resultButtonStyle: CSSProperties = {
  minHeight: 64,
  display: 'grid',
  justifyItems: 'start',
  gap: 4,
  padding: '10px 12px',
  border: '1px solid transparent',
  borderRadius: 6,
  background: '#fff',
  color: '#17314f',
  cursor: 'pointer',
  textAlign: 'left',
}

const newButtonStyle: CSSProperties = {
  borderColor: '#9bb7d2',
  background: '#edf6ff',
}

const resultTitleStyle: CSSProperties = {
  font: '700 16px system-ui, sans-serif',
}

const resultMetaStyle: CSSProperties = {
  color: '#5f7790',
  font: '13px system-ui, sans-serif',
}

const placeholderPanelStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 14,
  border: '1px solid #c8d8ea',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.58)',
}

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 4px',
  font: '700 16px system-ui, sans-serif',
  color: '#365f8f',
}

const placeholderCardStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 12,
  border: '1px dashed #b6c9dc',
  borderRadius: 6,
  color: '#5f7790',
  font: '13px system-ui, sans-serif',
  background: 'rgba(255,255,255,0.54)',
}

const mutedStyle: CSSProperties = {
  color: '#6b7f93',
  fontWeight: 500,
}

const errorStyle: CSSProperties = {
  padding: 12,
  borderRadius: 6,
  background: 'rgba(220,38,38,0.08)',
  color: '#b91c1c',
  font: '600 13px system-ui, sans-serif',
}

const emptyStyle: CSSProperties = {
  padding: 12,
  color: '#6b7f93',
  font: '14px system-ui, sans-serif',
}
