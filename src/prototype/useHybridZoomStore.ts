import { create } from 'zustand'
import {
  applyZoomStep,
  createInitialSnapshot,
  realignPanOffset,
  type HybridZoomSnapshot,
} from './hybridZoom'

interface PanOffset {
  x: number
  y: number
}

interface HybridZoomState {
  selectedNodeId: string | null
  snapshot: HybridZoomSnapshot
  isDragging: boolean
  isPaused: boolean
  panOffset: PanOffset
  selectNode: (nodeId: string) => void
  clearSelection: () => void
  zoomIn: () => void
  zoomOut: () => void
  pause: () => void
  beginDrag: () => void
  endDrag: () => void
  panBy: (dx: number, dy: number) => void
}

const initialSnapshot = createInitialSnapshot()

export const useHybridZoomStore = create<HybridZoomState>((set) => ({
  selectedNodeId: 'node-alpha',
  snapshot: initialSnapshot,
  isDragging: false,
  isPaused: false,
  panOffset: { x: 0, y: 0 },
  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId })
  },
  clearSelection: () => {
    set({ selectedNodeId: null, isPaused: true })
  },
  zoomIn: () => {
    set((state) => {
      if (!state.selectedNodeId) {
        return state
      }
      return {
        snapshot: applyZoomStep(state.snapshot, 'in'),
        panOffset: realignPanOffset(state.panOffset),
        isPaused: false,
      }
    })
  },
  zoomOut: () => {
    set((state) => ({
      snapshot: applyZoomStep(state.snapshot, 'out'),
      isPaused: false,
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
      if (!state.isDragging) {
        return state
      }
      return {
        panOffset: {
          x: state.panOffset.x + dx,
          y: state.panOffset.y + dy,
        },
      }
    })
  },
}))
