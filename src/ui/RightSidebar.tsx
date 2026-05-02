/**
 * RightSidebar — context-routed inspector panel.
 *
 * Stage 3 scope: shape, fill colour, border colour, label. Subscribes to the
 * store's `selRev` + `rev` so it re-renders when the user selects a different
 * node or commits a drag/edit. Multi-selection: applies edits to every
 * selected node; numeric/colour fields show `(mixed)` when values diverge.
 *
 * UI is plain React/CSS — we keep all visuals out of the canvas.
 */

import { useState, useSyncExternalStore } from 'react'
import { FlowEffectEditor, emptyEffect } from '../flow/FlowEffectEditor'
import { useOmniStore } from '../model/store'
import type { ModelNode, NodeShape, ConnectionDashStyle, ConnectionArrowStyle, ConnectionKind } from '../model/types'
import { collapsedStripStyle, shellStyle, toggleColumnStyle } from './LeftSidebar'
import { ALL_THEME_OPTIONS } from '../theme/themes'
import { GRADIENT_PRESETS, PATTERN_PRESETS } from '../theme/backgrounds'
import { PARTICLE_PRESETS } from '../theme/particles'
import type { BackgroundType, ThemeMode } from '../theme/types'

const ALL_SHAPES: NodeShape[] = [
  'rectangle',
  'rounded-rect',
  'circle',
  'oval',
  'diamond',
  'hexagon',
  'parallelogram',
  'triangle',
  'chat-bubble',
  'thinking-cloud',
]

const SHAPE_LABEL: Record<NodeShape, string> = {
  rectangle: 'Rectangle',
  'rounded-rect': 'Rounded',
  circle: 'Circle',
  oval: 'Oval',
  diamond: 'Diamond',
  hexagon: 'Hexagon',
  parallelogram: 'Parallelogram',
  triangle: 'Triangle',
  'chat-bubble': 'Chat bubble',
  'thinking-cloud': 'Thinking cloud',
}

function useStoreVersion(): number {
  // Re-run on either selection or model changes.
  return useSyncExternalStore(
    (cb) => useOmniStore.subscribe(cb),
    () => useOmniStore.getState().rev * 65537 + useOmniStore.getState().selRev,
    () => 0,
  )
}

