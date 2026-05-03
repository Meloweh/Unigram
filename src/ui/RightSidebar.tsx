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

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FlowEffectEditor, emptyEffect } from '../flow/FlowEffectEditor'
import { useOmniStore } from '../model/store'
import type { ModelNode, NodeShape, ConnectionDashStyle, ConnectionArrowStyle, ConnectionKind } from '../model/types'
import { animatedContentStyle, shellStyle, toggleColumnStyle } from './LeftSidebar'
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

  // Single persistent shell so the collapse/expand animation runs on the
  // outer width transition (the previous code returned different DOM trees
  // for collapsed vs expanded, which prevented React from animating).
  const inner = collapsed ? null : renderInner(nodes, state, renderer ?? null)

  return (
    <div style={shellStyle('right', collapsed)}>
      <div style={rightInspectorContentStyle(collapsed)}>{inner}</div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand inspector' : 'Collapse panel'}
        style={toggleColumnStyle()}
      >
        {collapsed ? '‹' : '›'}
      </button>
    </div>
  )
}

function rightInspectorContentStyle(collapsed: boolean): React.CSSProperties {
  return {
    ...animatedContentStyle(collapsed),
    gap: 0,
    padding: collapsed ? 0 : '12px 10px',
  }
}

/**
 * Build the inspector body for the current selection. Extracted from
 * `RightSidebar` so the outer collapsible shell stays single-rooted.
 */
function renderInner(
  nodes: ModelNode[],
  state: ReturnType<typeof useOmniStore.getState>,
  renderer: import('../scene/SceneRenderer').SceneRenderer | null,
): React.ReactNode {
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
          <>
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
                      background: kind === k ? 'var(--ug-primary)' : 'var(--ug-surface-raised)',
                      borderColor: kind === k ? 'var(--ug-primary-light)' : 'var(--ug-border)',
                      color: kind === k ? 'var(--ug-text-on-primary)' : 'var(--ug-text)',
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
                style={{ width: '100%', height: 26, padding: 0, border: '1px solid var(--ug-border)' }}
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
            <Checkbox
              label="Tracked by camera"
              checked={edge.cameraTracked === true}
              onChange={(v) => useOmniStore.getState().updateEdge(eid, { cameraTracked: v || undefined })}
            />
            <button
              onClick={() => useOmniStore.getState().removeEdges([eid])}
              style={dangerButtonStyle}
            >
              Delete connection
            </button>
          </>
        )
      }
    }
    const grid = state.model.grid ?? { enabled: false, snap: false, sizePercent: 4 }
    return (
      <>
        <Title>Diagram</Title>
        <Field label="Name">
          <input
            type="text"
            value={state.model.name}
            onChange={(e) => {
              useOmniStore.setState((s) => ({
                model: { ...s.model, name: e.target.value },
                rev: s.rev + 1,
              }))
            }}
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Grid</span>
          <Checkbox
            label="Show grid"
            checked={grid.enabled}
            onChange={(v) => useOmniStore.getState().setGrid({ enabled: v })}
          />
          <Checkbox
            label="Snap to grid"
            checked={grid.snap}
            onChange={(v) => useOmniStore.getState().setGrid({ snap: v })}
          />
          <Field label="Grid size %">
            <NumberField
              value={grid.sizePercent}
              min={0.5}
              max={50}
              step={0.5}
              onChange={(v) => useOmniStore.getState().setGrid({ sizePercent: v })}
            />
          </Field>
          <Field label="Grid appearance">
            <select
              value={grid.appearance ?? 'lines'}
              onChange={(e) =>
                useOmniStore
                  .getState()
                  .setGrid({ appearance: e.target.value as 'lines' | 'dots' | 'tile' })
              }
              style={inputStyle}
            >
              <option value="lines">Lines</option>
              <option value="dots">Dots</option>
              <option value="tile">Tile</option>
            </select>
          </Field>
        </div>
        <CosmeticsControls />
      </>
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
    <>
      <Title>{isMulti ? `${nodes.length} nodes` : 'Node'}</Title>

      <Field label="Node shape">
        <select
          value={shape === MIXED ? '' : (shape as NodeShape)}
          onChange={(e) => updateAll({ shape: e.target.value as NodeShape })}
          style={inputStyle}
        >
          {shape === MIXED && <option value="">(mixed)</option>}
          {ALL_SHAPES.map((s) => (
            <option key={s} value={s}>{SHAPE_LABEL[s]}</option>
          ))}
        </select>
      </Field>

      {!isMulti && <MediaSection node={nodes[0]} />}

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
        <Field label="Fill" grow>
          <ColorField
            value={cellColor}
            onChange={(v) => updateAll({ cellColor: v })}
          />
        </Field>
        <Field label="Border" grow>
          <ColorField
            value={membraneColor}
            onChange={(v) => updateAll({ membraneColor: v })}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Width %" grow>
          <NumberField
            value={w}
            min={1}
            max={100}
            step={0.5}
            onChange={(v) => updateAll({ w: v })}
          />
        </Field>
        <Field label="Height %" grow>
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
        style={{ ...buttonStyle, background: 'var(--ug-danger-bg)', color: 'var(--ug-danger)', borderColor: 'var(--ug-danger-border)', marginTop: 8 }}
      >
        Delete {isMulti ? `${nodes.length} nodes` : 'node'}
      </button>

      <BehaviourFlags nodes={nodes} updateAll={updateAll} />

      {!isMulti && <MpdSection node={nodes[0]} />}
      {!isMulti && <RmmSection node={nodes[0]} />}
      {!isMulti && <LinkedNodesSection node={nodes[0]} />}
      {!isMulti && renderer && <FlowEffectsSection node={nodes[0]} renderer={renderer} />}
    </>
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
        style={{ width: 32, height: 24, padding: 0, border: '1px solid var(--ug-border)', background: 'transparent' }}
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

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontWeight: 700,
        fontSize: '0.78rem',
        color: 'var(--ug-text)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: 10,
        padding: '0 2px',
      }}
    >
      {children}
    </div>
  )
}

