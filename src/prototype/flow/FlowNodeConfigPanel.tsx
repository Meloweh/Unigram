import { useState, useCallback, useRef } from 'react'
import type { EffectGraphNode, FlowEffectKind } from '../model/sampleModels'
import type { EffectEditorHostContext, MoveWaypoint, SpawnItem, SpawnCircularItem } from './FlowEffectEditor'
import { TextGeneratorConfigPanel } from './TextGeneratorConfigPanel'
import { storeMediaBlob, getMediaBlob } from '../model/mediaStore'

/** Inline audio clip config with record/play capability */
function AudioClipConfig({ selectedNode, updateNodeConfig, hostNodeId }: {
  selectedNode: EffectGraphNode
  updateNodeConfig: (key: string, value: unknown) => void
  hostNodeId: string
}) {
  const clipKey = (selectedNode.config.clipKey as string) || ''
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [clipDuration, setClipDuration] = useState<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const playAudioRef = useRef<HTMLAudioElement | null>(null)

  const effectiveClipKey = clipKey || `${hostNodeId}:${selectedNode.id}`

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      // Processing chain: highpass → lowpass → compressor → limiter → dest
      const hp1 = audioCtx.createBiquadFilter(); hp1.type = 'highpass'; hp1.frequency.value = 100
      const hp2 = audioCtx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 100
      const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 15000
      const comp = audioCtx.createDynamicsCompressor()
      comp.threshold.value = -24; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15
      const limiter = audioCtx.createDynamicsCompressor()
      limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.05
      const gain = audioCtx.createGain(); gain.gain.value = 1.4
      const dest = audioCtx.createMediaStreamDestination()
      source.connect(hp1).connect(hp2).connect(lp).connect(comp).connect(limiter).connect(gain).connect(dest)

      const recorder = new MediaRecorder(dest.stream)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        audioCtx.close()
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const blobUrl = storeMediaBlob(blob)
        updateNodeConfig('clipKey', effectiveClipKey)
        updateNodeConfig('clipBlobUrl', blobUrl)
        // Compute duration
        const tempAudio = new Audio(blobUrl)
        tempAudio.addEventListener('loadedmetadata', () => {
          setClipDuration(tempAudio.duration)
        })
        setIsRecording(false)
      }
      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      // mic permission denied
    }
  }, [effectiveClipKey, updateNodeConfig])

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state !== 'inactive') {
      recorderRef.current?.stop()
    }
  }, [])

  const playClip = useCallback(() => {
    const blobUrl = selectedNode.config.clipBlobUrl as string | undefined
    if (!blobUrl) return
    if (playAudioRef.current) { playAudioRef.current.pause(); playAudioRef.current = null }
    const audio = new Audio(blobUrl)
    playAudioRef.current = audio
    audio.onended = () => setIsPlaying(false)
    audio.play().catch(() => {})
    setIsPlaying(true)
  }, [selectedNode.config.clipBlobUrl])

  const stopClip = useCallback(() => {
    if (playAudioRef.current) { playAudioRef.current.pause(); playAudioRef.current = null }
    setIsPlaying(false)
  }, [])

  const hasBlobUrl = !!(selectedNode.config.clipBlobUrl as string)

  return (
    <>
      <div className="fxeditor-field-hint">Record an audio sample for this clip node.</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {!isRecording ? (
          <button type="button" className="fxeditor-add-node-btn" style={{ flex: 1 }} onClick={startRecording}>
            ⏺ Record
          </button>
        ) : (
          <button type="button" className="fxeditor-add-node-btn" style={{ flex: 1, color: '#ef4444' }} onClick={stopRecording}>
            ⏹ Stop
          </button>
        )}
        {hasBlobUrl && !isRecording && (
          !isPlaying ? (
            <button type="button" className="fxeditor-add-node-btn" style={{ flex: 1 }} onClick={playClip}>
              ▶ Play
            </button>
          ) : (
            <button type="button" className="fxeditor-add-node-btn" style={{ flex: 1 }} onClick={stopClip}>
              ⏹ Stop
            </button>
          )
        )}
      </div>
      {clipDuration != null && (
        <div className="fxeditor-field-hint">Duration: {clipDuration.toFixed(1)}s</div>
      )}
    </>
  )
}