export function RightSidebar({ renderer }: { renderer?: import('../scene/SceneRenderer').SceneRenderer | null } = {}) {
  useStoreVersion()
  const [collapsed, setCollapsed] = useState(false)
  const state = useOmniStore.getState()
  const selectedIds = state.selectedIds
  const nodes: ModelNode[] = []
  for (const id of selectedIds) {
    const n = state.model.nodes.get(id)
    if (n) nodes.push(n)
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Expand inspector"
        style={collapsedStripStyle('right')}
      >
        <span style={{ font: 'bold 14px system-ui, sans-serif', color: '#cfe' }}>‹</span>
      </button>
    )
  }

  if (nodes.length === 0) {
    // Edge inspector takes precedence over the diagram panel.
    const edgeIds = state.selectedEdgeIds
    if (edgeIds.size > 0) {
      const eid = [...edgeIds][0]
      const edge = state.model.edges.get(eid)
      if (edge) {
        const fromNode = state.model.nodes.get(edge.from)
        const toNode = state.model.nodes.get(edge.to)
        const dash: ConnectionDashStyle = edge.dash ?? 'solid'
        const arrow: ConnectionArrowStyle = edge.arrowStyle ?? 'standard'
        const kind: ConnectionKind = edge.kind ?? 'default'
        return (
          <Panel onCollapse={() => setCollapsed(true)}>
            <Title>Connection</Title>
            <Hint>
              {fromNode?.label || edge.from} → {toNode?.label || edge.to}
            </Hint>
            <Field label="Kind">
              <div style={{ display: 'flex', gap: 4 }}>
                {(['default', 'flow'] as ConnectionKind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => useOmniStore.getState().updateEdge(eid, { kind: k })}
                    style={{
                      ...buttonStyle,
                      flex: 1,
                      background: kind === k ? '#2b6cb0' : '#1a2030',
                      borderColor: kind === k ? '#4aa3ff' : '#384055',
                      color: kind === k ? '#fff' : '#cfe',
                    }}
                  >
                    {k === 'default' ? 'Default' : 'Flow'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Color">
              <input
                type="color"
                value={normaliseHex(edge.color)}
                onChange={(e) =>
                  useOmniStore.getState().updateEdge(eid, { color: e.target.value })
                }
                style={{ width: '100%', height: 26, padding: 0, border: '1px solid #2a3a52' }}
              />
            </Field>
            <Field label="Width %">
              <NumberField
                value={edge.width}
                min={0.05}
                max={2}
                step={0.05}
                onChange={(v) => useOmniStore.getState().updateEdge(eid, { width: v })}
              />
            </Field>
            <Field label="Dash">
              <select
                value={dash}
                onChange={(e) =>
                  useOmniStore.getState().updateEdge(eid, { dash: e.target.value as ConnectionDashStyle })
                }
                style={inputStyle}
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
                <option value="dash-dot">Dash-Dot</option>
              </select>
            </Field>
            <Field label="Arrow">
              <select
                value={arrow}
                onChange={(e) =>
                  useOmniStore.getState().updateEdge(eid, { arrowStyle: e.target.value as ConnectionArrowStyle })
                }
                style={inputStyle}
              >
                <option value="none">None</option>
                <option value="standard">Standard</option>
                <option value="filled-triangle">Filled triangle</option>
                <option value="line-arrow">Line arrow</option>
                <option value="stealth">Stealth</option>
                <option value="diamond">Diamond</option>
              </select>
            </Field>
            <Field label="Label">
              <input
                type="text"
                value={edge.label ?? ''}
                placeholder="(none)"
                onChange={(e) =>
                  useOmniStore.getState().updateEdge(eid, { label: e.target.value || undefined })
                }
                style={inputStyle}
              />
            </Field>
            <Field label="Label size">
              <NumberField
                value={edge.labelFontSize ?? 22}
                min={8}
                max={64}
                step={1}
                onChange={(v) => useOmniStore.getState().updateEdge(eid, { labelFontSize: v })}
              />
            </Field>
            <button
              onClick={() => useOmniStore.getState().removeEdges([eid])}
              style={dangerButtonStyle}
            >
              Delete connection
            </button>
          </Panel>
        )
      }
    }
    const grid = state.model.grid ?? { enabled: false, snap: false, sizePercent: 4 }
    return (
      <Panel onCollapse={() => setCollapsed(true)}>
        <Title>Diagram</Title>
        <Field label="Name">
          <input
            type="text"
            value={state.model.name}
            onChange={(e) => {
              // Lightweight rename — bypass undo for the model name; not yet
              // patch-modeled. Stage 4 promotes diagram metadata into patches.
              useOmniStore.setState((s) => ({
                model: { ...s.model, name: e.target.value },
                rev: s.rev + 1,
              }))
            }}
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#7a8aa0' }}>Grid</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={grid.enabled}
              onChange={(e) => useOmniStore.getState().setGrid({ enabled: e.target.checked })}
            />
            Show grid
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={grid.snap}
              onChange={(e) => useOmniStore.getState().setGrid({ snap: e.target.checked })}
            />
            Snap to grid
          </label>
          <Field label="Grid size %">
            <NumberField
              value={grid.sizePercent}
              min={0.5}
              max={50}
              step={0.5}
              onChange={(v) => useOmniStore.getState().setGrid({ sizePercent: v })}
            />
          </Field>
        </div>
        <CosmeticsControls />
        <Hint>Click or box-select a node to edit it.</Hint>
      </Panel>
    )
  }

  const isMulti = nodes.length > 1
  const shape = sharedField(nodes, (n) => n.shape)
  const cellColor = sharedField(nodes, (n) => n.cellColor)
  const membraneColor = sharedField(nodes, (n) => n.membraneColor)
  const label = sharedField(nodes, (n) => n.label)
  const w = sharedField(nodes, (n) => n.w)
  const h = sharedField(nodes, (n) => n.h)

  const updateAll = (patch: Partial<ModelNode>) => {
    for (const n of nodes) useOmniStore.getState().updateNode(n.id, patch)
  }

  return (
    <Panel onCollapse={() => setCollapsed(true)}>
      <Title>{isMulti ? `${nodes.length} nodes` : 'Node'}</Title>

      <Field label="Shape">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          {ALL_SHAPES.map((s) => {
            const active = shape === s
            return (
              <button
                key={s}
                onClick={() => updateAll({ shape: s })}
                style={{
                  ...buttonStyle,
                  background: active ? '#2b6cb0' : '#1a2030',
                  color: active ? '#fff' : '#cfe',
                  borderColor: active ? '#4aa3ff' : '#384055',
                }}
                title={SHAPE_LABEL[s]}
              >
                {SHAPE_LABEL[s]}
              </button>
            )
          })}
        </div>
        {shape === MIXED && <Mixed />}
      </Field>

      <Field label="Label">
        <textarea
          value={label === MIXED ? '' : (label as string)}
          placeholder={label === MIXED ? '(mixed)' : ''}
          rows={3}
          onChange={(e) => updateAll({ label: e.target.value })}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }}
        />
      </Field>

      <Row>
        <Field label="Fill">
          <ColorField
            value={cellColor}
            onChange={(v) => updateAll({ cellColor: v })}
          />
        </Field>
        <Field label="Border">
          <ColorField
            value={membraneColor}
            onChange={(v) => updateAll({ membraneColor: v })}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Width %">
          <NumberField
            value={w}
            min={1}
            max={100}
            step={0.5}
            onChange={(v) => updateAll({ w: v })}
          />
        </Field>
        <Field label="Height %">
          <NumberField
            value={h}
            min={1}
            max={100}
            step={0.5}
            onChange={(v) => updateAll({ h: v })}
          />
        </Field>
      </Row>

      {(shape === 'chat-bubble' || shape === 'thinking-cloud') && (
        <CosmeticTipControls nodes={nodes} updateAll={updateAll} />
      )}

      <button
        onClick={() => useOmniStore.getState().removeNodes(nodes.map((n) => n.id))}
        style={{ ...buttonStyle, background: '#5a1f1f', borderColor: '#a04040', marginTop: 8 }}
      >
        Delete {isMulti ? `${nodes.length} nodes` : 'node'}
      </button>

      <BehaviourFlags nodes={nodes} updateAll={updateAll} />

      {!isMulti && <MpdSection node={nodes[0]} />}
      {!isMulti && renderer && <FlowEffectsSection node={nodes[0]} renderer={renderer} />}
      {!isMulti && renderer && <TextGenSection node={nodes[0]} renderer={renderer} />}
    </Panel>
  )
}

