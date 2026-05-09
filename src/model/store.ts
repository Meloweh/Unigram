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
  type ConnectionKind,
  type ExternalMpdLink,
  type ExternalRmmLink,
  type GridSettings,
  type Model,
  type ModelNode,
} from './types'
import { completeExternalMpdLink, completeExternalRmmLink } from './externalMpd'
import type { ModelCosmetics } from '../theme/types'
import {
  applyZoomStep,
  createInitialSnapshot,
  isAtRest,
  isHandoffReady,
  type HybridZoomSnapshot,
} from '../zoom/hybridZoom'

let idCounter = 0
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`

function uniqueNodeLabel(
  label: string | undefined,
  nodes: ReadonlyMap<string, ModelNode>,
  selfId: string,
): string {
  const trimmed = label ?? ''
  if (!trimmed.trim()) return trimmed
  const exists = (candidate: string) => {
    const needle = candidate.trim().toLowerCase()
    for (const node of nodes.values()) {
      if (node.id === selfId) continue
      if (node.label.trim().toLowerCase() === needle) return true
    }
    return false
  }
  if (!exists(trimmed)) return trimmed
  let index = 2
  let candidate = `${trimmed} ${index}`
  while (exists(candidate)) {
    index += 1
    candidate = `${trimmed} ${index}`
  }
  return candidate
}

function withPreviewSpawnOffset(host: ModelNode, preview: ModelNode): ModelNode | null {
  const ref = preview.previewOf
  if (!ref || !host.flowEffects) return null
  const spawnEffectNodeId = ref.spawnEffectNodeId
  const itemIndex = ref.itemIndex
  if (!spawnEffectNodeId || typeof itemIndex !== 'number') return null
  let changed = false
  const flowEffects = host.flowEffects.map((effect) => {
    let effectChanged = false
    const nodes = effect.graph.nodes.map((graphNode) => {
      if (graphNode.id !== spawnEffectNodeId || graphNode.kind !== 'spawn') return graphNode
      const items = graphNode.spawnItems
      const item = items?.[itemIndex]
      if (!items || !item) return graphNode
      const offsetX = preview.x - host.x
      const offsetY = preview.y - host.y
      if (item.offsetX === offsetX && item.offsetY === offsetY) return graphNode
      changed = true
      effectChanged = true
      return {
        ...graphNode,
        spawnItems: items.map((it, i) => (i === itemIndex ? { ...it, offsetX, offsetY } : it)),
      }
    })
    return effectChanged ? { ...effect, graph: { ...effect.graph, nodes } } : effect
  })
  return changed ? { ...host, flowEffects } : null
}

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
  /** Edge selection (single-edge inspectors); separate from node selection. */
  selectedEdgeIds: Set<string>
  /** Bumps any time entity maps change — cheap subscription target. */
  rev: number
  /** Bumps any time selection changes. */
  selRev: number
  /** Bumps any time the RMM zoom snapshot or focused node changes. */
  zoomRev: number
  undoStack: UndoStack
  /**
   * In-memory clipboard for copy/paste. NOT persisted; survives only for
   * the lifetime of the page. Edges are only included when *both* endpoints
   * are also in `nodes`. Null when nothing has been copied yet.
   */
  clipboard: { nodes: ModelNode[]; edges: Connection[] } | null
  /** Wall-clock ms of the last paste, used to throttle key-repeat. */
  lastPasteAt: number
  /** Active RMM zoom state. `progress === 0` means we're at rest (free zoom). */
  zoom: HybridZoomSnapshot
  /** Node currently being inflated; null when zoom is at rest. */
  focusedNodeId: string | null
  /** Stack of parent frames for `rmmZoomOut`. */
  zoomStack: ZoomStackFrame[]
  /** Node whose label is being edited inline (null when not editing). */
  editingNodeId: string | null
  /**
   * Sticky kind for new connections drawn via right-drag in the canvas.
   * Mirrors the legacy LeftSidebar `Connection Types` radio. NOT undoable
   * (UI preference). Default `'default'`.
   */
  defaultConnectionKind: ConnectionKind

  /**
   * One-shot pointer mode used by inspector flows that need a follow-up
   * canvas click. Currently:
   *   - `'link-node'` — the next node clicked is paired with the
   *     currently-selected node from the flow-effect editor link picker.
   * The PointerController consumes and clears this on the next select.
   * NOT undoable (UI state).
   */
  pickMode: 'link-node' | null
}

interface Actions {
  // Hot-path camera (NOT undoable).
  setCamera(c: Partial<Camera>): void
  panBy(dx: number, dy: number): void

  // Selection (NOT undoable).
  select(id: string | null, additive?: boolean): void
  selectMany(ids: Iterable<string>, edgeIds?: Iterable<string>): void
  clearSelection(): void

  /** Select a single edge (clears node selection). Pass null to clear. */
  selectEdge(id: string | null, additive?: boolean): void

  /** Begin / end inline label editing for a node (NOT undoable; UI state). */
  setEditingNode(id: string | null): void

  /** Sticky kind applied to connections drawn via the canvas (NOT undoable). */
  setDefaultConnectionKind(kind: ConnectionKind): void

  /** Set the one-shot pointer mode (NOT undoable). Pass null to clear. */
  setPickMode(mode: 'link-node' | null): void

  // Entity authoring (each is one undoable transaction).
  addNode(partial: Partial<ModelNode> & Pick<ModelNode, 'x' | 'y'>): string
  removeNodes(ids: Iterable<string>): void
  moveNodes(updates: Iterable<{ id: string; x: number; y: number }>): void
  updateNode(id: string, patch: Partial<ModelNode>): void
  updateEdge(id: string, patch: Partial<Connection>): void

  addEdge(from: string, to: string, partial?: Partial<Connection>): string | null
  removeEdges(ids: Iterable<string>): void

  // Multi-step transaction support for drag commits.
  applyTransaction(patches: Patch[]): void

  /**
   * Snapshot the current node selection (and any edges whose endpoints are
   * both inside the selection) into the in-memory clipboard. NOT undoable
   * (clipboard is purely UI state). No-op when nothing is selected.
   */
  copySelection(): void

  /**
   * Paste the clipboard contents back into the active model with fresh ids.
   * The new nodes are offset by `(offsetX, offsetY)` scene-percent units
   * (default `+4`, matching `DEFAULT_GRID_SNAP`). Calls within `throttleMs`
   * (default 500 ms) of the last paste are dropped to avoid OOM on key
   * repeat. Pasted nodes become the new selection. One undoable
   * transaction. Returns the new node ids (empty when nothing pasted).
   */
  pasteClipboard(offsetX?: number, offsetY?: number, throttleMs?: number): string[]

  /**
   * Commit a drag/move whose intermediate frames were applied directly to the
   * renderer (and thus to the live ModelNode references in place). This
   * builds the undo patches from the supplied baselines vs current node state
   * and pushes them as a single transaction.
   */
  commitDrag(baselines: Iterable<{ id: string; x: number; y: number }>): void
  /** Commit renderer-direct geometry edits as one undoable change. */
  commitGeometry(baseline: { id: string; x: number; y: number; w: number; h: number }): void
  /** Commit renderer-direct cosmetic tip edits as one undoable change. */
  commitCosmeticTip(baseline: { id: string; tipAngle?: number; tipLength?: number; tip?: ModelNode['tip'] }): void

  undo(): void
  redo(): void
  /** Replace the entire model (e.g. project load, bench spawn). Clears undo. */
  loadModel(model: Model): void
  /** Replace the entire project (registry + active model). Clears undo. */
  loadProject(snapshot: { rootModelId: string; models: Map<string, Model> }): void
  /** Update diagram-level grid settings (NOT undoable; UI-state). */
  setGrid(patch: Partial<GridSettings>): void
  /** Update diagram-level cosmetics (theme/background/particles). NOT undoable. */
  setCosmetics(patch: Partial<ModelCosmetics>): void
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

  /**
   * Add an MPD dial entry that resolves to another public graph containing
   * the same normalized node label. NOT undoable; proposal/creative flows
   * decide whether this mutation is public draft or private autosave.
   */
  addExternalMpdLink(nodeId: string, link: Omit<ExternalMpdLink, 'id'> & { id?: string }): string | null

  /** Link an RMM child to a live external public graph with a matching node label. */
  addExternalRmmLink(nodeId: string, link: Omit<ExternalRmmLink, 'id'> & { id?: string }): string | null

  /**
   * Create a fresh empty child model and link it to `nodeId.childModelId`.
   * Returns the new model id, or null when the node doesn't exist or
   * already has a child model. The model registration is NOT undoable but
   * the node update is (so undo will unlink, not delete the model — the
   * registry is a project-level resource).
   */
  addChildModel(nodeId: string, name?: string): string | null

  /**
   * Unlink `nodeId.childModelId` (does NOT delete the registered model so
   * undo + re-link round-trips work). One undoable transaction.
   */
  removeChildModel(nodeId: string): void

  /**
   * Symmetrically link two nodes for paired effect-graph editing. Adds
   * each id to the other's `linkedNodeIds`. Idempotent. Single undoable
   * transaction. No-op when either node is missing or `a === b`.
   */
  linkNodes(a: string, b: string): void

  /**
   * Symmetrically unlink two nodes. Removes each id from the other's
   * `linkedNodeIds`, and prunes any cross-effect links between them from
   * `model.crossLinks`. Single undoable transaction.
   */
  unlinkNodes(a: string, b: string): void

  /**
   * Add a wire between two effect graphs. `from`/`to` reference the host
   * node and the in-graph effect id. The store enforces that both hosts
   * are linked (returns null otherwise) and rejects duplicates. Returns
   * the new link id.
   */
  addCrossLink(from: { nodeId: string; effectId: string; effectNodeId?: string }, to: { nodeId: string; effectId: string; effectNodeId?: string }): string | null

  /** Remove a cross-effect link by id. Undoable. */
  removeCrossLink(id: string): void

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
  grid: DEFAULT_GRID,
})

const initialModel = emptyModel()

function withDefaultGrid(model: Model): Model {
  return model.grid ? model : { ...model, grid: DEFAULT_GRID }
}

export const useOmniStore = create<Store>((set, get) => ({
  model: initialModel,
  models: new Map([[initialModel.id, initialModel]]),
  camera: { panX: 0, panY: 0, freeScale: 1 },
  selectedIds: new Set(),
  selectedEdgeIds: new Set(),
  rev: 0,
  selRev: 0,
  zoomRev: 0,
  undoStack: new UndoStack(),
  clipboard: null,
  lastPasteAt: 0,
  zoom: createInitialSnapshot(),
  focusedNodeId: null,
  zoomStack: [],
  editingNodeId: null,
  // Public graph authoring defaults to structural connections. Flow-typed
  // wires are still available from the toolbar when users explicitly need
  // playback participation.
  defaultConnectionKind: 'default',
  pickMode: null,

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
      return { selectedIds: next, selectedEdgeIds: new Set(), selRev: s.selRev + 1 }
    })
  },
  selectMany(ids, edgeIds) {
    set((s) => ({ selectedIds: new Set(ids), selectedEdgeIds: new Set(edgeIds ?? []), selRev: s.selRev + 1 }))
  },
  clearSelection() {
    set((s) => {
      if (s.selectedIds.size === 0 && s.selectedEdgeIds.size === 0) return s
      return { selectedIds: new Set(), selectedEdgeIds: new Set(), selRev: s.selRev + 1 }
    })
  },

  selectEdge(id, additive = false) {
    set((s) => {
      const next = additive ? new Set(s.selectedEdgeIds) : new Set<string>()
      if (id != null) {
        if (additive && next.has(id)) next.delete(id)
        else next.add(id)
      }
      const sameAsBefore =
        next.size === s.selectedEdgeIds.size &&
        (next.size === 0 || [...next].every((eid) => s.selectedEdgeIds.has(eid)))
      if (sameAsBefore && (additive || s.selectedIds.size === 0)) return s
      return {
        selectedEdgeIds: next,
        selectedIds: additive ? new Set(s.selectedIds) : new Set(),
        selRev: s.selRev + 1,
      }
    })
  },

  setEditingNode(id) {
    set((s) => (s.editingNodeId === id ? s : { editingNodeId: id, selRev: s.selRev + 1 }))
  },

  addNode(partial) {
    const id = partial.id ?? newId('n')
    const node: ModelNode = {
      ...DEFAULT_NODE,
      label: '',
      ...partial,
      id,
    }
    node.label = uniqueNodeLabel(node.label, get().model.nodes, id)
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
        const links = s.model.crossLinks
        let model = s.model
        let models = s.models
        if (links?.length) {
          const keep = links.filter((l) => !idSet.has(l.from.nodeId) && !idSet.has(l.to.nodeId))
          if (keep.length !== links.length) {
            model = { ...model, crossLinks: keep }
            models = new Map(models)
            models.set(model.id, model)
          }
        }
        if (s.selectedIds.size === 0) {
          return model === s.model ? s : { model, models, rev: s.rev + 1 }
        }
        const next = new Set(s.selectedIds)
        for (const id of idSet) next.delete(id)
        return { model, models, selectedIds: next, selRev: s.selRev + 1, rev: model === s.model ? s.rev : s.rev + 1 }
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
    if (typeof patch.label === 'string') {
      after.label = uniqueNodeLabel(patch.label, get().model.nodes, id)
    }
    get().applyTransaction([{ kind: 'node', op: 'update', id, before, after }])
  },

  updateEdge(id, patch) {
    const before = get().model.edges.get(id)
    if (!before) return
    const after: Connection = { ...before, ...patch, id, from: before.from, to: before.to }
    get().applyTransaction([{ kind: 'edge', op: 'update', id, before, after }])
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
    const idSet = new Set(ids)
    for (const id of idSet) {
      const edge = model.edges.get(id)
      if (edge) tx.push({ kind: 'edge', op: 'remove', edge })
    }
    get().applyTransaction(tx)
    // Drop any removed edges from the edge selection.
    set((s) => {
      let changed = false
      const next = new Set(s.selectedEdgeIds)
      for (const id of idSet) if (next.delete(id)) changed = true
      return changed ? { selectedEdgeIds: next, selRev: s.selRev + 1 } : s
    })
  },

  applyTransaction(patches) {
    if (patches.length === 0) return
    set((s) => {
      const nodes = s.model.nodes
      const edges = s.model.edges
      for (const p of patches) applyPatch(p, nodes, edges)
      s.undoStack.push(patches)
      const model = { ...s.model }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  copySelection() {
    const s = get()
    if (s.selectedIds.size === 0) return
    const nodes: ModelNode[] = []
    for (const id of s.selectedIds) {
      const node = s.model.nodes.get(id)
      // Shallow clone is enough — node fields are primitives, small arrays,
      // and a shape string. Deep structures (`flowEffects`, `mpdDimensions`)
      // are re-created at paste time.
      if (node) nodes.push({ ...node })
    }
    const edges: Connection[] = []
    for (const edge of s.model.edges.values()) {
      if (s.selectedIds.has(edge.from) && s.selectedIds.has(edge.to)) {
        edges.push({ ...edge })
      }
    }
    set({ clipboard: { nodes, edges } })
  },

  pasteClipboard(offsetX = 4, offsetY = 4, throttleMs = 500) {
    const s = get()
    const clip = s.clipboard
    if (!clip || clip.nodes.length === 0) return []
    const now = Date.now()
    if (now - s.lastPasteAt < throttleMs) return []
    // Map old node ids → new node ids so cloned edges stay internally
    // consistent. Edges referencing nodes outside the clipboard are dropped.
    const idMap = new Map<string, string>()
    const tx: Patch[] = []
    const newIds: string[] = []
    const labelRegistry = new Map(s.model.nodes)
    for (const src of clip.nodes) {
      const id = newId('n')
      idMap.set(src.id, id)
      newIds.push(id)
      // Fresh references for any array fields so undo/edits on the paste
      // don't touch the clipboard original.
      const node: ModelNode = {
        ...src,
        id,
        x: src.x + offsetX,
        y: src.y + offsetY,
        label: uniqueNodeLabel(src.label, labelRegistry, id),
        flowEffects: src.flowEffects ? src.flowEffects.map((e) => ({ ...e })) : undefined,
        mpdDimensions: src.mpdDimensions ? [...src.mpdDimensions] : undefined,
        externalMpdLinks: src.externalMpdLinks ? { ...src.externalMpdLinks } : undefined,
        externalRmmLink: src.externalRmmLink ? { ...src.externalRmmLink } : undefined,
      }
      labelRegistry.set(id, node)
      tx.push({ kind: 'node', op: 'add', node })
    }
    for (const src of clip.edges) {
      const from = idMap.get(src.from)
      const to = idMap.get(src.to)
      if (!from || !to) continue
      const edge: Connection = { ...src, id: newId('e'), from, to }
      tx.push({ kind: 'edge', op: 'add', edge })
    }
    if (tx.length === 0) return []
    get().applyTransaction(tx)
    set((cur) => ({
      lastPasteAt: now,
      selectedIds: new Set(newIds),
      selectedEdgeIds: new Set(),
      selRev: cur.selRev + 1,
    }))
    return newIds
  },

  commitDrag(baselines) {
    const { model } = get()
    const tx: Patch[] = []
    const hostUpdates = new Map<string, { before: ModelNode; after: ModelNode }>()
    for (const b of baselines) {
      const cur = model.nodes.get(b.id)
      if (!cur) continue
      if (cur.x === b.x && cur.y === b.y) continue
      const before: ModelNode = { ...cur, x: b.x, y: b.y }
      tx.push({ kind: 'node', op: 'update', id: b.id, before, after: cur })
      if (cur.previewOf) {
        const hostId = cur.previewOf.hostNodeId
        if (!hostId) continue
        const host = hostUpdates.get(hostId)?.after ?? model.nodes.get(hostId)
        if (host) {
          const nextHost = withPreviewSpawnOffset(host, cur)
          if (nextHost) {
            hostUpdates.set(hostId, {
              before: hostUpdates.get(hostId)?.before ?? host,
              after: nextHost,
            })
          }
        }
      }
    }
    for (const [hostId, update] of hostUpdates) {
      model.nodes.set(hostId, update.after)
      tx.push({ kind: 'node', op: 'update', id: hostId, before: update.before, after: update.after })
    }
    if (tx.length === 0) return
    // Live nodes already hold the new positions (renderer wrote them in
    // place), and preview facade offset sync above has already replaced
    // affected host nodes. Push patches + bump rev; do NOT call applyPatch.
    set((s) => {
      s.undoStack.push(tx)
      const model = { ...s.model }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  commitGeometry(baseline) {
    const cur = get().model.nodes.get(baseline.id)
    if (!cur) return
    if (
      cur.x === baseline.x &&
      cur.y === baseline.y &&
      cur.w === baseline.w &&
      cur.h === baseline.h
    ) return
    const before: ModelNode = {
      ...cur,
      x: baseline.x,
      y: baseline.y,
      w: baseline.w,
      h: baseline.h,
    }
    const tx: Patch[] = [{ kind: 'node', op: 'update', id: baseline.id, before, after: cur }]
    set((s) => {
      s.undoStack.push(tx)
      const model = { ...s.model }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  commitCosmeticTip(baseline) {
    const cur = get().model.nodes.get(baseline.id)
    if (!cur) return
    if (
      cur.tipAngle === baseline.tipAngle &&
      cur.tipLength === baseline.tipLength &&
      cur.tip?.x === baseline.tip?.x &&
      cur.tip?.y === baseline.tip?.y
    ) return
    const before: ModelNode = {
      ...cur,
      tipAngle: baseline.tipAngle,
      tipLength: baseline.tipLength,
      tip: baseline.tip,
    }
    const tx: Patch[] = [{ kind: 'node', op: 'update', id: baseline.id, before, after: cur }]
    set((s) => {
      s.undoStack.push(tx)
      const model = { ...s.model }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  undo() {
    const inverted = get().undoStack.undo()
    if (!inverted) return
    set((s) => {
      const nodes = s.model.nodes
      const edges = s.model.edges
      for (const p of inverted) applyPatch(p, nodes, edges)
      const model = { ...s.model }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  redo() {
    const tx = get().undoStack.redo()
    if (!tx) return
    set((s) => {
      const nodes = s.model.nodes
      const edges = s.model.edges
      for (const p of tx) applyPatch(p, nodes, edges)
      const model = { ...s.model }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  loadModel(model) {
    set((s) => {
      s.undoStack.clear()
      const nextModel = withDefaultGrid(model)
      const models = new Map(s.models)
      models.set(nextModel.id, nextModel)
      return {
        model: nextModel,
        models,
        selectedIds: new Set(),
        selectedEdgeIds: new Set(),
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

  loadProject(snapshot) {
    set((s) => {
      const normalizedModels = new Map<string, Model>()
      for (const [id, model] of snapshot.models) normalizedModels.set(id, withDefaultGrid(model))
      const root = normalizedModels.get(snapshot.rootModelId)
      if (!root) return s
      s.undoStack.clear()
      return {
        model: root,
        models: normalizedModels,
        selectedIds: new Set(),
        selectedEdgeIds: new Set(),
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

  setDefaultConnectionKind(kind) {
    set({ defaultConnectionKind: kind })
  },

  setPickMode(mode) {
    set({ pickMode: mode })
  },

  setCosmetics(patch) {
    set((s) => {
      const cur = s.model.cosmetics ?? {}
      const cosmetics: ModelCosmetics = { ...cur, ...patch }
      const model: Model = { ...s.model, cosmetics }
      const models = new Map(s.models)
      models.set(model.id, model)
      return { model, models, rev: s.rev + 1 }
    })
  },

  registerModel(model) {
    set((s) => {
      const nextModel = withDefaultGrid(model)
      const models = new Map(s.models)
      models.set(nextModel.id, nextModel)
      return { models }
    })
    return model.id
  },

  setActiveModel(id) {
    const next = get().models.get(id)
    if (!next) return
    const nextModel = withDefaultGrid(next)
    set((s) => {
      // Preserve selection ids that exist in the target model (MPD twins).
      const keep = new Set<string>()
      for (const sid of s.selectedIds) {
        if (nextModel.nodes.has(sid)) keep.add(sid)
      }
      const selectionChanged = keep.size !== s.selectedIds.size
      return {
        model: nextModel,
        models: next === nextModel ? s.models : new Map(s.models).set(nextModel.id, nextModel),
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

  addExternalMpdLink(nodeId, rawLink) {
    const s = get()
    const source = s.model.nodes.get(nodeId)
    if (!source) return null
    const link = completeExternalMpdLink(rawLink)
    let dims: string[] = source.mpdDimensions ? [...source.mpdDimensions] : [s.model.id]
    if (!dims.includes(s.model.id)) dims = [s.model.id, ...dims]
    if (!dims.includes(link.id)) dims.push(link.id)
    const externalMpdLinks = { ...(source.externalMpdLinks ?? {}), [link.id]: link }
    set((cur) => {
      const models = new Map(cur.models)
      for (const dimId of dims) {
        const m = models.get(dimId)
        if (!m) continue
        const twinInM = m.nodes.get(nodeId)
        if (!twinInM) continue
        m.nodes.set(nodeId, { ...twinInM, mpdDimensions: dims, externalMpdLinks })
      }
      const live = cur.model.nodes.get(nodeId)
      if (live) {
        ;(live as { mpdDimensions?: string[] }).mpdDimensions = dims
        ;(live as { externalMpdLinks?: Record<string, ExternalMpdLink> }).externalMpdLinks = externalMpdLinks
      }
      return {
        model: { ...cur.model },
        models,
        rev: cur.rev + 1,
      }
    })
    return link.id
  },

  addChildModel(nodeId, name) {
    const s = get()
    const node = s.model.nodes.get(nodeId)
    if (!node) return null
    if (node.childModelId) return null
    const newModelId = `model_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
    const child: Model = {
      id: newModelId,
      name: name ?? `${node.label || node.id} · child`,
      nodes: new Map(),
      edges: new Map(),
    }
    // Register the model first (non-undoable; the registry is project-level).
    set((cur) => {
      const models = new Map(cur.models)
      models.set(newModelId, child)
      return { models }
    })
    // Link via an undoable update so toggling the link via undo/redo works.
    get().updateNode(nodeId, { childModelId: newModelId })
    return newModelId
  },

  addExternalRmmLink(nodeId, rawLink) {
    const node = get().model.nodes.get(nodeId)
    if (!node || node.childModelId) return null
    const link = completeExternalRmmLink(rawLink)
    get().updateNode(nodeId, { childModelId: link.id, externalRmmLink: link })
    return link.id
  },

  removeChildModel(nodeId) {
    const node = get().model.nodes.get(nodeId)
    if (!node?.childModelId) return
    // Patch only the field to keep the patch payload minimal; we deliberately
    // leave the registered child model in place (re-link with undo restores
    // the previous reference).
    get().updateNode(nodeId, { childModelId: undefined, externalRmmLink: undefined })
  },

  /**
   * Link two nodes symmetrically. Implemented as two node-update patches
   * inside one transaction so undo unlinks both ends in lock-step.
   */
  linkNodes(a, b) {
    if (a === b) return
    const s = get()
    const na = s.model.nodes.get(a)
    const nb = s.model.nodes.get(b)
    if (!na || !nb) return
    const aLinks = na.linkedNodeIds ?? []
    const bLinks = nb.linkedNodeIds ?? []
    const tx: Patch[] = []
    if (!aLinks.includes(b)) {
      const after = { ...na, linkedNodeIds: [...aLinks, b] }
      tx.push({ kind: 'node', op: 'update', id: a, before: na, after })
    }
    if (!bLinks.includes(a)) {
      const after = { ...nb, linkedNodeIds: [...bLinks, a] }
      tx.push({ kind: 'node', op: 'update', id: b, before: nb, after })
    }
    if (tx.length === 0) return
    get().applyTransaction(tx)
  },

  unlinkNodes(a, b) {
    if (a === b) return
    const s = get()
    const na = s.model.nodes.get(a)
    const nb = s.model.nodes.get(b)
    if (!na || !nb) return
    const tx: Patch[] = []
    if (na.linkedNodeIds?.includes(b)) {
      const after = { ...na, linkedNodeIds: na.linkedNodeIds.filter((x) => x !== b) }
      tx.push({ kind: 'node', op: 'update', id: a, before: na, after })
    }
    if (nb.linkedNodeIds?.includes(a)) {
      const after = { ...nb, linkedNodeIds: nb.linkedNodeIds.filter((x) => x !== a) }
      tx.push({ kind: 'node', op: 'update', id: b, before: nb, after })
    }
    if (tx.length > 0) get().applyTransaction(tx)
    // Prune any cross-effect links that span the two nodes. Cross-links
    // are NOT undoable (see addCrossLink contract) so we drop them
    // outside the transaction.
    const links = s.model.crossLinks ?? []
    const keep = links.filter(
      (l) => !((l.from.nodeId === a && l.to.nodeId === b) || (l.from.nodeId === b && l.to.nodeId === a)),
    )
    if (keep.length !== links.length) {
      set((cur) => {
        const model: Model = { ...cur.model, crossLinks: keep }
        const models = new Map(cur.models)
        models.set(model.id, model)
        return { model, models, rev: cur.rev + 1 }
      })
    }
  },

  /**
   * Cross-graph links are stored on `model.crossLinks` and treated like
   * sidebar/clipboard state — they record authoring intent rather than a
   * mutation of the active scene, and they are NOT routed through the
   * undo stack. (Spec §4.7 reserves undo for first-class node/edge
   * mutations; cross-links can be re-added cheaply via the FlowEffectEditor.)
   */
  addCrossLink(from, to) {
    const s = get()
    const a = s.model.nodes.get(from.nodeId)
    const b = s.model.nodes.get(to.nodeId)
    if (!a || !b) return null
    if (!a.linkedNodeIds?.includes(to.nodeId)) return null
    const links = s.model.crossLinks ?? []
    const dup = links.find(
      (l) =>
        (l.from.nodeId === from.nodeId && l.from.effectId === from.effectId &&
          l.from.effectNodeId === from.effectNodeId &&
          l.to.nodeId === to.nodeId && l.to.effectId === to.effectId &&
          l.to.effectNodeId === to.effectNodeId) ||
        (l.from.nodeId === to.nodeId && l.from.effectId === to.effectId &&
          l.from.effectNodeId === to.effectNodeId &&
          l.to.nodeId === from.nodeId && l.to.effectId === from.effectId &&
          l.to.effectNodeId === from.effectNodeId),
    )
    if (dup) return dup.id
    const id = newId('xl')
    const link = { id, from: { ...from }, to: { ...to } }
    set((cur) => {
      const model: Model = { ...cur.model, crossLinks: [...(cur.model.crossLinks ?? []), link] }
      const models = new Map(cur.models)
      models.set(model.id, model)
      return { model, models, rev: cur.rev + 1 }
    })
    return id
  },

  removeCrossLink(id) {
    const s = get()
    const links = s.model.crossLinks ?? []
    const next = links.filter((l) => l.id !== id)
    if (next.length === links.length) return
    set((cur) => {
      const model: Model = { ...cur.model, crossLinks: next }
      const models = new Map(cur.models)
      models.set(model.id, model)
      return { model, models, rev: cur.rev + 1 }
    })
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
