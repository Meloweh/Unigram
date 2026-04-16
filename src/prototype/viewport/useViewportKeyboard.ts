import { useEffect } from 'react'
import type { Model, ModelNode, ModelConnection } from './sampleModels'
import { snapToGrid } from './useHybridZoomStore'
import type { UnzipPopupState } from './useHybridZoomStore'

export interface ViewportKeyboardDeps {
  frameSelectedNodeId: string | null
  frameModelId: string
  editingNodeId: string | null
  modelNodes: ModelNode[]
  modelConnections: ModelConnection[]
  selectedNodeIds: Set<string>
  setSelectedNodeIds: (ids: Set<string>) => void
  removeNode: (modelId: string, nodeId: string) => void
  removeConnection: (modelId: string, from: string, to: string) => void
  clearSelection: () => void
  closeUnzip: () => void
  undo: (modelId: string) => void
  redo: (modelId: string) => void
  beginEditNode: (modelId: string) => void
  addNode: (modelId: string, node: Partial<ModelNode>) => void
  addConnection: (modelId: string, conn: Partial<ModelConnection>) => void
  unzipPopup: UnzipPopupState | null
  setEditingNodeId: (id: string | null) => void
  clipboardRef: React.MutableRefObject<{ nodes: ModelNode[]; connections: ModelConnection[] } | null>
}

export function useViewportKeyboard(deps: ViewportKeyboardDeps) {
  const {
    frameSelectedNodeId, frameModelId, editingNodeId,
    modelNodes, modelConnections, selectedNodeIds, setSelectedNodeIds,
    removeNode, removeConnection, clearSelection, closeUnzip,
    undo, redo, beginEditNode, addNode, addConnection,
    unzipPopup, setEditingNodeId, clipboardRef,
  } = deps

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore non-modifier keys when focus is on a form input (sidebar fields, etc.)
      const tag = (e.target as HTMLElement)?.tagName
      const inFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (inFormField && !e.ctrlKey && !e.metaKey) return

      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo(frameModelId)
        return
      }
      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault()
        redo(frameModelId)
        return
      }
      // Copy: Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (editingNodeId || inFormField) return // don't intercept text copy in edit mode or form fields
        const ids = selectedNodeIds.size > 0
          ? selectedNodeIds
          : frameSelectedNodeId ? new Set([frameSelectedNodeId]) : null
        if (!ids || ids.size === 0) return
        e.preventDefault()
        const nodes = modelNodes.filter((n) => ids.has(n.id))
        const connections = modelConnections.filter(
          (c) => ids.has(c.from) && ids.has(c.to),
        )
        clipboardRef.current = { nodes, connections }
        return
      }
      // Paste: Ctrl+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (editingNodeId || inFormField) return
        const clip = clipboardRef.current
        if (!clip || clip.nodes.length === 0) return
        e.preventDefault()
        const idMap = new Map<string, string>()
        const pastedIds = new Set<string>()
        // Create new IDs and offset positions
        for (const node of clip.nodes) {
          const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          idMap.set(node.id, newId)
          pastedIds.add(newId)
        }
        beginEditNode(frameModelId) // push undo snapshot
        for (const node of clip.nodes) {
          const newId = idMap.get(node.id)!
          addNode(frameModelId, {
            ...node,
            id: newId,
            x: snapToGrid(node.x + 4),
            y: snapToGrid(node.y + 4),
            // Don't copy RMM/MPD references — those are specific to the source node
            childModelId: undefined,
            mpdIds: undefined,
          })
        }
        for (const conn of clip.connections) {
          const newFrom = idMap.get(conn.from)
          const newTo = idMap.get(conn.to)
          if (newFrom && newTo) {
            addConnection(frameModelId, { from: newFrom, to: newTo, type: conn.type })
          }
        }
        // Select the pasted nodes
        setSelectedNodeIds(pastedIds)
        clearSelection() // clear single-select
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete while typing in a node label
        if (editingNodeId) return
        // Multi-selection delete
        if (selectedNodeIds.size > 0) {
          beginEditNode(frameModelId) // push undo snapshot
          for (const id of selectedNodeIds) {
            removeNode(frameModelId, id)
          }
          setSelectedNodeIds(new Set())
          return
        }
        if (frameSelectedNodeId) {
          removeNode(frameModelId, frameSelectedNodeId)
          return
        }
        // Delete selected connection
        if (unzipPopup) {
          const conn = modelConnections.find(c => `${c.from}->${c.to}` === unzipPopup.connectionKey)
          if (conn) {
            beginEditNode(frameModelId)
            removeConnection(frameModelId, conn.from, conn.to)
            closeUnzip()
          }
        }
      }
      // Escape to deselect or cancel editing
      if (e.key === 'Escape') {
        if (editingNodeId) {
          // If label is still empty, remove the node
          const node = modelNodes.find((n) => n.id === editingNodeId)
          if (node && !node.label.trim()) {
            removeNode(frameModelId, editingNodeId)
          }
          setEditingNodeId(null)
        } else {
          clearSelection()
          setSelectedNodeIds(new Set())
          closeUnzip()
        }
      }
      // Select All: Ctrl+A
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (editingNodeId) return
        e.preventDefault()
        setSelectedNodeIds(new Set(modelNodes.map((n) => n.id)))
        return
      }
      // Tab or F2 to start editing the selected node
      if ((e.key === 'Tab' || e.key === 'F2') && !editingNodeId && frameSelectedNodeId) {
        e.preventDefault()
        beginEditNode(frameModelId)
        setEditingNodeId(frameSelectedNodeId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [frameSelectedNodeId, frameModelId, editingNodeId, modelNodes, modelConnections, selectedNodeIds, removeNode, removeConnection, clearSelection, closeUnzip, undo, redo, beginEditNode, addNode, addConnection, unzipPopup])
}