// ---- field helpers --------------------------------------------------------

const MIXED = '\u0000__MIXED__\u0000'

function sharedField<T>(nodes: ModelNode[], pick: (n: ModelNode) => T): T | string {
  if (nodes.length === 0) return MIXED
  const first = pick(nodes[0])
  for (let i = 1; i < nodes.length; i++) {
    if (pick(nodes[i]) !== first) return MIXED
  }
  return first
}function ColorField({
  value,
  onChange,
}: {
  value: string | unknown
  onChange: (v: string) => void
}) {
  const isMixed = value === MIXED
  const v = isMixed ? '#cccccc' : (value as string)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        type="color"
        value={hexOf(v)}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: '1px solid #384055', background: 'transparent' }}
      />
      <input
        type="text"
        value={isMixed ? '' : v}
        placeholder={isMixed ? '(mixed)' : ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
      />
    </div>
  )
}

function NumberField({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number | string | unknown
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  const isMixed = value === MIXED
  return (
    <input
      type="number"
      value={isMixed ? '' : (value as number)}
      placeholder={isMixed ? '(mixed)' : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = parseFloat(e.target.value)
        if (!Number.isNaN(n)) onChange(n)
      }}
      style={inputStyle}
    />
  )
}

function hexOf(v: string): string {
  // <input type="color"> only accepts #rrggbb; coerce.
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  return '#cccccc'
}

// ---- minimal layout primitives -------------------------------------------

function Panel({ children, onCollapse }: { children: React.ReactNode; onCollapse: () => void }) {
  return (
    <div style={shellStyle('right')}>
      <button
        onClick={onCollapse}
        title="Collapse panel"
        style={toggleColumnStyle('right')}
      >
        ›
      </button>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontWeight: 600,
        fontSize: 13,
        color: '#fff',
        borderBottom: '1px solid #2a3142',
        paddingBottom: 6,
      }}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: '#7a8aa0' }}>{label}</span>
      {children}
    </label>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8 }}>{children}</div>
}

