import { create } from 'zustand'
import {
  applyZoomStep,
  buildSnapshot,
  createInitialSnapshot,
  realignPanOffset,
  type HybridZoomSnapshot,
} from './hybridZoom'
import { getInitialModels, type Model, type ModelConnection, type ModelNode, type NodeShape, type ConnectionType, type ThemeMode, type ModelCosmetics } from './sampleModels'
import { applyThemeToDOM, getTopicalPreset, resolvePalette } from './themes'

/** Default grid size in percentage units (40px at 1000px viewport ≈ 4%) */
export const DEFAULT_GRID_SNAP = 4

/** Snap a percentage coordinate to the nearest grid point */
export function snapToGrid(val: number, gridSnap = DEFAULT_GRID_SNAP): number {
  return Math.round(val / gridSnap) * gridSnap
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
  /** Independent camera zoom multiplier (Google Maps-style, default 1) */
  freeScale: number
  /** The child model ID that was actually displayed (may differ from node.childModelId after MPD switch) */
  lastChildModelId?: string
  /** Original modelId before a node-level MPD switch (so we can switch back) */
  nodeMpdOriginalModelId?: string
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
  gridSnap: number

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
  /** Adjust the independent camera zoom (Google Maps-style).
   *  delta > 0 zooms in, delta < 0 zooms out. */
  adjustFreeScale: (delta: number) => void
  /** Set freeScale to an exact value on the current frame */
  setFreeScale: (value: number) => void
  /** Set panOffset to an exact value on the current frame */
  setPanOffset: (x: number, y: number) => void

  openUnzip: (connectionKey: string, anchorX: number, anchorY: number) => void
  closeUnzip: () => void
  unzipDeeper: () => void
  unzipShallower: () => void

  // Editing actions
  moveNode: (modelId: string, nodeId: string, x: number, y: number) => void
  /** Move multiple nodes in a single state update (for animation batching) */
  moveNodes: (modelId: string, moves: { nodeId: string; x: number; y: number }[]) => void
  /** Snapshot current state for undo before a drag sequence */
  beginMoveNode: (modelId: string) => void
  /** Snapshot current state for undo before an edit sequence */
  beginEditNode: (modelId: string) => void
  addNode: (modelId: string, node: ModelNode) => void
  updateNodeLabel: (modelId: string, nodeId: string, label: string) => void
  updateNodeShape: (modelId: string, nodeId: string, shape: NodeShape) => void
  /** Update arbitrary visual properties on a node (with undo) */
  updateNodeProps: (modelId: string, nodeId: string, props: Partial<ModelNode>) => void
  /** Update label without pushing undo (used during live editing after beginEditNode) */
  setNodeLabelSilent: (modelId: string, nodeId: string, label: string) => void
  removeNode: (modelId: string, nodeId: string) => void
  addConnection: (modelId: string, connection: ModelConnection) => void
  removeConnection: (modelId: string, from: string, to: string) => void
  updateConnectionType: (modelId: string, from: string, to: string, type: ConnectionType) => void
  /** Update arbitrary properties on a connection */
  updateConnectionProps: (modelId: string, from: string, to: string, props: Partial<ModelConnection>) => void
  undo: (modelId: string) => void
  redo: (modelId: string) => void
  /** Clear lastChildModelId on the current frame (used when node-level MPD dial switches) */
  clearLastChildModelId: () => void
  /** Set lastChildModelId on the current frame (node-level dial perspective pick) */
  setLastChildModelId: (modelId: string) => void
  /** Switch the current frame's model to an alternative MPD dimension */
  switchFrameMpd: (newModelId: string, initialPanOffset?: { x: number; y: number }) => void
  /** Switch the current frame to a node-level MPD (keeps original modelId for switching back) */
  switchNodeMpd: (newModelId: string, mpdIds: string[], initialPanOffset?: { x: number; y: number }) => void
  /** Register a dynamically loaded model into the store */
  registerModel: (model: Model) => void
  /** Update a model's label */
  updateModelLabel: (modelId: string, label: string) => void
  /** Reset zoom stack to root (e.g. after loading a project file) */
  resetToRoot: () => void
  /** Update grid snap size */
  setGridSnap: (size: number) => void
  /** Update evidence on a connection */
  updateConnectionEvidence: (modelId: string, from: string, to: string, evidence: import('./sampleModels').StudyEvidence[]) => void

  // ---- Cosmetic / theme state (outside undo) ----
  appThemeMode: ThemeMode
  modelCosmetics: Record<string, ModelCosmetics>
  setAppThemeMode: (mode: ThemeMode) => void
  setModelCosmetics: (modelId: string, cosmetics: Partial<ModelCosmetics>) => void

  // ---- Label selection tracking (for text formatting sidebar) ----
  labelSelection: { start: number; end: number } | null
  setLabelSelection: (sel: { start: number; end: number } | null) => void
}

