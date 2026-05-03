/**
 * Flow effect editor — a small React/SVG modal for authoring `FlowEffect`
 * graphs. Effect graphs are tiny (typically ≤ 10 nodes) so a Pixi
 * sub-renderer would be overkill; plain SVG keeps the implementation small
 * and makes the editor independent of the diagram renderer.
 *
 * The editor mutates a *local* copy; the parent decides whether to play it
 * one-shot or attach it as an always-play loop on save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EffectNode, FlowEffect, FlowEffectKind } from './types'
import { useOmniStore } from '../model/store'
import type { CrossEffectLink } from '../model/types'

/** Stable empty fallback for `linkedNodeIds` selector. */
const EMPTY_LINKED: readonly string[] = []
/** Stable empty fallback for `crossLinks` selector. */
const EMPTY_CROSS_LINKS: readonly CrossEffectLink[] = []


const KINDS: FlowEffectKind[] = [
  'wait',
  'move',
  'scale',
  'color',
  'jitter',
  'float',
  'emerge',
  'dismiss',
  'cloud-levitate',
  'bubble-levitate',
  'repeater',
  'camera',
  'break',
  'text-generator',
  'record',
  'obs-record',
  'handoff-rmm',
  'return-rmm',
  'handoff-mpd',
  'spawn',
  'spawn-circular',
  'expand',
  'collapse',
]

const NODE_W = 140
const NODE_H = 64

const KIND_COLORS: Record<FlowEffectKind, string> = {
  wait: '#3a4a66',
  move: '#2d5e7e',
  scale: '#5a3d7a',
  color: '#7a4540',
  jitter: '#3f6b3a',
  float: '#356b7a',
  emerge: '#4a7a3a',
  dismiss: '#7a4a3a',
  'cloud-levitate': '#4f5d8a',
  'bubble-levitate': '#7a5b3a',
  repeater: '#5b3a7a',
  camera: '#3a6b5e',
  break: '#7a3840',
  'text-generator': '#7a4a8a',
  record: '#7a3030',
  'obs-record': '#a04040',
  'handoff-rmm': '#3a6b8a',
  'return-rmm': '#5a8a6b',
  'handoff-mpd': '#8a6b3a',
  spawn: '#3a8a8a',
  'spawn-circular': '#5b8a3a',
  expand: '#5a7a3d',
  collapse: '#7a5a3d',
}

const PARAM_FIELDS: Record<FlowEffectKind, string[]> = {
  wait: ['ms'],
  move: ['dx', 'dy', 'ms', 'roundtrip'],
  scale: ['mul', 'ms', 'permanent'],
  color: ['tint', 'ms', 'permanent'],
  jitter: ['amp', 'ms'],
  float: ['amp', 'freq', 'ms'],
  emerge: ['ms', 'fromScale'],
  dismiss: ['ms', 'toScale'],
  'cloud-levitate': ['ampX', 'ampY', 'freq', 'ms'],
  'bubble-levitate': ['ampY', 'scaleAmp', 'scalePulse', 'freq', 'ms'],
  repeater: ['times'],
  camera: ['panX', 'panY', 'zoom', 'ms', 'permanent'],
  break: ['axis', 'shakeIntensity', 'shakeDurationMs', 'fallDurationMs', 'ms'],
  'text-generator': ['charsPerSec', 'soundPreset', 'loop', 'endHoldMs', 'startIndex', 'endIndex', 'degenerationMs', 'ms'],
  record: ['ms', 'fps'],
  'obs-record': ['ms'],
  // RMM handoff drives `useOmniStore.rmmZoomStep('in')` until the dial
  // reaches handoff (i.e. swap to host node's child model). `ms` is the
  // visual budget; the renderer steps the dial at ~60 Hz inside it.
  'handoff-rmm': ['ms'],
  // RMM return walks the dial back out, popping one frame off the stack.
  'return-rmm': ['ms'],
  // MPD handoff cycles to the next/previous MPD dimension on the host
  // node. `direction` is +1 (next) or -1 (previous). `ms` controls the
  // curtain animation length.
  'handoff-mpd': ['direction', 'ms'],
  // Spawn N decorative children at random offsets around the host within
  // `radius` (scene-percent). They fade in over `fadeMs`, hold, then fade
  // out when the task ends. `ms` is on-screen lifetime.
  spawn: ['count', 'radius', 'ms', 'fadeMs'],
  // Same as spawn but children land on a regular circle.
  'spawn-circular': ['count', 'radius', 'ms', 'fadeMs'],
  // Grow node by `mul` over `ms` (defaults to 1.5×). `permanent` holds final.
  expand: ['mul', 'ms', 'permanent'],
  // Shrink node by 1/mul over `ms`. `permanent` holds final.
  collapse: ['mul', 'ms', 'permanent'],
}