function Mixed() {
  return <span style={{ fontSize: 10, color: '#7a8aa0' }}>(mixed across selection)</span>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: '#7a8aa0', fontStyle: 'italic' }}>{children}</div>
}

/**
 * Diagram-level cosmetics: theme palette, background, ambient particles.
 *
 * Keeps form state in `useOmniStore` directly via `setCosmetics`; non-undoable
 * (UI state, mirrors `setGrid`).
 */
function CosmeticsControls() {
  const cosmetics = useSyncExternalStore(
    useOmniStore.subscribe,
    () => useOmniStore.getState().model.cosmetics,
  )
  const themeMode: ThemeMode = cosmetics?.themeMode ?? 'light'
  const bg = cosmetics?.background
  const particle = cosmetics?.particleEffect ?? ''
  const setMode = (m: ThemeMode) => useOmniStore.getState().setCosmetics({ themeMode: m })
  const setBg = (b: { type: BackgroundType; value: string } | undefined) =>
    useOmniStore.getState().setCosmetics({ background: b })
  const setParticle = (id: string) =>
    useOmniStore.getState().setCosmetics({ particleEffect: id || null })
  const bgType = bg?.type ?? 'solid'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      <span style={{ fontSize: 11, color: '#7a8aa0' }}>Theme</span>
      <select
        value={themeMode}
        onChange={(e) => setMode(e.target.value as ThemeMode)}
        style={inputStyle}
      >
        <optgroup label="Base">
          {ALL_THEME_OPTIONS.filter((t) => t.group === 'base').map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </optgroup>
        <optgroup label="Topical">
          {ALL_THEME_OPTIONS.filter((t) => t.group === 'topical').map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </optgroup>
      </select>

      <span style={{ fontSize: 11, color: '#7a8aa0' }}>Background</span>
      <select
        value={bgType}
        onChange={(e) => {
          const t = e.target.value as BackgroundType | ''
          if (!t) return setBg(undefined)
          if (t === 'solid') setBg({ type: 'solid', value: '#10131a' })
          else if (t === 'gradient') setBg({ type: 'gradient', value: GRADIENT_PRESETS[0].value })
          else if (t === 'pattern') setBg({ type: 'pattern', value: PATTERN_PRESETS[0].value })
          else setBg({ type: 'image', value: '' })
        }}
        style={inputStyle}
      >
        <option value="solid">Solid</option>
        <option value="gradient">Gradient</option>
        <option value="pattern">Pattern</option>
        <option value="image">Image</option>
      </select>
      {bgType === 'solid' && bg && (
        <input
          type="color"
          value={normaliseHex(bg.value || '#10131a')}
          onChange={(e) => setBg({ type: 'solid', value: e.target.value })}
          style={{ width: '100%', height: 28, padding: 0, border: '1px solid #2a3142' }}
        />
      )}
      {bgType === 'gradient' && bg && (
        <select
          value={bg.value}
          onChange={(e) => setBg({ type: 'gradient', value: e.target.value })}
          style={inputStyle}
        >
          {GRADIENT_PRESETS.map((p) => (
            <option key={p.id} value={p.value}>{p.name}</option>
          ))}
        </select>
      )}
      {bgType === 'pattern' && bg && (
        <select
          value={bg.value}
          onChange={(e) => setBg({ type: 'pattern', value: e.target.value })}
          style={inputStyle}
        >
          {PATTERN_PRESETS.map((p) => (
            <option key={p.id} value={p.value}>{p.name}</option>
          ))}
        </select>
      )}
      {bgType === 'image' && bg && (
        <input
          type="text"
          placeholder="Image URL or data URI"
          value={bg.value}
          onChange={(e) => setBg({ type: 'image', value: e.target.value })}
          style={inputStyle}
        />
      )}
      <button onClick={() => setBg(undefined)} style={buttonStyle}>Clear background</button>

      <span style={{ fontSize: 11, color: '#7a8aa0' }}>Particles</span>
      <select
        value={particle}
        onChange={(e) => setParticle(e.target.value)}
        style={inputStyle}
      >
        <option value="">None</option>
        {PARTICLE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#0e131c',
  color: '#e0eaf5',
  border: '1px solid #2a3142',
  borderRadius: 3,
  padding: '4px 6px',
  font: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  background: '#1a2030',
  color: '#cfe',
  border: '1px solid #384055',
  borderRadius: 3,
  padding: '4px 6px',
  font: '11px system-ui, sans-serif',
  cursor: 'pointer',
}

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#3a1a20',
  color: '#fcc',
  border: '1px solid #6e2a36',
}

function normaliseHex(c: string): string {
  // <input type="color"> requires #rrggbb form. Pass through if already valid;
  // otherwise fall back to a neutral grey rather than crashing.
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
  }
  return '#365f8f'
}

/**
 * Behavioural flags surfaced for selection (single or multi). Each flag
 * follows the legacy semantics:
 *  - `locked`: drag and untangle skip this node.
 *  - `hideDuringFlow`: node is hidden while a flow effect is playing.
 *  - `cameraTracked`: viewport `move`/`camera` flow effects keep this node
 *    centred.
 *
 * For multi-selection the checkbox is checked iff *every* selected node has
 * the flag on; toggling sets the same value across the entire selection.
 */
function BehaviourFlags({
  nodes,
  updateAll,
}: {
  nodes: ModelNode[]
  updateAll: (patch: Partial<ModelNode>) => void
}) {
  const allHave = (pick: (n: ModelNode) => boolean | undefined) => nodes.every((n) => !!pick(n))
  const locked = allHave((n) => n.locked)
  const hideDuringFlow = allHave((n) => n.hideDuringFlow)
  const cameraTracked = allHave((n) => n.cameraTracked)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: '#7a8aa0' }}>Behaviour</span>
      <Checkbox
        label="Locked (skip drag & untangle)"
        checked={locked}
        onChange={(v) => updateAll({ locked: v || undefined })}
      />
      <Checkbox
        label="Hide while flow plays"
        checked={hideDuringFlow}
        onChange={(v) => updateAll({ hideDuringFlow: v || undefined })}
      />
      <Checkbox
        label="Camera tracks this node"
        checked={cameraTracked}
        onChange={(v) => updateAll({ cameraTracked: v || undefined })}
      />
    </div>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#cfe', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

