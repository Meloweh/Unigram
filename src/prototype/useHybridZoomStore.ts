import { create } from 'zustand'
import {
  applyZoomStep,
  buildSnapshot,
  createInitialSnapshot,
  realignPanOffset,
  type HybridZoomSnapshot,
} from './hybridZoom'
import { getInitialModels, type Model, type ModelConnection, type ModelNode } from './sampleModels'

/** Grid size in percentage units (40px at 1000px viewport ≈ 4%) */
export const GRID_SNAP = 4

/** Snap a percentage coordinate to the nearest grid point */
export function snapToGrid(val: number): number {
  return Math.round(val / GRID_SNAP) * GRID_SNAP
}

interface PanOffset {
  x: number
  y: number
}

/** One level of the recursive zoom stack */
export interface ZoomStackFrame {
  modelId: string
  /** The node that was zoomed into to reach this level (null for root) */
  entryNodeId: string | null
  /** MPD options inherited from the entry node (if any) */
  mpdIds?: string[]
  snapshot: HybridZoomSnapshot
  selectedNodeId: string | null
  panOffset: PanOffset
}

export type UnzipLevel = 1 | 2 | 3

export interface UnzipPopupState {
  /** Connection key "from->to" */
  connectionKey: string
  level: UnzipLevel
  /** Anchor position in scene-percentage coords */
  anchorX: number
  anchorY: number
}

interface HybridZoomState {
  models: Record<string, Model>
  undoStacks: Record<string, Model[]>
  redoStacks: Record<string, Model[]>
  stack: ZoomStackFrame[]
  isDragging: boolean
  isPaused: boolean
  unzipPopup: UnzipPopupState | null

  // Derived convenience (always reflects top of stack)
  currentFrame: () => ZoomStackFrame
  /** Get a model by ID from the mutable store */
  getModel: (id: string) => Model | undefined

  selectNode: (nodeId: string, centeringResidual?: { x: number; y: number }) => void
  clearSelection: () => void
  zoomIn: () => void
  zoomOut: () => void
  /** Push into a child model when handoff completes */
  pushModel: (childModelId: string, entryNodeId: string) => void
  pause: () => void
  beginDrag: () => void
  endDrag: () => void
  panBy: (dx: number, dy: number) => void

  openUnzip: (connectionKey: string, anchorX: number, anchorY: number) => void
  closeUnzip: () => void
  unzipDeeper: () => void
  unzipShallower: () => void

  // Editing actions
  moveNode: (modelId: string, nodeId: string, x: number, y: number) => void
  /** Snapshot current state for undo before a drag sequence */
  beginMoveNode: (modelId: string) => void
  addNode: (modelId: string, node: ModelNode) => void
  updateNodeLabel: (modelId: string, nodeId: string, label: string) => void
  removeNode: (modelId: string, nodeId: string) => void
  addConnection: (modelId: string, connection: ModelConnection) => void
  removeConnection: (modelId: string, from: string, to: string) => void
  undo: (modelId: string) => void
  redo: (modelId: string) => void
  /** Switch the current frame's model to an alternative MPD dimension */
  switchFrameMpd: (newModelId: string, initialPanOffset?: { x: number; y: number }) => void
}

const MAX_UNDO = 50

function makeRootFrame(): ZoomStackFrame {
  return {
    modelId: 'root',
    entryNodeId: null,
    snapshot: createInitialSnapshot(),
    selectedNodeId: null,
    panOffset: { x: 0, y: 0 },
  }
}

function updateTopFrame(
  stack: ZoomStackFrame[],
  updater: (frame: ZoomStackFrame) => Partial<ZoomStackFrame>,
): ZoomStackFrame[] {
  const newStack = [...stack]
  const top = { ...newStack[newStack.length - 1] }
  Object.assign(top, updater(top))
  newStack[newStack.length - 1] = top
  return newStack
}

