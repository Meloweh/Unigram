import type { EffectGraphNode } from '../model/sampleModels'
import { TEXT_GEN_SOUND_PRESETS } from './textGeneratorSounds'

export function TextGeneratorConfigPanel({
  selectedNode,
  updateNodeConfig,
}: {
  selectedNode: EffectGraphNode
  updateNodeConfig: (key: string, value: unknown) => void
}) {
  return (
    <>
      <div className="fxeditor-field-hint">
        Progressively reveals text in the node label, like RPG dialog text generation.
      </div>
      <div className="fxeditor-radio-group">
        <span>Target Mode</span>
        <label>
          <input type="radio" name="textGenTargetMode"
            checked={((selectedNode.config.targetMode as string) ?? 'indices') === 'indices'}
            onChange={() => updateNodeConfig('targetMode', 'indices')} />
          By Indices
        </label>
        <label>
          <input type="radio" name="textGenTargetMode"
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
      <label className="fxeditor-field">
        <span>Speed (ms/step)</span>
        <input type="number" min={1} step={5}
          value={(selectedNode.config.speed as number) ?? 50}
          onChange={(e) => updateNodeConfig('speed', Number(e.target.value))} />
      </label>
      <label className="fxeditor-field">
        <span>Mode</span>
        <select
          value={(selectedNode.config.mode as string) ?? 'letter'}
          onChange={(e) => updateNodeConfig('mode', e.target.value)}
        >
          <option value="letter">Letter by letter</option>
          <option value="word">Word by word</option>
        </select>
      </label>
      <label className="fxeditor-field">
        <span>Sound Preset</span>
        <select
          value={(selectedNode.config.soundPreset as string) ?? 'none'}
          onChange={(e) => updateNodeConfig('soundPreset', e.target.value)}
        >
          {TEXT_GEN_SOUND_PRESETS.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="fxeditor-checkbox">
        <input type="checkbox"
          checked={!!selectedNode.config.useNodeDuration}
          onChange={(e) => updateNodeConfig('useNodeDuration', e.target.checked)} />
        <span>Hold after generation</span>
      </label>
      {!!selectedNode.config.useNodeDuration && (
        <label className="fxeditor-field">
          <span>Hold Duration (ms)</span>
          <input type="number" min={0} step={50}
            value={(selectedNode.config.nodeDurationMs as number) ?? 1000}
            onChange={(e) => updateNodeConfig('nodeDurationMs', Number(e.target.value))} />
        </label>
      )}
      <label className="fxeditor-checkbox">
        <input type="checkbox"
          checked={!!selectedNode.config.useDegeneration}
          onChange={(e) => updateNodeConfig('useDegeneration', e.target.checked)} />
        <span>Degeneration (reverse reveal)</span>
      </label>
      {!!selectedNode.config.useDegeneration && (
        <label className="fxeditor-field">
          <span>Degeneration Duration (ms)</span>
          <input type="number" min={0} step={50}
            value={(selectedNode.config.degenerationDurationMs as number) ?? 0}
            onChange={(e) => updateNodeConfig('degenerationDurationMs', Number(e.target.value))} />
        </label>
      )}
    </>
  )
}