/**
 * Polar tip editor for cosmetic shapes (chat-bubble, thinking-cloud).
 *
 * The model stores `tip: { x, y }` in scene-percent of the node size; this
 * UI surfaces an angle (degrees, 0 = right, 90 = down) and a length so the
 * user can rotate the tail without juggling two axes. We compute x/y from
 * the polar form on every change and write the cartesian back to the model.
 */
function CosmeticTipControls({
  nodes,
  updateAll,
}: {
  nodes: ModelNode[]
  updateAll: (patch: Partial<ModelNode>) => void
}) {
  const first = nodes[0]
  const tip = first.tip ?? { x: -45, y: 60 }
  const len = Math.hypot(tip.x, tip.y)
  // 0° = right, sweep clockwise (screen-y is down).
  const angDeg = (Math.atan2(tip.y, tip.x) * 180) / Math.PI
  const setPolar = (deg: number, length: number) => {
    const rad = (deg * Math.PI) / 180
    const x = Math.round(Math.cos(rad) * length * 10) / 10
    const y = Math.round(Math.sin(rad) * length * 10) / 10
    updateAll({ tip: { x, y } })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: '#7a8aa0' }}>Tip / tail</span>
      <Row>
        <Field label="Angle°">
          <NumberField
            value={Math.round(angDeg)}
            min={-180}
            max={360}
            step={5}
            onChange={(v) => setPolar(v, len || 60)}
          />
        </Field>
        <Field label="Length %">
          <NumberField
            value={Math.round(len * 10) / 10}
            min={0}
            max={200}
            step={1}
            onChange={(v) => setPolar(angDeg, v)}
          />
        </Field>
      </Row>
    </div>
  )
}

