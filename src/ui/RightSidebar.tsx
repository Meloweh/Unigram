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

import { useSyncExternalStore } from 'react'
import { useOmniStore } from '../model/store'
import type { ModelNode, NodeShape } from '../model/types'

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

export function RightSidebar() {
  useStoreVersion()
  const state = useOmniStore.getState()
  const selectedIds = state.selectedIds
  const nodes: ModelNode[] = []
  for (const id of selectedIds) {
    const n = state.model.nodes.get(id)
    if (n) nodes.push(n)
  }

  if (nodes.length === 0) {
    return (
      <Panel>
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
    <Panel>
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
        <input
          type="text"
          value={label === MIXED ? '' : (label as string)}
          placeholder={label === MIXED ? '(mixed)' : ''}
          onChange={(e) => updateAll({ label: e.target.value })}
          style={inputStyle}
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

      <button
        onClick={() => useOmniStore.getState().removeNodes(nodes.map((n) => n.id))}
        style={{ ...buttonStyle, background: '#5a1f1f', borderColor: '#a04040', marginTop: 8 }}
      >
        Delete {isMulti ? `${nodes.length} nodes` : 'node'}
      </button>
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

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        bottom: 8,
        width: 260,
        background: 'rgba(16,19,26,0.92)',
        color: '#cfe',
        font: '12px system-ui, sans-serif',
        padding: 12,
        borderRadius: 6,
        border: '1px solid #2a3142',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        overflowY: 'auto',
        zIndex: 5,
      }}
    >
      {children}
    </div>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 600, fontSize: 13, color: '#fff', borderBottom: '1px solid #2a3142', paddingBottom: 6 }}>
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
