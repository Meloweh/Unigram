import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Model, ModelNode } from '../model/sampleModels'
import { SCENE_W, SCENE_H } from '../scene/sceneConstants'
import { gridBackgroundImage } from '../scene/gridBackground'
import type { BackgroundConfig } from '../theme/backgrounds'

export interface MpdCurtainState {
  oldModel: Model
  oldSceneStyle: React.CSSProperties
  oldBgStyle?: React.CSSProperties
  oldBgConfig?: BackgroundConfig
  particleScreenshot: string | null
  oldNodeSizes: Map<string, { w: number; h: number }>
  oldGridExtent: { minX: number; minY: number; maxX: number; maxY: number }
  oldGridBgImage: string
  oldGridPxW: number
  oldGridPxH: number
  progress: number
  direction: 'left' | 'right'
}

export interface MpdCurtainDeps {
  model: Model
  frameModelId: string
  frameSelectedNodeId: string | null
  frameNodeMpdOriginalModelId?: string
  framePanOffset: { x: number; y: number }
  frameSnapshotNodeProgress: number
  effectiveScale: number
  selectedNode: ModelNode | undefined
  vpSize: { w: number; h: number }
  sceneStyle: React.CSSProperties
  bgStyle?: React.CSSProperties
  bgConfig?: BackgroundConfig
  gridExtent: { minX: number; minY: number; maxX: number; maxY: number }
  gridConfig: unknown
  gridPxW: number
  gridPxH: number
  mpdOptions: Array<{ id: string; label: string }> | null
  isNodeLevelMpd: boolean
  nodeDialIds: string[] | null
  storeGetModel: (id: string) => Model | undefined
  switchNodeMpd: (targetId: string, mpdIds: string[], alignPan?: { x: number; y: number }) => void
  switchFrameMpd: (targetId: string, alignPan?: { x: number; y: number }) => void
}