function MpdSection({ node }: { node: ModelNode }) {
  const dims = node.mpdDimensions ?? []
  const state = useOmniStore.getState()
  const handleAdd = () => {
    useOmniStore.getState().addMpdDimension(node.id)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
      <span style={{ fontSize: 11, color: '#7a8aa0' }}>MPD dimensions</span>
      {dims.length === 0 ? (
        <span style={{ fontSize: 11, color: '#576278' }}>None — add a dimension to enable the dial.</span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {dims.map((id) => {
            const m = state.models.get(id)
            const isCurrent = id === state.model.id
            return (
              <li key={id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="text"
                  value={m?.name ?? id}
                  disabled={!m}
                  onChange={(e) => {
                    const target = useOmniStore.getState().models.get(id)
                    if (!target) return
                    useOmniStore.setState((s) => {
                      const models = new Map(s.models)
                      const updated = { ...target, name: e.target.value }
                      models.set(id, updated)
                      const isActive = s.model.id === id
                      return {
                        models,
                        model: isActive ? updated : s.model,
                        rev: s.rev + 1,
                      }
                    })
                  }}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    fontWeight: isCurrent ? 600 : 400,
                    borderColor: isCurrent ? '#4aa3ff' : '#384055',
                  }}
                />
              </li>
            )
          })}
        </ul>
      )}
      <button onClick={handleAdd} style={buttonStyle}>+ Add MPD dimension</button>
    </div>
  )
}

const FLOW_PRESETS: { id: string; label: string; effect: import('../flow/types').FlowEffect }[] = [
  {
    id: 'pulse',
    label: 'Pulse',
    effect: {
      id: 'pulse',
      label: 'Pulse',
      graph: {
        nodes: [{ id: 's', kind: 'scale', x: 0, y: 0, params: { mul: 1.3, ms: 250 } }],
        edges: [],
      },
    },
  },
  {
    id: 'shake',
    label: 'Shake',
    effect: {
      id: 'shake',
      label: 'Shake',
      graph: {
        nodes: [{ id: 'j', kind: 'jitter', x: 0, y: 0, params: { amp: 0.4, ms: 600 } }],
        edges: [],
      },
    },
  },
  {
    id: 'flash',
    label: 'Flash red',
    effect: {
      id: 'flash',
      label: 'Flash',
      graph: {
        nodes: [{ id: 'c', kind: 'color', x: 0, y: 0, params: { tint: 0xff5555, ms: 500 } }],
        edges: [],
      },
    },
  },
  {
    id: 'nudge',
    label: 'Nudge right',
    effect: {
      id: 'nudge',
      label: 'Nudge',
      graph: {
        nodes: [{ id: 'm', kind: 'move', x: 0, y: 0, params: { dx: 4, dy: 0, ms: 400 } }],
        edges: [],
      },
    },
  },
  {
    id: 'pulse-then-flash',
    label: 'Pulse → flash',
    effect: {
      id: 'pulse-then-flash',
      label: 'Pulse → flash',
      graph: {
        nodes: [
          { id: 's', kind: 'scale', x: 0, y: 0, params: { mul: 1.4, ms: 250 } },
          { id: 'c', kind: 'color', x: 0, y: 0, params: { tint: 0x55ff55, ms: 400 } },
        ],
        edges: [{ from: 's', to: 'c' }],
      },
    },
  },
]

