/**
 * EditorToolbar — chrome row mounted at the top of the canvas.
 *
 * Owns Undo / Redo / Delete / Play / Stop
 * cluster. Buttons disable themselves contextually (no undo stack, no
 * selection, no flow running, recording already in flight) so the chrome
 * accurately mirrors the available actions — same contract as legacy
 * `src/old/ui/EditorToolbar.tsx`.
 *
 * Untangle is deferred until the auto-untangle worker is ported.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useOmniStore } from '../model/store'
import { computeUntangledPositions } from '../viewport/untangle'
import type { SceneRenderer } from '../scene/SceneRenderer'

interface EditorToolbarProps {
  renderer: SceneRenderer | null
  onHome?: () => void
  onApplyToMainGraph?: () => void
  applyToMainDisabled?: boolean
  applyToMainTitle?: string
  onPullMerge?: () => void
  pullMergeDisabled?: boolean
  pullMergeTitle?: string
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
    if (e.kind === 'flow' || e.cameraTracked === true) incomingFlow.add(e.to)
  }
  for (const id of nodes.keys()) {
    if (!incomingFlow.has(id)) return id
  }
  return [...nodes.keys()][0]
}

export function EditorToolbar({
  renderer,
  onHome,
  onApplyToMainGraph,
  applyToMainDisabled,
  applyToMainTitle,
  onPullMerge,
  pullMergeDisabled,
  pullMergeTitle,
}: EditorToolbarProps) {
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
  const untangleRaf = useRef(0)
  const [untangleActive, setUntangleActive] = useState(false)
  useEffect(() => () => {
    if (untangleRaf.current) cancelAnimationFrame(untangleRaf.current)
  }, [])
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

  return (
    <div style={barStyle} role="toolbar" aria-label="Editor toolbar">
      {onHome && (
        <>
          <ToolbarButton onClick={onHome} title="Back to diagram search">
            Home
          </ToolbarButton>
          <Separator />
        </>
      )}
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
      <ToolbarButton
        onClick={() => {
          if (!renderer || untangleActive) return
          const cur = useOmniStore.getState()
          if (cur.model.nodes.size === 0) return
          const targets = computeUntangledPositions(cur.model.nodes.values(), cur.model.edges.values())
          const baselines: Array<{ id: string; x: number; y: number }> = []
          const final: Array<{ id: string; x: number; y: number }> = []
          for (const [id, p] of targets) {
            const node = cur.model.nodes.get(id)
            if (!node || node.locked) continue
            if (Math.abs(node.x - p.x) < 0.001 && Math.abs(node.y - p.y) < 0.001) continue
            baselines.push({ id, x: node.x, y: node.y })
            final.push({ id, x: p.x, y: p.y })
          }
          if (baselines.length === 0) return
          setUntangleActive(true)
          const startedAt = performance.now()
          const durationMs = 650
          const tick = (now: number) => {
            const raw = Math.min(1, (now - startedAt) / durationMs)
            const t = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2
            renderer.moveNodesDirect(final.map((p, i) => ({
              id: p.id,
              x: baselines[i].x + (p.x - baselines[i].x) * t,
              y: baselines[i].y + (p.y - baselines[i].y) * t,
            })), { updateIndex: false })
            if (raw < 1) {
              untangleRaf.current = requestAnimationFrame(tick)
              return
            }
            untangleRaf.current = 0
            renderer.reindexNodes(baselines.map((b) => b.id))
            useOmniStore.getState().commitDrag(baselines)
            setUntangleActive(false)
          }
          if (untangleRaf.current) cancelAnimationFrame(untangleRaf.current)
          untangleRaf.current = requestAnimationFrame(tick)
        }}
        disabled={!renderer || s.model.nodes.size === 0 || isPlaying || untangleActive}
        title="Auto-arrange nodes to reduce edge crossings (force-directed)"
      >
        🪢 Untangle
      </ToolbarButton>
      {(onApplyToMainGraph || onPullMerge) && <Separator />}
      {onApplyToMainGraph && (
        <ToolbarButton
          onClick={onApplyToMainGraph}
          disabled={applyToMainDisabled}
          title={applyToMainTitle ?? 'Create a main graph proposal from this creative copy'}
        >
          Apply to main graph
        </ToolbarButton>
      )}
      {onPullMerge && (
        <ToolbarButton
          onClick={onPullMerge}
          disabled={pullMergeDisabled}
          title={pullMergeTitle ?? 'Pull public graph changes into this creative copy'}
        >
          Pull & Merge
        </ToolbarButton>
      )}
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

// Recording is now exposed as `record` and `obs-record` flow effect kinds
// (legacy Unigram parity) — the renderer handles the side-effects via
// `FlowRuntime.onRecord` / `onObsRecord`. The previous toolbar buttons were
// removed so recording is always tied to a deterministic flow trigger.

const scaled = (px: number) => `calc(${px}px * var(--ug-ui-scale))`

const barStyle: React.CSSProperties = {
  position: 'absolute',
  // Bottom-centred (legacy Unigram parity). `translateX(-50%)` recentres
  // after `left:50%` so the bar is anchored from its own midpoint.
  bottom: scaled(8),
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'stretch',
  gap: scaled(4),
  padding: scaled(4),
  background: 'var(--ug-glass)',
  border: '1px solid var(--ug-border)',
  borderRadius: scaled(6),
  boxShadow: '0 2px 8px var(--ug-shadow)',
  backdropFilter: 'blur(6px)',
  zIndex: 10,
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--ug-border)',
  borderRadius: scaled(3),
  padding: `${scaled(4)} ${scaled(10)}`,
  font: `${scaled(12)} system-ui, sans-serif`,
  cursor: 'pointer',
}