const MAX_UNDO = 50

function makeRootFrame(): ZoomStackFrame {
  return {
    modelId: 'root',
    entryNodeId: null,
    snapshot: createInitialSnapshot(),
    selectedNodeId: null,
    panOffset: { x: 0, y: 0 },
    freeScale: 1,
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
  gridSnap: DEFAULT_GRID_SNAP,

  // Cosmetics — not part of undo
  appThemeMode: 'light' as ThemeMode,
  modelCosmetics: {} as Record<string, ModelCosmetics>,

  // Label selection — not part of undo
  labelSelection: null as { start: number; end: number } | null,

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
        lastChildModelId: undefined,
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
      // Only allow zoom if the selected node has a child model to zoom into
      const model = state.models[top.modelId]
      const node = model?.nodes.find((n) => n.id === top.selectedNodeId)
      if (!node?.childModelId) return state
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
        const childModelId = top.modelId
        const newStack = [...state.stack]
        newStack.pop()
        // Set parent frame to progress=1 (just came back from child)
        // then apply one zoom-out step so it starts animating back
        return {
          stack: updateTopFrame(newStack, (frame) => ({
            snapshot: applyZoomStep(frame.snapshot, 'out'),
            lastChildModelId: childModelId,
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
      // Guard: don't push if the top frame already targets this child (e.g. StrictMode double-fire)
      const top = state.stack[state.stack.length - 1]
      if (top.modelId === childModelId && top.entryNodeId === entryNodeId) return state

      return {
        stack: [
          ...state.stack,
          {
            modelId: childModelId,
            entryNodeId,
            snapshot: createInitialSnapshot(),
            selectedNodeId: null,
            panOffset: { x: 0, y: 0 },
            freeScale: 1,
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

  adjustFreeScale: (delta) => {
    set((state) => ({
      stack: updateTopFrame(state.stack, (frame) => {
        const factor = delta > 0 ? 1.08 : 1 / 1.08
        const next = Math.min(5, Math.max(0.2, frame.freeScale * factor))
        return { freeScale: next }
      }),
    }))
  },

  setFreeScale: (value) => {
    set((state) => ({
      stack: updateTopFrame(state.stack, () => ({ freeScale: value })),
    }))
  },

  setPanOffset: (x, y) => {
    set((state) => ({
      stack: updateTopFrame(state.stack, () => ({ panOffset: { x, y } })),
    }))
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
              n.id === nodeId ? { ...n, x: snapToGrid(x, state.gridSnap), y: snapToGrid(y, state.gridSnap) } : n,
            ),
          },
        },
      }
    })
  },

  moveNodes: (modelId, moves) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      const lookup = new Map(moves.map(m => [m.nodeId, m]))
      return {
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            nodes: model.nodes.map((n) => {
              const m = lookup.get(n.id)
              return m ? { ...n, x: snapToGrid(m.x, state.gridSnap), y: snapToGrid(m.y, state.gridSnap) } : n
            }),
          },
        },
      }
    })
  },

  beginMoveNode: (modelId) => {
    set((state) => pushUndo(state, modelId))
  },

  beginEditNode: (modelId) => {
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
            nodes: [...model.nodes, { ...node, x: snapToGrid(node.x, state.gridSnap), y: snapToGrid(node.y, state.gridSnap) }],
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

  updateNodeShape: (modelId, nodeId, shape) => {
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
              n.id === nodeId ? { ...n, shape } : n,
            ),
          },
        },
      }
    })
  },

  updateNodeProps: (modelId, nodeId, props) => {
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
              n.id === nodeId ? { ...n, ...props } : n,
            ),
          },
        },
      }
    })
  },

  setNodeLabelSilent: (modelId, nodeId, label) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
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

  updateConnectionType: (modelId, from, to, type) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      const conn = model.connections.find(c => c.from === from && c.to === to)
      if (!conn) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            connections: model.connections.map(c =>
              c.from === from && c.to === to
                ? { ...c, type: type === 'default' ? undefined : type }
                : c,
            ),
          },
        },
      }
    })
  },

  updateConnectionProps: (modelId, from, to, props) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      const conn = model.connections.find(c => c.from === from && c.to === to)
      if (!conn) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            connections: model.connections.map(c =>
              c.from === from && c.to === to
                ? { ...c, ...props }
                : c,
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

  clearLastChildModelId: () => {
    set((state) => ({
      stack: updateTopFrame(state.stack, () => ({ lastChildModelId: undefined })),
    }))
  },

  setLastChildModelId: (modelId) => {
    set((state) => ({
      stack: updateTopFrame(state.stack, () => ({ lastChildModelId: modelId })),
    }))
  },

  switchFrameMpd: (newModelId, initialPanOffset) => {
    set((state) => {
      const frame = state.stack[state.stack.length - 1]
      if (frame.modelId === newModelId) return state
      // Derive live mpdIds from the parent frame's entry node (MPDs only, not RMM)
      let liveMpdIds: string[] | undefined = undefined
      if (state.stack.length >= 2 && frame.entryNodeId) {
        const parentFrame = state.stack[state.stack.length - 2]
        const parentModel = state.models[parentFrame.modelId]
        const entryNode = parentModel?.nodes.find((n) => n.id === frame.entryNodeId)
        if (entryNode?.mpdIds && entryNode.mpdIds.length > 1) {
          liveMpdIds = entryNode.mpdIds
        }
      }
      if (!liveMpdIds?.includes(newModelId)) return state
      // Preserve selection if a twin node exists in the new model
      const newModel = state.models[newModelId]
      const keepSelection = frame.selectedNodeId && newModel?.nodes.some((n) => n.id === frame.selectedNodeId)
        ? frame.selectedNodeId
        : null
      return {
        stack: updateTopFrame(state.stack, () => ({
          modelId: newModelId,
          selectedNodeId: keepSelection,
          panOffset: initialPanOffset ?? { x: 0, y: 0 },
          snapshot: createInitialSnapshot(),
        })),
        unzipPopup: null,
      }
    })
  },

  switchNodeMpd: (newModelId, mpdIds, initialPanOffset) => {
    set((state) => {
      const frame = state.stack[state.stack.length - 1]
      if (frame.modelId === newModelId) return state
      const originalModelId = frame.nodeMpdOriginalModelId ?? frame.modelId
      // Allow switching to any mpdId or back to the original model
      if (newModelId !== originalModelId && !mpdIds.includes(newModelId)) return state
      return {
        stack: updateTopFrame(state.stack, () => ({
          modelId: newModelId,
          nodeMpdOriginalModelId: newModelId === originalModelId ? undefined : originalModelId,
          selectedNodeId: frame.selectedNodeId,
          panOffset: initialPanOffset ?? frame.panOffset,
          snapshot: frame.snapshot,
        })),
        unzipPopup: null,
      }
    })
  },

  registerModel: (model) => {
    set((state) => ({
      models: { ...state.models, [model.id]: model },
    }))
  },

  updateModelLabel: (modelId, label) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
        models: { ...state.models, [modelId]: { ...model, label } },
      }
    })
  },

  resetToRoot: () => {
    set({
      stack: [makeRootFrame()],
      undoStacks: {},
      redoStacks: {},
      unzipPopup: null,
      isPaused: true,
    })
  },

  setGridSnap: (size) => {
    set({ gridSnap: size })
  },

  updateConnectionEvidence: (modelId, from, to, evidence) => {
    set((state) => {
      const model = state.models[modelId]
      if (!model) return state
      return {
        ...pushUndo(state, modelId),
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            connections: model.connections.map((c) =>
              c.from === from && c.to === to
                ? { ...c, evidence: evidence.length > 0 ? evidence : undefined }
                : c,
            ),
          },
        },
      }
    })
  },

  setAppThemeMode: (mode) => {
    set({ appThemeMode: mode })
    applyThemeToDOM(resolvePalette(mode))
    // Auto-apply topical theme cosmetics to the current model
    const topical = getTopicalPreset(mode)
    if (topical) {
      const modelId = get().currentFrame().modelId
      set((state) => ({
        modelCosmetics: {
          ...state.modelCosmetics,
          [modelId]: {
            ...state.modelCosmetics[modelId],
            background: topical.background,
            particleEffect: topical.particlePreset,
            grid: topical.grid,
          },
        },
      }))
    }
  },

  setModelCosmetics: (modelId, cosmetics) => {
    set((state) => ({
      modelCosmetics: {
        ...state.modelCosmetics,
        [modelId]: { ...state.modelCosmetics[modelId], ...cosmetics },
      },
    }))
  },

  setLabelSelection: (sel) => {
    set({ labelSelection: sel })
  },
}
})