export function useMpdCurtain(deps: MpdCurtainDeps) {
  const {
    model, frameModelId, frameSelectedNodeId, frameNodeMpdOriginalModelId,
    framePanOffset, frameSnapshotNodeProgress, effectiveScale,
    selectedNode, vpSize, sceneStyle, bgStyle, bgConfig,
    gridExtent, gridConfig, gridPxW, gridPxH,
    mpdOptions, isNodeLevelMpd, nodeDialIds,
    storeGetModel, switchNodeMpd, switchFrameMpd,
  } = deps

  const [mpdCurtain, setMpdCurtain] = useState<MpdCurtainState | null>(null)
  const curtainRaf = useRef<number>(0)
  const particleContainerRef = useRef<HTMLDivElement>(null)
  const liveNodeSizesRef = useRef<Map<string, { w: number; h: number }>>(new Map())

  const handleMpdSelect = useCallback((idx: number, direction: 'left' | 'right') => {
    if (!mpdOptions) return
    const newModelId = mpdOptions[idx].id

    // --- Node-level: switch MPD with curtain animation ---
    if (isNodeLevelMpd) {
      // First entry (default) = restore original model
      const isDefault = idx === 0
      const targetId = isDefault && frameNodeMpdOriginalModelId
        ? frameNodeMpdOriginalModelId
        : newModelId
      // Skip if already showing this model
      if (targetId === frameModelId) return

      // Compute pan offset to keep twin node anchored at same screen position
      let alignPan: { x: number; y: number } | undefined
      if (frameSelectedNodeId) {
        const oldNode = model.nodes.find((n) => n.id === frameSelectedNodeId)
        const newModel = storeGetModel(targetId)
        const twinNode = newModel?.nodes.find((n) => n.id === frameSelectedNodeId)
        if (oldNode && twinNode) {
          const cs = effectiveScale
          const np = frameSnapshotNodeProgress
          const dx = (twinNode.x - oldNode.x) / 100 * SCENE_W * cs * (np - 1)
          const dy = (twinNode.y - oldNode.y) / 100 * SCENE_H * cs * (np - 1)
          alignPan = {
            x: framePanOffset.x + dx,
            y: framePanOffset.y + dy,
          }
        }
      }

      const oldModel = model
      const oldStyle = { ...sceneStyle }
      const oldBgSt = bgStyle ? { ...bgStyle } : undefined
      const oldBgCfg = bgConfig ? { ...bgConfig } : undefined
      const oldSizes = new Map(liveNodeSizesRef.current)
      const oldGE = { ...gridExtent }
      const oldGBG = gridBackgroundImage(gridConfig)
      const oldGPW = gridPxW
      const oldGPH = gridPxH
      let pScreenshot: string | null = null
      const pCanvas = particleContainerRef.current?.querySelector('canvas')
      if (pCanvas) { try { pScreenshot = pCanvas.toDataURL() } catch (_) { /* tainted canvas */ } }
      cancelAnimationFrame(curtainRaf.current)
      flushSync(() => {
        setMpdCurtain({ oldModel, oldSceneStyle: oldStyle, oldBgStyle: oldBgSt, oldBgConfig: oldBgCfg, particleScreenshot: pScreenshot, oldNodeSizes: oldSizes, oldGridExtent: oldGE, oldGridBgImage: oldGBG, oldGridPxW: oldGPW, oldGridPxH: oldGPH, progress: 0, direction })
      })
      switchNodeMpd(targetId, nodeDialIds!, alignPan)
      const startTime = performance.now()
      const animate = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / 500, 1)
        const eased = t * t * (3 - 2 * t)
        setMpdCurtain((prev) => prev ? { ...prev, progress: eased } : null)
        if (t < 1) {
          curtainRaf.current = requestAnimationFrame(animate)
        } else {
          setMpdCurtain(null)
        }
      }
      curtainRaf.current = requestAnimationFrame(animate)
      return
    }

    // --- Frame-level: switch the whole view with curtain animation ---
    if (newModelId === frameModelId) return

    // Compute pan offset to align twin nodes across dimensions
    let alignPan: { x: number; y: number } = { x: 0, y: 0 }
    if (frameSelectedNodeId) {
      const oldNode = model.nodes.find((n) => n.id === frameSelectedNodeId)
      const newModel = storeGetModel(newModelId)
      const twinNode = newModel?.nodes.find((n) => n.id === frameSelectedNodeId)
      if (oldNode && twinNode) {
        const cs = effectiveScale
        const np = frameSnapshotNodeProgress
        let cx = 0, cy = 0
        if (selectedNode) {
          cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * cs
          cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * cs
        }
        const oldScreenX = cx + framePanOffset.x + (oldNode.x / 100 * SCENE_W - vpSize.w / 2) * cs
        const oldScreenY = cy + framePanOffset.y + (oldNode.y / 100 * SCENE_H - vpSize.h / 2) * cs
        alignPan = {
          x: oldScreenX - (twinNode.x / 100 * SCENE_W - vpSize.w / 2),
          y: oldScreenY - (twinNode.y / 100 * SCENE_H - vpSize.h / 2),
        }
      }
    }

    // Capture current state for curtain
    const oldModel = model
    const oldStyle = { ...sceneStyle }
    const oldBgSt = bgStyle ? { ...bgStyle } : undefined
    const oldBgCfg = bgConfig ? { ...bgConfig } : undefined
    const oldSizes = new Map(liveNodeSizesRef.current)
    const oldGE = { ...gridExtent }
    const oldGBG = gridBackgroundImage(gridConfig)
    const oldGPW = gridPxW
    const oldGPH = gridPxH
    let pScreenshot: string | null = null
    const pCanvas = particleContainerRef.current?.querySelector('canvas')
    if (pCanvas) { try { pScreenshot = pCanvas.toDataURL() } catch (_) { /* tainted canvas */ } }
    cancelAnimationFrame(curtainRaf.current)
    flushSync(() => {
      setMpdCurtain({ oldModel, oldSceneStyle: oldStyle, oldBgStyle: oldBgSt, oldBgConfig: oldBgCfg, particleScreenshot: pScreenshot, oldNodeSizes: oldSizes, oldGridExtent: oldGE, oldGridBgImage: oldGBG, oldGridPxW: oldGPW, oldGridPxH: oldGPH, progress: 0, direction })
    })
    switchFrameMpd(newModelId, alignPan)
    const startTime = performance.now()
    const animate = () => {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / 500, 1)
      const eased = t * t * (3 - 2 * t) // smoothstep
      setMpdCurtain((prev) => prev ? { ...prev, progress: eased } : null)
      if (t < 1) {
        curtainRaf.current = requestAnimationFrame(animate)
      } else {
        setMpdCurtain(null)
      }
    }
    curtainRaf.current = requestAnimationFrame(animate)
  }, [model, frameModelId, frameSelectedNodeId, frameNodeMpdOriginalModelId,
    framePanOffset, frameSnapshotNodeProgress, effectiveScale, selectedNode, vpSize,
    sceneStyle, bgStyle, bgConfig, gridExtent, gridConfig, gridPxW, gridPxH,
    mpdOptions, isNodeLevelMpd, nodeDialIds, storeGetModel, switchNodeMpd, switchFrameMpd])

  return {
    mpdCurtain,
    particleContainerRef,
    liveNodeSizesRef,
    handleMpdSelect,
  }
}