function FlowEffectsSection({
  node,
  renderer,
}: {
  node: ModelNode
  renderer: import('../scene/SceneRenderer').SceneRenderer
}) {
  const [selected, setSelected] = useState<string>(FLOW_PRESETS[0].id)
  const [editing, setEditing] = useState<import('../flow/types').FlowEffect | null>(null)
  const play = () => {
    const preset = FLOW_PRESETS.find((p) => p.id === selected)
    if (!preset) return
    renderer.playFlowEffect(node.id, preset.effect)
  }
  const attach = () => {
    const preset = FLOW_PRESETS.find((p) => p.id === selected)
    if (!preset) return
    attachEffect(node.id, { ...preset.effect, alwaysPlay: true }, node.flowEffects)
  }
  const detach = (effectId: string) => {
    const existing = node.flowEffects ?? []
    useOmniStore
      .getState()
      .updateNode(node.id, { flowEffects: existing.filter((e) => e.id !== effectId) })
  }
  const editExisting = (eff: import('../flow/types').FlowEffect) => setEditing(eff)
  const editor = editing ? (
    <FlowEffectEditor
      initial={editing}
      onPreview={(eff) => renderer.playFlowEffect(node.id, eff)}
      onSave={(eff) => {
        const existing = node.flowEffects ?? []
        const withId = { ...eff, id: eff.id || `eff_${Date.now().toString(36)}`, alwaysPlay: true }
        // Replace by id if it already exists.
        const next = existing.some((x) => x.id === withId.id)
          ? existing.map((x) => (x.id === withId.id ? withId : x))
          : [...existing, withId]
        useOmniStore.getState().updateNode(node.id, { flowEffects: next })
        setEditing(null)
      }}
      onClose={() => setEditing(null)}
    />
  ) : null
  const attached = (node.flowEffects ?? []).filter((e) => e.alwaysPlay)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
      <span style={{ fontSize: 11, color: '#7a8aa0' }}>Flow effects</span>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={inputStyle}
      >
        {FLOW_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <Row>
        <button onClick={play} style={buttonStyle}>
          ▶ Play once
        </button>
        <button onClick={attach} style={buttonStyle}>
          ∞ Attach loop
        </button>
      </Row>
      <button
        onClick={() => setEditing(emptyEffect())}
        style={buttonStyle}
      >
        + New custom effect
      </button>
      {attached.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {attached.map((e) => (
            <li
              key={e.id}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#bcd' }}
            >
              <span>∞ {e.label}</span>
              <span>
                <button
                  onClick={() => editExisting(e)}
                  style={{ ...buttonStyle, padding: '2px 6px', fontSize: 11, marginRight: 4 }}
                  title="Edit effect"
                >
                  ✎
                </button>
                <button
                  onClick={() => detach(e.id)}
                  style={{ ...buttonStyle, padding: '2px 6px', fontSize: 11 }}
                  title="Remove looped effect"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editor}
    </div>
  )
}

function attachEffect(
  nodeId: string,
  effect: import('../flow/types').FlowEffect,
  existing: import('../flow/types').FlowEffect[] | undefined,
) {
  // Stable per-attachment id so always-play reconciliation works.
  const attached: import('../flow/types').FlowEffect = {
    ...effect,
    id: `${effect.id}-${Date.now().toString(36)}`,
  }
  useOmniStore
    .getState()
    .updateNode(nodeId, { flowEffects: [...(existing ?? []), attached] })
}

function TextGenSection({
  node,
  renderer,
}: {
  node: ModelNode
  renderer: import('../scene/SceneRenderer').SceneRenderer
}) {
  const [text, setText] = useState<string>('Hello, world!')
  const [cps, setCps] = useState<number>(24)
  const [sound, setSound] = useState<import('../audio/textGenSounds').TextGenSoundPreset>('typewriter')
  const [loop, setLoop] = useState<boolean>(false)
  const [running, setRunning] = useState<boolean>(false)
  const start = () => {
    renderer.startTextGen(node.id, { text, charsPerSec: cps, sound, loop, endHoldMs: 1500 })
    setRunning(true)
  }
  const stop = () => {
    renderer.stopTextGen(node.id)
    setRunning(false)
  }
  // Sound preset choices loaded lazily so SSR/test paths don't touch the
  // audio module unless this section actually mounts.
  const SOUNDS: { id: import('../audio/textGenSounds').TextGenSoundPreset; label: string }[] = [
    { id: 'none', label: 'None' },
    { id: 'undertale', label: 'Undertale' },
    { id: 'inscryption', label: 'Inscryption' },
    { id: 'pokemon', label: 'Pokémon' },
    { id: 'typewriter', label: 'Typewriter' },
    { id: 'terminal', label: 'Terminal' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
      <span style={{ fontSize: 11, color: '#7a8aa0' }}>Text generator</span>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        style={{ ...inputStyle, resize: 'vertical', minHeight: 32, fontFamily: 'inherit' }}
      />
      <Row>
        <Field label="cps">
          <NumberField value={cps} min={1} max={120} step={1} onChange={setCps} />
        </Field>
        <Field label="loop">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            style={{ accentColor: '#5da' }}
          />
        </Field>
      </Row>
      <select
        value={sound}
        onChange={(e) => setSound(e.target.value as import('../audio/textGenSounds').TextGenSoundPreset)}
        style={inputStyle}
      >
        {SOUNDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <Row>
        <button onClick={start} style={buttonStyle} disabled={running}>
          ▶ Type
        </button>
        <button onClick={stop} style={buttonStyle} disabled={!running}>
          ⏹ Stop
        </button>
      </Row>
    </div>
  )
}
