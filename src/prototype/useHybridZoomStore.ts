import { create } from 'zustand'
import {
  applyZoomStep,
  buildSnapshot,
  createInitialSnapshot,
  realignPanOffset,
  type HybridZoomSnapshot,
} from './hybridZoom'

interface PanOffset {
  x: number
  y: number
}

/** One level of the recursive zoom stack */
export interface ZoomStackFrame {
  modelId: string
  /** The node that was zoomed into to reach this level (null for root) */
  entryNodeId: string | null
  snapshot: HybridZoomSnapshot
  selectedNodeId: string | null
  panOffset: PanOffset
}

interface HybridZoomState {
  stack: ZoomStackFrame[]
  isDragging: boolean
  isPaused: boolean

  // Derived convenience (always reflects top of stack)
  currentFrame: () => ZoomStackFrame

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
}

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

export const useHybridZoomStore = create<HybridZoomState>((set, get) => ({
  stack: [makeRootFrame()],
  isDragging: false,
  isPaused: false,

  currentFrame: () => {
    const { stack } = get()
    return stack[stack.length - 1]
  },

  selectNode: (nodeId, centeringResidual) => {
    set((state) => ({
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
    set((state) => ({
      stack: [
        ...state.stack,
        {
          modelId: childModelId,
          entryNodeId,
          snapshot: createInitialSnapshot(),
          selectedNodeId: null,
          panOffset: { x: 0, y: 0 },
        },
      ],
      isPaused: true,
    }))
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
}))