export const useHybridZoomStore = create<HybridZoomState>((set, get) => {
  /** Push current model snapshot onto undo stack (clears redo) */
  function pushUndo(state: HybridZoomState, modelId: string): Pick<HybridZoomState, 'undoStacks' | 'redoStacks'> {
    const model = state.models[modelId]
    if (!model) return { undoStacks: state.undoStacks, redoStacks: state.redoStacks }
    const prev = state.undoStacks[modelId] ?? []
    return {
      undoStacks: {
        ...state.undoStacks,
        [modelId]: [...prev.slice(-(MAX_UNDO - 1)), JSON.parse(JSON.stringify(model))],
      },
      redoStacks: { ...state.redoStacks, [modelId]: [] },
    }
  }

  return {
  models: getInitialModels(),
  undoStacks: {},
  redoStacks: {},
  stack: [makeRootFrame()],
  isDragging: false,
  isPaused: false,
  unzipPopup: null,

  currentFrame: () => {
    const { stack } = get()
    return stack[stack.length - 1]
  },

  getModel: (id: string) => get().models[id],

  selectNode: (nodeId, centeringResidual) => {
    set((state) => ({
      unzipPopup: null,
      stack: updateTopFrame(state.stack, (frame) => ({
        selectedNodeId: nodeId,
        snapshot: buildSnapshot(frame.snapshot.progress, 0),
        panOffset: centeringResidual
          ? { x: frame.panOffset.x + centeringResidual.x, y: frame.panOffset.y + centeringResidual.y }
          : frame.panOffset,
      })),
    }))
  },

  clearSelection: () => {
    set((state) => ({
      stack: updateTopFrame(state.stack, () => ({ selectedNodeId: null })),
      isPaused: true,
    }))
  },

  zoomIn: () => {
    set((state) => {
      const top = state.stack[state.stack.length - 1]
      if (!top.selectedNodeId) return state
      return {
        unzipPopup: null,
        stack: updateTopFrame(state.stack, (frame) => ({
          snapshot: applyZoomStep(frame.snapshot, 'in'),
          panOffset: realignPanOffset(frame.panOffset),
        })),
        isPaused: false,
      }
    })
  },

  zoomOut: () => {
    set((state) => {
      const top = state.stack[state.stack.length - 1]
      // If at bottom of current level and there's a parent, pop the stack
      if (top.snapshot.progress <= 0 && state.stack.length > 1) {
        const newStack = [...state.stack]
        newStack.pop()
        // Set parent frame to progress=1 (just came back from child)
        // then apply one zoom-out step so it starts animating back
        return {
          stack: updateTopFrame(newStack, (frame) => ({
            snapshot: applyZoomStep(frame.snapshot, 'out'),
          })),
          isPaused: false,
        }
      }
      return {
        stack: updateTopFrame(state.stack, (frame) => ({
          snapshot: applyZoomStep(frame.snapshot, 'out'),
        })),
        isPaused: false,
      }
    })
  },

  pushModel: (childModelId, entryNodeId) => {
    set((state) => {
      const currentModel = state.models[state.stack[state.stack.length - 1].modelId]
      const entryNode = currentModel?.nodes.find((n) => n.id === entryNodeId)
      return {
        stack: [
          ...state.stack,
          {
            modelId: childModelId,
            entryNodeId,
            mpdIds: entryNode?.mpdIds,
            snapshot: createInitialSnapshot(),
            selectedNodeId: null,
            panOffset: { x: 0, y: 0 },
          },
        ],
        isPaused: true,
      }
    })
  },

  pause: () => {
    set({ isPaused: true })
  },
  beginDrag: () => {
    set({ isDragging: true })
  },
  endDrag: () => {
    set({ isDragging: false })
  },
  panBy: (dx, dy) => {
    set((state) => {
      if (!state.isDragging) return state
      return {
        stack: updateTopFrame(state.stack, (frame) => ({
          panOffset: {
            x: frame.panOffset.x + dx,
            y: frame.panOffset.y + dy,
          },
        })),
      }
    })
  },

  openUnzip: (connectionKey, anchorX, anchorY) => {
    set({ unzipPopup: { connectionKey, level: 1, anchorX, anchorY } })
  },

  closeUnzip: () => {
    set({ unzipPopup: null })
  },

  unzipDeeper: () => {
    set((state) => {
      if (!state.unzipPopup || state.unzipPopup.level >= 3) return state
      return {
        unzipPopup: { ...state.unzipPopup, level: (state.unzipPopup.level + 1) as UnzipLevel },
      }
    })
  },

  unzipShallower: () => {
    set((state) => {
      if (!state.unzipPopup) return state
      if (state.unzipPopup.level <= 1) return { unzipPopup: null }
      return {
        unzipPopup: { ...state.unzipPopup, level: (state.unzipPopup.level - 1) as UnzipLevel },
      }
    })
  },

  // ---- Editing actions ----

  moveNode: (modelId, nodeId, x, y) => {
    // No undo push here — beginMoveNode snapshots before drag starts
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            nodes: model.nodes.map((n) =>
              n.id === nodeId ? { ...n, x: snapToGrid(x), y: snapToGrid(y) } : n,
            ),
          },
        },
      }
    })
  },

  beginMoveNode: (modelId) => {
    set((state) => pushUndo(state, modelId))
  },

  addNode: (modelId, node) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            nodes: [...model.nodes, { ...node, x: snapToGrid(node.x), y: snapToGrid(node.y) }],
          },
        },
      }
    })
  },

  updateNodeLabel: (modelId, nodeId, label) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            nodes: model.nodes.map((n) =>
              n.id === nodeId ? { ...n, label } : n,
            ),
          },
        },
      }
    })
  },

  removeNode: (modelId, nodeId) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            nodes: model.nodes.filter((n) => n.id !== nodeId),
            connections: model.connections.filter(
              (c) => c.from !== nodeId && c.to !== nodeId,
            ),
          },
        },
        stack: updateTopFrame(state.stack, (frame) =>
          frame.selectedNodeId === nodeId ? { selectedNodeId: null } : {},
        ),
      }
    })
  },

  addConnection: (modelId, connection) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      const exists = model.connections.some(
        (c) => c.from === connection.from && c.to === connection.to,
      )
      if (exists) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            connections: [...model.connections, connection],
          },
        },
      }
    })
  },

  removeConnection: (modelId, from, to) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            connections: model.connections.filter(
              (c) => !(c.from === from && c.to === to),
            ),
          },
        },
      }
    })
  },

  undo: (modelId) => {
    set((state) => {
      const stack = state.undoStacks[modelId]
      if (!stack?.length) return state
      const prev = stack[stack.length - 1]
      const current = state.models[modelId]
      return {
        models: { ...state.models, [modelId]: prev },
        undoStacks: { ...state.undoStacks, [modelId]: stack.slice(0, -1) },
        redoStacks: {
          ...state.redoStacks,
          [modelId]: [...(state.redoStacks[modelId] ?? []), JSON.parse(JSON.stringify(current))],
        },
      }
    })
  },

  redo: (modelId) => {
    set((state) => {
      const stack = state.redoStacks[modelId]
      if (!stack?.length) return state
      const next = stack[stack.length - 1]
      const current = state.models[modelId]
      return {
        models: { ...state.models, [modelId]: next },
        redoStacks: { ...state.redoStacks, [modelId]: stack.slice(0, -1) },
        undoStacks: {
          ...state.undoStacks,
          [modelId]: [...(state.undoStacks[modelId] ?? []), JSON.parse(JSON.stringify(current))],
        },
      }
    })
  },

  switchFrameMpd: (newModelId, initialPanOffset) => {
    set((state) => {
      const frame = state.stack[state.stack.length - 1]
      if (!frame.mpdIds?.includes(newModelId)) return state
      if (frame.modelId === newModelId) return state
      return {
        stack: updateTopFrame(state.stack, () => ({
          modelId: newModelId,
          selectedNodeId: null,
          panOffset: initialPanOffset ?? { x: 0, y: 0 },
          snapshot: createInitialSnapshot(),
        })),
        unzipPopup: null,
      }
    })
  },
}
})