const DEFAULT_PARAMS: Record<FlowEffectKind, Record<string, number>> = {
  wait: { ms: 500 },
  move: { dx: 4, dy: 0, ms: 400, roundtrip: 0 },
  scale: { mul: 1.3, ms: 250, permanent: 0 },
  color: { tint: 0xff5555, ms: 400, permanent: 0 },
  jitter: { amp: 0.4, ms: 600 },
  float: { amp: 0.5, freq: 1, ms: 2000 },
  emerge: { ms: 400, fromScale: 0 },
  dismiss: { ms: 400, toScale: 0 },
  'cloud-levitate': { ampX: 0.6, ampY: 0.4, freq: 0.6, ms: 4000 },
  'bubble-levitate': { ampY: 0.5, scaleAmp: 0.04, scalePulse: 1, freq: 1, ms: 3000 },
  repeater: { times: 1 },
  camera: { panX: 0, panY: 0, zoom: 1, ms: 600, permanent: 0 },
  break: { axis: 0, shakeIntensity: 0.8, shakeDurationMs: 300, fallDurationMs: 600, ms: 900 },
  'text-generator': { charsPerSec: 24, soundPreset: 0, loop: 0, endHoldMs: 1000, startIndex: 0, endIndex: -1, degenerationMs: 0, ms: 1500 },
  // Record canvas to .webm for `ms` while task is active. `fps` is the
  // capture frame rate; defaults to 30. The recording downloads on stop.
  record: { ms: 5000, fps: 30 },
  // Tell OBS (via WebSocket) to start recording for `ms` while active. The
  // OBS host/port/password are read from the renderer's stored settings.
  'obs-record': { ms: 5000 },
  'handoff-rmm': { ms: 600 },
  'return-rmm': { ms: 600 },
  'handoff-mpd': { direction: 1, ms: 500 },
  spawn: { count: 6, radius: 8, ms: 1500, fadeMs: 300 },
  'spawn-circular': { count: 8, radius: 8, ms: 1500, fadeMs: 300 },
  expand: { mul: 1.5, ms: 400, permanent: 0 },
  collapse: { mul: 1.5, ms: 400, permanent: 0 },
}

/**
 * Friendly metadata per param field, surfaced in the right-side settings
 * panel (tasks F + G). The `kind` decides the input control:
 *   - `number` (default): plain numeric input
 *   - `bool`: 0/1 toggled by a checkbox
 *   - `tint`: 24-bit colour picker
 *   - `enum`: a `<select>` whose option values are listed in `options`
 * `label` overrides the raw param key, `unit` is appended in muted text,
 * `step` overrides the default 0.1 step, `min`/`max` are advisory.
 */
type FieldKind = 'number' | 'bool' | 'tint' | 'enum'
interface FieldMeta {
  label?: string
  hint?: string
  unit?: string
  kind?: FieldKind
  options?: { value: number; label: string }[]
  step?: number
  min?: number
  max?: number
}
const FIELD_META: Record<string, FieldMeta> = {
  ms: { label: 'Duration', unit: 'ms', step: 50, min: 0 },
  dx: { label: 'Δ X', unit: '%' },
  dy: { label: 'Δ Y', unit: '%' },
  mul: { label: 'Multiplier', step: 0.05, min: 0 },
  tint: { label: 'Tint', kind: 'tint' },
  amp: { label: 'Amplitude', step: 0.1 },
  ampX: { label: 'Amp X', step: 0.1 },
  ampY: { label: 'Amp Y', step: 0.1 },
  freq: { label: 'Frequency', unit: 'Hz', step: 0.1, min: 0 },
  scaleAmp: { label: 'Scale amp', step: 0.01 },
  scalePulse: { label: 'Scale pulse', kind: 'bool' },
  fromScale: { label: 'From scale', step: 0.05, min: 0 },
  toScale: { label: 'To scale', step: 0.05, min: 0 },
  panX: { label: 'Pan X', unit: '%' },
  panY: { label: 'Pan Y', unit: '%' },
  zoom: { label: 'Zoom', step: 0.1, min: 0.01 },
  permanent: { label: 'Hold final state', kind: 'bool' },
  roundtrip: { label: 'Round-trip', kind: 'bool', hint: 'Animate back to start.' },
  loop: { label: 'Loop', kind: 'bool' },
  charsPerSec: { label: 'Chars / sec', step: 1, min: 1 },
  soundPreset: {
    label: 'Sound',
    kind: 'enum',
    options: [
      { value: 0, label: 'None' },
      { value: 1, label: 'Undertale' },
      { value: 2, label: 'Inscryption' },
      { value: 3, label: 'Pokemon' },
      { value: 4, label: 'Typewriter' },
      { value: 5, label: 'Terminal' },
    ],
  },
  endHoldMs: { label: 'End hold', unit: 'ms', step: 50, min: 0 },
  startIndex: { label: 'Start index', step: 1, min: 0 },
  endIndex: { label: 'End index', step: 1, hint: '-1 = end of string.' },
  degenerationMs: { label: 'Degeneration', unit: 'ms', step: 50, min: 0 },
  fps: { label: 'FPS', step: 1, min: 1 },
  count: { label: 'Count', step: 1, min: 1 },
  radius: { label: 'Radius', unit: '%', step: 0.5, min: 0 },
  fadeMs: { label: 'Fade', unit: 'ms', step: 50, min: 0 },
  times: { label: 'Times', step: 1, min: 1 },
  axis: {
    label: 'Axis',
    kind: 'enum',
    options: [
      { value: 0, label: 'Vertical' },
      { value: 1, label: 'Horizontal' },
    ],
  },
  shakeIntensity: { label: 'Shake', unit: '%', step: 0.1, min: 0 },
  shakeDurationMs: { label: 'Shake time', unit: 'ms', step: 50, min: 0 },
  fallDurationMs: { label: 'Fall time', unit: 'ms', step: 50, min: 0 },
  direction: {
    label: 'Direction',
    kind: 'enum',
    options: [
      { value: 1, label: 'Next' },
      { value: -1, label: 'Previous' },
    ],
  },
}

