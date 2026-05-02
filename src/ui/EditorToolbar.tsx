/**
 * EditorToolbar — chrome row mounted at the top of the canvas.
 *
 * Owns Undo / Redo / Delete and the Save / Load / Record cluster. Buttons
 * disable themselves contextually (no undo stack, no selection, recording
 * already in flight) so the chrome accurately mirrors the available actions
 * — same contract as legacy `src/old/ui/EditorToolbar.tsx`.
 *
 * Untangle and Play/Stop are deferred until the corresponding subsystems
 * land (auto-untangle worker → not yet ported, flow play/stop → already
 * accessible via the per-node flow controls in `RightSidebar`).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useOmniStore } from '../model/store'
import { exportBundle, importBundle } from '../model/projectBundle'
import type { SceneRenderer } from '../scene/SceneRenderer'

interface EditorToolbarProps {
  renderer: SceneRenderer | null
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
        background: danger ? '#3a1a20' : '#1a2030',
        color: danger ? '#fcc' : '#cfe',
        borderColor: danger ? '#6e2a36' : '#384055',
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
        background: '#2a3142',
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
      const snap = await importBundle(file)
      useOmniStore.getState().loadProject(snap)
    } catch (err) {
      console.error('Failed to load bundle:', err)
      alert(`Failed to load bundle: ${(err as Error).message}`)
    }
  }
  return (
    <>
      <ToolbarButton onClick={onSave} title="Save project as .unigram">
        💾 Save
      </ToolbarButton>
      <ToolbarButton onClick={onPick} title="Load .unigram bundle">
        📂 Load
      </ToolbarButton>
      <input
        ref={fileRef}
        type="file"
        accept=".unigram,.zip,application/zip"
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
  background: 'rgba(15, 18, 26, 0.85)',
  border: '1px solid #2a3142',
  borderRadius: 6,
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  backdropFilter: 'blur(6px)',
  zIndex: 10,
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid #384055',
  borderRadius: 3,
  padding: '4px 10px',
  font: '12px system-ui, sans-serif',
  cursor: 'pointer',
}
