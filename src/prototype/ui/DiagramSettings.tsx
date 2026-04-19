import { useState, useRef } from 'react'
import type { Model, ThemeMode, GridStyle } from '../model/sampleModels'
import { useHybridZoomStore } from '../model/useHybridZoomStore'
import { GRADIENT_PRESETS, PATTERN_PRESETS } from '../theme/backgrounds'
import { PARTICLE_PRESETS } from '../theme/particles'
import { ALL_THEME_OPTIONS } from '../theme/themes'

/** Convert any CSS color string to #rrggbb (required by <input type="color">).
 *  Alpha is discarded since the native picker doesn't support it. */
function toHex6(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  // Try parsing rgba/rgb directly first (avoids canvas dependency)
  const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)
  if (m) {
    const hex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`
  }
  // Fallback: use canvas 2d context for named colors, hsl, etc.
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx) {
    ctx.fillStyle = color
    const resolved = ctx.fillStyle
    if (/^#[0-9a-fA-F]{6}$/.test(resolved)) return resolved
  }
  return '#000000'
}

/** Color picker that uses a hidden native input but positions the swatch to the left of the sidebar */
export function ColorInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
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
        value={toHex6(value)}
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

export function DiagramSettings({ model, gridSnap, onSetGridSnap }: {
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
