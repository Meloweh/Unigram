/**
 * Stage 1 store. Holds a single active model + camera + selection.
 * Mutations operate on Maps in place inside `set()`; we only swap the top-level
 * object identity, so React selectors that read whole maps still re-fire while
 * pure-renderer subscribers can read entity ids directly without diffing.
 *
 * Hot paths (drag / pan / zoom) MUST go through `beginTx` / `commitTx` so the
 * UndoStack only sees gesture-end state, not per-frame mutations.
 */

import { create } from 'zustand'
import { applyPatch, type Patch, UndoStack } from './undo'
import {
  DEFAULT_EDGE,
  DEFAULT_NODE,
  type Connection,
  type Model,
  type ModelNode,
} from './types'

let idCounter = 0
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`

interface Camera {
  panX: number
  panY: number
  freeScale: number
}

export interface OmniState {
  model: Model
  camera: Camera
  selectedIds: Set<string>
  /** Bumps any time entity maps change — cheap subscription target. */
  rev: number
  /** Bumps any time selection changes. */
  selRev: number
  undoStack: UndoStack
}

interface Actions {
  // Hot-path camera (NOT undoable).
  setCamera(c: Partial<Camera>): void
  panBy(dx: number, dy: number): void

  // Selection (NOT undoable).
  select(id: string | null, additive?: boolean): void
  selectMany(ids: Iterable<string>): void
  clearSelection(): void

  // Entity authoring (each is one undoable transaction).
  addNode(partial: Partial<ModelNode> & Pick<ModelNode, 'x' | 'y'>): string
  removeNodes(ids: Iterable<string>): void
  moveNodes(updates: Iterable<{ id: string; x: number; y: number }>): void
  updateNode(id: string, patch: Partial<ModelNode>): void

  addEdge(from: string, to: string, partial?: Partial<Connection>): string | null
  removeEdges(ids: Iterable<string>): void

  // Multi-step transaction support for drag commits.
  applyTransaction(patches: Patch[]): void

  undo(): void
  redo(): void
  /** Replace the entire model (e.g. project load, bench spawn). Clears undo. */
  loadModel(model: Model): void
}

export type Store = OmniState & Actions

const emptyModel = (): Model => ({
  id: 'root',
  name: 'untitled',
  nodes: new Map(),
  edges: new Map(),
})

export const useOmniStore = create<Store>((set, get) => ({
  model: emptyModel(),
  camera: { panX: 0, panY: 0, freeScale: 1 },
  selectedIds: new Set(),
  rev: 0,
  selRev: 0,
  undoStack: new UndoStack(),

  setCamera(c) {
    set((s) => ({ camera: { ...s.camera, ...c } }))
  },
  panBy(dx, dy) {
    set((s) => ({ camera: { ...s.camera, panX: s.camera.panX + dx, panY: s.camera.panY + dy } }))
  },

  select(id, additive = false) {
    set((s) => {
      const next = additive ? new Set(s.selectedIds) : new Set<string>()
      if (id != null) {
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      return { selectedIds: next, selRev: s.selRev + 1 }
    })
  },
  selectMany(ids) {
    set((s) => ({ selectedIds: new Set(ids), selRev: s.selRev + 1 }))
  },
  clearSelection() {
    set((s) => (s.selectedIds.size === 0 ? s : { selectedIds: new Set(), selRev: s.selRev + 1 }))
  },

  addNode(partial) {
    const id = partial.id ?? newId('n')
    const node: ModelNode = {
      ...DEFAULT_NODE,
      label: '',
      ...partial,
      id,
    }
    get().applyTransaction([{ kind: 'node', op: 'add', node }])
    return id
  },

  removeNodes(ids) {
    const { model } = get()
    const tx: Patch[] = []
    const idSet = new Set(ids)
    for (const id of idSet) {
      const node = model.nodes.get(id)
      if (!node) continue
      tx.push({ kind: 'node', op: 'remove', node })
    }
    // Cascade: remove edges touching any removed node.
    for (const edge of model.edges.values()) {
      if (idSet.has(edge.from) || idSet.has(edge.to)) {
        tx.push({ kind: 'edge', op: 'remove', edge })
      }
    }
    get().applyTransaction(tx)
    if (tx.length > 0) {
      set((s) => {
        if (s.selectedIds.size === 0) return s
        const next = new Set(s.selectedIds)
        for (const id of idSet) next.delete(id)
        return { selectedIds: next, selRev: s.selRev + 1 }
      })
    }
  },

  moveNodes(updates) {
    const { model } = get()
    const tx: Patch[] = []
    for (const u of updates) {
      const before = model.nodes.get(u.id)
      if (!before) continue
      if (before.x === u.x && before.y === u.y) continue
      tx.push({
        kind: 'node',
        op: 'update',
        id: u.id,
        before,
        after: { ...before, x: u.x, y: u.y },
      })
    }
    get().applyTransaction(tx)
  },

  updateNode(id, patch) {
    const before = get().model.nodes.get(id)
    if (!before) return
    const after = { ...before, ...patch, id }
    get().applyTransaction([{ kind: 'node', op: 'update', id, before, after }])
  },

  addEdge(from, to, partial) {
    if (from === to) return null
    const { model } = get()
    if (!model.nodes.has(from) || !model.nodes.has(to)) return null
    const id = partial?.id ?? newId('e')
    const edge: Connection = { ...DEFAULT_EDGE, ...partial, id, from, to }
    get().applyTransaction([{ kind: 'edge', op: 'add', edge }])
    return id
  },

  removeEdges(ids) {
    const { model } = get()
    const tx: Patch[] = []
    for (const id of ids) {
      const edge = model.edges.get(id)
      if (edge) tx.push({ kind: 'edge', op: 'remove', edge })
    }
    get().applyTransaction(tx)
  },

  applyTransaction(patches) {
    if (patches.length === 0) return
    set((s) => {
      const nodes = s.model.nodes
      const edges = s.model.edges
      for (const p of patches) applyPatch(p, nodes, edges)
      s.undoStack.push(patches)
      return { model: { ...s.model }, rev: s.rev + 1 }
    })
  },

  undo() {
    const inverted = get().undoStack.undo()
    if (!inverted) return
    set((s) => {
      const nodes = s.model.nodes
      const edges = s.model.edges
      for (const p of inverted) applyPatch(p, nodes, edges)
      return { model: { ...s.model }, rev: s.rev + 1 }
    })
  },

  redo() {
    const tx = get().undoStack.redo()
    if (!tx) return
    set((s) => {
      const nodes = s.model.nodes
      const edges = s.model.edges
      for (const p of tx) applyPatch(p, nodes, edges)
      return { model: { ...s.model }, rev: s.rev + 1 }
    })
  },

  loadModel(model) {
    set((s) => {
      s.undoStack.clear()
      return {
        model,
        selectedIds: new Set(),
        rev: s.rev + 1,
        selRev: s.selRev + 1,
      }
    })
  },
}))
