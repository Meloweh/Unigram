import { useState, useRef } from 'react'
import type { Model, ModelNode, ModelConnection, NodeShape } from './sampleModels'

let _nextId = 1
function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${_nextId++}`
}

/** Color picker that uses a hidden native input but positions the swatch to the left of the sidebar */
function ColorInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value)
  const lastProp = useRef(value)
  if (value !== lastProp.current) {
    lastProp.current = value
    setText(value)
  }
  return (
    <div className="settings-color-wrapper">
      <input
        ref={inputRef}
        id={id}
        type="color"
        className="settings-color-native"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="settings-color-swatch"
        style={{ background: value }}
        onClick={() => inputRef.current?.click()}
        title="Pick color"
      />
      <input
        type="text"
        className="settings-color-hex"
        value={text}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v)
        }}
        onBlur={() => {
          let v = text.trim()
          if (!v.startsWith('#')) v = '#' + v
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v)
          else setText(value)
        }}
      />
    </div>
  )
}

export function RightSidebar({ model, selectedNode, selectedConnection, gridSnap, onSetGridSnap, onUpdateNodeShape, onUpdateNodeProps, allModels, onRegisterModel, onUpdateModelLabel }: {
  model: Model | undefined
  selectedNode: ModelNode | undefined
  selectedConnection: ModelConnection | undefined
  gridSnap: number
  onSetGridSnap: (size: number) => void
  onUpdateNodeShape: (nodeId: string, shape: NodeShape) => void
  onUpdateNodeProps: (nodeId: string, props: Partial<ModelNode>) => void
  allModels: Record<string, Model>
  onRegisterModel: (model: Model) => void
  onUpdateModelLabel: (modelId: string, label: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className={`sidebar sidebar-right ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand panel' : 'Collapse panel'}
      >
        {collapsed ? '‹' : '›'}
      </button>
      {!collapsed && (
        <div className="sidebar-content">
          {selectedNode ? (
            <NodeSettings
              node={selectedNode}
              onUpdateShape={(shape) => onUpdateNodeShape(selectedNode.id, shape)}
              onUpdateProps={(props) => onUpdateNodeProps(selectedNode.id, props)}
              allModels={allModels}
              onRegisterModel={onRegisterModel}
              onUpdateModelLabel={onUpdateModelLabel}
            />
          ) : selectedConnection ? (
            <ConnectionSettings connection={selectedConnection} />
          ) : (
            <DiagramSettings
              model={model}
              gridSnap={gridSnap}
              onSetGridSnap={onSetGridSnap}
            />
          )}
        </div>
      )}
    </div>
  )
}

