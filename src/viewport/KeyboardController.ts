/**
 * KeyboardController — Delete/Backspace remove selected connections,
 * Ctrl+Z/Ctrl+Shift+Z (or Ctrl+Y) drive undo/redo. Listens on `window` so the
 * canvas does not need focus.
 */

import { useOmniStore } from '../model/store'
import { clearSocialEdgeDraft } from '../social/graphDraft'

export class KeyboardController {
  private readonly allowNodeDelete: boolean
  private readonly editorHotkeys: boolean

  constructor(options: { allowNodeDelete?: boolean; editorHotkeys?: boolean } = {}) {
    this.allowNodeDelete = options.allowNodeDelete ?? false
    this.editorHotkeys = options.editorHotkeys ?? true
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
    if (document.querySelector('[data-omnigram-keyboard-scope="modal"]')) {
      return
    }
    const ctrl = e.ctrlKey || e.metaKey
    if (this.editorHotkeys && ctrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) useOmniStore.getState().redo()
      else useOmniStore.getState().undo()
      return
    }
    if (this.editorHotkeys && ctrl && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault()
      useOmniStore.getState().redo()
      return
    }
    if (this.editorHotkeys && ctrl && (e.key === 'c' || e.key === 'C')) {
      const s = useOmniStore.getState()
      if (s.selectedIds.size === 0) return
      e.preventDefault()
      s.copySelection()
      return
    }
    if (this.editorHotkeys && ctrl && (e.key === 'v' || e.key === 'V')) {
      const s = useOmniStore.getState()
      if (!s.clipboard) return
      e.preventDefault()
      s.pasteClipboard()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const s = useOmniStore.getState()
      const edgeSel = s.selectedEdgeIds
      const nodeSel = s.selectedIds
      if (edgeSel.size === 0 && (!this.allowNodeDelete || nodeSel.size === 0)) return
      e.preventDefault()
      if (edgeSel.size > 0) {
        s.removeEdges([...edgeSel])
        for (const id of edgeSel) clearSocialEdgeDraft(id)
      }
      if (this.allowNodeDelete && nodeSel.size > 0) {
        s.removeNodes([...nodeSel])
      }
      return
    }
    if (e.key === 'Escape') {
      useOmniStore.getState().clearSelection()
    }
  }
}
