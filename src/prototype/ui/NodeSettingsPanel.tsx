import { useState, useRef } from 'react'
import type { Model, ModelNode, NodeShape, MediaNodeType, CosmeticType, FlowEffect, TextFormatRange } from '../model/sampleModels'
import { applyFormatToRange } from '../model/sampleModels'
import { useHybridZoomStore } from '../model/useHybridZoomStore'
import { ColorInput } from './DiagramSettings'
import { storeMediaBlob } from '../model/mediaStore'

let _nextId = 1
function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${_nextId++}`
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

export function NodeSettings({ node, onUpdateShape, onUpdateProps, allModels, onRegisterModel, onUpdateModelLabel, onEditEffect, onEditContent }: {
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
              disabled={!!node.cosmeticType}
            >
              {shapeOptions.map((s) => (
                <option key={s} value={s}>{s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          {node.cosmeticType && (
            <>
              <div className="settings-row">
                <label className="settings-label" htmlFor="cosmetic-type">Cosmetic</label>
                <select
                  id="cosmetic-type"
                  className="settings-select"
                  value={node.cosmeticType}
                  onChange={(e) => onUpdateProps({ cosmeticType: e.target.value as CosmeticType })}
                >
                  <option value="chat-bubble">Chat Bubble</option>
                  <option value="thinking-cloud">Thinking Cloud</option>
                </select>
              </div>
              <div className="settings-row">
                <label className="settings-label" htmlFor="tip-angle">Tip Angle</label>
                <input
                  id="tip-angle"
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={Math.round((node.tipAngle ?? Math.PI * 0.75) * 180 / Math.PI)}
                  onChange={(e) => onUpdateProps({ tipAngle: parseFloat(e.target.value) * Math.PI / 180 })}
                  className="settings-range"
                />
              </div>
            </>
          )}
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
    const blobUrl = storeMediaBlob(file)
    onUpdateProps({ mediaSrc: blobUrl, mediaFileName: file.name })
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
      const resp = await fetch('/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }
      const blob = await resp.blob()
      const blobUrl = storeMediaBlob(blob)
      onUpdateProps({ mediaSrc: blobUrl, mediaFileName: 'youtube-video.mp4' })
      setYtStatus('idle')
      setYtUrl('')
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
  'cloud-levitate': 'Cloudy Levitate',
  'bubble-levitate': 'Soap Bubble Levitate',
}

function FlowAnimationsSection({ node, onUpdateProps, onEditEffect }: {
  node: ModelNode
  onUpdateProps: (props: Partial<ModelNode>) => void
  onEditEffect: (effectId: string) => void
}) {
  const effects = node.flowEffects ?? []
  const hasLockedMedia = !!node.mediaType
  const hasLockedCosmetic = !!node.cosmeticType

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
  if (hasLockedCosmetic) {
    const cosmeticKind = node.cosmeticType === 'thinking-cloud' ? 'cloud-levitate' as const : 'bubble-levitate' as const
    const cosmeticLabel = node.cosmeticType === 'thinking-cloud' ? 'Cloudy Levitate' : 'Soap Bubble Levitate'
    const existingLockedCosmetic = effects.find(e => e.locked && e.graph.nodes.some(n => n.kind === cosmeticKind))
    displayEffects.push(existingLockedCosmetic ?? {
      id: '__locked-cosmetic__',
      label: cosmeticLabel,
      locked: true,
      alwaysPlay: true,
      graph: {
        nodes: [
          { id: '__entry__', kind: 'entry' as const, label: 'Signal In', x: 60, y: 120, config: {} },
          { id: 'cosmetic-root', kind: cosmeticKind, label: cosmeticLabel, x: 300, y: 120, config: {} },
        ],
        edges: [{ from: '__entry__', to: 'cosmetic-root' }],
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
              {effect.graph.nodes.some(n => n.kind === 'cloud-levitate' || n.kind === 'bubble-levitate') && (
                <label className="flow-effect-always-play">
                  <input
                    type="checkbox"
                    checked={effect.alwaysPlay !== false}
                    onChange={(e) => {
                      const alwaysVal = e.target.checked
                      const existing = effects.find(ex => ex.id === effect.id)
                      if (existing) {
                        onUpdateProps({
                          flowEffects: effects.map(ex => ex.id === effect.id ? { ...ex, alwaysPlay: alwaysVal } : ex),
                        })
                      } else {
                        // Materialise virtual locked cosmetic effect
                        onUpdateProps({
                          flowEffects: [...effects, { ...effect, id: `fx-cosmetic-${Date.now()}`, alwaysPlay: alwaysVal }],
                        })
                      }
                    }}
                  />
                  Always play
                </label>
              )}
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
