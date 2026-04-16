import { useState, useEffect } from 'react'
import type { Model, ModelNode, ModelConnection, NodeShape, ConnectionType, ConnectionArrowStyle, ConnectionDashStyle } from '../model/sampleModels'
import { ColorInput, DiagramSettings } from './DiagramSettings'
import { NodeSettings } from './NodeSettingsPanel'

export function RightSidebar({ model, selectedNode, selectedNodeIds, selectedConnection, gridSnap, onSetGridSnap, onUpdateNodeShape, onUpdateNodeProps, onBulkUpdateNodeProps, onBulkUpdateNodeShape, allModels, onRegisterModel, onUpdateModelLabel, onUpdateConnectionType, onUpdateConnectionProps, onEditEffect, onEditContent, forceCollapsed }: {
  model: Model | undefined
  selectedNode: ModelNode | undefined
  selectedNodeIds: Set<string>
  selectedConnection: ModelConnection | undefined
  gridSnap: number
  onSetGridSnap: (size: number) => void
  onUpdateNodeShape: (nodeId: string, shape: NodeShape) => void
  onUpdateNodeProps: (nodeId: string, props: Partial<ModelNode>) => void
  onBulkUpdateNodeProps: (nodeIds: Set<string>, props: Partial<ModelNode>) => void
  onBulkUpdateNodeShape: (nodeIds: Set<string>, shape: NodeShape) => void
  allModels: Record<string, Model>
  onRegisterModel: (model: Model) => void
  onUpdateModelLabel: (modelId: string, label: string) => void
  onUpdateConnectionType: (from: string, to: string, type: ConnectionType) => void
  onUpdateConnectionProps: (from: string, to: string, props: Partial<ModelConnection>) => void
  onEditEffect: (nodeId: string, effectId: string) => void
  onEditContent?: (nodeId: string) => void
  forceCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (forceCollapsed !== undefined) setCollapsed(forceCollapsed)
  }, [forceCollapsed])

  const multiNodes = selectedNodeIds.size > 1 && model
    ? model.nodes.filter(n => selectedNodeIds.has(n.id))
    : []

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
          {multiNodes.length > 1 ? (
            <MultiNodeSettings
              nodes={multiNodes}
              onUpdateProps={(props) => onBulkUpdateNodeProps(selectedNodeIds, props)}
              onUpdateShape={(shape) => onBulkUpdateNodeShape(selectedNodeIds, shape)}
            />
          ) : selectedNode ? (
            <NodeSettings
              node={selectedNode}
              onUpdateShape={(shape) => onUpdateNodeShape(selectedNode.id, shape)}
              onUpdateProps={(props) => onUpdateNodeProps(selectedNode.id, props)}
              allModels={allModels}
              onRegisterModel={onRegisterModel}
              onUpdateModelLabel={onUpdateModelLabel}
              onEditEffect={(effectId) => onEditEffect(selectedNode.id, effectId)}
              onEditContent={onEditContent ? () => onEditContent(selectedNode.id) : undefined}
            />
          ) : selectedConnection ? (
            <ConnectionSettings
              connection={selectedConnection}
              onUpdateType={(type) => onUpdateConnectionType(selectedConnection.from, selectedConnection.to, type)}
              onUpdateProps={(props) => onUpdateConnectionProps(selectedConnection.from, selectedConnection.to, props)}
            />
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

function MultiNodeSettings({ nodes, onUpdateProps, onUpdateShape }: {
  nodes: ModelNode[]
  onUpdateProps: (props: Partial<ModelNode>) => void
  onUpdateShape: (shape: NodeShape) => void
}) {
  const shapeOptions: NodeShape[] = ['rectangle', 'rounded-rect', 'oval', 'circle', 'diamond', 'hexagon', 'parallelogram', 'triangle']

  // Compute "mixed" state: if all nodes share the same value, show it; otherwise show placeholder
  const allSame = <K extends keyof ModelNode>(key: K): ModelNode[K] | undefined => {
    const first = nodes[0]?.[key]
    return nodes.every(n => n[key] === first) ? first : undefined
  }

  const sharedShape = allSame('shape') ?? (nodes.every(n => (n.shape ?? 'rounded-rect') === (nodes[0].shape ?? 'rounded-rect')) ? (nodes[0].shape ?? 'rounded-rect') : undefined)
  const sharedCellColor = allSame('cellColor') ?? (nodes.every(n => (n.cellColor ?? '#f4f8fd') === (nodes[0].cellColor ?? '#f4f8fd')) ? (nodes[0].cellColor ?? '#f4f8fd') : undefined)
  const sharedMembraneColor = allSame('membraneColor') ?? (nodes.every(n => (n.membraneColor ?? '#365f8f') === (nodes[0].membraneColor ?? '#365f8f')) ? (nodes[0].membraneColor ?? '#365f8f') : undefined)
  const sharedBorder = nodes.every(n => n.membraneVisible !== false) ? true : nodes.every(n => n.membraneVisible === false) ? false : undefined
  const sharedLocked = nodes.every(n => n.locked === true) ? true : nodes.every(n => n.locked !== true) ? false : undefined
  const sharedHideFlow = nodes.every(n => n.hideDuringFlow === true) ? true : nodes.every(n => n.hideDuringFlow !== true) ? false : undefined
  const sharedCameraTracked = nodes.every(n => n.cameraTracked === true) ? true : nodes.every(n => n.cameraTracked !== true) ? false : undefined

  return (
    <>
      <div className="sidebar-title">{nodes.length} Nodes Selected</div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Appearance</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-label">Label</label>
            <input
              id="multi-label"
              type="text"
              className="settings-text-input"
              placeholder="(mixed)"
              defaultValue=""
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value
                  if (v) onUpdateProps({ label: v })
                }
              }}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-shape">Shape</label>
            <select
              id="multi-shape"
              className="settings-select"
              value={sharedShape ?? ''}
              onChange={(e) => onUpdateShape(e.target.value as NodeShape)}
            >
              {!sharedShape && <option value="" disabled>(mixed)</option>}
              {shapeOptions.map((s) => (
                <option key={s} value={s}>{s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-cell-color">Cell Color</label>
            <ColorInput
              id="multi-cell-color"
              value={sharedCellColor ?? '#f4f8fd'}
              onChange={(v) => onUpdateProps({ cellColor: v })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-membrane-color">Membrane</label>
            <ColorInput
              id="multi-membrane-color"
              value={sharedMembraneColor ?? '#365f8f'}
              onChange={(v) => onUpdateProps({ membraneColor: v })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-border">Border</label>
            <input
              id="multi-border"
              type="checkbox"
              className="settings-checkbox"
              ref={(el) => { if (el) el.indeterminate = sharedBorder === undefined }}
              checked={sharedBorder === true}
              onChange={(e) => onUpdateProps({ membraneVisible: e.target.checked })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-locked">Lock</label>
            <input
              id="multi-locked"
              type="checkbox"
              className="settings-checkbox"
              ref={(el) => { if (el) el.indeterminate = sharedLocked === undefined }}
              checked={sharedLocked === true}
              onChange={(e) => onUpdateProps({ locked: e.target.checked })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-hide-flow">Hide in Flow</label>
            <input
              id="multi-hide-flow"
              type="checkbox"
              className="settings-checkbox"
              ref={(el) => { if (el) el.indeterminate = sharedHideFlow === undefined }}
              checked={sharedHideFlow === true}
              onChange={(e) => onUpdateProps({ hideDuringFlow: e.target.checked })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="multi-camera-tracked">Camera Tracked</label>
            <input
              id="multi-camera-tracked"
              type="checkbox"
              className="settings-checkbox"
              ref={(el) => { if (el) el.indeterminate = sharedCameraTracked === undefined }}
              checked={sharedCameraTracked === true}
              onChange={(e) => onUpdateProps({ cameraTracked: e.target.checked })}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function ConnectionSettings({ connection, onUpdateType, onUpdateProps }: {
  connection: ModelConnection
  onUpdateType: (type: ConnectionType) => void
  onUpdateProps: (props: Partial<ModelConnection>) => void
}) {
  return (
    <>
      <div className="sidebar-title">Connection Settings</div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Label</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <input
              type="text"
              className="settings-text-input"
              placeholder="Connection label (optional)"
              value={connection.label ?? ''}
              onChange={(e) => onUpdateProps({ label: e.target.value || undefined })}
            />
          </div>
          <div className="settings-row">
            <span className="settings-label">Font Size</span>
            <input
              type="number"
              className="settings-number-input"
              min={0.5}
              max={3}
              step={0.05}
              value={connection.labelFontSize ?? 0.85}
              onChange={(e) => onUpdateProps({ labelFontSize: parseFloat(e.target.value) || 0.85 })}
              style={{ width: '60px' }}
            />
            <span className="settings-value" style={{ marginLeft: 2 }}>rem</span>
          </div>
        </div>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Style</div>
        <div className="sidebar-section-body">
          <div className="settings-row">
            <label className="settings-label" htmlFor="conn-type">Line Type</label>
            <select
              id="conn-type"
              className="settings-select"
              value={connection.type ?? 'default'}
              onChange={(e) => onUpdateType(e.target.value as ConnectionType)}
            >
              <option value="default">Default</option>
              <option value="flow">Flow</option>
            </select>
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="conn-color">Color</label>
            <ColorInput
              id="conn-color"
              value={connection.strokeColor ?? (connection.type === 'flow' ? '#f59e0b' : '#256095')}
              onChange={(v) => onUpdateProps({ strokeColor: v })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="conn-width">Width</label>
            <input
              id="conn-width"
              type="number"
              className="settings-number-input"
              min={1}
              max={12}
              step={0.5}
              value={connection.strokeWidth ?? (connection.type === 'flow' ? 3 : 2)}
              onChange={(e) => onUpdateProps({ strokeWidth: Number(e.target.value) })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="conn-dash">Line Style</label>
            <select
              id="conn-dash"
              className="settings-select"
              value={connection.strokeDash ?? 'solid'}
              onChange={(e) => onUpdateProps({ strokeDash: e.target.value as ConnectionDashStyle })}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="dash-dot">Dash-Dot</option>
            </select>
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="conn-arrow">Arrow Head</label>
            <select
              id="conn-arrow"
              className="settings-select"
              value={connection.arrowStyle ?? 'standard'}
              onChange={(e) => onUpdateProps({ arrowStyle: e.target.value as ConnectionArrowStyle })}
            >
              <option value="standard">Standard</option>
              <option value="triangle">Triangle (filled)</option>
              <option value="diamond">Diamond</option>
              <option value="circle">Circle</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="conn-hide-flow">Hide in Flow</label>
            <input
              id="conn-hide-flow"
              type="checkbox"
              className="settings-checkbox"
              checked={connection.hideDuringFlow === true}
              onChange={(e) => onUpdateProps({ hideDuringFlow: e.target.checked })}
            />
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
