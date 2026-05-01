import type { Model, ModelNode, FlowEffect } from '../model/sampleModels'
import { FlowEffectEditor, type EffectEditorHostContext } from './FlowEffectEditor'

interface FlowEffectEditorModalProps {
  editingEffect: { nodeId: string; effectId: string; peerNodeId?: string | null; peerEffectId?: string }
  model: Model
  frameModelId: string
  stackLength: number
  storeModels: Record<string, Model>
  updateNodeProps: (modelId: string, nodeId: string, props: Partial<ModelNode>) => void
  onClose: () => void
  onRequestPeer?: (sourceNodeId: string, sourceEffectId: string) => void
  onUnlinkPeer?: () => void
  onSyncPreviewFacades?: (hostNodeId: string, graphNodeId: string, items: import('./FlowEffectEditor').SpawnItem[]) => void
}

export function FlowEffectEditorModal({
  editingEffect, model, frameModelId, stackLength,
  storeModels, updateNodeProps, onClose, onRequestPeer, onUnlinkPeer, onSyncPreviewFacades,
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
  const hostCtx = buildHostCtx(editNode!, editingEffect.nodeId, stackLength, storeModels)

  // ---- Auto-detect peer node from existing cross-edges ----
  let resolvedPeerNodeId = editingEffect.peerNodeId
  if (resolvedPeerNodeId === null) {
    // Explicitly unlinked — skip auto-detection
    resolvedPeerNodeId = undefined
  } else if (!resolvedPeerNodeId) {
    // Check if this effect has outgoing cross-edges
    const outCross = editFx.graph.edges.find(e => !!e.crossNodeId)
    if (outCross) {
      resolvedPeerNodeId = outCross.crossNodeId
    } else {
      // Check if any other node has cross-edges targeting this node
      for (const n of model.nodes) {
        if (n.id === editingEffect.nodeId) continue
        for (const fx of n.flowEffects ?? []) {
          if (fx.graph.edges.some(e => e.crossNodeId === editingEffect.nodeId)) {
            resolvedPeerNodeId = n.id
            break
          }
        }
        if (resolvedPeerNodeId) break
      }
    }
  }

  // ---- Build peer effect + context (if split-screen linked) ----
  let peerFx: FlowEffect | undefined
  let peerCtx: EffectEditorHostContext | undefined
  if (resolvedPeerNodeId) {
    const peerNode = model.nodes.find(n => n.id === resolvedPeerNodeId)
    if (peerNode) {
      peerCtx = buildHostCtx(peerNode, peerNode.id, stackLength, storeModels)
      // Auto-select the peer's single effect (or first effect, or locked preset)
      const peerEffects = peerNode.flowEffects ?? []
      if (editingEffect.peerEffectId) {
        peerFx = peerEffects.find(e => e.id === editingEffect.peerEffectId)
      }
      if (!peerFx && peerEffects.length > 0) {
        peerFx = peerEffects[0]
      }
      if (!peerFx) {
        // Build locked virtual effect for peer (same logic as host)
        peerFx = buildLockedVirtualEffect(peerNode)
      }
    }
  }

  const saveEffect = (nodeId: string, node: ModelNode | undefined, updated: FlowEffect) => {
    if (!node) return
    if (updated.id === '__locked-media__' || updated.id === '__locked-cosmetic__') {
      const existing = node.flowEffects ?? []
      const lockedExists = existing.find(e => e.locked)
      if (lockedExists) {
        updateNodeProps(frameModelId, node.id, {
          flowEffects: existing.map(e => e.id === lockedExists.id ? { ...updated, id: lockedExists.id } : e),
        })
      } else {
        const persisted = { ...updated, id: `fx-locked-${Date.now()}` }
        updateNodeProps(frameModelId, node.id, {
          flowEffects: [persisted, ...existing],
        })
      }
    } else {
      const existing = node.flowEffects ?? []
      updateNodeProps(frameModelId, node.id, {
        flowEffects: existing.map(e => e.id === updated.id ? updated : e),
      })
    }
  }

  return (
    <FlowEffectEditor
      key={resolvedPeerNodeId ?? '__no-peer__'}
      effect={editFx}
      hostContext={hostCtx}
      peerEffect={peerFx}
      peerHostContext={peerCtx}
      onSave={(updated) => {
        saveEffect(editingEffect.nodeId, editNode, updated)
        onClose()
      }}
      onSavePeer={peerFx ? (updated) => {
        const peerNode = model.nodes.find(n => n.id === resolvedPeerNodeId)
        saveEffect(resolvedPeerNodeId!, peerNode, updated)
      } : undefined}
      onRequestPeer={onRequestPeer ? () => onRequestPeer(editingEffect.nodeId, editingEffect.effectId) : undefined}
      onUnlinkPeer={(cleanedEffect, cleanedPeerEffect) => {
        saveEffect(editingEffect.nodeId, editNode, cleanedEffect)
        if (cleanedPeerEffect && resolvedPeerNodeId) {
          const peerNode = model.nodes.find(n => n.id === resolvedPeerNodeId)
          saveEffect(resolvedPeerNodeId, peerNode, cleanedPeerEffect)
        }
        onUnlinkPeer?.()
      }}
      onSyncPreviewFacades={onSyncPreviewFacades}
      onClose={onClose}
    />
  )
}

function buildHostCtx(node: ModelNode, nodeId: string, stackLength: number, storeModels: Record<string, Model>): EffectEditorHostContext {
  return {
    hostNodeId: nodeId,
    hasChildModel: !!node.childModelId,
    isInsideChildModel: stackLength > 1,
    mpdIds: node.mpdIds ?? [],
    mpdLabels: Object.fromEntries(
      (node.mpdIds ?? []).map(id => [id, storeModels[id]?.label ?? id])
    ),
    mediaType: node.mediaType,
    cosmeticType: node.cosmeticType,
  }
}

function buildLockedVirtualEffect(node: ModelNode): FlowEffect | undefined {
  if (node.mediaType) {
    return {
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
    }
  }
  if (node.cosmeticType) {
    const cKind = node.cosmeticType === 'thinking-cloud' ? 'cloud-levitate' as const : 'bubble-levitate' as const
    const cLabel = node.cosmeticType === 'thinking-cloud' ? 'Cloudy Levitate' : 'Soap Bubble Levitate'
    const cConfig = cKind === 'cloud-levitate'
      ? { amplitude: 8, speed: 0.8, durationMs: 3000 }
      : { amplitude: 10, speed: 0.5, durationMs: 4000, scalePulse: true }
    return {
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
  return undefined
}
