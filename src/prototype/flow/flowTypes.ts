import type { MutableRefObject, Dispatch, SetStateAction, RefObject } from 'react'
import type { Model, ModelNode, ModelConnection, EffectGraphNode } from '../model/sampleModels'

export type FlowTask =
  | { id: string; kind: 'node'; nodeId: string; durationMs: number; dependsOn: string[]; startTime: number }
  | { id: string; kind: 'wire'; connectionKey: string; durationMs: number; dependsOn: string[]; startTime: number }

export type FlowDAG = {
  tasks: Map<string, FlowTask>
  activeTasks: Set<string>
  completedTasks: Set<string>
  untrackedPaths: Set<string>
}

export interface FlowCameraOverride {
  panX: number; panY: number; zoom: number; rotation: number
  durationMs: number; startTime: number
  panXDurationMs: number; panYDurationMs: number; zoomDurationMs: number; rotationDurationMs: number
  panXResetMode: string; panYResetMode: string; zoomResetMode: string; rotationResetMode: string
  panXEasing: string; panYEasing: string; zoomEasing: string; rotationEasing: string
  startPan: { x: number; y: number }; startFreeScale: number
}

export interface FlowCameraFadeout {
  rotation: number; freeScaleOffset: number; startFreeScale: number
}

export interface TextFormatOrigStyles {
  fontWeight: string; fontStyle: string; textDecoration: string; color: string; fontSize: string; transition: string
}

export interface WrapperOrigStyles {
  width: string; minWidth: string; height: string; minHeight: string; transition: string
}

/** Mutable state bag for flow cleanup — shared between all flow functions */
export interface FlowCleanupState {
  colorBackups: { el: HTMLElement; bg: string }[]
  brokenElements: HTMLElement[]
  emergeHidden: HTMLElement[]
  scaleTimers: number[]
  textFormatTimers: number[]
  textFormatBackups: { el: HTMLElement; orig: TextFormatOrigStyles }[]
  wrapperBackups: { el: HTMLElement; orig: WrapperOrigStyles }[]
  keepPlayingAnims: { rafId: number; cleanup: () => void }[]
  levitateAnims: { rafId: number; cleanup: () => void }[]
  effectTimers: number[]
  mediaDone: Set<string>
}

/** Context passed to effect handler functions */
export interface FlowEffectCtx {
  nodeId: string
  node: ModelNode
  model: Model
  frameModelId: string
  scheduleEffect: (fn: () => void, ms: number) => number
  cleanup: FlowCleanupState
  // Media
  triggerMediaPlay: (nodeId: string) => void
  audioCtxCache: WeakMap<HTMLMediaElement, { ctx: AudioContext; analyser: AnalyserNode }>
  // Camera
  flowCameraOverrideRef: MutableRefObject<FlowCameraOverride | null>
  flowCameraFadeoutRef: MutableRefObject<FlowCameraFadeout | null>
  panOffsetRef: RefObject<{ x: number; y: number }>
  freeScaleRef: RefObject<number>
  // Setters
  setShakeOffset: (o: { x: number; y: number }) => void
  setEmergeAnimations: Dispatch<SetStateAction<Map<string, number>>>
  setForceCollapseSidebars: (v: boolean) => void
  setHideToolbar: (v: boolean) => void
  // Store actions
  updateNodeProps: (modelId: string, nodeId: string, props: Partial<ModelNode>) => void
  addNode: (modelId: string, node: Partial<ModelNode>) => void
  addConnection: (modelId: string, conn: Partial<ModelConnection>) => void
  selectNode: (nodeId: string) => void
  currentFrame: () => { modelId: string; selectedNodeId: string | null; snapshot: { progress: number; cameraScale: number } }
  zoomIn: () => void
  zoomOut: () => void
  switchNodeMpd: (targetId: string, mpdIds: string[]) => void
  switchFrameMpd: (targetId: string) => void
  stack: Array<{ modelId: string }>
  // Recording
  flowRecorderRef: MutableRefObject<MediaRecorder | null>
  flowRecordChunksRef: MutableRefObject<BlobPart[]>
  flowRecordStreamRef: MutableRefObject<MediaStream | null>
  viewportRef: RefObject<HTMLDivElement | null>
  // Recursive call
  startFlowAnimationRef: RefObject<(nodeId: string) => void>
}

export function createCleanupState(): FlowCleanupState {
  return {
    colorBackups: [],
    brokenElements: [],
    emergeHidden: [],
    scaleTimers: [],
    textFormatTimers: [],
    textFormatBackups: [],
    wrapperBackups: [],
    keepPlayingAnims: [],
    levitateAnims: [],
    effectTimers: [],
    mediaDone: new Set(),
  }
}
