import { useState, useRef, useEffect } from 'react'
import type { Model, ModelNode, ModelConnection, NodeShape, MediaNodeType, ConnectionType, ConnectionArrowStyle, ConnectionDashStyle, FlowEffect, ThemeMode, GridStyle, TextFormatRange } from './sampleModels'
import { useHybridZoomStore } from './useHybridZoomStore'
import { applyFormatToRange } from './sampleModels'
import { GRADIENT_PRESETS, PATTERN_PRESETS } from './backgrounds'
import { PARTICLE_PRESETS } from './particles'
import { ALL_THEME_OPTIONS } from './themes'

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

function DiagramSettings({ model, gridSnap, onSetGridSnap }: {
  model: Model | undefined
  gridSnap: number
  onSetGridSnap: (size: number) => void
}) {
  const appThemeMode = useHybridZoomStore((s) => s.appThemeMode)
  const setAppThemeMode = useHybridZoomStore((s) => s.setAppThemeMode)
  const modelCosmetics = useHybridZoomStore((s) => model ? s.modelCosmetics[model.id] : undefined)
  const setModelCosmetics = useHybridZoomStore((s) => s.setModelCosmetics)
  const bgImageInputRef = useRef<HTMLInputElement>(null)

  const effectiveBg = modelCosmetics?.background
  const effectiveParticle = modelCosmetics?.particleEffect ?? null

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

      {/* Appearance section */}
      <div className="sidebar-section">
        <div className="sidebar-section-header static">Appearance</div>
        <div className="sidebar-section-body">
          {/* Theme mode */}
          <div className="settings-row">
            <label className="settings-label" htmlFor="theme-mode">Theme</label>
            <select
              id="theme-mode"
              className="settings-select"
              value={appThemeMode}
              onChange={(e) => setAppThemeMode(e.target.value as ThemeMode)}
            >
              <optgroup label="Base">
                {ALL_THEME_OPTIONS.filter((o) => o.group === 'base').map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </optgroup>
              <optgroup label="Topical">
                {ALL_THEME_OPTIONS.filter((o) => o.group === 'topical').map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Background */}
          {model && (
            <>
              <div className="settings-row">
                <label className="settings-label" htmlFor="bg-type">Background</label>
                <select
                  id="bg-type"
                  className="settings-select"
                  value={effectiveBg?.type ?? 'none'}
                  onChange={(e) => {
                    const t = e.target.value
                    if (t === 'none') {
                      setModelCosmetics(model.id, { background: undefined })
                    } else if (t === 'gradient') {
                      setModelCosmetics(model.id, { background: { type: 'gradient', value: GRADIENT_PRESETS[0].value } })
                    } else if (t === 'solid') {
                      setModelCosmetics(model.id, { background: { type: 'solid', value: '#ffffff' } })
                    } else if (t === 'pattern') {
                      setModelCosmetics(model.id, { background: { type: 'pattern', value: PATTERN_PRESETS[0].value } })
                    } else if (t === 'image') {
                      bgImageInputRef.current?.click()
                    }
                  }}
                >
                  <option value="none">Default</option>
                  <option value="gradient">Gradient</option>
                  <option value="solid">Solid Color</option>
                  <option value="pattern">Pattern</option>
                  <option value="image">Image</option>
                </select>
              </div>

              {/* Gradient preset picker */}
              {effectiveBg?.type === 'gradient' && (
                <div className="settings-row">
                  <span className="settings-label">Preset</span>
                  <div className="settings-preset-grid">
                    {GRADIENT_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`settings-preset-swatch${effectiveBg.value === p.value ? ' active' : ''}`}
                        style={{ background: p.value }}
                        title={p.name}
                        onClick={() => setModelCosmetics(model.id, { background: { type: 'gradient', value: p.value } })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Solid color */}
              {effectiveBg?.type === 'solid' && (
                <div className="settings-row">
                  <label className="settings-label" htmlFor="bg-solid-color">Color</label>
                  <ColorInput
                    id="bg-solid-color"
                    value={effectiveBg.value || '#ffffff'}
                    onChange={(v) => setModelCosmetics(model.id, { background: { type: 'solid', value: v } })}
                  />
                </div>
              )}

              {/* Pattern preset picker */}
              {effectiveBg?.type === 'pattern' && (
                <div className="settings-row">
                  <span className="settings-label">Pattern</span>
                  <select
                    className="settings-select"
                    value={PATTERN_PRESETS.find(p => p.value === effectiveBg.value)?.id ?? PATTERN_PRESETS[0].id}
                    onChange={(e) => {
                      const preset = PATTERN_PRESETS.find(p => p.id === e.target.value)
                      if (preset) setModelCosmetics(model.id, { background: { type: 'pattern', value: preset.value } })
                    }}
                  >
                    {PATTERN_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Image upload (hidden input) */}
              <input
                ref={bgImageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    setModelCosmetics(model.id, { background: { type: 'image', value: reader.result as string } })
                  }
                  reader.readAsDataURL(file)
                  e.target.value = ''
                }}
              />

              {/* Image controls when image bg is selected */}
              {effectiveBg?.type === 'image' && (
                <>
                  <div className="settings-row">
                    <span className="settings-label">Image</span>
                    <button type="button" className="settings-add-btn" onClick={() => bgImageInputRef.current?.click()}>
                      Change
                    </button>
                  </div>
                  <div className="settings-row">
                    <label className="settings-label" htmlFor="bg-opacity">Opacity</label>
                    <input
                      id="bg-opacity"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      className="settings-range"
                      value={effectiveBg.opacity ?? 1}
                      onChange={(e) => setModelCosmetics(model.id, { background: { ...effectiveBg, opacity: Number(e.target.value) } })}
                    />
                  </div>
                  <div className="settings-row">
                    <label className="settings-label" htmlFor="bg-blur">Blur</label>
                    <input
                      id="bg-blur"
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      className="settings-range"
                      value={effectiveBg.blur ?? 0}
                      onChange={(e) => setModelCosmetics(model.id, { background: { ...effectiveBg, blur: Number(e.target.value) } })}
                    />
                  </div>
                  <div className="settings-row">
                    <label className="settings-label" htmlFor="bg-fit">Fit</label>
                    <select
                      id="bg-fit"
                      className="settings-select"
                      value={effectiveBg.fit ?? 'cover'}
                      onChange={(e) => setModelCosmetics(model.id, { background: { ...effectiveBg, fit: e.target.value as 'cover' | 'contain' | 'tile' } })}
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                      <option value="tile">Tile</option>
                    </select>
                  </div>
                </>
              )}

              {/* Particle effect */}
              <div className="settings-row">
                <label className="settings-label" htmlFor="particle-effect">Particles</label>
                <select
                  id="particle-effect"
                  className="settings-select"
                  value={effectiveParticle ?? 'none'}
                  onChange={(e) => {
                    const val = e.target.value === 'none' ? null : e.target.value
                    setModelCosmetics(model.id, { particleEffect: val })
                  }}
                >
                  <option value="none">None</option>
                  {PARTICLE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Grid section */}
      {model && (
        <div className="sidebar-section">
          <div className="sidebar-section-header static">Grid</div>
          <div className="sidebar-section-body">
            <div className="settings-row">
              <label className="settings-label" htmlFor="grid-style">Style</label>
              <select
                id="grid-style"
                className="settings-select"
                value={modelCosmetics?.grid?.style ?? 'dots'}
                onChange={(e) => setModelCosmetics(model.id, { grid: { ...modelCosmetics?.grid, style: e.target.value as GridStyle } })}
              >
                <option value="dots">Dots</option>
                <option value="lines">Lines</option>
                <option value="dotted-lines">Dotted Lines</option>
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label" htmlFor="grid-color">Color</label>
              <ColorInput
                id="grid-color"
                value={modelCosmetics?.grid?.color || 'rgba(37,96,149,0.18)'}
                onChange={(v) => setModelCosmetics(model.id, { grid: { ...modelCosmetics?.grid, color: v } })}
              />
            </div>
            <div className="settings-row">
              <label className="settings-label" htmlFor="grid-size">Size</label>
              <input
                id="grid-size"
                type="range"
                min={0.5}
                max={4}
                step={0.5}
                className="settings-range"
                value={modelCosmetics?.grid?.size ?? 1}
                onChange={(e) => setModelCosmetics(model.id, { grid: { ...modelCosmetics?.grid, size: Number(e.target.value) } })}
              />
            </div>
          </div>
        </div>
      )}
    </>
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

function TextFormatSection({ node, onUpdateProps }: {
  node: ModelNode
  onUpdateProps: (props: Partial<ModelNode>) => void
}) {
  const labelSelection = useHybridZoomStore((s) => s.labelSelection)
  const hasSel = labelSelection != null && labelSelection.start < labelSelection.end

  const applyFormat = (fmt: Omit<TextFormatRange, 'start' | 'end'>) => {
    if (!hasSel) return
    const updated = applyFormatToRange(
      node.textFormats ?? [],
      labelSelection!.start,
      labelSelection!.end,
      fmt,
    )
    onUpdateProps({ textFormats: updated.length ? updated : undefined })
  }

  // Check if current selection has a particular format
  const selHas = (prop: 'bold' | 'italic' | 'strikethrough'): boolean => {
    if (!hasSel) return false
    const ranges = node.textFormats ?? []
    for (let i = labelSelection!.start; i < labelSelection!.end; i++) {
      const hit = ranges.find(r => r.start <= i && i < r.end && r[prop])
      if (!hit) return false
    }
    return true
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header static">Text Format</div>
      <div className="sidebar-section-body">
        <div className="text-format-toolbar">
          <button
            type="button"
            className={`text-format-btn${selHas('bold') ? ' active' : ''}`}
            disabled={!hasSel}
            title="Bold"
            onClick={() => applyFormat({ bold: !selHas('bold') })}
          ><b>B</b></button>
          <button
            type="button"
            className={`text-format-btn${selHas('italic') ? ' active' : ''}`}
            disabled={!hasSel}
            title="Italic"
            onClick={() => applyFormat({ italic: !selHas('italic') })}
          ><i>I</i></button>
          <button
            type="button"
            className={`text-format-btn${selHas('strikethrough') ? ' active' : ''}`}
            disabled={!hasSel}
            title="Strikethrough"
            onClick={() => applyFormat({ strikethrough: !selHas('strikethrough') })}
          ><s>S</s></button>
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="fmt-color">Color</label>
          <ColorInput
            id="fmt-color"
            value={(() => {
              if (!hasSel) return '#000000'
              const ranges = node.textFormats ?? []
              const hit = ranges.find(r => r.start <= labelSelection!.start && labelSelection!.start < r.end && r.color)
              return hit?.color ?? '#000000'
            })()}
            onChange={(v) => applyFormat({ color: v })}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="fmt-fontsize">Font Size</label>
          <input
            id="fmt-fontsize"
            type="number"
            className="settings-number-input"
            min={8}
            max={72}
            step={1}
            disabled={!hasSel}
            value={(() => {
              if (!hasSel) return ''
              const ranges = node.textFormats ?? []
              const hit = ranges.find(r => r.start <= labelSelection!.start && labelSelection!.start < r.end && r.fontSize != null)
              return hit?.fontSize ?? ''
            })()}
            placeholder="default"
            onChange={(e) => {
              const v = e.target.value
              applyFormat({ fontSize: v ? Number(v) : undefined })
            }}
          />
        </div>
        {!hasSel && (
          <div className="settings-hint">Select text in a node label to format it.</div>
        )}
      </div>
    </div>
  )
}

function NodeSettings({ node, onUpdateShape, onUpdateProps, allModels, onRegisterModel, onUpdateModelLabel, onEditEffect, onEditContent }: {
  node: ModelNode
  onUpdateShape: (shape: NodeShape) => void
  onUpdateProps: (props: Partial<ModelNode>) => void
  allModels: Record<string, Model>
  onRegisterModel: (model: Model) => void
  onUpdateModelLabel: (modelId: string, label: string) => void
  onEditEffect: (effectId: string) => void
  onEditContent?: () => void
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
          <div className="settings-row">
            <label className="settings-label" htmlFor="node-hide-flow">Hide in Flow</label>
            <input
              id="node-hide-flow"
              type="checkbox"
              className="settings-checkbox"
              checked={node.hideDuringFlow === true}
              onChange={(e) => onUpdateProps({ hideDuringFlow: e.target.checked })}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="node-width">Width</label>
            <input
              id="node-width"
              type="number"
              className="settings-number-input"
              min={40}
              step={1}
              value={node.nodeWidth ?? ''}
              placeholder="auto"
              onChange={(e) => {
                const v = e.target.value
                onUpdateProps({ nodeWidth: v ? Number(v) : undefined })
              }}
            />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="node-height">Height</label>
            <input
              id="node-height"
              type="number"
              className="settings-number-input"
              min={30}
              step={1}
              value={node.nodeHeight ?? ''}
              placeholder="auto"
              onChange={(e) => {
                const v = e.target.value
                onUpdateProps({ nodeHeight: v ? Number(v) : undefined })
              }}
            />
          </div>
          {(node.nodeWidth != null || node.nodeHeight != null) && (
            <div className="settings-row">
              <button
                type="button"
                className="settings-reset-btn"
                onClick={() => onUpdateProps({ nodeWidth: undefined, nodeHeight: undefined })}
              >
                Reset to auto size
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Text Format section — visible when editing */}
      <TextFormatSection node={node} onUpdateProps={onUpdateProps} />
      {/* Media section — only for media node types */}
      {node.mediaType && node.mediaType !== 'markdown' && node.mediaType !== 'math' && (
        <MediaSettings node={node} onUpdateProps={onUpdateProps} />
      )}
      {/* Content section — for markdown / math nodes */}
      {(node.mediaType === 'markdown' || node.mediaType === 'math') && (
        <div className="sidebar-section">
          <div className="sidebar-section-header static">Content</div>
          <div className="sidebar-section-body">
            <div className="settings-row">
              <span className="settings-label">Type</span>
              <span className="settings-value">{node.mediaType === 'markdown' ? 'Markdown' : 'Math'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Collapsed</span>
              <input
                type="checkbox"
                className="settings-checkbox"
                checked={node.contentCollapsed !== false}
                onChange={(e) => {
                  const nowCollapsed = e.target.checked
                  const expandedH = Math.max(node.nodeHeight ?? 60, 160)
                  onUpdateProps({
                    contentCollapsed: nowCollapsed,
                    nodeHeight: nowCollapsed ? 60 : expandedH,
                  })
                }}
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
                value={node.contentFontSize ?? 0.85}
                onChange={(e) => onUpdateProps({ contentFontSize: parseFloat(e.target.value) || 0.85 })}
                style={{ width: '60px' }}
              />
              <span className="settings-value" style={{ marginLeft: 2 }}>rem</span>
            </div>
            {onEditContent && (
              <div className="settings-row">
                <button type="button" className="settings-add-btn" onClick={onEditContent} style={{ width: '100%' }}>
                  Edit Content
                </button>
              </div>
            )}
          </div>
        </div>
      )}
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
      <FlowAnimationsSection node={node} onUpdateProps={onUpdateProps} onEditEffect={onEditEffect} />
    </>
  )
}

function MediaSettings({ node, onUpdateProps }: {
  node: ModelNode
  onUpdateProps: (props: Partial<ModelNode>) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const isPlayable = node.mediaType === 'gif' || node.mediaType === 'audio' || node.mediaType === 'video'

  const acceptMap: Record<MediaNodeType, string> = {
    image: 'image/png,image/jpeg,image/webp,image/svg+xml',
    gif: 'image/gif',
    audio: 'audio/*',
    video: 'video/*',
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      onUpdateProps({
        mediaSrc: reader.result as string,
        mediaFileName: file.name,
      })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      onUpdateProps({ audioCoverSrc: reader.result as string })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header static">Media</div>
      <div className="sidebar-section-body">
        <div className="settings-row">
          <span className="settings-label">Type</span>
          <span className="settings-value">{node.mediaType}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">File</span>
          <div className="settings-media-file">
            {node.mediaFileName ? (
              <>
                <span className="settings-media-filename" title={node.mediaFileName}>{node.mediaFileName}</span>
                <button
                  type="button"
                  className="settings-remove-btn"
                  onClick={() => onUpdateProps({ mediaSrc: undefined, mediaFileName: undefined })}
                  title="Remove media"
                >×</button>
              </>
            ) : (
              <button type="button" className="settings-add-btn" onClick={() => fileInputRef.current?.click()}>
                + Select file
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptMap[node.mediaType!]}
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
          </div>
        </div>

        {node.mediaType === 'audio' && (
          <div className="settings-row">
            <span className="settings-label">Cover</span>
            <div className="settings-media-file">
              {node.audioCoverSrc ? (
                <>
                  <span className="settings-media-filename">cover image</span>
                  <button
                    type="button"
                    className="settings-remove-btn"
                    onClick={() => onUpdateProps({ audioCoverSrc: undefined })}
                    title="Remove cover"
                  >×</button>
                </>
              ) : (
                <button type="button" className="settings-add-btn" onClick={() => coverInputRef.current?.click()}>
                  + Select cover
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleCoverSelect}
              />
            </div>
          </div>
        )}

        {isPlayable && (
          <>
            <div className="settings-row">
              <label className="settings-label" htmlFor="play-start">Start (s)</label>
              <input
                id="play-start"
                type="number"
                className="settings-number-input"
                min={0}
                step={0.1}
                value={node.playStart ?? ''}
                placeholder="0"
                onChange={(e) => {
                  const v = e.target.value
                  onUpdateProps({ playStart: v ? Number(v) : undefined })
                }}
              />
            </div>
            <div className="settings-row">
              <label className="settings-label" htmlFor="play-end">End (s)</label>
              <input
                id="play-end"
                type="number"
                className="settings-number-input"
                min={0}
                step={0.1}
                value={node.playEnd ?? ''}
                placeholder="end"
                onChange={(e) => {
                  const v = e.target.value
                  onUpdateProps({ playEnd: v ? Number(v) : undefined })
                }}
              />
            </div>
          </>
        )}

        {node.mediaType === 'video' && (
          <YouTubeUrlField onUpdateProps={onUpdateProps} />
        )}
      </div>
    </div>
  )
}

function YouTubeUrlField({ onUpdateProps }: { onUpdateProps: (props: Partial<ModelNode>) => void }) {
  const [ytUrl, setYtUrl] = useState('')
  const [ytStatus, setYtStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ytError, setYtError] = useState('')

  const handleDownload = async () => {
    const url = ytUrl.trim()
    if (!url) return
    setYtStatus('loading')
    setYtError('')
    try {
      const resp = await fetch('http://localhost:3001/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }
      const blob = await resp.blob()
      const reader = new FileReader()
      reader.onload = () => {
        onUpdateProps({
          mediaSrc: reader.result as string,
          mediaFileName: 'youtube-video.mp4',
        })
        setYtStatus('idle')
        setYtUrl('')
      }
      reader.onerror = () => {
        setYtStatus('error')
        setYtError('Failed to read downloaded video')
      }
      reader.readAsDataURL(blob)
    } catch (err) {
      setYtStatus('error')
      setYtError(err instanceof Error ? err.message : 'Download failed')
    }
  }

  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <span className="settings-label">YouTube URL</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="text"
          className="settings-number-input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="https://youtube.com/watch?v=..."
          value={ytUrl}
          onChange={(e) => setYtUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDownload() }}
          disabled={ytStatus === 'loading'}
        />
        <button
          type="button"
          className="settings-add-btn"
          onClick={handleDownload}
          disabled={ytStatus === 'loading' || !ytUrl.trim()}
          style={{ whiteSpace: 'nowrap' }}
        >
          {ytStatus === 'loading' ? 'Downloading\u2026' : '\u2b07 Download'}
        </button>
      </div>
      {ytStatus === 'error' && (
        <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>{ytError}</span>
      )}
    </div>
  )
}

const effectKindLabels: Record<string, string> = {
  'wait': 'Wait',
  'move': 'Move',
  'color': 'Color',
  'spawn': 'Spawn',
  'play-media': 'Play media',
  'camera': 'Camera',
  'break': 'Break Apart',
}

function FlowAnimationsSection({ node, onUpdateProps, onEditEffect }: {
  node: ModelNode
  onUpdateProps: (props: Partial<ModelNode>) => void
  onEditEffect: (effectId: string) => void
}) {
  const effects = node.flowEffects ?? []
  const hasLockedMedia = !!node.mediaType

  const addEffect = () => {
    const effect: FlowEffect = {
      id: `fx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: `Effect ${effects.length + 1}`,
      graph: {
        nodes: [{ id: '__entry__', kind: 'entry' as const, label: 'Signal In', x: 60, y: 120, config: {} }],
        edges: [],
      },
    }
    onUpdateProps({ flowEffects: [...effects, effect] })
  }

  const removeEffect = (id: string) => {
    onUpdateProps({ flowEffects: effects.filter(e => e.id !== id) })
  }

  // Build display list: if media node, prepend a locked play-media entry
  const displayEffects: (FlowEffect & { _locked?: boolean })[] = []
  if (hasLockedMedia) {
    // Find existing locked effect or create a virtual one
    const existingLocked = effects.find(e => e.locked)
    displayEffects.push(existingLocked ?? {
      id: '__locked-media__',
      label: `Play ${node.mediaType}`,
      locked: true,
      graph: {
        nodes: [
          { id: '__entry__', kind: 'entry' as const, label: 'Signal In', x: 60, y: 120, config: {} },
          { id: 'play-media-root', kind: 'play-media' as const, label: `Play ${node.mediaType}`, x: 300, y: 120, config: {} },
        ],
        edges: [{ from: '__entry__', to: 'play-media-root' }],
      },
      _locked: true,
    })
  }
  for (const e of effects) {
    if (!e.locked) displayEffects.push(e)
  }

  // Summarize graph contents for display
  const summarize = (effect: FlowEffect) => {
    const effectNodes = effect.graph.nodes.filter(n => n.kind !== 'entry')
    if (effectNodes.length === 0) return 'Empty'
    return effectNodes.map(n => effectKindLabels[n.kind] ?? n.kind).join(', ')
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header static">Flow Animations</div>
      <div className="sidebar-section-body">
        {displayEffects.length === 0 && (
          <div className="settings-row">
            <span className="settings-value" style={{ opacity: 0.5, fontSize: '0.8rem' }}>No effects</span>
          </div>
        )}
        {displayEffects.map((effect) => (
          <div className="settings-row flow-effect-row" key={effect.id}>
            <div className="flow-effect-info">
              <span className={`flow-effect-label${effect.locked || (effect as { _locked?: boolean })._locked ? ' locked' : ''}`}>
                {effect.label}
              </span>
              <span className="flow-effect-summary">{summarize(effect)}</span>
            </div>
            <span className="flow-effect-actions">
              <button
                type="button"
                className="flow-effect-btn"
                title="Edit effect graph"
                onClick={() => onEditEffect(effect.id)}
              >✎</button>
              {!effect.locked && !(effect as { _locked?: boolean })._locked && (
                <button
                  type="button"
                  className="settings-remove-btn"
                  title="Remove effect"
                  onClick={() => removeEffect(effect.id)}
                >×</button>
              )}
            </span>
          </div>
        ))}
        <div className="settings-row">
          <span className="settings-label" />
          <button type="button" className="settings-add-btn" onClick={addEffect}>+ Add Effect</button>
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="node-camera-tracked">Camera Tracked</label>
          <input
            id="node-camera-tracked"
            type="checkbox"
            className="settings-checkbox"
            checked={node.cameraTracked === true}
            onChange={(e) => onUpdateProps({ cameraTracked: e.target.checked })}
          />
        </div>
      </div>
    </div>
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
