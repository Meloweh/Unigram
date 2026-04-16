import { useRef } from 'react'

export interface EditorToolbarProps {
  hideToolbar: boolean
  undoDisabled: boolean
  redoDisabled: boolean
  deleteDisabled: boolean
  isUntangling: boolean
  selectedNodeIsInFlow: boolean
  isFlowPlaying: boolean
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onUntangle: () => void
  onStartFlow: () => void
  onStopFlow: () => void
  onSave: () => void
  onLoad: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function EditorToolbar({
  hideToolbar, undoDisabled, redoDisabled, deleteDisabled,
  isUntangling, selectedNodeIsInFlow, isFlowPlaying,
  onUndo, onRedo, onDelete, onUntangle, onStartFlow, onStopFlow,
  onSave, onLoad,
}: EditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="editor-toolbar" style={hideToolbar ? { visibility: 'hidden' } : undefined}>
      <button
        type="button"
        className="toolbar-btn"
        disabled={undoDisabled}
        onClick={onUndo}
        title="Undo (Ctrl+Z)"
      >&#x21A9; Undo</button>
      <button
        type="button"
        className="toolbar-btn"
        disabled={redoDisabled}
        onClick={onRedo}
        title="Redo (Ctrl+Shift+Z)"
      >&#x21AA; Redo</button>
      <span className="toolbar-sep" />
      <button
        type="button"
        className="toolbar-btn"
        disabled={deleteDisabled}
        onClick={onDelete}
        title="Delete selected node (Del)"
      >&#x2715; Delete</button>
      <span className="toolbar-sep" />
      <button
        type="button"
        className="toolbar-btn"
        disabled={isUntangling}
        onClick={onUntangle}
        title="Auto-untangle crossed connections"
      >{isUntangling ? '⟳ Untangling…' : '⟳ Untangle'}</button>

      {selectedNodeIsInFlow && (
        <>
          <span className="toolbar-sep" />
          {isFlowPlaying ? (
            <button
              type="button"
              className="toolbar-btn toolbar-btn-stop"
              onClick={onStopFlow}
              title="Stop flow animation"
            >&#x25A0; Stop</button>
          ) : (
            <button
              type="button"
              className="toolbar-btn toolbar-btn-play"
              onClick={onStartFlow}
              title="Play flow animation from selected node"
            >&#x25B6; Play</button>
          )}
        </>
      )}
      <span className="toolbar-sep" />
      <button
        type="button"
        className="toolbar-btn"
        onClick={onSave}
        title="Save project (JSON)"
      >&#x1F4BE; Save</button>
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => fileInputRef.current?.click()}
        title="Load project"
      >&#x1F4C2; Load</button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".unigram,.zip,.json"
        style={{ display: 'none' }}
        onChange={onLoad}
      />
    </div>
  )
}