/** Short human-readable description of each effect kind for the panel header. */
const KIND_HINTS: Partial<Record<FlowEffectKind, string>> = {
  wait: 'Hold the schedule for a fixed duration.',
  move: 'Translate the host node by ΔX/ΔY scene-percent.',
  scale: 'Multiply the host node\u2019s size.',
  color: 'Tint the host node\u2019s fill.',
  jitter: 'Randomly nudge the node within an amplitude.',
  float: 'Sinusoidal vertical bob.',
  emerge: 'Fade + scale the node in from `fromScale`.',
  dismiss: 'Fade + scale the node out to `toScale`.',
  'cloud-levitate': 'Slow XY drift, suited to thinking-cloud nodes.',
  'bubble-levitate': 'Vertical bob with subtle scale pulse.',
  repeater: 'Re-fire the downstream graph N times.',
  camera: 'Pan + zoom the viewport.',
  break: 'Shake, then fly apart along the chosen axis.',
  'text-generator': 'Reveal the node label one character at a time.',
  record: 'Capture the canvas to a .webm for `ms`.',
  'obs-record': 'Trigger OBS recording for `ms`.',
  'handoff-rmm': 'Recursive zoom-in into this node\u2019s child model.',
  'return-rmm': 'Pop one level back out of an RMM stack.',
  'handoff-mpd': 'Cycle MPD dimensions on the host.',
  spawn: 'Burst N decorative children at random offsets.',
  'spawn-circular': 'Burst N decorative children on a circle.',
  expand: 'Grow the node by `mul`.',
  collapse: 'Shrink the node by 1/`mul`.',
}

/**
 * Auto-injected entry node id. The entry node is a `wait` with `ms: 0` that
 * the editor surfaces visually as a signal-source — every fresh effect graph
 * gets one so the user has a clear "play here" anchor (legacy parity, see
 * `src/old/flow/FlowEffectEditor.tsx`). It is filtered out of the runtime
 * via `durationOf` returning 0.
 */
export const ENTRY_NODE_ID = '__entry__'

/** Editor grid step in svg pixels (legacy `GRID = 20`). */
const GRID = 20

/** Snap a coord to the editor grid. */
function snapToGrid(v: number): number {
  return Math.round(v / GRID) * GRID
}

