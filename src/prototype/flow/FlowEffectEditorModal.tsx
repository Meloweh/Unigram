import type { Model, ModelNode } from '../model/sampleModels'
import { FlowEffectEditor, type EffectEditorHostContext } from './FlowEffectEditor'

interface FlowEffectEditorModalProps {
  editingEffect: { nodeId: string; effectId: string }
  model: Model
  frameModelId: string
  stackLength: number
  storeModels: Record<string, Model>
  updateNodeProps: (modelId: string, nodeId: string, props: Partial<ModelNode>) => void
  onClose: () => void
}

export function FlowEffectEditorModal({
  editingEffect, model, frameModelId, stackLength,
  storeModels, updateNodeProps, onClose,
}: FlowEffectEditorModalProps) {
  const editNode = model.nodes.find(n => n.id === editingEffect.nodeId)
  // Find the effect — either from flowEffects or build the locked media virtual effect
  let editFx = editNode?.flowEffects?.find(e => e.id === editingEffect.effectId)
  if (!editFx && editingEffect.effectId === '__locked-media__' && editNode?.mediaType) {
    editFx = {
      id: '__locked-media__',
      label: `Play ${editNode.mediaType}`,
      locked: true,
      graph: {
        nodes: [
          { id: '__entry__', kind: 'entry' as const, label: 'Signal In', x: 60, y: 120, config: {} },
          { id: 'play-media-root', kind: 'play-media' as const, label: `Play ${editNode.mediaType}`, x: 300, y: 120, config: {} },
        ],
        edges: [{ from: '__entry__', to: 'play-media-root' }],
      },
    }
  }
  if (!editFx && editingEffect.effectId === '__locked-cosmetic__' && editNode?.cosmeticType) {
    const cKind = editNode.cosmeticType === 'thinking-cloud' ? 'cloud-levitate' as const : 'bubble-levitate' as const
    const cLabel = editNode.cosmeticType === 'thinking-cloud' ? 'Cloudy Levitate' : 'Soap Bubble Levitate'
    const cConfig = cKind === 'cloud-levitate'
      ? { amplitude: 8, speed: 0.8, durationMs: 3000 }
      : { amplitude: 10, speed: 0.5, durationMs: 4000, scalePulse: true }
    editFx = {
      id: '__locked-cosmetic__',
      label: cLabel,
      locked: true,
      alwaysPlay: true,
      graph: {
        nodes: [
          { id: '__entry__', kind: 'entry' as const, label: 'Signal In', x: 60, y: 120, config: {} },
          { id: 'cosmetic-root', kind: cKind, label: cLabel, x: 300, y: 120, config: cConfig },
        ],
        edges: [{ from: '__entry__', to: 'cosmetic-root' }],
      },
    }
  }
  if (!editFx) return null
  const hostCtx: EffectEditorHostContext = {
    hasChildModel: !!editNode?.childModelId,
    isInsideChildModel: stackLength > 1,
    mpdIds: editNode?.mpdIds ?? [],
    mpdLabels: Object.fromEntries(
      (editNode?.mpdIds ?? []).map(id => [id, storeModels[id]?.label ?? id])
    ),
    mediaType: editNode?.mediaType,
    cosmeticType: editNode?.cosmeticType,
  }
  return (
    <FlowEffectEditor
      effect={editFx}
      hostContext={hostCtx}
      onSave={(updated) => {
        if (!editNode) return
        if (updated.id === '__locked-media__' || updated.id === '__locked-cosmetic__') {
          const existing = editNode.flowEffects ?? []
          const lockedExists = existing.find(e => e.locked)
          if (lockedExists) {
            updateNodeProps(frameModelId, editNode.id, {
              flowEffects: existing.map(e => e.id === lockedExists.id ? { ...updated, id: lockedExists.id } : e),
            })
          } else {
            const persisted = { ...updated, id: `fx-locked-${Date.now()}` }
            updateNodeProps(frameModelId, editNode.id, {
              flowEffects: [persisted, ...existing],
            })
          }
        } else {
          const existing = editNode.flowEffects ?? []
          updateNodeProps(frameModelId, editNode.id, {
            flowEffects: existing.map(e => e.id === updated.id ? updated : e),
          })
        }
        onClose()
      }}
      onClose={onClose}
    />
  )
}
