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
  DEFAULT_GRID,
  DEFAULT_NODE,
  type Connection,
  type GridSettings,
  type Model,
  type ModelNode,
} from './types'
import {
  applyZoomStep,
  createInitialSnapshot,
  isAtRest,
  isHandoffReady,
  type HybridZoomSnapshot,
} from '../zoom/hybridZoom'

let idCounter = 0
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`

interface Camera {
  panX: number
  panY: number
  freeScale: number
}

/**
 * One frame of the RMM zoom stack: state to restore when we zoom *out* of a
 * child model back to its parent.
 */
export interface ZoomStackFrame {
  modelId: string
  focusedNodeId: string
  /** Camera state at the moment we handed off into the child. */
  camera: Camera
  /** Selection at handoff time, restored on return. */
  selectedIds: Set<string>
}

export interface OmniState {
  model: Model
  /** All models reachable from the project root, keyed by id. The active model is mirrored at `model`. */
  models: Map<string, Model>
  camera: Camera
  selectedIds: Set<string>
  /** Bumps any time entity maps change — cheap subscription target. */
  rev: number
  /** Bumps any time selection changes. */
  selRev: number
  /** Bumps any time the RMM zoom snapshot or focused node changes. */
  zoomRev: number
  undoStack: UndoStack
  /** Active RMM zoom state. `progress === 0` means we're at rest (free zoom). */
  zoom: HybridZoomSnapshot
  /** Node currently being inflated; null when zoom is at rest. */
  focusedNodeId: string | null
  /** Stack of parent frames for `rmmZoomOut`. */
  zoomStack: ZoomStackFrame[]
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

  /**
   * Commit a drag/move whose intermediate frames were applied directly to the
   * renderer (and thus to the live ModelNode references in place). This
   * builds the undo patches from the supplied baselines vs current node state
   * and pushes them as a single transaction.
   */
  commitDrag(baselines: Iterable<{ id: string; x: number; y: number }>): void

  undo(): void
  redo(): void
  /** Replace the entire model (e.g. project load, bench spawn). Clears undo. */
  loadModel(model: Model): void
  /** Update diagram-level grid settings (NOT undoable; UI-state). */
  setGrid(patch: Partial<GridSettings>): void
  /** Register a model in the project registry without activating it. Returns the id. */
  registerModel(model: Model): string
  /** Replace the active model from the registry. Does NOT clear undo (use `loadModel` for project loads). */
  setActiveModel(id: string): void

  /**
   * Add a new MPD dimension to a node. Creates an alternate model whose
   * only node is a twin of the source (same id, geometry, and shared
   * `mpdDimensions` array so we can dial back). Registers it and pushes
   * its id onto the source node's `mpdDimensions` (creating the array
   * with the current model id as canonical entry on first call). Returns
   * the new dimension's model id, or null on failure. NOT undoable.
   */
  addMpdDimension(nodeId: string, label?: string): string | null

  // RMM zoom (hot-path; NOT undoable per specification.md §4.7).
  /** Step the zoom snapshot in/out by one notch. Performs handoff/return at the boundaries. */
  rmmZoomStep(direction: 'in' | 'out', step?: number): void
  /** Reset zoom to rest without performing handoff (e.g. selection cleared). */
  rmmReset(): void
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
  models: new Map(),
  camera: { panX: 0, panY: 0, freeScale: 1 },
  selectedIds: new Set(),
  rev: 0,
  selRev: 0,
  zoomRev: 0,
  undoStack: new UndoStack(),
  zoom: createInitialSnapshot(),
  focusedNodeId: null,
  zoomStack: [],

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

  commitDrag(baselines) {
    const { model } = get()
    const tx: Patch[] = []
    for (const b of baselines) {
      const cur = model.nodes.get(b.id)
      if (!cur) continue
      if (cur.x === b.x && cur.y === b.y) continue
      const before: ModelNode = { ...cur, x: b.x, y: b.y }
      tx.push({ kind: 'node', op: 'update', id: b.id, before, after: cur })
    }
    if (tx.length === 0) return
    // Live nodes already hold the new positions (renderer wrote them in
    // place). Push the patches to the undo stack and bump rev so other
    // subscribers see the change; do NOT call applyPatch again.
    set((s) => {
      s.undoStack.push(tx)
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
      const models = new Map(s.models)
      models.set(model.id, model)
      return {
        model,
        models,
        selectedIds: new Set(),
        rev: s.rev + 1,
        selRev: s.selRev + 1,
        zoomRev: s.zoomRev + 1,
        zoom: createInitialSnapshot(),
        focusedNodeId: null,
        zoomStack: [],
        camera: { panX: 0, panY: 0, freeScale: 1 },
      }
    })
  },

  setGrid(patch) {
    set((s) => {
      const cur = s.model.grid ?? DEFAULT_GRID
      const grid: GridSettings = { ...cur, ...patch }
      if (grid.sizePercent <= 0) grid.sizePercent = DEFAULT_GRID.sizePercent
      const model: Model = { ...s.model, grid }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  registerModel(model) {
    set((s) => {
      const models = new Map(s.models)
      models.set(model.id, model)
      return { models }
    })
    return model.id
  },

  setActiveModel(id) {
    const next = get().models.get(id)
    if (!next) return
    set((s) => {
      // Preserve selection ids that exist in the target model (MPD twins).
      const keep = new Set<string>()
      for (const sid of s.selectedIds) {
        if (next.nodes.has(sid)) keep.add(sid)
      }
      const selectionChanged = keep.size !== s.selectedIds.size
      return {
        model: next,
        selectedIds: keep,
        rev: s.rev + 1,
        selRev: selectionChanged ? s.selRev + 1 : s.selRev,
      }
    })
  },

  addMpdDimension(nodeId, label) {
    const s = get()
    const source = s.model.nodes.get(nodeId)
    if (!source) return null
    // Ensure the source has an mpdDimensions array containing the current
    // model id as its canonical entry.
    let dims: string[] = source.mpdDimensions ? [...source.mpdDimensions] : [s.model.id]
    if (!dims.includes(s.model.id)) dims = [s.model.id, ...dims]
    const newId = `mpd_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
    dims.push(newId)
    // Twin node: same id and geometry, but its own (shared) dims array.
    const twin: ModelNode = { ...source, mpdDimensions: dims }
    const newModel: Model = {
      id: newId,
      name: label ?? `${source.label || source.id} · dim ${dims.length - 1}`,
      nodes: new Map([[twin.id, twin]]),
      edges: new Map(),
    }
    set((cur) => {
      // Update the source node in place + propagate dims to all existing
      // twins in already-registered dimensions so dial-back stays consistent.
      const models = new Map(cur.models)
      for (const dimId of dims) {
        if (dimId === newId) continue
        const m = models.get(dimId)
        if (!m) continue
        const twinInM = m.nodes.get(nodeId)
        if (!twinInM) continue
        const updatedTwin: ModelNode = { ...twinInM, mpdDimensions: dims }
        m.nodes.set(nodeId, updatedTwin)
      }
      // Update the live source node in place (Map identity preserved).
      const live = cur.model.nodes.get(nodeId)
      if (live) {
        ;(live as { mpdDimensions?: string[] }).mpdDimensions = dims
      }
      models.set(newModel.id, newModel)
      return {
        model: { ...cur.model },
        models,
        rev: cur.rev + 1,
      }
    })
    return newId
  },

  rmmZoomStep(direction, step) {
    const s = get()
    if (direction === 'in') {
      // Pick a focus target on first step into a fresh transition.
      let focusedNodeId = s.focusedNodeId
      if (!focusedNodeId) {
        // Use the single selected node as focus; abort if no childModelId
        // (RMM is a no-op without a child to zoom into).
        if (s.selectedIds.size !== 1) return
        const onlyId = s.selectedIds.values().next().value as string
        const node = s.model.nodes.get(onlyId)
        if (!node?.childModelId) return
        focusedNodeId = onlyId
      }
      const next = applyZoomStep(s.zoom, 'in', step)
      set((cur) => ({
        zoom: next,
        focusedNodeId,
        zoomRev: cur.zoomRev + 1,
      }))
      // Handoff: when fully inflated, swap to the child model and reset.
      if (isHandoffReady(next)) {
        const node = s.model.nodes.get(focusedNodeId)
        const childId = node?.childModelId
        const child = childId ? s.models.get(childId) : undefined
        if (!child) return // child unavailable; stay inflated until loaded
        set((cur) => {
          const frame: ZoomStackFrame = {
            modelId: cur.model.id,
            focusedNodeId: focusedNodeId!,
            camera: { ...cur.camera },
            selectedIds: new Set(cur.selectedIds),
          }
          return {
            zoomStack: [...cur.zoomStack, frame],
            model: child,
            selectedIds: new Set(),
            zoom: createInitialSnapshot(),
            focusedNodeId: null,
            camera: { panX: 0, panY: 0, freeScale: 1 },
            rev: cur.rev + 1,
            selRev: cur.selRev + 1,
            zoomRev: cur.zoomRev + 1,
          }
        })
      }
      return
    }
    // Zoom out.
    if (isAtRest(s.zoom)) {
      // Already at rest; pop a frame if we have one.
      const top = s.zoomStack[s.zoomStack.length - 1]
      if (!top) return
      const parent = s.models.get(top.modelId)
      if (!parent) return
      set((cur) => ({
        zoomStack: cur.zoomStack.slice(0, -1),
        model: parent,
        camera: top.camera,
        selectedIds: top.selectedIds,
        zoom: { progress: 0.92, nodeProgress: 0.92, cameraScale: 1 + (1.8 - 1) * 0.92, nodeInflation: 0.92, handoffMode: 'host' },
        focusedNodeId: top.focusedNodeId,
        rev: cur.rev + 1,
        selRev: cur.selRev + 1,
        zoomRev: cur.zoomRev + 1,
      }))
      return
    }
    const next = applyZoomStep(s.zoom, 'out', step)
    set((cur) => ({
      zoom: next,
      focusedNodeId: isAtRest(next) ? null : cur.focusedNodeId,
      zoomRev: cur.zoomRev + 1,
    }))
  },

  rmmReset() {
    set((s) => {
      if (isAtRest(s.zoom) && s.focusedNodeId == null) return s
      return {
        zoom: createInitialSnapshot(),
        focusedNodeId: null,
        zoomRev: s.zoomRev + 1,
      }
    })
  },
}))