/** Ensure the entry node exists; returns the unchanged effect when present. */
function withEntryNode(effect: FlowEffect): FlowEffect {
  if (effect.graph.nodes.some((n) => n.id === ENTRY_NODE_ID)) return effect
  const entry: EffectNode = {
    id: ENTRY_NODE_ID,
    kind: 'wait',
    x: GRID,
    y: GRID,
    params: { ms: 0 },
  }
  return {
    ...effect,
    graph: {
      ...effect.graph,
      nodes: [entry, ...effect.graph.nodes],
    },
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- helper exported alongside editor component
export function emptyEffect(): FlowEffect {
  return {
    id: `eff_${Date.now().toString(36)}`,
    label: 'New effect',
    graph: { nodes: [], edges: [] },
  }
}

interface Props {
  initial: FlowEffect
  onPreview: (effect: FlowEffect) => void
  onSave: (effect: FlowEffect) => void
  onClose: () => void
  /**
   * Optional host node id this effect graph belongs to. When provided the
   * editor surfaces a "Link Node" button so the user can pair other model
   * nodes with this one (parity item I). Clicking the button arms the
   * canvas-side `pickMode` and closes the modal so the peer can be chosen
   * directly from the main view.
   */
  hostNodeId?: string
  /**
   * Called when the user clicks "Link Node". The parent should save the
   * passed-in effect state, hide the editor, and arm canvas pick mode;
   * once the link is recorded the editor can be re-opened with the saved
   * state preserved.
   */
  onLinkPick?: (effect: FlowEffect) => void
}

export function FlowEffectEditor({ initial, onSave, onClose, hostNodeId, onLinkPick }: Props) {
  const [effect, setEffect] = useState<FlowEffect>(() => withEntryNode(deepClone(initial)))
  const [selection, setSelection] = useState<{ pane: PaneId; id: string } | null>(null)
  // Shared cross-pane wire-draft state. Owned at the editor level so a wire
  // started in one pane can be dropped onto a node in the other pane to
  // create a cross-graph link.
  const [wireDraft, setWireDraft] = useState<WireDraft | null>(null)
  const [cursorClient, setCursorClient] = useState<{ x: number; y: number } | null>(null)
  // SVG mount refs as state so the overlay re-renders once each pane is
  // attached and we can read their bounding rects.
  const [primarySvg, setPrimarySvg] = useState<SVGSVGElement | null>(null)
  const [peerSvg, setPeerSvg] = useState<SVGSVGElement | null>(null)
  // Body container ref-as-state for the overlay positioning.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  // Subscribe to cross-links from the store so newly-created links re-render.
  const crossLinks = useOmniStore((s) => s.model.crossLinks ?? EMPTY_CROSS_LINKS)

  // Peer pane state — read host's first linked peer + auto-create effect.
  const linked = useOmniStore((s) => s.model.nodes.get(hostNodeId ?? '__none__')?.linkedNodeIds ?? EMPTY_LINKED)
  const peerNodeId = linked[0] ?? null
  const peerNode = useOmniStore((s) => (peerNodeId ? s.model.nodes.get(peerNodeId) : null))
  const peerEffect = peerNode?.flowEffects?.[0] ?? null

  // Auto-create an empty effect graph on the peer if it has none yet, so the
  // split-screen pane is immediately editable instead of showing a "no
  // effect graph yet" message.
  useEffect(() => {
    if (!peerNodeId || !peerNode) return
    if (peerNode.flowEffects && peerNode.flowEffects.length > 0) return
    const fresh = withEntryNode(emptyEffect())
    useOmniStore.getState().updateNode(peerNodeId, { flowEffects: [fresh] })
  }, [peerNodeId, peerNode])

  const updatePeerEffect = useCallback((next: FlowEffect) => {
    if (!peerNodeId || !peerNode) return
    const list = peerNode.flowEffects ?? []
    const head = list[0]
    const replaced = head ? [next, ...list.slice(1)] : [next]
    useOmniStore.getState().updateNode(peerNodeId, { flowEffects: replaced })
  }, [peerNodeId, peerNode])

  // ESC closes; Delete removes the selected node from whichever pane owns it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Delete' && selection) {
        if (selection.pane === 'primary') {
          setEffect((cur) => removeNodeFrom(cur, selection.id))
        } else if (peerEffect) {
          updatePeerEffect(removeNodeFrom(peerEffect, selection.id))
        }
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onClose, peerEffect, updatePeerEffect])

  // Window-level pointerup listener while a wire is being dragged: resolves
  // cross-pane drops by hit-testing the element under the cursor for our
  // `data-effect-node-id` + `data-pane-id` markers.
  useEffect(() => {
    if (!wireDraft) return
    const onMove = (e: PointerEvent) => setCursorClient({ x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const target = el?.closest('[data-effect-node-id]') as HTMLElement | null
      const toId = target?.getAttribute('data-effect-node-id') ?? null
      const toPane = (target?.getAttribute('data-pane-id') as PaneId | null) ?? null
      if (toId && toPane && toPane !== wireDraft.pane) {
        // Cross-pane drop \u2192 create a CrossEffectLink (only succeeds if the
        // hosts are linked, which they must be for the peer pane to exist).
        if (hostNodeId && peerNodeId) {
          const fromNodeId = wireDraft.pane === 'primary' ? hostNodeId : peerNodeId
          const toNodeId = toPane === 'primary' ? hostNodeId : peerNodeId
          const fromEffectId = wireDraft.pane === 'primary' ? effect.id : (peerEffect?.id ?? '')
          const toEffectId = toPane === 'primary' ? effect.id : (peerEffect?.id ?? '')
          if (fromEffectId && toEffectId) {
            useOmniStore.getState().addCrossLink(
              { nodeId: fromNodeId, effectId: fromEffectId, effectNodeId: wireDraft.fromId },
              { nodeId: toNodeId, effectId: toEffectId, effectNodeId: toId },
            )
          }
        }
      } else if (toId && toPane === wireDraft.pane && toId !== wireDraft.fromId) {
        // Same-pane drop \u2192 toggle a regular edge.
        if (toPane === 'primary') {
          setEffect((cur) => toggleEdgeIn(cur, wireDraft.fromId, toId))
        } else if (peerEffect) {
          updatePeerEffect(toggleEdgeIn(peerEffect, wireDraft.fromId, toId))
        }
      }
      setWireDraft(null)
      setCursorClient(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [wireDraft, hostNodeId, peerNodeId, effect.id, peerEffect, updatePeerEffect])

  const selectedNode = selection
    ? (selection.pane === 'primary'
        ? effect.graph.nodes.find((n) => n.id === selection.id) ?? null
        : peerEffect?.graph.nodes.find((n) => n.id === selection.id) ?? null)
    : null

  const setParam = (key: string, val: number) => {
    if (!selection || !selectedNode) return
    if (selection.pane === 'primary') {
      setEffect((cur) => setParamIn(cur, selection.id, key, val))
    } else if (peerEffect) {
      updatePeerEffect(setParamIn(peerEffect, selection.id, key, val))
    }
  }

  const setNodeLabel = (label: string) => {
    if (!selection || !selectedNode) return
    if (selection.pane === 'primary') {
      setEffect((cur) => setNodeLabelIn(cur, selection.id, label))
    } else if (peerEffect) {
      updatePeerEffect(setNodeLabelIn(peerEffect, selection.id, label))
    }
  }

  const deleteSelected = () => {
    if (!selection) return
    if (selection.pane === 'primary') {
      setEffect((cur) => removeNodeFrom(cur, selection.id))
    } else if (peerEffect) {
      updatePeerEffect(removeNodeFrom(peerEffect, selection.id))
    }
    setSelection(null)
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <input
            value={effect.label}
            onChange={(e) => setEffect((cur) => ({ ...cur, label: e.target.value }))}
            style={titleInputStyle}
            placeholder="Effect name"
          />
          <div style={{ flex: 1 }} />
          {hostNodeId && <LinkPicker hostNodeId={hostNodeId} onPick={() => onLinkPick?.(effect)} />}
          <button onClick={() => onSave(effect)} style={{ ...btnStyle, background: '#2f5a32' }}>Save</button>
          <button onClick={onClose} style={btnStyle}>✕</button>
        </header>
        <div ref={setBodyEl} style={bodyStyle}>
          <aside style={sidebarStyle}>
            <div style={{ fontSize: 13, color: '#7a8aa0', marginBottom: 4 }}>Add node</div>
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => setEffect((cur) => addNodeTo(cur, k))}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/omnigram-effect-kind', k)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                style={{ ...btnStyle, justifyContent: 'flex-start', background: KIND_COLORS[k], cursor: 'grab' }}
              >
                + {k}
              </button>
            ))}
            {wireDraft && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#cfe' }}>
                Drop on a node to connect (drag across the divider for a
                cross-link).
              </div>
            )}
          </aside>
          <CanvasPane
            paneId="primary"
            effect={effect}
            onChangeEffect={setEffect}
            selectedId={selection?.pane === 'primary' ? selection.id : null}
            onSelect={(id) => setSelection(id ? { pane: 'primary', id } : null)}
            wireDraft={wireDraft}
            onBeginWire={(fromId, x, y) => {
              setWireDraft({ pane: 'primary', fromId })
              setCursorClient({ x, y })
            }}
            svgRef={setPrimarySvg}
          />
          {peerNodeId && peerEffect && (
            <CanvasPane
              paneId="peer"
              effect={peerEffect}
              onChangeEffect={updatePeerEffect}
              selectedId={selection?.pane === 'peer' ? selection.id : null}
              onSelect={(id) => setSelection(id ? { pane: 'peer', id } : null)}
              wireDraft={wireDraft}
              onBeginWire={(fromId, x, y) => {
                setWireDraft({ pane: 'peer', fromId })
                setCursorClient({ x, y })
              }}
              svgRef={setPeerSvg}
              divider
            />
          )}
          <aside style={rightSidebarStyle}>
            {selectedNode ? (
              <NodeSettingsPanel
                node={selectedNode}
                onChangeParam={setParam}
                onChangeLabel={setNodeLabel}
                onDelete={deleteSelected}
              />
            ) : (
              <div style={{ fontSize: 13, color: '#7a8aa0' }}>
                Select an effect node to edit its settings.
              </div>
            )}
          </aside>
          <CrossOverlay
            bodyEl={bodyEl}
            primarySvg={primarySvg}
            peerSvg={peerSvg}
            primaryEffect={effect}
            peerEffect={peerEffect}
            hostNodeId={hostNodeId ?? null}
            peerNodeId={peerNodeId}
            wireDraft={wireDraft}
            cursorClient={cursorClient}
            crossLinks={crossLinks}
          />
        </div>
      </div>
    </div>
  )
}