function DiagramSettings({ model, gridSnap, onSetGridSnap }: {
  model: Model | undefined
  gridSnap: number
  onSetGridSnap: (size: number) => void
}) {
  return (
    <>
      <div className="sidebar-title">Diagram Settings</div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">General</div>
        <div className="sidebar-section-body">
          {model && (
            <div className="settings-row">
              <span className="settings-label">Model</span>
              <span className="settings-value">{model.label}</span>
            </div>
          )}
          <div className="settings-row">
            <label className="settings-label" htmlFor="grid-snap">Grid Snap</label>
            <select
              id="grid-snap"
              className="settings-select"
              value={gridSnap}
              onChange={(e) => onSetGridSnap(Number(e.target.value))}
            >
              {[1, 2, 4, 5, 8, 10].map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </>
  )
}

function NodeSettings({ node, onUpdateShape, onUpdateProps, allModels, onRegisterModel, onUpdateModelLabel }: {
  node: ModelNode
  onUpdateShape: (shape: NodeShape) => void
  onUpdateProps: (props: Partial<ModelNode>) => void
  allModels: Record<string, Model>
  onRegisterModel: (model: Model) => void
  onUpdateModelLabel: (modelId: string, label: string) => void
}) {
  const shapeOptions: NodeShape[] = ['rectangle', 'rounded-rect', 'oval', 'circle', 'diamond', 'hexagon', 'parallelogram', 'triangle']

  /** Create a twin node stub that mirrors the source node in a new model */
  const makeTwinNode = (): ModelNode => ({
    id: node.id,
    label: node.label,
    x: node.x,
    y: node.y,
    shape: node.shape,
    cellColor: node.cellColor,
    membraneColor: node.membraneColor,
    membraneVisible: node.membraneVisible,
  })

  const addRmm = () => {
    const id = genId('rmm')
    const label = `${node.label || 'Node'} RMM`
    onRegisterModel({ id, label, nodes: [], connections: [] })
    onUpdateProps({ childModelId: id })
  }

  const addMpd = () => {
    const mpdId = genId('mpd')
    const label = `${node.label || 'Node'} MPD ${(node.mpdIds?.length ?? 0) + 1}`
    // Create a new model with a twin of the source node so the dial has something to switch to
    onRegisterModel({ id: mpdId, label, nodes: [makeTwinNode()], connections: [] })

    if (node.mpdIds) {
      // Already has MPD entries — just append
      onUpdateProps({ mpdIds: [...node.mpdIds, mpdId] })
    } else {
      // No mpdIds yet — create a default model for the current scene
      const defaultId = genId('mpd')
      const defaultLabel = `${node.label || 'Node'} (default)`
      onRegisterModel({ id: defaultId, label: defaultLabel, nodes: [], connections: [] })
      onUpdateProps({ mpdIds: [defaultId, mpdId] })
    }
  }

  const removeMpd = (mpdId: string) => {
    const mpdIds = (node.mpdIds ?? []).filter(id => id !== mpdId)
    onUpdateProps({
      mpdIds: mpdIds.length ? mpdIds : (undefined as unknown as string[]),
    })
  }

  const rmmModel = node.childModelId ? allModels[node.childModelId] : undefined
  const mpdEntries = (node.mpdIds ?? [])
    .map(id => ({ id, model: allModels[id] }))

  return (
    <>
      <div className="sidebar-title">Node Settings</div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Appearance</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <span className="settings-label">Label</span>
            <span className="settings-value">{node.label || '(empty)'}</span>
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="node-shape">Shape</label>
            <select
              id="node-shape"
              className="settings-select"
              value={node.shape ?? 'rounded-rect'}
              onChange={(e) => onUpdateShape(e.target.value as NodeShape)}
            >
              {shapeOptions.map((s) => (
                <option key={s} value={s}>{s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="cell-color">Cell Color</label>
            <ColorInput
              id="cell-color"
              value={node.cellColor ?? '#f4f8fd'}
              onChange={(v) => onUpdateProps({ cellColor: v })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="membrane-color">Membrane</label>
            <ColorInput
              id="membrane-color"
              value={node.membraneColor ?? '#365f8f'}
              onChange={(v) => onUpdateProps({ membraneColor: v })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="membrane-visible">Border</label>
            <input
              id="membrane-visible"
              type="checkbox"
              className="settings-checkbox"
              checked={node.membraneVisible !== false}
              onChange={(e) => onUpdateProps({ membraneVisible: e.target.checked })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="node-locked">Lock</label>
            <input
              id="node-locked"
              type="checkbox"
              className="settings-checkbox"
              checked={node.locked === true}
              onChange={(e) => onUpdateProps({ locked: e.target.checked })}
            />
          </div>
        </div>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Diagrams</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <span className="settings-label">RMM</span>
            {rmmModel ? (
              <input
                type="text"
                className="settings-text-input"
                value={rmmModel.label}
                onChange={(e) => onUpdateModelLabel(rmmModel.id, e.target.value)}
              />
            ) : (
              <button type="button" className="settings-add-btn" onClick={addRmm}>+ Add</button>
            )}
          </div>

          {/* MPD section — always visible; first entry is immutable default */}
          <div className="settings-row">
            <span className="settings-label">MPD</span>
            <span className="settings-value">
              {mpdEntries.length > 0
                ? `${mpdEntries.length} dimension${mpdEntries.length > 1 ? 's' : ''}`
                : rmmModel
                  ? `1 dimension`
                  : '—'}
            </span>
          </div>
          {mpdEntries.map(({ id, model: m }, idx) => (
            <div className="settings-row settings-row-indent" key={id}>
              {idx === 0 ? (
                <span className="settings-value mpd-default-entry">{m?.label ?? id}</span>
              ) : (
                <>
                  <input
                    type="text"
                    className="settings-text-input"
                    value={m?.label ?? id}
                    onChange={(e) => onUpdateModelLabel(id, e.target.value)}
                  />
                  <button
                    type="button"
                    className="settings-remove-btn"
                    onClick={() => removeMpd(id)}
                    title="Remove MPD"
                  >×</button>
                </>
              )}
            </div>
          ))}

          <div className="settings-row">
            <span className="settings-label" />
            <button type="button" className="settings-add-btn" onClick={addMpd}>+ Add MPD</button>
          </div>
        </div>
      </div>
    </>
  )
}

function ConnectionSettings({ connection }: { connection: ModelConnection }) {
  return (
    <>
      <div className="sidebar-title">Connection Settings</div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Style</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <span className="settings-label">Line Type</span>
            <span className="settings-value">Solid</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Arrow Head</span>
            <span className="settings-value">Standard</span>
          </div>
        </div>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">References</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <span className="settings-label">From → To</span>
            <span className="settings-value">{connection.from} → {connection.to}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Evidence</span>
            <span className="settings-value">{connection.evidence?.length ?? 0} items</span>
          </div>
        </div>
      </div>
    </>
  )
}
