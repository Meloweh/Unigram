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
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = useOmniStore.getState().selectedIds
      if (sel.size === 0) return
      e.preventDefault()
      useOmniStore.getState().removeNodes([...sel])
      return
    }
    if (e.key === 'Escape') {
      useOmniStore.getState().clearSelection()
    }
  }
}