// ---- Pure effect mutators (used by both panes) ---------------------------

function addNodeTo(effect: FlowEffect, kind: FlowEffectKind, atX?: number, atY?: number): FlowEffect {
  const id = `n_${Date.now().toString(36)}_${effect.graph.nodes.length}`
  let x: number
  let y: number
  if (atX != null && atY != null) {
    x = snapToGrid(atX - NODE_W / 2)
    y = snapToGrid(atY - NODE_H / 2)
  } else {
    const ROW = NODE_H + GRID * 2
    const COL = NODE_W + GRID * 2
    const PER_COL = 6
    const idx = effect.graph.nodes.length
    x = GRID + Math.floor(idx / PER_COL) * COL
    y = GRID + ((idx % PER_COL) + 1) * ROW
  }
  const node: EffectNode = { id, kind, x, y, params: { ...DEFAULT_PARAMS[kind] } }
  return { ...effect, graph: { ...effect.graph, nodes: [...effect.graph.nodes, node] } }
}

function removeNodeFrom(effect: FlowEffect, id: string): FlowEffect {
  if (id === ENTRY_NODE_ID) return effect
  return {
    ...effect,
    graph: {
      nodes: effect.graph.nodes.filter((n) => n.id !== id),
      edges: effect.graph.edges.filter((ed) => ed.from !== id && ed.to !== id),
    },
  }
}

function setParamIn(effect: FlowEffect, id: string, key: string, val: number): FlowEffect {
  return {
    ...effect,
    graph: {
      ...effect.graph,
      nodes: effect.graph.nodes.map((n) =>
        n.id === id ? { ...n, params: { ...n.params, [key]: val } } : n,
      ),
    },
  }
}

function setNodeLabelIn(effect: FlowEffect, id: string, label: string): FlowEffect {
  return {
    ...effect,
    graph: {
      ...effect.graph,
      nodes: effect.graph.nodes.map((n) => (n.id === id ? { ...n, label } : n)),
    },
  }
}

function moveNodeIn(effect: FlowEffect, id: string, x: number, y: number): FlowEffect {
  const sx = snapToGrid(x)
  const sy = snapToGrid(y)
  return {
    ...effect,
    graph: {
      ...effect.graph,
      nodes: effect.graph.nodes.map((n) => (n.id === id ? { ...n, x: sx, y: sy } : n)),
    },
  }
}

function toggleEdgeIn(effect: FlowEffect, from: string, to: string): FlowEffect {
  if (from === to) return effect
  const exists = effect.graph.edges.some((ed) => ed.from === from && ed.to === to)
  const edges = exists
    ? effect.graph.edges.filter((ed) => !(ed.from === from && ed.to === to))
    : [...effect.graph.edges, { from, to }]
  return { ...effect, graph: { ...effect.graph, edges } }
}

// ---- Shared canvas pane (primary + peer) ---------------------------------

type PaneId = 'primary' | 'peer'
interface WireDraft {
  pane: PaneId
  fromId: string
}

interface CanvasPaneProps {
  paneId: PaneId
  effect: FlowEffect
  onChangeEffect: (next: FlowEffect) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  wireDraft: WireDraft | null
  onBeginWire: (fromId: string, clientX: number, clientY: number) => void
  /** Forward the mounted SVG element so the editor can position cross-pane overlays. */
  svgRef?: (el: SVGSVGElement | null) => void
  /** Render a dashed left-edge divider when this pane is the right-hand peer. */
  divider?: boolean
}