function Field({ label, children, grow = false }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flex: grow ? 1 : '0 0 auto',
        minWidth: 0,
        minHeight: 28,
        margin: 0,
        padding: '4px 8px',
        fontSize: '0.8rem',
      }}
    >
      <span style={{ color: 'var(--ug-text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>{children}</span>
    </label>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 2 }}>{children}</div>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14, color: 'var(--ug-text-muted)', fontStyle: 'italic' }}>{children}</div>
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
      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Theme</span>
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

      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Background</span>
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

      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Particles</span>
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
  background: 'var(--ug-surface)',
  color: 'var(--ug-text)',
  border: '1px solid var(--ug-border)',
  borderRadius: 4,
  padding: '2px 6px',
  font: '0.78rem system-ui, sans-serif',
  width: '100%',
  minHeight: 24,
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--ug-accent-bg)',
  color: 'var(--ug-accent)',
  border: '1px solid var(--ug-accent-border)',
  borderRadius: 4,
  padding: '2px 10px',
  font: '600 0.75rem system-ui, sans-serif',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const checkboxStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  margin: 0,
  accentColor: 'var(--ug-primary)',
  cursor: 'pointer',
}

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--ug-danger-bg)',
  color: 'var(--ug-danger)',
  border: '1px solid var(--ug-danger-border)',
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
  const someHave = (pick: (n: ModelNode) => boolean | undefined) => nodes.some((n) => !!pick(n))
  const triState = (pick: (n: ModelNode) => boolean | undefined): boolean | 'mixed' => {
    const all = allHave(pick)
    if (all) return true
    return someHave(pick) ? 'mixed' : false
  }
  const locked = triState((n) => n.locked)
  const hideDuringFlow = triState((n) => n.hideDuringFlow)
  const cameraTracked = triState((n) => n.cameraTracked)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Behaviour</span>
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
        label="Tracked by camera"
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
  checked: boolean | 'mixed'
  onChange: (v: boolean) => void
}) {
  // Render an HTML "indeterminate" checkbox when the multi-selection is
  // mixed so the user knows the value differs across nodes. Clicking
  // promotes everything to checked (matches legacy Unigram behaviour).
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--ug-text)', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked === true}
        ref={(el) => { if (el) el.indeterminate = checked === 'mixed' }}
        onChange={(e) => onChange(checked === 'mixed' ? true : e.target.checked)}
        style={checkboxStyle}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Tip / tail</span>
      <Row>
        <Field label="Angle°" grow>
          <NumberField
            value={Math.round(angDeg)}
            min={-180}
            max={360}
            step={5}
            onChange={(v) => setPolar(v, len || 60)}
          />
        </Field>
        <Field label="Length %" grow>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>MPD dimensions</span>
      {dims.length === 0 ? (
        <span style={{ fontSize: 14, color: '#576278' }}>None</span>
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

/**
 * RMM (recursive-model-model) child link editor. A node can act as a
 * portal into a child model: zooming the dial fully in re-roots the
 * scene at the child. This panel surfaces the link state with three
 * actions:
 *  - "+ Add" creates a fresh empty model and links it.
 *  - "Open" zooms the renderer into the child via the existing RMM stack.
 *  - "Remove" unlinks (the child model stays registered so undo restores).
 *
 * Mirrors legacy [src/old/ui/NodeSettingsPanel.tsx](../old/ui/NodeSettingsPanel.tsx)
 * `addRmm()` parity. The `Open` action selects the node and triggers
 * `rmmZoomStep('in')` repeatedly until the handoff fires (handoff happens
 * at the dial boundary inside `rmmZoomStep`).
 */
function RmmSection({ node }: { node: ModelNode }) {
  const linkedId = node.childModelId
  const linkedModel = useOmniStore((s) => (linkedId ? s.models.get(linkedId) : undefined))
  const handleAdd = () => {
    useOmniStore.getState().addChildModel(node.id)
  }
  const handleRemove = () => {
    useOmniStore.getState().removeChildModel(node.id)
  }
  const handleOpen = () => {
    const s = useOmniStore.getState()
    s.selectMany([node.id])
    // Step in until the handoff fires (rmmZoomStep is a no-op once the dial
    // hits its inner boundary on the same model).
    for (let i = 0; i < 8; i++) {
      s.rmmZoomStep('in')
      if (useOmniStore.getState().model.id === linkedId) break
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Child model (RMM)</span>
      {linkedId ? (
        <>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="text"
              value={linkedModel?.name ?? linkedId}
              disabled={!linkedModel}
              onChange={(e) => {
                const target = useOmniStore.getState().models.get(linkedId)
                if (!target) return
                useOmniStore.setState((s) => {
                  const models = new Map(s.models)
                  const updated = { ...target, name: e.target.value }
                  models.set(linkedId, updated)
                  const isActive = s.model.id === linkedId
                  return {
                    models,
                    model: isActive ? updated : s.model,
                    rev: s.rev + 1,
                  }
                })
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={handleOpen} style={{ ...buttonStyle, flex: 1 }} disabled={!linkedModel}>Open</button>
            <button onClick={handleRemove} style={{ ...buttonStyle, flex: 1 }}>Remove</button>
          </div>
        </>
      ) : (
        <>
          <span style={{ fontSize: 14, color: '#576278' }}>None</span>
          <button onClick={handleAdd} style={buttonStyle}>+ Add child model</button>
        </>
      )}
    </div>
  )
}

/* ---- MediaSection -------------------------------------------------------
 *
 * Surfaces the special node-type metadata: a label badge for the chosen
 * `mediaType` and (for the binary kinds) a file picker that stashes the
 * dropped file through `storeMediaBlob` and writes the resulting object
 * URL back to the node's `mediaSrc`. Markdown / math editing UI is left
 * for Phase E (needs a markdown + KaTeX rendering pipeline that is not
 * yet wired into the scene).
 */
function MediaSection({ node }: { node: ModelNode }) {
  const update = (patch: Partial<ModelNode>) => useOmniStore.getState().updateNode(node.id, patch)
  const mediaType = node.mediaType
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: 0 }}>
      <span style={{ fontSize: 13, color: 'var(--ug-text-muted)', lineHeight: 1.1 }}>Media</span>
      <select
        value={mediaType ?? ''}
        onChange={(e) => {
          const v = e.target.value as ModelNode['mediaType'] | ''
          update({
            mediaType: v === '' ? undefined : v,
            ...(v === 'markdown' || v === 'math' ? { contentSource: node.contentSource ?? '', contentCollapsed: node.contentCollapsed ?? true } : {}),
          })
        }}
        style={inputStyle}
      >
        <option value="">— none —</option>
        <option value="image">Image</option>
        <option value="gif">GIF</option>
        <option value="audio">Audio</option>
        <option value="video">Video</option>
        <option value="markdown">Markdown</option>
        <option value="math">Math</option>
      </select>
      {mediaType && mediaType !== 'markdown' && mediaType !== 'math' && (
        <>
          <input
            type="file"
            accept={
              mediaType === 'image' || mediaType === 'gif' ? 'image/*' :
              mediaType === 'audio' ? 'audio/*' : 'video/*'
            }
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const { storeMediaBlob } = await import('../media/mediaStore')
              const url = await storeMediaBlob(f)
              update({ mediaSrc: url, mediaFileName: f.name })
            }}
            style={{ fontSize: 14, color: 'var(--ug-text)' }}
          />
          {node.mediaFileName && (
            <span style={{ fontSize: 14, color: '#576278' }}>{node.mediaFileName}</span>
          )}
          {node.mediaSrc && (
            <button
              type="button"
              onClick={() => update({ mediaSrc: undefined, mediaFileName: undefined })}
              style={buttonStyle}
            >
              Clear media
            </button>
          )}
          {mediaType === 'audio' && (
            <>
              <span style={{ fontSize: 13, color: 'var(--ug-text-muted)', lineHeight: 1.1 }}>Cover</span>
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  const { storeMediaBlob } = await import('../media/mediaStore')
                  update({ audioCoverSrc: await storeMediaBlob(f) })
                }}
                style={{ fontSize: 14, color: 'var(--ug-text)' }}
              />
              {node.audioCoverSrc && (
                <button type="button" onClick={() => update({ audioCoverSrc: undefined })} style={buttonStyle}>
                  Clear cover
                </button>
              )}
            </>
          )}
        </>
      )}
      {(mediaType === 'markdown' || mediaType === 'math') && (
        <>
          <textarea
            value={node.contentSource ?? (typeof node.extra?.contentSource === 'string' ? node.extra.contentSource : '')}
            onChange={(e) => update({ contentSource: e.target.value })}
            rows={4}
            placeholder={mediaType === 'markdown' ? '# Heading\n\nText...' : 'a^2 + b^2 = c^2'}
            style={{
              ...inputStyle,
              font: '12px ui-monospace, monospace',
              padding: 4,
              resize: 'vertical',
            }}
          />
          <Checkbox
            label="Collapsed preview"
            checked={node.contentCollapsed !== false}
            onChange={(v) => update({ contentCollapsed: v })}
          />
          <Field label="Content size">
            <NumberField
              value={node.contentFontSize ?? 0.85}
              min={0.5}
              max={3}
              step={0.05}
              onChange={(v) => update({ contentFontSize: v })}
            />
          </Field>
        </>
      )}
    </div>
  )
}

