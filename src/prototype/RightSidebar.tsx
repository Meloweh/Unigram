import { useState } from 'react'
import type { Model, ModelNode, ModelConnection, NodeShape } from './sampleModels'

export function RightSidebar({ model, selectedNode, selectedConnection, gridSnap, onSetGridSnap, onUpdateNodeShape, onUpdateNodeProps }: {
  model: Model | undefined
  selectedNode: ModelNode | undefined
  selectedConnection: ModelConnection | undefined
  gridSnap: number
  onSetGridSnap: (size: number) => void
  onUpdateNodeShape: (nodeId: string, shape: NodeShape) => void
  onUpdateNodeProps: (nodeId: string, props: Partial<ModelNode>) => void
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

function NodeSettings({ node, onUpdateShape, onUpdateProps }: {
  node: ModelNode
  onUpdateShape: (shape: NodeShape) => void
  onUpdateProps: (props: Partial<ModelNode>) => void
}) {
  const shapeOptions: NodeShape[] = ['rectangle', 'rounded-rect', 'oval', 'circle', 'diamond', 'hexagon', 'parallelogram', 'triangle']
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
            <input
              id="cell-color"
              type="color"
              className="settings-color-input"
              value={node.cellColor ?? '#f4f8fd'}
              onChange={(e) => onUpdateProps({ cellColor: e.target.value })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="membrane-color">Membrane</label>
            <input
              id="membrane-color"
              type="color"
              className="settings-color-input"
              value={node.membraneColor ?? '#365f8f'}
              onChange={(e) => onUpdateProps({ membraneColor: e.target.value })}
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
        </div>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Diagrams</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <span className="settings-label">RMM</span>
            <span className="settings-value">{node.childModelId ?? '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">MPD</span>
            <span className="settings-value">{node.mpdIds?.length ? node.mpdIds.join(', ') : '—'}</span>
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
