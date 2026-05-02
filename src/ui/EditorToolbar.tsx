/**
 * EditorToolbar — chrome row mounted at the top of the canvas.
 *
 * Owns Undo / Redo / Delete / Play / Stop and the Save / Load / Record
 * cluster. Buttons disable themselves contextually (no undo stack, no
 * selection, no flow running, recording already in flight) so the chrome
 * accurately mirrors the available actions — same contract as legacy
 * `src/old/ui/EditorToolbar.tsx`.
 *
 * Untangle is deferred until the auto-untangle worker is ported.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useOmniStore } from '../model/store'
import { exportBundle, importBundle } from '../model/projectBundle'
import { importLegacyBundle, type LegacyFetcher } from '../model/legacyImport'
import type { SceneRenderer } from '../scene/SceneRenderer'

interface EditorToolbarProps {
  renderer: SceneRenderer | null
}

/**
 * Resolve the implicit Play root: first selected node, else the first node
 * with no incoming `kind:'flow'` edge (the natural cascade source), else
 * the first node in the model. Returns null only when the model is empty.
 */
function resolvePlayRoot(s: ReturnType<typeof useOmniStore.getState>): string | null {
  if (s.selectedIds.size > 0) return [...s.selectedIds][0]
  const nodes = s.model.nodes
  if (nodes.size === 0) return null
  const incomingFlow = new Set<string>()
  for (const e of s.model.edges.values()) {
    if (e.kind === 'flow') incomingFlow.add(e.to)
  }
  for (const id of nodes.keys()) {
    if (!incomingFlow.has(id)) return id
  }
  return [...nodes.keys()][0]
}

export function EditorToolbar({ renderer }: EditorToolbarProps) {
  // Re-render on store rev / selection changes to refresh enabled states.
  useSyncExternalStore(
    useOmniStore.subscribe,
    () => {
      const s = useOmniStore.getState()
      return s.rev * 65537 + s.selRev
    },
    () => 0,
  )
  const s = useOmniStore.getState()
  const canUndo = s.undoStack.canUndo()
  const canRedo = s.undoStack.canRedo()
  const hasSelection = s.selectedIds.size > 0 || s.selectedEdgeIds.size > 0
  // Play root: prefer the first selected node; otherwise auto-pick the
  // first node with no *incoming* flow edge (cascade source); falling back
  // to the first node in the model. Matches legacy "Play from root" UX.
  const playRootId = resolvePlayRoot(s)
  // Re-render every animation frame while a flow is playing so the Stop
  // button auto-disables when the runs drain. `isFlowPlaying` is a derived
  // boolean read from the renderer (not the store), so we poll cheaply.
  const [, setPulse] = useState(0)
  useEffect(() => {
    if (!renderer) return
    let raf = 0
    const tick = () => {
      setPulse((p) => (p + 1) & 0xffff)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [renderer])
  const isPlaying = renderer?.isFlowPlaying ?? false

  const onDelete = () => {
    const cur = useOmniStore.getState()
    if (cur.selectedIds.size > 0) cur.removeNodes([...cur.selectedIds])
    if (cur.selectedEdgeIds.size > 0) cur.removeEdges([...cur.selectedEdgeIds])
  }

  return (
    <div style={barStyle} role="toolbar" aria-label="Editor toolbar">
      <ToolbarButton
        onClick={() => useOmniStore.getState().undo()}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        ↩ Undo
      </ToolbarButton>
      <ToolbarButton
        onClick={() => useOmniStore.getState().redo()}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
      >
        ↪ Redo
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        onClick={onDelete}
        disabled={!hasSelection}
        title="Delete selection (Del)"
        danger
      >
        ✕ Delete
      </ToolbarButton>
      <Separator />
      {isPlaying ? (
        <ToolbarButton
          onClick={() => renderer?.stopFlow()}
          disabled={!renderer}
          title="Stop flow playback"
          danger
        >
          ⏹ Stop
        </ToolbarButton>
      ) : (
        <ToolbarButton
          onClick={() => playRootId && renderer?.playFlowFromNode(playRootId)}
          disabled={!renderer || !playRootId}
          title={
            playRootId
              ? 'Play flow cascade (from selection if any, else from a flow root)'
              : 'Add at least one node to play'
          }
        >
          ▶ Play
        </ToolbarButton>
      )}
      <Separator />
      <SaveLoadButtons />
      <Separator />
      <RecordingButtons renderer={renderer} />
    </div>
  )
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...buttonStyle,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: danger ? 'var(--ug-danger-bg)' : 'var(--ug-surface-raised)',
        color: danger ? 'var(--ug-danger)' : 'var(--ug-text)',
        borderColor: danger ? 'var(--ug-danger-border)' : 'var(--ug-border)',
      }}
    >
      {children}
    </button>
  )
}

function Separator() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        alignSelf: 'stretch',
        background: 'var(--ug-border-light)',
        margin: '0 2px',
      }}
    />
  )
}