function CanvasPane({
  paneId,
  effect,
  onChangeEffect,
  selectedId,
  onSelect,
  wireDraft,
  onBeginWire,
  svgRef: svgRefCallback,
  divider,
}: CanvasPaneProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const setSvgRef = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el
    svgRefCallback?.(el)
  }, [svgRefCallback])
  const dragState = useRef<{ id: string; offX: number; offY: number; pointerId: number; capturedOn: Element | null } | null>(null)

  const nodeIndex = useMemo(() => {
    const m = new Map<string, EffectNode>()
    for (const n of effect.graph.nodes) m.set(n.id, n)
    return m
  }, [effect.graph.nodes])

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragState.current) {
      const pt = svgPoint(svgRef.current!, e.clientX, e.clientY)
      onChangeEffect(moveNodeIn(effect, dragState.current.id, pt.x - dragState.current.offX, pt.y - dragState.current.offY))
    }
  }

  const onSvgPointerUp = () => {
    const d = dragState.current
    if (d) {
      try { d.capturedOn?.releasePointerCapture?.(d.pointerId) } catch { /* ignore */ }
      dragState.current = null
    }
  }

  const startDrag = (e: React.PointerEvent, n: EffectNode) => {
    if (wireDraft) return
    e.stopPropagation()
    onSelect(n.id)
    const pt = svgPoint(svgRef.current!, e.clientX, e.clientY)
    const target = e.currentTarget as Element
    dragState.current = { id: n.id, offX: pt.x - n.x, offY: pt.y - n.y, pointerId: e.pointerId, capturedOn: target }
    target.setPointerCapture(e.pointerId)
  }

  // Pending wire previews are drawn by the parent CrossOverlay (in client
  // coords over the body) so the same dashed line spans both panes when the
  // user drags across the divider — and there is exactly one preview line.

  return (
    <svg
      ref={setSvgRef}
      style={divider ? { ...canvasStyle, borderLeft: '2px dashed #2f3a4a' } : canvasStyle}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onPointerDown={() => onSelect(null)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/omnigram-effect-kind')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData('application/omnigram-effect-kind') as FlowEffectKind | ''
        if (!kind) return
        e.preventDefault()
        const pt = svgPoint(svgRef.current!, e.clientX, e.clientY)
        onChangeEffect(addNodeTo(effect, kind, pt.x, pt.y))
      }}
    >
      {/* Edges */}
      {effect.graph.edges.map((e) => {
        const a = nodeIndex.get(e.from)
        const b = nodeIndex.get(e.to)
        if (!a || !b) return null
        const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H
        const x2 = b.x + NODE_W / 2, y2 = b.y
        return (
          <path
            key={`${e.from}->${e.to}`}
            d={curvePath(x1, y1, x2, y2)}
            fill="none"
            stroke="#88a"
            strokeWidth={2}
            onClick={() => onChangeEffect(toggleEdgeIn(effect, e.from, e.to))}
            style={{ cursor: 'pointer' }}
          />
        )
      })}
      {/* Nodes */}
      {effect.graph.nodes.map((n) => (
        <g
          key={n.id}
          transform={`translate(${n.x},${n.y})`}
          data-effect-node-id={n.id}
          data-pane-id={paneId}
          onPointerDown={(e) => startDrag(e, n)}
          style={{ cursor: wireDraft ? 'crosshair' : 'grab' }}
        >
          <rect
            width={NODE_W}
            height={NODE_H}
            rx={8}
            fill={KIND_COLORS[n.kind]}
            stroke={selectedId === n.id ? '#cfe' : '#456'}
            strokeWidth={selectedId === n.id ? 2 : 1}
          />
          <text x={10} y={22} fill="#fff" fontSize={14} fontWeight={600}>
            {n.id === ENTRY_NODE_ID ? '\u25b6 entry' : (n.label?.trim() || n.kind)}
          </text>
          {/* Output port (bottom edge) */}
          <circle
            cx={NODE_W / 2}
            cy={NODE_H}
            r={6}
            fill="#cfe"
            stroke="#456"
            onPointerDown={(e) => {
              e.stopPropagation()
              onBeginWire(n.id, e.clientX, e.clientY)
            }}
            style={{ cursor: 'crosshair' }}
          />
          {n.id !== ENTRY_NODE_ID && (
            <circle cx={NODE_W / 2} cy={0} r={4} fill="#456" stroke="#cfe" />
          )}
        </g>
      ))}
    </svg>
  )
}


function NodeSettingsPanel({
  node,
  onChangeParam,
  onChangeLabel,
  onDelete,
}: {
  node: EffectNode
  onChangeParam: (key: string, value: number) => void
  onChangeLabel: (label: string) => void
  onDelete: () => void
}) {
  if (node.id === ENTRY_NODE_ID) {
    return (
      <>
        <div style={{ fontSize: 14, color: '#dde', fontWeight: 600 }}>Entry node</div>
        <div style={{ fontSize: 13, color: '#7a8aa0', marginTop: 4 }}>
          The signal source. Connect downstream effect nodes to its bottom port.
        </div>
      </>
    )
  }
  const fields = PARAM_FIELDS[node.kind]
  const hint = KIND_HINTS[node.kind]
  return (
    <>
      <div style={{ fontSize: 14, color: '#dde', fontWeight: 600, textTransform: 'capitalize' }}>
        {node.kind.replace(/-/g, ' ')}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: '#7a8aa0', marginTop: 2, marginBottom: 6 }}>{hint}</div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 13, color: '#bcd', width: 90 }}>Label</span>
        <input
          value={node.label ?? ''}
          placeholder={node.kind}
          onChange={(e) => onChangeLabel(e.target.value)}
          style={fieldStyle}
        />
      </label>
      {fields.map((key) => (
        <ParamField
          key={key}
          fieldKey={key}
          value={node.params[key] ?? 0}
          onChange={(v) => onChangeParam(key, v)}
        />
      ))}
      <button
        onClick={onDelete}
        style={{ ...btnStyle, background: '#5a1f1f', borderColor: '#a04040', marginTop: 12 }}
      >
        Delete node
      </button>
    </>
  )
}

