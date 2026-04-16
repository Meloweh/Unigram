import { useMemo } from 'react'
import type { Model, ModelNode } from './sampleModels'

export interface MpdLogicDeps {
  frameModelId: string
  frameSelectedNodeId: string | null
  frameNodeMpdOriginalModelId?: string
  frameEntryNodeId?: string
  selectedNode: ModelNode | undefined
  stack: ReadonlyArray<{ modelId: string }>
  storeModels: Record<string, Model>
  storeGetModel: (id: string) => Model | undefined
}

export function useMpdLogic(deps: MpdLogicDeps) {
  const {
    frameModelId, frameSelectedNodeId, frameNodeMpdOriginalModelId,
    frameEntryNodeId, selectedNode, stack, storeModels, storeGetModel,
  } = deps

  // --- Node-level dial ---
  // When we've switched to an MPD model (nodeMpdOriginalModelId is set), look up
  // the source node from the original model so the dial stays visible.
  const nodeMpdSourceNode = useMemo(() => {
    if (!frameNodeMpdOriginalModelId || !frameSelectedNodeId) return null
    const origModel = storeModels[frameNodeMpdOriginalModelId]
    return origModel?.nodes.find((n) => n.id === frameSelectedNodeId) ?? null
  }, [frameNodeMpdOriginalModelId, frameSelectedNodeId, storeModels])

  const nodeDialIds = useMemo(() => {
    const node = nodeMpdSourceNode ?? selectedNode
    if (!node) return null
    if (!node.mpdIds || node.mpdIds.length < 2) return null
    return node.mpdIds
  }, [nodeMpdSourceNode, selectedNode])

  // --- Frame-level dial ---
  // Derive live MPD perspectives from the entry node in the parent model
  // so newly added MPDs are picked up without re-zooming.
  // Only mpdIds — childModelId (RMM) is never part of the frame-level dial.
  const liveMpdIds = useMemo(() => {
    if (stack.length < 2 || !frameEntryNodeId) return undefined
    const parentFrame = stack[stack.length - 2]
    const parentModel = storeModels[parentFrame.modelId]
    const entryNode = parentModel?.nodes.find((n) => n.id === frameEntryNodeId)
    if (!entryNode?.mpdIds || entryNode.mpdIds.length < 2) return undefined
    return entryNode.mpdIds
  }, [stack, frameEntryNodeId, storeModels])

  // Node-level takes priority; frame-level only when no node-level and a node is selected
  const isNodeLevelMpd = !!nodeDialIds
  const isFrameLevelMpd = !isNodeLevelMpd && !!liveMpdIds && liveMpdIds.length > 1 && !!frameSelectedNodeId

  const mpdOptions = useMemo(() => {
    if (isNodeLevelMpd) {
      return nodeDialIds!.map((id) => {
        const m = storeGetModel(id)
        return { id, label: m?.label ?? id }
      })
    }
    if (isFrameLevelMpd) {
      return liveMpdIds!.map((id) => {
        const m = storeGetModel(id)
        return { id, label: m?.label ?? id }
      })
    }
    return null
  }, [isNodeLevelMpd, isFrameLevelMpd, nodeDialIds, liveMpdIds, storeGetModel])

  const mpdActiveIndex = useMemo(() => {
    if (!mpdOptions) return 0
    if (isNodeLevelMpd) {
      // When viewing the original model (or no MPD switch yet), active = first entry (default)
      if (!frameNodeMpdOriginalModelId) return 0
      // Otherwise find which mpdId matches current frame.modelId
      const idx = nodeDialIds!.indexOf(frameModelId)
      return idx >= 0 ? idx : 0
    }
    return Math.max(0, liveMpdIds!.indexOf(frameModelId))
  }, [mpdOptions, isNodeLevelMpd, frameModelId, frameNodeMpdOriginalModelId, nodeDialIds, liveMpdIds])

  return {
    nodeMpdSourceNode,
    nodeDialIds,
    liveMpdIds,
    isNodeLevelMpd,
    isFrameLevelMpd,
    mpdOptions,
    mpdActiveIndex,
  }
}
