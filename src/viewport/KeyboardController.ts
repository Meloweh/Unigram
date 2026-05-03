/**
 * KeyboardController — Delete/Backspace remove selected entities,
 * Ctrl+Z/Ctrl+Shift+Z (or Ctrl+Y) drive undo/redo. Listens on `window` so the
 * canvas does not need focus.
 */

import { useOmniStore } from '../model/store'

export class KeyboardController {
  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) useOmniStore.getState().redo()
      else useOmniStore.getState().undo()
      return
    }
    if (ctrl && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault()
      useOmniStore.getState().redo()
      return
    }
    if (ctrl && (e.key === 'c' || e.key === 'C')) {
      const s = useOmniStore.getState()
      if (s.selectedIds.size === 0) return
      e.preventDefault()
      s.copySelection()
      return
    }
    if (ctrl && (e.key === 'v' || e.key === 'V')) {
      const s = useOmniStore.getState()
      if (!s.clipboard) return
      e.preventDefault()
      s.pasteClipboard()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const s = useOmniStore.getState()
      const nodeSel = s.selectedIds
      const edgeSel = s.selectedEdgeIds
      if (nodeSel.size === 0 && edgeSel.size === 0) return
      e.preventDefault()
      if (nodeSel.size > 0) s.removeNodes([...nodeSel])
      if (edgeSel.size > 0) s.removeEdges([...edgeSel])
      return
    }
    if (e.key === 'Escape') {
      useOmniStore.getState().clearSelection()
    }
  }
}