function SaveLoadButtons() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const onSave = async () => {
    const s = useOmniStore.getState()
    const blob = await exportBundle({ rootModelId: s.model.id, models: s.models })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${s.model.name || 'project'}.unigram`
    a.click()
    URL.revokeObjectURL(url)
  }
  const onPick = () => fileRef.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      // Heuristic: legacy v0 model files are plain JSON and are loaded via
      // the multi-file walker. New bundles are zips (`.unigram` / `.zip`).
      const isJson = /\.json$/i.test(file.name) || file.type === 'application/json'
      if (isJson) {
        // Build a synthetic fetcher that resolves sibling files via the same
        // directory as the picked file. The user must pick the *root* JSON;
        // referenced JSONs are loaded as same-directory blobs.
        const text = await file.text()
        const siblings = new Map<string, string>([[`/${file.name}`, text]])
        const fetcher: LegacyFetcher = async (url) => {
          const t = siblings.get(url)
          if (t) return JSON.parse(t)
          // Fall back to network (e.g. when loading the demo from `public/`).
          const r = await fetch(url)
          if (!r.ok) throw new Error(`Cannot resolve ${url}`)
          return r.json()
        }
        const snap = await importLegacyBundle(`/${file.name}`, fetcher)
        useOmniStore.getState().loadProject(snap)
        return
      }
      const snap = await importBundle(file)
      useOmniStore.getState().loadProject(snap)
    } catch (err) {
      console.error('Failed to load:', err)
      alert(`Failed to load: ${(err as Error).message}`)
    }
  }
  // Ctrl/Cmd+S → Save, Ctrl/Cmd+O → Load. Suppressed when typing in a form
  // field so editor inputs keep their normal behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        void onSave()
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        onPick()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <ToolbarButton onClick={onSave} title="Save project as .unigram (Ctrl+S)">
        💾 Save
      </ToolbarButton>
      <ToolbarButton onClick={onPick} title="Load .unigram bundle (Ctrl+O)">
        📂 Load
      </ToolbarButton>
      <input
        ref={fileRef}
        type="file"
        accept=".unigram,.zip,application/zip,.json,application/json"
        style={{ display: 'none' }}
        onChange={onFile}
      />
    </>
  )
}

function RecordingButtons({ renderer }: { renderer: SceneRenderer | null }) {
  const [recording, setRecording] = useState<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null)
  const [busy, setBusy] = useState(false)
  const [obs, setObs] = useState<import('../recording/obsClient').ObsConnection | null>(null)

  // Stop OBS connection on unmount so we don't leak the websocket.
  useEffect(() => () => { obs?.close() }, [obs])

  const onStart = async () => {
    if (!renderer || busy) return
    const canvas = renderer.getCanvas()
    if (!canvas) return
    setBusy(true)
    try {
      const { startCanvasRecording, isRecordingSupported } = await import('../recording/canvasRecorder')
      if (!isRecordingSupported()) {
        alert('Recording is not supported in this browser.')
        return
      }
      setRecording(startCanvasRecording(canvas, 30))
    } finally {
      setBusy(false)
    }
  }
  const onStop = async () => {
    if (!recording || busy) return
    setBusy(true)
    try {
      const blob = await recording.stop()
      const { downloadBlob } = await import('../recording/canvasRecorder')
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
      downloadBlob(blob, `omnigram-${Date.now()}.${ext}`)
    } finally {
      setRecording(null)
      setBusy(false)
    }
  }
  const onObsToggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (obs) {
        const { obsStopRecord } = await import('../recording/obsClient')
        try { await obsStopRecord(obs) } catch { /* ignore */ }
        obs.close()
        setObs(null)
        return
      }
      const host = window.prompt('OBS host:port (e.g. 127.0.0.1:4455)?', '127.0.0.1:4455')
      if (!host) return
      const password = window.prompt('OBS WebSocket password (blank if none):', '') ?? ''
      const [h, portStr] = host.split(':')
      const port = Number(portStr) || 4455
      const { connectObs, obsStartRecord } = await import('../recording/obsClient')
      const conn = await connectObs(h, port, password)
      await obsStartRecord(conn)
      setObs(conn)
    } catch (err) {
      alert('OBS error: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {recording ? (
        <ToolbarButton onClick={onStop} disabled={busy} title="Stop recording and download" danger>
          ⏹ Stop rec
        </ToolbarButton>
      ) : (
        <ToolbarButton onClick={onStart} disabled={busy || !renderer} title="Record canvas to .webm">
          ⏺ Record
        </ToolbarButton>
      )}
      <ToolbarButton onClick={onObsToggle} disabled={busy} title="Toggle OBS recording via WebSocket">
        {obs ? '⏹ OBS' : '◉ OBS'}
      </ToolbarButton>
    </>
  )
}

const barStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 264,
  display: 'flex',
  alignItems: 'stretch',
  gap: 4,
  padding: 4,
  background: 'var(--ug-glass)',
  border: '1px solid var(--ug-border)',
  borderRadius: 6,
  boxShadow: '0 2px 8px var(--ug-shadow)',
  backdropFilter: 'blur(6px)',
  zIndex: 10,
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--ug-border)',
  borderRadius: 3,
  padding: '4px 10px',
  font: '12px system-ui, sans-serif',
  cursor: 'pointer',
}
