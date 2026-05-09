import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { CreativeDiagramSummary, DiagramSuggestion, DiagramSummary, AuthUser } from '../social/cloudClient'
import { createCloudDiagram, getCurrentAccount, listCreativeDiagrams, listDiagramSuggestions, searchCloudDiagrams } from '../social/cloudClient'

interface SocialHomeProps {
  onOpenDiagram: (diagram: DiagramSummary) => Promise<void>
  onOpenCreativeDiagram: (diagram: CreativeDiagramSummary) => Promise<void>
}

export function SocialHome({ onOpenDiagram, onOpenCreativeDiagram }: SocialHomeProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DiagramSummary[]>([])
  const [suggestions, setSuggestions] = useState<DiagramSuggestion[]>([])
  const [creativeGraphs, setCreativeGraphs] = useState<CreativeDiagramSummary[]>([])
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [creativeLoading, setCreativeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [creativeError, setCreativeError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupTitle, setSetupTitle] = useState('')
  const [setupTopic, setSetupTopic] = useState('')
  const [setupDescription, setSetupDescription] = useState('')
  const newTitle = useMemo(() => query.trim(), [query])
  const hasExactTitle = useMemo(
    () => results.some((diagram) => normalizeTitle(diagram.title) === normalizeTitle(newTitle)),
    [results, newTitle],
  )
  const canCreate = newTitle.length > 0 && !hasExactTitle

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

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setCreativeLoading(true)
      setSuggestionLoading(true)
      setCreativeError(null)
      setSuggestionError(null)
      try {
        const account = await getCurrentAccount()
        if (cancelled) return
        setCurrentUser(account)
        const suggestionItems = await listDiagramSuggestions()
        if (!cancelled) setSuggestions(suggestionItems)
        if (!account) {
          setCreativeGraphs([])
          return
        }
        const graphs = await listCreativeDiagrams()
        if (!cancelled) setCreativeGraphs(graphs)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Home data failed'
          setCreativeError(message)
          setSuggestionError(message)
        }
      } finally {
        if (!cancelled) {
          setCreativeLoading(false)
          setSuggestionLoading(false)
        }
      }
    }
    const reload = () => void load()
    reload()
    window.addEventListener('omnigram-auth-changed', reload)
    return () => {
      cancelled = true
      window.removeEventListener('omnigram-auth-changed', reload)
    }
  }, [])

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

  const openCreative = async (diagram: CreativeDiagramSummary) => {
    setOpeningId(diagram.id)
    setError(null)
    try {
      await onOpenCreativeDiagram(diagram)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open creative graph')
    } finally {
      setOpeningId(null)
    }
  }

  const openSetup = () => {
    setSetupTitle(newTitle)
    setSetupTopic(`${newTitle} forum`)
    setSetupDescription('')
    setSetupOpen(true)
  }

  const createNew = async (event: FormEvent) => {
    event.preventDefault()
    const title = setupTitle.trim()
    if (!title) {
      setError('Project name is required')
      return
    }
    setOpeningId('__new__')
    setError(null)
    try {
      const diagram = await createCloudDiagram({
        title,
        topic: setupTopic.trim(),
        description: setupDescription.trim(),
      })
      setSuggestions(await listDiagramSuggestions())
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
            <span>Suggestions</span>
            {loading && <span style={mutedStyle}>Searching...</span>}
          </div>
          {error && <div style={errorStyle}>{error}</div>}
          {!error && results.length > 0 && (
            <div style={suggestionsListStyle}>
              {results.map((diagram) => (
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
            </div>
          )}
          {!loading && !error && results.length === 0 && newTitle.length > 0 && (
            <div style={emptyStyle}>No matching diagrams yet.</div>
          )}
          {!loading && !error && newTitle.length === 0 && (
            <div style={emptyStyle}>Type a diagram title to search or create.</div>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={openSetup}
              disabled={openingId !== null}
              style={newButtonStyle}
            >
              <span style={newBadgeStyle}>+ New</span>
              <span style={newButtonTextStyle}>Create “{newTitle}”</span>
            </button>
          )}
        </div>
      </section>

      <aside style={placeholderPanelStyle} aria-label="Diagram suggestions">
        <h2 style={sectionTitleStyle}>Suggestions</h2>
        {suggestionLoading && <span style={mutedStyle}>Loading recommendations...</span>}
        {suggestionError && <div style={errorStyle}>{suggestionError}</div>}
        {!suggestionError && suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.kind}
            suggestion={suggestion}
            opening={openingId !== null}
            onOpen={open}
          />
        ))}
        <section style={creativePanelStyle} aria-label="Your creative graphs">
          <div style={creativeHeaderStyle}>
            <h2 style={sectionTitleStyle}>Your Creative Graphs</h2>
            {creativeLoading && <span style={mutedStyle}>Loading...</span>}
          </div>
          {!currentUser && <div style={creativeEmptyStyle}>Log in from a graph to keep private creative copies here.</div>}
          {currentUser && creativeError && <div style={errorStyle}>{creativeError}</div>}
          {currentUser && !creativeError && creativeGraphs.length === 0 && (
            <div style={creativeEmptyStyle}>Private Creative Mode copies will appear here.</div>
          )}
          {currentUser && creativeGraphs.length > 0 && (
            <div style={creativeListStyle}>
              {creativeGraphs.map((graph) => (
                <button
                  key={graph.id}
                  type="button"
                  onClick={() => void openCreative(graph)}
                  disabled={openingId !== null}
                  style={creativeGraphButtonStyle}
                >
                  <span style={resultTitleStyle}>{graph.title}</span>
                  <span style={resultMetaStyle}>
                    {graph.sourceTitle ? `from ${graph.sourceTitle} · ` : ''}updated {formatDate(graph.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>
      {setupOpen && (
        <div style={setupBackdropStyle} role="presentation">
          <form
            style={setupDialogStyle}
            role="dialog"
            aria-modal="true"
            aria-label="New graph setup"
            onSubmit={(event) => void createNew(event)}
          >
            <header style={setupHeaderStyle}>
              <h2 style={setupTitleStyle}>New graph</h2>
              <button
                type="button"
                onClick={() => setSetupOpen(false)}
                disabled={openingId !== null}
                style={setupGhostButtonStyle}
              >
                Cancel
              </button>
            </header>
            <label style={setupLabelStyle}>
              Project name
              <input
                value={setupTitle}
                onChange={(e) => setSetupTitle(e.target.value)}
                style={setupInputStyle}
              />
            </label>
            <label style={setupLabelStyle}>
              Topic
              <input
                value={setupTopic}
                onChange={(e) => setSetupTopic(e.target.value)}
                placeholder="Diagram forum"
                style={setupInputStyle}
              />
            </label>
            <label style={setupLabelStyle}>
              Project description
              <textarea
                value={setupDescription}
                onChange={(e) => setSetupDescription(e.target.value)}
                placeholder="Briefly describe what this graph is about."
                style={setupTextareaStyle}
              />
            </label>
            <button type="submit" disabled={openingId !== null} style={setupPrimaryButtonStyle}>
              Create graph
            </button>
          </form>
        </div>
      )}
    </main>
  )
}

function SuggestionCard({
  suggestion,
  opening,
  onOpen,
}: {
  suggestion: DiagramSuggestion
  opening: boolean
  onOpen: (diagram: DiagramSummary) => Promise<void>
}) {
  const diagram = suggestion.diagram
  if (!diagram) {
    return (
      <div style={placeholderCardStyle}>
        <strong>{suggestion.title}</strong>
        <span>{suggestion.reason}</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      style={suggestionButtonStyle}
      disabled={opening}
      onClick={() => void onOpen(diagram)}
    >
      <span style={suggestionSlotStyle}>{suggestion.title}</span>
      <strong>{diagram.title}</strong>
      <span>{diagram.topic ? `${diagram.topic} · ` : ''}{diagram.visits} visits</span>
      <small>{suggestion.reason}</small>
    </button>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
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
  gap: 10,
  padding: 12,
  border: '1px solid #c8d8ea',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.82)',
  boxShadow: '0 14px 36px rgba(19, 41, 73, 0.11)',
}

const resultsHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 6px 8px',
  color: '#365f8f',
  font: '700 13px system-ui, sans-serif',
}

const suggestionsListStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
}

const resultButtonStyle: CSSProperties = {
  minHeight: 62,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  justifyItems: 'start',
  gap: 5,
  padding: '11px 13px',
  border: '1px solid #edf2f8',
  borderRadius: 6,
  background: 'linear-gradient(180deg, #fff, #f9fcff)',
  color: '#17314f',
  cursor: 'pointer',
  textAlign: 'left',
  boxShadow: '0 1px 0 rgba(19, 41, 73, 0.03)',
}

const newButtonStyle: CSSProperties = {
  minHeight: 56,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  border: '1px solid #96b7d6',
  borderRadius: 6,
  background: 'linear-gradient(180deg, #edf7ff, #dfefff)',
  color: '#17314f',
  cursor: 'pointer',
  textAlign: 'left',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)',
}

const resultTitleStyle: CSSProperties = {
  font: '700 16px system-ui, sans-serif',
}

const resultMetaStyle: CSSProperties = {
  color: '#5f7790',
  font: '13px system-ui, sans-serif',
}

const newBadgeStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'grid',
  placeItems: 'center',
  minWidth: 58,
  minHeight: 30,
  borderRadius: 6,
  background: '#365f8f',
  color: '#fff',
  font: '800 13px system-ui, sans-serif',
}

const newButtonTextStyle: CSSProperties = {
  minWidth: 0,
  color: '#21486f',
  font: '700 15px system-ui, sans-serif',
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

const suggestionButtonStyle: CSSProperties = {
  ...placeholderCardStyle,
  border: '1px solid #b9cde2',
  borderLeft: '4px solid #365f8f',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.84), rgba(239,246,253,0.72))',
  color: '#17314f',
  cursor: 'pointer',
  textAlign: 'left',
  boxShadow: '0 8px 22px rgba(19, 41, 73, 0.07)',
}

const suggestionSlotStyle: CSSProperties = {
  width: 'fit-content',
  padding: '3px 8px',
  borderRadius: 999,
  background: '#e2eef9',
  color: '#365f8f',
  font: '800 11px system-ui, sans-serif',
}

const creativePanelStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 8,
  paddingTop: 12,
  borderTop: '1px solid #c8d8ea',
}

const creativeHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const creativeListStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
}

const creativeGraphButtonStyle: CSSProperties = {
  ...resultButtonStyle,
  minHeight: 54,
  background: 'linear-gradient(180deg, #f5f9ff, #e8f1fa)',
  border: '1px solid #b9cde2',
}

const creativeEmptyStyle: CSSProperties = {
  padding: 12,
  border: '1px dashed #b6c9dc',
  borderRadius: 6,
  color: '#5f7790',
  font: '13px system-ui, sans-serif',
  background: 'rgba(255,255,255,0.42)',
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

const setupBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: 'rgba(15, 28, 44, 0.34)',
  boxSizing: 'border-box',
}

const setupDialogStyle: CSSProperties = {
  width: 'min(620px, 100%)',
  display: 'grid',
  gap: 16,
  padding: 22,
  border: '1px solid #b9cde2',
  borderRadius: 8,
  background: '#ffffff',
  color: '#17314f',
  boxShadow: '0 24px 70px rgba(19, 41, 73, 0.22)',
}

const setupHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

const setupTitleStyle: CSSProperties = {
  margin: 0,
  font: '700 22px system-ui, sans-serif',
}

const setupLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 7,
  color: '#365f8f',
  font: '700 13px system-ui, sans-serif',
}

const setupInputStyle: CSSProperties = {
  minHeight: 42,
  border: '1px solid #b9cde2',
  borderRadius: 6,
  padding: '8px 11px',
  color: '#17314f',
  font: '15px system-ui, sans-serif',
}

const setupTextareaStyle: CSSProperties = {
  ...setupInputStyle,
  minHeight: 118,
  resize: 'vertical',
}

const setupPrimaryButtonStyle: CSSProperties = {
  minHeight: 44,
  border: '1px solid #284f79',
  borderRadius: 6,
  background: '#365f8f',
  color: '#fff',
  cursor: 'pointer',
  font: '800 14px system-ui, sans-serif',
}

const setupGhostButtonStyle: CSSProperties = {
  border: '1px solid #c8d8ea',
  borderRadius: 6,
  background: '#f8fbff',
  color: '#365f8f',
  cursor: 'pointer',
  padding: '8px 12px',
  font: '700 13px system-ui, sans-serif',
}