function ParamField({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string
  value: number
  onChange: (v: number) => void
}) {
  const meta = FIELD_META[fieldKey] ?? {}
  const label = meta.label ?? fieldKey
  const kind: FieldKind = meta.kind ?? 'number'
  if (kind === 'bool') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <input
          type="checkbox"
          checked={value !== 0}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
        />
        <span style={{ fontSize: 13, color: '#bcd' }}>{label}</span>
        {meta.hint && (
          <span style={{ fontSize: 11, color: '#7a8aa0' }}>({meta.hint})</span>
        )}
      </label>
    )
  }
  if (kind === 'tint') {
    const hex = '#' + (value & 0xffffff).toString(16).padStart(6, '0')
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 13, color: '#bcd', width: 90 }}>{label}</span>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))}
          style={{ width: 36, height: 22, border: 'none', background: 'transparent' }}
        />
      </label>
    )
  }
  if (kind === 'enum') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 13, color: '#bcd', width: 90 }}>{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={fieldStyle}
        >
          {meta.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  // Default: number input.
  const step = meta.step ?? (fieldKey === 'ms' ? 50 : 0.1)
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <span style={{ fontSize: 13, color: '#bcd', width: 90 }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={meta.min}
        max={meta.max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={fieldStyle}
      />
      {meta.unit && (
        <span style={{ fontSize: 11, color: '#7a8aa0' }}>{meta.unit}</span>
      )}
    </label>
  )
}

function summariseParams(): string {
  // Retained for potential future tooltip use; in-membrane settings labels
  // were removed per task H so this is currently unreferenced.
  return ''
}
// Suppress unused-export lint warning — kept for future use.
void summariseParams

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  // Vertical S-curve: pull control points along the y-axis so wires read
  // top-to-bottom. Falls back to a small offset for near-zero spans.
  const dy = Math.max(40, Math.abs(y2 - y1) * 0.4)
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  const sp = pt.matrixTransform(ctm.inverse())
  return { x: sp.x, y: sp.y }
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
}

const modalStyle: React.CSSProperties = {
  // Doubled relative to the previous min(1100,90vw) / min(700,85vh) sizing so
  // the editor canvas has enough room for vertical-stacked graphs.
  width: 'min(2200px, 95vw)',
  height: 'min(1400px, 95vh)',
  background: '#1a1f2a',
  border: '1px solid #2f3a4a',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  color: '#dde',
  fontFamily: 'system-ui, sans-serif',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid #2f3a4a',
  background: '#222a38',
}

const bodyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
  // Establish a positioning context so the absolute CrossOverlay anchors
  // to this container (not a higher modal ancestor); without this the
  // dashed draft line is offset and reads upside-down.
  position: 'relative',
}

const sidebarStyle: React.CSSProperties = {
  // Widened proportionally to the doubled modal so the kind buttons +
  // param fields still breathe.
  width: 240,
  padding: 12,
  borderRight: '1px solid #2f3a4a',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  overflowY: 'auto',
}

const rightSidebarStyle: React.CSSProperties = {
  // Mirror of `sidebarStyle` but anchored to the right edge of the modal
  // body (tasks F + G). Hosts per-effect-node settings for the current
  // selection.
  width: 280,
  padding: 12,
  borderLeft: '1px solid #2f3a4a',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  background: '#161c26',
}

const canvasStyle: React.CSSProperties = {
  flex: 1,
  background: '#0e131c',
  cursor: 'default',
  userSelect: 'none',
}

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  background: '#2c3548',
  border: '1px solid #455168',
  borderRadius: 4,
  color: '#dde',
  fontSize: 14,
  cursor: 'pointer',
}

const titleInputStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  color: '#fff',
  font: '600 14px system-ui, sans-serif',
  padding: '4px 6px',
  outline: 'none',
}

const fieldStyle: React.CSSProperties = {
  flex: 1,
  background: '#0e131c',
  border: '1px solid #2f3a4a',
  color: '#dde',
  padding: '3px 6px',
  borderRadius: 3,
  fontSize: 12,
  width: 70,
}

/**
 * "Link Node" button shown in the editor header. Clicking it puts the
 * canvas into one-shot `pickMode = 'link-node'` and notifies the parent
 * (via `onPick`) so the editor can be hidden during the pick and then
 * reopened once a peer has been chosen on the canvas (parity with legacy
 * Unigram). The host node is forced into the active selection so
 * `PointerController`'s pick handler can resolve the source.
 */
// ---- Cross-pane overlay ---------------------------------------------------

/**
 * Absolute-positioned SVG layered over both canvas panes. Draws:
 *  1. The in-progress wire draft from the source port to the cursor when the
 *     user is dragging across panes.
 *  2. Persistent CrossEffectLinks between the host and peer effect graphs
 *     (rendered as orange dashed wires terminating in arrowheads at each
 *     graph's entry node — a stand-in anchor since CrossEffectLink relates
 *     whole effect graphs, not individual effect nodes).
 *
 * Coords: each pane SVG has no `viewBox`, so 1 user unit = 1 client px. We
 * convert effect-node-local coords to client coords via the SVG's bounding
 * rect, then subtract the body container's rect to land in the absolute
 * overlay's frame.
 */