export function FlowNodeConfigPanel({
  selectedNode,
  updateNodeConfig,
  setNodes,
  selectedNodeId,
  isNodeLocked,
  deleteSelected,
  addableKinds,
  addNode,
  hostContext,
  hostNodeId,
  kindLabels,
  kindColors,
  onSyncPreviewFacades,
}: {
  selectedNode: EffectGraphNode | undefined
  updateNodeConfig: (key: string, value: unknown) => void
  setNodes: React.Dispatch<React.SetStateAction<EffectGraphNode[]>>
  selectedNodeId: string | null
  isNodeLocked: (node: EffectGraphNode) => boolean
  deleteSelected: () => void
  addableKinds: FlowEffectKind[]
  addNode: (kind: FlowEffectKind) => void
  hostContext: EffectEditorHostContext
  hostNodeId: string
  kindLabels: Record<FlowEffectKind, string>
  kindColors: Record<FlowEffectKind, string>
  onSyncPreviewFacades?: (graphNodeId: string, items: SpawnItem[]) => void
}) {
  if (selectedNode) {
    return (
      <>
        <div className="fxeditor-props-title">
          <span className="fxeditor-props-dot" style={{ background: kindColors[selectedNode.kind] }} />
          {kindLabels[selectedNode.kind]}
        </div>
        <label className="fxeditor-field">
          <span>Label</span>
          <input
            type="text"
            value={selectedNode.label}
            onChange={(e) => setNodes(prev => prev.map(n =>
              n.id === selectedNodeId ? { ...n, label: e.target.value } : n
            ))}
          />
        </label>
        {selectedNode.kind === 'entry' && (
          <>
            <div className="fxeditor-field-hint">
              Flow signal arrives here. Connect to effect nodes below.
            </div>
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={!!selectedNode.config.triggeredByRmmParent}
                onChange={(e) => updateNodeConfig('triggeredByRmmParent', e.target.checked)}
              />
              <span>Triggered by RMM Parent</span>
            </label>
          </>
        )}
        {selectedNode.kind === 'wait' && (
          <label className="fxeditor-field">
            <span>Duration (ms)</span>
            <input type="number" min={0} step={50}
              value={(selectedNode.config.durationMs as number) ?? 500}
              onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
          </label>
        )}
        {selectedNode.kind === 'move' && (() => {
          const waypoints: MoveWaypoint[] = (selectedNode.config.waypoints as MoveWaypoint[] | undefined) ?? []
          const updateWaypoints = (items: MoveWaypoint[]) => updateNodeConfig('waypoints', items)
          return (
            <div className="fxeditor-spawn-section">
              <div className="fxeditor-field-hint">
                Define waypoints the node will move through sequentially.
              </div>
              {waypoints.map((wp, idx) => (
                <div key={idx} className="fxeditor-spawn-item">
                  <div className="fxeditor-spawn-item-header">
                    <span className="fxeditor-spawn-item-num">#{idx + 1}</span>
                    {waypoints.length > 1 && (
                      <button type="button" className="fxeditor-spawn-remove"
                        onClick={() => updateWaypoints(waypoints.filter((_, i) => i !== idx))}>×</button>
                    )}
                  </div>
                  <label className="fxeditor-field">
                    <span>ΔX (%)</span>
                    <input type="number" step={1} value={wp.dx}
                      onChange={(e) => {
                        const next = [...waypoints]
                        next[idx] = { ...wp, dx: Number(e.target.value) }
                        updateWaypoints(next)
                      }} />
                  </label>
                  <label className="fxeditor-field">
                    <span>ΔY (%)</span>
                    <input type="number" step={1} value={wp.dy}
                      onChange={(e) => {
                        const next = [...waypoints]
                        next[idx] = { ...wp, dy: Number(e.target.value) }
                        updateWaypoints(next)
                      }} />
                  </label>
                  <label className="fxeditor-field">
                    <span>Duration (ms)</span>
                    <input type="number" min={0} step={50} value={wp.durationMs}
                      onChange={(e) => {
                        const next = [...waypoints]
                        next[idx] = { ...wp, durationMs: Number(e.target.value) }
                        updateWaypoints(next)
                      }} />
                  </label>
                </div>
              ))}
              <button type="button" className="fxeditor-spawn-add"
                onClick={() => updateWaypoints([...waypoints, { dx: 0, dy: 0, durationMs: 500 }])}>
                + Add waypoint
              </button>
              <label className="fxeditor-checkbox" style={{ marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={!!selectedNode.config.roundtrip}
                  onChange={(e) => updateNodeConfig('roundtrip', e.target.checked)}
                />
                <span>Roundtrip (return to start)</span>
              </label>
              <label className="fxeditor-checkbox">
                <input
                  type="checkbox"
                  checked={!!selectedNode.config.keepPlaying}
                  onChange={(e) => updateNodeConfig('keepPlaying', e.target.checked)}
                />
                <span>Keep playing until flow ends</span>
              </label>
            </div>
          )
        })()}
        {selectedNode.kind === 'color' && (
          <>
            <label className="fxeditor-field">
              <span>Color</span>
              <input type="color"
                value={(selectedNode.config.color as string) ?? '#f59e0b'}
                onChange={(e) => updateNodeConfig('color', e.target.value)} />
            </label>
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={!!selectedNode.config.keepPlaying}
                onChange={(e) => updateNodeConfig('keepPlaying', e.target.checked)}
              />
              <span>Keep playing until flow ends</span>
            </label>
            {!selectedNode.config.keepPlaying && (
              <label className="fxeditor-field">
                <span>Duration (ms)</span>
                <input type="number" min={0} step={50}
                  value={(selectedNode.config.durationMs as number) ?? 300}
                  onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
              </label>
            )}
          </>
        )}
        {selectedNode.kind === 'play-media' && (
          <>
            <div className="fxeditor-field-hint">
              Triggers media playback on the host node.
            </div>
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={!!selectedNode.config.audioReactive}
                onChange={(e) => {
                  if (e.target.checked) {
                    updateNodeConfig('audioReactive', true)
                    if (!selectedNode.config.visualEffect) updateNodeConfig('visualEffect', 'glow-pulse')
                    if (!selectedNode.config.reactiveIntensity) updateNodeConfig('reactiveIntensity', 1)
                  } else {
                    updateNodeConfig('audioReactive', false)
                  }
                }}
              />
              <span>Audio Reactive</span>
            </label>
            {!!selectedNode.config.audioReactive && (
              <>
                <label className="fxeditor-field">
                  <span>Visual Effect</span>
                  <select
                    value={(selectedNode.config.visualEffect as string) ?? 'glow-pulse'}
                    onChange={(e) => updateNodeConfig('visualEffect', e.target.value)}
                  >
                    <option value="glow-pulse">Glow Pulse</option>
                    <option value="scale-bounce">Scale Bounce</option>
                    <option value="opacity-pulse">Opacity Pulse</option>
                    <option value="color-shift">Color Shift</option>
                  </select>
                </label>
                <label className="fxeditor-field">
                  <span>Intensity</span>
                  <input type="number" min={0.1} max={3} step={0.1}
                    value={(selectedNode.config.reactiveIntensity as number) ?? 1}
                    onChange={(e) => updateNodeConfig('reactiveIntensity', Number(e.target.value))} />
                </label>
              </>
            )}
          </>
        )}
        {selectedNode.kind === 'spawn' && (() => {
          const spawnItems: SpawnItem[] = (selectedNode.config.spawnItems as SpawnItem[] | undefined) ?? []
          const updateSpawnItems = (items: SpawnItem[]) => {
            updateNodeConfig('spawnItems', items)
            onSyncPreviewFacades?.(selectedNode.id, items)
          }
          return (
            <div className="fxeditor-spawn-section">
              <div className="fxeditor-field-hint">
                Define nodes to spawn when this effect runs.
              </div>
              {spawnItems.map((item, idx) => (
                <div key={idx} className="fxeditor-spawn-item">
                  <div className="fxeditor-spawn-item-header">
                    <span className="fxeditor-spawn-item-num">#{idx + 1}</span>
                    <button type="button" className="fxeditor-spawn-remove"
                      onClick={() => updateSpawnItems(spawnItems.filter((_, i) => i !== idx))}>×</button>
                  </div>
                  <label className="fxeditor-field">
                    <span>Label</span>
                    <input type="text" value={item.label}
                      onChange={(e) => {
                        const next = [...spawnItems]
                        next[idx] = { ...item, label: e.target.value }
                        updateSpawnItems(next)
                      }} />
                  </label>
                  <label className="fxeditor-field">
                    <span>ΔX (%)</span>
                    <input type="number" step={1} value={item.offsetX}
                      onChange={(e) => {
                        const next = [...spawnItems]
                        next[idx] = { ...item, offsetX: Number(e.target.value) }
                        updateSpawnItems(next)
                      }} />
                  </label>
                  <label className="fxeditor-field">
                    <span>ΔY (%)</span>
                    <input type="number" step={1} value={item.offsetY}
                      onChange={(e) => {
                        const next = [...spawnItems]
                        next[idx] = { ...item, offsetY: Number(e.target.value) }
                        updateSpawnItems(next)
                      }} />
                  </label>
                  <label className="fxeditor-field">
                    <span>Animation</span>
                    <select value={item.animation}
                      onChange={(e) => {
                        const next = [...spawnItems]
                        next[idx] = { ...item, animation: e.target.value as SpawnItem['animation'] }
                        updateSpawnItems(next)
                      }}>
                      <option value="emerge">Emerge from source</option>
                      <option value="zip-in">Zip-in</option>
                    </select>
                  </label>
                  <label className="fxeditor-field">
                    <span>Connection</span>
                    <select value={item.connectionType}
                      onChange={(e) => {
                        const next = [...spawnItems]
                        next[idx] = { ...item, connectionType: e.target.value as SpawnItem['connectionType'] }
                        updateSpawnItems(next)
                      }}>
                      <option value="none">No connection</option>
                      <option value="default">Default connection</option>
                      <option value="flow">Flow connection</option>
                    </select>
                  </label>
                </div>
              ))}
              <button type="button" className="fxeditor-spawn-add"
                onClick={() => updateSpawnItems([...spawnItems, {
                  label: `Node ${spawnItems.length + 1}`,
                  offsetX: 10, offsetY: 10,
                  animation: 'emerge',
                  connectionType: 'none',
                }])}>
                + Add spawn item
              </button>
            </div>
          )
        })()}
        {selectedNode.kind === 'handoff-rmm' && (
          <div className="fxeditor-field-hint">
            Zooms into this node's RMM child dimension and resumes the effect graph entry that has "Triggered by RMM Parent" checked.
          </div>
        )}
        {selectedNode.kind === 'return-rmm' && (
          <div className="fxeditor-field-hint">
            Zooms out from this RMM child dimension and resumes the parent's flow.
          </div>
        )}
        {selectedNode.kind === 'handoff-mpd' && (
          <>
            <div className="fxeditor-field-hint">
              Switches to a target MPD. The twin node in the target dimension will be triggered.
            </div>
            <label className="fxeditor-field">
              <span>Target MPD</span>
              <select
                value={(selectedNode.config.targetMpdId as string) ?? ''}
                onChange={(e) => updateNodeConfig('targetMpdId', e.target.value)}
              >
                <option value="" disabled>Select dimension…</option>
                {hostContext.mpdIds.map(id => (
                  <option key={id} value={id}>{hostContext.mpdLabels[id] ?? id}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {selectedNode.kind === 'camera' && (
          <>
            <div className="fxeditor-field-hint">
              Overrides camera position during flow. Each attribute animates and reverts within its own duration. Hold duration controls when the flow advances.
            </div>
            <label className="fxeditor-field">
              <span>Pan X (%)</span>
              <input type="number" min={-50} max={50} step={1}
                value={(selectedNode.config.panX as number) ?? 0}
                onChange={(e) => updateNodeConfig('panX', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Pan X Duration (ms)</span>
              <input type="number" min={0} step={50}
                value={(selectedNode.config.panXDurationMs as number) ?? 1000}
                onChange={(e) => updateNodeConfig('panXDurationMs', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Pan X Easing</span>
              <select
                value={(selectedNode.config.panXEasing as string) ?? 'ease-out'}
                onChange={(e) => updateNodeConfig('panXEasing', e.target.value)}
              >
                <option value="ease-in">Ease In</option>
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Ease In Out</option>
              </select>
            </label>
            <div className="fxeditor-radio-group">
              <span>Reset Pan X</span>
              <label>
                <input type="radio" name="panXResetMode"
                  checked={((selectedNode.config.panXResetMode as string) ?? 'attr') === 'attr'}
                  onChange={() => updateNodeConfig('panXResetMode', 'attr')} />
                Elapsed Pan X duration
              </label>
              <label>
                <input type="radio" name="panXResetMode"
                  checked={((selectedNode.config.panXResetMode as string) ?? 'attr') === 'node'}
                  onChange={() => updateNodeConfig('panXResetMode', 'node')} />
                Elapsed Node duration
              </label>
            </div>
            <label className="fxeditor-field">
              <span>Pan Y (%)</span>
              <input type="number" min={-50} max={50} step={1}
                value={(selectedNode.config.panY as number) ?? 0}
                onChange={(e) => updateNodeConfig('panY', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Pan Y Duration (ms)</span>
              <input type="number" min={0} step={50}
                value={(selectedNode.config.panYDurationMs as number) ?? 1000}
                onChange={(e) => updateNodeConfig('panYDurationMs', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Pan Y Easing</span>
              <select
                value={(selectedNode.config.panYEasing as string) ?? 'ease-out'}
                onChange={(e) => updateNodeConfig('panYEasing', e.target.value)}
              >
                <option value="ease-in">Ease In</option>
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Ease In Out</option>
              </select>
            </label>
            <div className="fxeditor-radio-group">
              <span>Reset Pan Y</span>
              <label>
                <input type="radio" name="panYResetMode"
                  checked={((selectedNode.config.panYResetMode as string) ?? 'attr') === 'attr'}
                  onChange={() => updateNodeConfig('panYResetMode', 'attr')} />
                Elapsed Pan Y duration
              </label>
              <label>
                <input type="radio" name="panYResetMode"
                  checked={((selectedNode.config.panYResetMode as string) ?? 'attr') === 'node'}
                  onChange={() => updateNodeConfig('panYResetMode', 'node')} />
                Elapsed Node duration
              </label>
            </div>
            <label className="fxeditor-field">
              <span>Zoom</span>
              <input type="number" min={0.2} max={5} step={0.1}
                value={(selectedNode.config.zoom as number) ?? 1}
                onChange={(e) => updateNodeConfig('zoom', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Zoom Duration (ms)</span>
              <input type="number" min={0} step={50}
                value={(selectedNode.config.zoomDurationMs as number) ?? 1000}
                onChange={(e) => updateNodeConfig('zoomDurationMs', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Zoom Easing</span>
              <select
                value={(selectedNode.config.zoomEasing as string) ?? 'ease-out'}
                onChange={(e) => updateNodeConfig('zoomEasing', e.target.value)}
              >
                <option value="ease-in">Ease In</option>
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Ease In Out</option>
              </select>
            </label>
            <div className="fxeditor-radio-group">
              <span>Reset Zoom</span>
              <label>
                <input type="radio" name="zoomResetMode"
                  checked={((selectedNode.config.zoomResetMode as string) ?? 'attr') === 'attr'}
                  onChange={() => updateNodeConfig('zoomResetMode', 'attr')} />
                Elapsed Zoom duration
              </label>
              <label>
                <input type="radio" name="zoomResetMode"
                  checked={((selectedNode.config.zoomResetMode as string) ?? 'attr') === 'node'}
                  onChange={() => updateNodeConfig('zoomResetMode', 'node')} />
                Elapsed Node duration
              </label>
            </div>
            <label className="fxeditor-field">
              <span>Rotation (°)</span>
              <input type="number" min={-180} max={180} step={1}
                value={(selectedNode.config.rotation as number) ?? 0}
                onChange={(e) => updateNodeConfig('rotation', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Rotation Duration (ms)</span>
              <input type="number" min={0} step={50}
                value={(selectedNode.config.rotationDurationMs as number) ?? 1000}
                onChange={(e) => updateNodeConfig('rotationDurationMs', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Rotation Easing</span>
              <select
                value={(selectedNode.config.rotationEasing as string) ?? 'ease-out'}
                onChange={(e) => updateNodeConfig('rotationEasing', e.target.value)}
              >
                <option value="ease-in">Ease In</option>
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Ease In Out</option>
              </select>
            </label>
            <div className="fxeditor-radio-group">
              <span>Reset Rotation</span>
              <label>
                <input type="radio" name="rotationResetMode"
                  checked={((selectedNode.config.rotationResetMode as string) ?? 'attr') === 'attr'}
                  onChange={() => updateNodeConfig('rotationResetMode', 'attr')} />
                Elapsed Rotation duration
              </label>
              <label>
                <input type="radio" name="rotationResetMode"
                  checked={((selectedNode.config.rotationResetMode as string) ?? 'attr') === 'node'}
                  onChange={() => updateNodeConfig('rotationResetMode', 'node')} />
                Elapsed Node duration
              </label>
              <label>
                <input type="radio" name="rotationResetMode"
                  checked={((selectedNode.config.rotationResetMode as string) ?? 'attr') === 'persist'}
                  onChange={() => updateNodeConfig('rotationResetMode', 'persist')} />
                By other Camera Nodes later after this one
              </label>
            </div>
            <label className="fxeditor-field">
              <span>Hold Duration (ms)</span>
              <input type="number" min={0} step={50}
                value={(selectedNode.config.durationMs as number) ?? 1000}
                onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
            </label>
          </>
        )}
        {selectedNode.kind === 'break' && (
          <>
            <div className="fxeditor-field-hint">
              Splits the node into halves that fall apart with screen shake.
            </div>
            <label className="fxeditor-field">
              <span>Split Axis</span>
              <select
                value={(selectedNode.config.axis as string) ?? 'horizontal'}
                onChange={(e) => updateNodeConfig('axis', e.target.value)}
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </label>
            <label className="fxeditor-field">
              <span>Shake Intensity (px)</span>
              <input type="number" min={1} max={20} step={1}
                value={(selectedNode.config.shakeIntensity as number) ?? 8}
                onChange={(e) => updateNodeConfig('shakeIntensity', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Shake Duration (ms)</span>
              <input type="number" min={100} max={1000} step={50}
                value={(selectedNode.config.shakeDurationMs as number) ?? 300}
                onChange={(e) => updateNodeConfig('shakeDurationMs', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Fall Duration (ms)</span>
              <input type="number" min={200} max={2000} step={50}
                value={(selectedNode.config.fallDurationMs as number) ?? 600}
                onChange={(e) => updateNodeConfig('fallDurationMs', Number(e.target.value))} />
            </label>
          </>
        )}
        {(selectedNode.kind === 'expand' || selectedNode.kind === 'collapse') && (
          <>
            <div className="fxeditor-field-hint">
              {selectedNode.kind === 'expand' ? 'Expands collapsed content nodes.' : 'Collapses expanded content nodes.'}
            </div>
            <label className="fxeditor-field">
              <span>Duration (ms)</span>
              <input type="number" min={50} max={2000} step={50}
                value={(selectedNode.config.durationMs as number) ?? 300}
                onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
            </label>
          </>
        )}
        {selectedNode.kind === 'record' && (
          <>
            <div className="fxeditor-field-hint">
              Records a video of the flow playback. Hides UI chrome, starts recording, then downloads the .webm when the flow finishes or is stopped.
            </div>
            <label className="fxeditor-field">
              <span>Record Mode</span>
              <select
                value={(selectedNode.config.recordMode as string) ?? 'browser'}
                onChange={(e) => updateNodeConfig('recordMode', e.target.value)}
              >
                <option value="browser">Browser (built-in)</option>
                <option value="obs">OBS Studio (WebSocket)</option>
              </select>
            </label>
            {(selectedNode.config.recordMode as string) === 'obs' && (
              <>
                <div className="fxeditor-field-hint" style={{ color: '#38bdf8', fontSize: '0.75rem' }}>
                  Controls OBS via its WebSocket server. Enable it in OBS → Tools → WebSocket Server Settings. Recording settings (codec, resolution, fps) are configured in OBS itself.
                </div>
                <label className="fxeditor-field">
                  <span>OBS Host</span>
                  <input type="text"
                    value={(selectedNode.config.obsHost as string) ?? 'localhost'}
                    onChange={(e) => updateNodeConfig('obsHost', e.target.value)} />
                </label>
                <label className="fxeditor-field">
                  <span>OBS Port</span>
                  <input type="number" min={1} max={65535}
                    value={(selectedNode.config.obsPort as number) ?? 4455}
                    onChange={(e) => updateNodeConfig('obsPort', Number(e.target.value))} />
                </label>
                <label className="fxeditor-field">
                  <span>OBS Password</span>
                  <input type="password"
                    value={(selectedNode.config.obsPassword as string) ?? ''}
                    placeholder="(leave empty if none)"
                    onChange={(e) => updateNodeConfig('obsPassword', e.target.value)} />
                </label>
              </>
            )}
            {(selectedNode.config.recordMode as string) !== 'obs' && (
              <>
                <label className="fxeditor-field">
                  <span>Capture Mode</span>
                  <select
                    value={(selectedNode.config.captureMode as string) ?? 'tab'}
                    onChange={(e) => updateNodeConfig('captureMode', e.target.value)}
                  >
                    <option value="tab">Browser Tab</option>
                    <option value="viewport">Viewport Only (Chrome)</option>
                  </select>
                </label>
                {(selectedNode.config.captureMode as string) === 'viewport' && (
                  <div className="fxeditor-field-hint" style={{ color: '#f59e0b', fontSize: '0.75rem' }}>
                    Viewport-only capture uses the CropTarget API, supported in Chrome 104+ only. Other browsers will fall back to full tab capture.
                  </div>
                )}
              </>
            )}
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={selectedNode.config.hideCursor !== false}
                onChange={(e) => updateNodeConfig('hideCursor', e.target.checked)}
              />
              <span>Hide cursor during recording</span>
            </label>
            {(selectedNode.config.recordMode as string) !== 'obs' && (
              <>
                <label className="fxeditor-field">
                  <span>Recording Width (px)</span>
                  <input type="number" min={320} max={7680} step={10}
                    value={(selectedNode.config.recordingWidth as number) ?? 1920}
                    onChange={(e) => updateNodeConfig('recordingWidth', Number(e.target.value))} />
                </label>
                <label className="fxeditor-field">
                  <span>Recording Height (px)</span>
                  <input type="number" min={240} max={4320} step={10}
                    value={(selectedNode.config.recordingHeight as number) ?? 1080}
                    onChange={(e) => updateNodeConfig('recordingHeight', Number(e.target.value))} />
                </label>
                <label className="fxeditor-field">
                  <span>Frame Rate</span>
                  <select
                    value={(selectedNode.config.fps as number) ?? 30}
                    onChange={(e) => updateNodeConfig('fps', Number(e.target.value))}
                  >
                    <option value={24}>24 fps (cinematic)</option>
                    <option value={30}>30 fps (default)</option>
                    <option value={60}>60 fps (smooth)</option>
                    <option value={120}>120 fps</option>
                  </select>
                </label>
                <label className="fxeditor-field">
                  <span>Codec</span>
                  <select
                    value={(selectedNode.config.codec as string) ?? 'vp9'}
                    onChange={(e) => updateNodeConfig('codec', e.target.value)}
                  >
                    <option value="vp9">VP9 (recommended)</option>
                    <option value="vp8">VP8 (smaller files)</option>
                    <option value="h264">H.264 (wide compat)</option>
                  </select>
                </label>
                <label className="fxeditor-field">
                  <span>Video Bitrate</span>
                  <select
                    value={(selectedNode.config.videoBitrateMbps as number) ?? 32}
                    onChange={(e) => updateNodeConfig('videoBitrateMbps', Number(e.target.value))}
                  >
                    <option value={8}>8 Mbps</option>
                    <option value={16}>16 Mbps</option>
                    <option value={32}>32 Mbps (default)</option>
                    <option value={64}>64 Mbps</option>
                    <option value={100}>100 Mbps</option>
                    <option value={200}>200 Mbps (near lossless)</option>
                  </select>
                </label>
              </>
            )}
          </>
        )}
        {selectedNode.kind === 'jitter' && (
          <>
            <div className="fxeditor-field-hint">
              Makes the node shake nervously for a duration.
            </div>
            <label className="fxeditor-field">
              <span>Intensity (px)</span>
              <input type="number" min={1} max={20} step={1}
                value={(selectedNode.config.intensity as number) ?? 4}
                onChange={(e) => updateNodeConfig('intensity', Number(e.target.value))} />
            </label>
            {!selectedNode.config.keepPlaying && (
              <label className="fxeditor-field">
                <span>Duration (ms)</span>
                <input type="number" min={100} step={50}
                  value={(selectedNode.config.durationMs as number) ?? 1000}
                  onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
              </label>
            )}
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={!!selectedNode.config.keepPlaying}
                onChange={(e) => updateNodeConfig('keepPlaying', e.target.checked)}
              />
              <span>Keep playing until flow ends</span>
            </label>
          </>
        )}
        {selectedNode.kind === 'float' && (
          <>
            <div className="fxeditor-field-hint">
              Wobbles the node in place like an air-suspended drone.
            </div>
            <label className="fxeditor-field">
              <span>Amplitude (px)</span>
              <input type="number" min={1} max={30} step={1}
                value={(selectedNode.config.amplitude as number) ?? 6}
                onChange={(e) => updateNodeConfig('amplitude', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Speed</span>
              <input type="number" min={0.1} max={5} step={0.1}
                value={(selectedNode.config.speed as number) ?? 1}
                onChange={(e) => updateNodeConfig('speed', Number(e.target.value))} />
            </label>
            {!selectedNode.config.keepPlaying && (
              <label className="fxeditor-field">
                <span>Duration (ms)</span>
                <input type="number" min={200} step={100}
                  value={(selectedNode.config.durationMs as number) ?? 3000}
                  onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
              </label>
            )}
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={!!selectedNode.config.keepPlaying}
                onChange={(e) => updateNodeConfig('keepPlaying', e.target.checked)}
              />
              <span>Keep playing until flow ends</span>
            </label>
          </>
        )}
        {selectedNode.kind === 'spawn-circular' && (() => {
          const scItems: SpawnCircularItem[] = (selectedNode.config.spawnCircularItems as SpawnCircularItem[] | undefined) ?? []
          const updateScItems = (items: SpawnCircularItem[]) => updateNodeConfig('spawnCircularItems', items)
          return (
            <div className="fxeditor-spawn-section">
              <div className="fxeditor-field-hint">
                Spawns nodes in a circle around the source, one after another.
              </div>
              <label className="fxeditor-field">
                <span>Distance (px)</span>
                <input type="number" min={20} step={10}
                  value={(selectedNode.config.distance as number) ?? 120}
                  onChange={(e) => updateNodeConfig('distance', Number(e.target.value))} />
              </label>
              <label className="fxeditor-field">
                <span>Delay between (ms)</span>
                <input type="number" min={0} step={50}
                  value={(selectedNode.config.delayBetweenMs as number) ?? 200}
                  onChange={(e) => updateNodeConfig('delayBetweenMs', Number(e.target.value))} />
              </label>
              {scItems.map((item, idx) => (
                <div key={idx} className="fxeditor-spawn-item">
                  <div className="fxeditor-spawn-item-header">
                    <span className="fxeditor-spawn-item-num">#{idx + 1}</span>
                    <button type="button" className="fxeditor-spawn-remove"
                      onClick={() => updateScItems(scItems.filter((_, i) => i !== idx))}>×</button>
                  </div>
                  <label className="fxeditor-field">
                    <span>Label</span>
                    <input type="text" value={item.label}
                      onChange={(e) => {
                        const next = [...scItems]
                        next[idx] = { ...item, label: e.target.value }
                        updateScItems(next)
                      }} />
                  </label>
                  <label className="fxeditor-field">
                    <span>Animation</span>
                    <select value={item.animation}
                      onChange={(e) => {
                        const next = [...scItems]
                        next[idx] = { ...item, animation: e.target.value as SpawnCircularItem['animation'] }
                        updateScItems(next)
                      }}>
                      <option value="emerge">Emerge from source</option>
                      <option value="zip-in">Zip-in</option>
                    </select>
                  </label>
                  <label className="fxeditor-field">
                    <span>Connection</span>
                    <select value={item.connectionType}
                      onChange={(e) => {
                        const next = [...scItems]
                        next[idx] = { ...item, connectionType: e.target.value as SpawnCircularItem['connectionType'] }
                        updateScItems(next)
                      }}>
                      <option value="none">No connection</option>
                      <option value="default">Default connection</option>
                      <option value="flow">Flow connection</option>
                    </select>
                  </label>
                </div>
              ))}
              <button type="button" className="fxeditor-spawn-add"
                onClick={() => updateScItems([...scItems, {
                  label: `Node ${scItems.length + 1}`,
                  animation: 'emerge',
                  connectionType: 'none',
                }])}>
                + Add spawn item
              </button>
            </div>
          )
        })()}
        {selectedNode.kind === 'emerge' && (
          <>
            <div className="fxeditor-field-hint">
              Hides this node when the flow starts. When reached, the node transitions out of its parent (incoming connection's source node).
            </div>
            <label className="fxeditor-field">
              <span>Animation</span>
              <select
                value={(selectedNode.config.animation as string) ?? 'scale-in'}
                onChange={(e) => updateNodeConfig('animation', e.target.value)}
              >
                <option value="scale-in">Scale in</option>
                <option value="fade-in">Fade in</option>
              </select>
            </label>
            <label className="fxeditor-field">
              <span>Duration (ms)</span>
              <input type="number" min={100} step={50}
                value={(selectedNode.config.durationMs as number) ?? 600}
                onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
            </label>
          </>
        )}
        {selectedNode.kind === 'dismiss' && (
          <>
            <div className="fxeditor-field-hint">
              Dismisses this node when reached, animating it away with a scale-out, fade-out, or scale-to-source transition.
            </div>
            <label className="fxeditor-field">
              <span>Animation</span>
              <select
                value={(selectedNode.config.animation as string) ?? 'scale-out'}
                onChange={(e) => updateNodeConfig('animation', e.target.value)}
              >
                <option value="scale-out">Scale out</option>
                <option value="fade-out">Fade out</option>
                <option value="scale-to-source">Scale to source</option>
              </select>
            </label>
            <label className="fxeditor-field">
              <span>Duration (ms)</span>
              <input type="number" min={100} step={50}
                value={(selectedNode.config.durationMs as number) ?? 600}
                onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
            </label>
          </>
        )}
        {selectedNode.kind === 'scale' && (
          <>
            <div className="fxeditor-field-hint">
              Smoothly scales the node to a new width and height.
            </div>
            <label className="fxeditor-field">
              <span>Target Width (px)</span>
              <input type="number" min={20} step={10}
                value={(selectedNode.config.targetWidth as number) ?? 200}
                onChange={(e) => updateNodeConfig('targetWidth', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Target Height (px)</span>
              <input type="number" min={20} step={10}
                value={(selectedNode.config.targetHeight as number) ?? 120}
                onChange={(e) => updateNodeConfig('targetHeight', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Duration (ms)</span>
              <input type="number" min={100} step={50}
                value={(selectedNode.config.durationMs as number) ?? 500}
                onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
            </label>
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={selectedNode.config.keepPlaying === true}
                onChange={(e) => updateNodeConfig('keepPlaying', e.target.checked)}
              />
              <span>Keep playing until flow ends</span>
            </label>
          </>
        )}
        {selectedNode.kind === 'text-format' && (
          <>
            <div className="fxeditor-field-hint">
              Temporarily applies text formatting to part of the node label during flow playback.
            </div>
            <div className="fxeditor-radio-group">
              <span>Target Mode</span>
              <label>
                <input type="radio" name="textFmtTargetMode"
                  checked={((selectedNode.config.targetMode as string) ?? 'indices') === 'indices'}
                  onChange={() => updateNodeConfig('targetMode', 'indices')} />
                By Indices
              </label>
              <label>
                <input type="radio" name="textFmtTargetMode"
                  checked={((selectedNode.config.targetMode as string) ?? 'indices') === 'substrings'}
                  onChange={() => updateNodeConfig('targetMode', 'substrings')} />
                By Substrings
              </label>
            </div>
            {((selectedNode.config.targetMode as string) ?? 'indices') === 'indices' ? (
              <>
                <label className="fxeditor-field">
                  <span>Start Index</span>
                  <input type="number" min={0} step={1}
                    value={(selectedNode.config.startIndex as number) ?? 0}
                    onChange={(e) => updateNodeConfig('startIndex', Number(e.target.value))} />
                </label>
                <label className="fxeditor-field">
                  <span>End Index</span>
                  <input type="number" min={0} step={1}
                    value={(selectedNode.config.endIndex as number) ?? 0}
                    onChange={(e) => updateNodeConfig('endIndex', Number(e.target.value))} />
                </label>
              </>
            ) : (
              <>
                <label className="fxeditor-field">
                  <span>Start Substring</span>
                  <input type="text"
                    value={(selectedNode.config.startSubstring as string) ?? ''}
                    onChange={(e) => updateNodeConfig('startSubstring', e.target.value)} />
                </label>
                <label className="fxeditor-field">
                  <span>End Substring</span>
                  <input type="text"
                    value={(selectedNode.config.endSubstring as string) ?? ''}
                    onChange={(e) => updateNodeConfig('endSubstring', e.target.value)} />
                </label>
              </>
            )}
            <label className="fxeditor-checkbox">
              <input type="checkbox"
                checked={selectedNode.config.bold === true}
                onChange={(e) => updateNodeConfig('bold', e.target.checked)} />
              <span>Bold</span>
            </label>
            <label className="fxeditor-checkbox">
              <input type="checkbox"
                checked={selectedNode.config.italic === true}
                onChange={(e) => updateNodeConfig('italic', e.target.checked)} />
              <span>Italic</span>
            </label>
            <label className="fxeditor-checkbox">
              <input type="checkbox"
                checked={selectedNode.config.strikethrough === true}
                onChange={(e) => updateNodeConfig('strikethrough', e.target.checked)} />
              <span>Strikethrough</span>
            </label>
            <label className="fxeditor-field">
              <span>Color</span>
              <input type="color"
                value={(selectedNode.config.color as string) || '#000000'}
                onChange={(e) => updateNodeConfig('color', e.target.value)} />
            </label>
            <label className="fxeditor-field">
              <span>Font Size (px)</span>
              <input type="number" min={0} step={1}
                value={(selectedNode.config.fontSize as number) ?? 0}
                onChange={(e) => updateNodeConfig('fontSize', Number(e.target.value))} />
            </label>
            {((selectedNode.config.fontSize as number) ?? 0) > 0 && (
              <label className="fxeditor-field">
                <span>Rescale Duration (ms)</span>
                <input type="number" min={0} step={50}
                  value={(selectedNode.config.rescaleDurationMs as number) ?? 0}
                  onChange={(e) => updateNodeConfig('rescaleDurationMs', Number(e.target.value))} />
              </label>
            )}
            {!selectedNode.config.keepPlaying && (
              <label className="fxeditor-field">
                <span>Node Duration (ms)</span>
                <input type="number" min={0} step={50}
                  value={(selectedNode.config.durationMs as number) ?? 1000}
                  onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
              </label>
            )}
            <label className="fxeditor-checkbox">
              <input
                type="checkbox"
                checked={!!selectedNode.config.keepPlaying}
                onChange={(e) => updateNodeConfig('keepPlaying', e.target.checked)}
              />
              <span>Keep playing until flow ends</span>
            </label>
            <label className="fxeditor-field">
              <span>Animation Style</span>
              <select
                value={(selectedNode.config.levitateStyle as string) ?? 'none'}
                onChange={(e) => updateNodeConfig('levitateStyle', e.target.value)}
              >
                <option value="none">None</option>
                <option value="cloudy">Cloudy</option>
                <option value="bubbly">Bubbly</option>
                <option value="jittery">Jittery</option>
                <option value="drunken">Drunken</option>
                <option value="watery">Watery</option>
              </select>
            </label>
          </>
        )}
        {selectedNode.kind === 'text-generator' && (
          <TextGeneratorConfigPanel selectedNode={selectedNode} updateNodeConfig={updateNodeConfig} />
        )}
        {selectedNode.kind === 'repeater' && (
          <>
            <div className="fxeditor-field-hint">
              Loops circuit-connected effects N times, then hands off via the default output.
              Connect circuit-out (bottom-right) → circuit-in (top-right) of downstream effects to form the loop.
            </div>
            <label className="fxeditor-field">
              <span>Repeat Count</span>
              <input type="number" min={1} max={100} step={1}
                value={(selectedNode.config.repeatCount as number) ?? 3}
                onChange={(e) => updateNodeConfig('repeatCount', Number(e.target.value))} />
            </label>
          </>
        )}
        {selectedNode.kind === 'cloud-levitate' && (
          <>
            <label className="fxeditor-field">
              <span>Amplitude</span>
              <input type="number" min={1} max={50} step={1}
                value={(selectedNode.config.amplitude as number) ?? 8}
                onChange={(e) => updateNodeConfig('amplitude', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Speed</span>
              <input type="number" min={0.1} max={5} step={0.1}
                value={(selectedNode.config.speed as number) ?? 0.8}
                onChange={(e) => updateNodeConfig('speed', Number(e.target.value))} />
            </label>
          </>
        )}
        {selectedNode.kind === 'bubble-levitate' && (
          <>
            <label className="fxeditor-field">
              <span>Amplitude</span>
              <input type="number" min={1} max={50} step={1}
                value={(selectedNode.config.amplitude as number) ?? 10}
                onChange={(e) => updateNodeConfig('amplitude', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>Speed</span>
              <input type="number" min={0.1} max={5} step={0.1}
                value={(selectedNode.config.speed as number) ?? 0.5}
                onChange={(e) => updateNodeConfig('speed', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox"
                checked={!!selectedNode.config.scalePulse}
                onChange={(e) => updateNodeConfig('scalePulse', e.target.checked)} />
              <span>Scale pulse</span>
            </label>
          </>
        )}
        {selectedNode.kind === 'segment-play' && (
          <>
            <label className="fxeditor-field">
              <span>Start (s)</span>
              <input type="number" min={0} step={0.1}
                value={(selectedNode.config.startTime as number) ?? 0}
                onChange={(e) => updateNodeConfig('startTime', Number(e.target.value))} />
            </label>
            <label className="fxeditor-field">
              <span>End (s)</span>
              <input type="number" min={0} step={0.1}
                value={(selectedNode.config.endTime as number) ?? 0}
                onChange={(e) => updateNodeConfig('endTime', Number(e.target.value))} />
            </label>
          </>
        )}
        {selectedNode.kind === 'audio-clip' && (
          <AudioClipConfig
            selectedNode={selectedNode}
            updateNodeConfig={updateNodeConfig}
            hostNodeId={hostNodeId}
          />
        )}
        {!isNodeLocked(selectedNode) && (
          <button type="button" className="fxeditor-delete-btn" onClick={deleteSelected}>
            Delete Node
          </button>
        )}
      </>
    )
  }

  return (
    <div className="fxeditor-add-nodes">
      <div className="fxeditor-add-nodes-title">Add Node</div>
      {addableKinds.map(kind => (
        <button key={kind} type="button" className="fxeditor-add-node-btn"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/fxnode-kind', kind)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => addNode(kind)}>
          <span className="fxeditor-add-node-dot" style={{ background: kindColors[kind] }} />
          {kindLabels[kind]}
        </button>
      ))}
    </div>
  )
}