/* ---- LinkedNodesSection -------------------------------------------------
 *
 * UI for parity item I — paired effect-graph editing. Lists the node's
 * symmetric link peers and exposes Add / Remove. The actual cross-graph
 * authoring lives inside FlowEffectEditor (which renders one column per
 * linked host once opened). "Add" is a one-click flow: the user toggles
 * `pickMode = 'link-node'` and the next selected node is paired.
 */
function LinkedNodesSection({ node }: { node: ModelNode }) {
  const links = node.linkedNodeIds ?? []
  const allNodes = useOmniStore((s) => s.model.nodes)
  // Hide the section entirely when nothing is linked — the empty-state
  // copy was confusing because the only way to add a link is from inside
  // the effect-graph editor (the inspector has no entry point).
  if (links.length === 0) return null
  const labelFor = (id: string) => allNodes.get(id)?.label || id
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Linked nodes (paired effects)</span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {links.map((peerId) => (
          <li key={peerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, color: 'var(--ug-text)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(peerId)}</span>
            <button
              style={{ ...buttonStyle, padding: '2px 6px', fontSize: 14 }}
              onClick={() => useOmniStore.getState().unlinkNodes(node.id, peerId)}
            >
              Unlink
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FlowEffectsSection({
  node,
  renderer,
}: {
  node: ModelNode
  renderer: import('../scene/SceneRenderer').SceneRenderer
}) {
  const [editing, setEditing] = useState<import('../flow/types').FlowEffect | null>(null)
  // Snapshot of the in-progress effect kept while the editor is hidden
  // during a canvas link-pick. When pickMode clears (the user clicked a
  // peer node, or hit Cancel) we restore the editor with this snapshot so
  // the user doesn't lose their unsaved graph edits.
  const linkPickSnapshot = useRef<import('../flow/types').FlowEffect | null>(null)
  const pickMode = useSyncExternalStore(
    (cb) => useOmniStore.subscribe(cb),
    () => useOmniStore.getState().pickMode,
    () => null,
  )
  useEffect(() => {
    if (pickMode === null && linkPickSnapshot.current && !editing) {
      // Pick resolved (success or cancel) → reopen the editor.
      setEditing(linkPickSnapshot.current)
      linkPickSnapshot.current = null
    }
  }, [pickMode, editing])
  const editor = editing ? (
    <FlowEffectEditor
      initial={editing}
      hostNodeId={node.id}
      onPreview={(eff) => renderer.playFlowEffect(node.id, eff)}
      onSave={(eff) => {
        const existing = node.flowEffects ?? []
        // Preserve the original alwaysPlay flag so editing a one-shot effect
        // doesn't accidentally promote it to a loop (legacy parity).
        const withId = {
          ...eff,
          id: eff.id || `eff_${Date.now().toString(36)}`,
          alwaysPlay: editing?.alwaysPlay ?? false,
        }
        // Replace by id if it already exists.
        const next = existing.some((x) => x.id === withId.id)
          ? existing.map((x) => (x.id === withId.id ? withId : x))
          : [...existing, withId]
        useOmniStore.getState().updateNode(node.id, { flowEffects: next })
        setEditing(null)
      }}
      onClose={() => setEditing(null)}
      onLinkPick={(latest) => {
        // Stash the latest editor state so it survives the modal close,
        // then close so the canvas pick UI is visible.
        linkPickSnapshot.current = latest
        setEditing(null)
      }}
    />
  ) : null
  const all = node.flowEffects ?? []
  // Per omnigram parity (task E) every node hosts a single effect graph;
  // multiple legacy effects are collapsed to the first entry.
  const single = all[0] ?? null
  const openGraph = () => {
    if (single) setEditing(single)
    else setEditing(emptyEffect())
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      <span style={{ fontSize: 14, color: 'var(--ug-text-muted)' }}>Flow effect</span>
      <button onClick={openGraph} style={buttonStyle}>
        Open effect graph
      </button>
      {editor}
    </div>
  )
}

// (TextGenSection removed — text-generator is exposed as a Flow Effect kind
// only, matching legacy Unigram behaviour. See `src/flow/types.ts` for the
// `'text-generator'` effect kind and the FlowEffectEditor for the editor UI.)