function CrossOverlay({
  bodyEl,
  primarySvg,
  peerSvg,
  primaryEffect,
  peerEffect,
  hostNodeId,
  peerNodeId,
  wireDraft,
  cursorClient,
  crossLinks,
}: {
  bodyEl: HTMLDivElement | null
  primarySvg: SVGSVGElement | null
  peerSvg: SVGSVGElement | null
  primaryEffect: FlowEffect
  peerEffect: FlowEffect | null
  hostNodeId: string | null
  peerNodeId: string | null
  wireDraft: WireDraft | null
  cursorClient: { x: number; y: number } | null
  crossLinks: readonly CrossEffectLink[]
}) {
  if (!bodyEl) return null
  const bodyRect = bodyEl.getBoundingClientRect()

  const portPos = (
    paneSvg: SVGSVGElement | null,
    node: EffectNode | undefined,
    side: 'out' | 'in',
  ): { x: number; y: number } | null => {
    if (!paneSvg || !node) return null
    const r = paneSvg.getBoundingClientRect()
    const cx = r.left - bodyRect.left + node.x + NODE_W / 2
    const cy = r.top - bodyRect.top + (side === 'out' ? node.y + NODE_H : node.y)
    return { x: cx, y: cy }
  }

  const lines: { d: string; key: string; color: string; dash?: string; arrow?: boolean }[] = []

  if (hostNodeId && peerNodeId && peerEffect) {
    for (const l of crossLinks) {
      let fromPane: SVGSVGElement | null = null
      let toPane: SVGSVGElement | null = null
      let fromEffect: FlowEffect | null = null
      let toEffect: FlowEffect | null = null
      if (l.from.nodeId === hostNodeId && l.to.nodeId === peerNodeId) {
        fromPane = primarySvg; toPane = peerSvg
        fromEffect = primaryEffect; toEffect = peerEffect
      } else if (l.from.nodeId === peerNodeId && l.to.nodeId === hostNodeId) {
        fromPane = peerSvg; toPane = primarySvg
        fromEffect = peerEffect; toEffect = primaryEffect
      } else {
        continue
      }
      // Anchor at the actual effect node the user wired to (falls back
      // to the entry node for legacy links missing effectNodeId).
      const fromId = l.from.effectNodeId ?? ENTRY_NODE_ID
      const toId = l.to.effectNodeId ?? ENTRY_NODE_ID
      const fromNode = fromEffect.graph.nodes.find((n) => n.id === fromId)
      const toNode = toEffect.graph.nodes.find((n) => n.id === toId)
      const a = portPos(fromPane, fromNode, 'out')
      const b = portPos(toPane, toNode, 'in')
      if (!a || !b) continue
      lines.push({ d: curvePath(a.x, a.y, b.x, b.y), key: l.id, color: '#cfa544', dash: '6 4', arrow: true })
    }
  }

  if (wireDraft && cursorClient) {
    const sourceEffect = wireDraft.pane === 'primary' ? primaryEffect : peerEffect
    const sourceSvg = wireDraft.pane === 'primary' ? primarySvg : peerSvg
    const fromNode = sourceEffect?.graph.nodes.find((n) => n.id === wireDraft.fromId)
    const a = portPos(sourceSvg, fromNode, 'out')
    if (a) {
      const cx = cursorClient.x - bodyRect.left
      const cy = cursorClient.y - bodyRect.top
      lines.push({ d: curvePath(a.x, a.y, cx, cy), key: '__draft__', color: '#cfe', dash: '4 3' })
    }
  }

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: bodyRect.width,
        height: bodyRect.height,
        pointerEvents: 'none',
      }}
    >
      <defs>
        <marker id="crossArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#cfa544" />
        </marker>
      </defs>
      {lines.map((l) => (
        <path
          key={l.key}
          d={l.d}
          fill="none"
          stroke={l.color}
          strokeWidth={2}
          strokeDasharray={l.dash}
          markerEnd={l.arrow ? 'url(#crossArrow)' : undefined}
        />
      ))}
    </svg>
  )
}

function LinkPicker({ hostNodeId, onPick }: { hostNodeId: string; onPick: () => void }) {
  // Read peer state from the store so the button text + handler stay in
  // sync with `host.linkedNodeIds`. Single subscription via selector so we
  // re-render only when the peer set changes.
  const linked = useOmniStore((s) => s.model.nodes.get(hostNodeId)?.linkedNodeIds ?? EMPTY_LINKED)
  const hasPeer = linked.length > 0
  if (hasPeer) {
    return (
      <button
        type="button"
        onClick={() => {
          const store = useOmniStore.getState()
          // Symmetric unlink for every paired peer (matches legacy parity:
          // "Unlink Node" tears down the split-screen pairing).
          for (const peerId of [...linked]) {
            store.unlinkNodes(hostNodeId, peerId)
          }
        }}
        style={{ ...btnStyle, padding: '4px 10px', background: '#5a3a2a' }}
        title="Tear down the split-screen pairing"
      >
        Unlink Node
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        const store = useOmniStore.getState()
        // Ensure the host is the sole selection so PointerController's
        // pick-mode handler picks it as the link source.
        store.select(hostNodeId, false)
        store.setPickMode('link-node')
        onPick()
      }}
      style={{ ...btnStyle, padding: '4px 10px' }}
      title="Click a node on the canvas to link it to this one"
    >
      Link Node
    </button>
  )
}

