/**
 * Bridges the Zustand store ↔ SceneRenderer.
 *
 * - On `rev` change: if the live `nodes` and `edges` Map identities are
 *   unchanged (i.e. the store mutated in place — the common case for drag
 *   commits, edits, undo/redo), we only call `invalidate()` and skip the
 *   quadtree rebuild. The renderer's per-op hooks (e.g. `moveNodeDirect`)
 *   are responsible for keeping the quadtree in sync. Add/remove of nodes
 *   currently still hits this path; a follow-up will dispatch entity-add
 *   patches incrementally so the quadtree updates without a rebuild.
 * - On full `loadModel` (Map identities swap): full `setModel` + rebuild.
 * - On `camera` change: hot-path camera push (idempotent on the renderer).
 *
 * Returns an `unsubscribe` function. Idempotent — safe to mount/unmount.
 */

import type { SceneRenderer } from '../scene/SceneRenderer'
import { useOmniStore, type Store } from '../model/store'
import type { Connection, ModelNode } from '../model/types'

export function bindStoreToRenderer(renderer: SceneRenderer): () => void {
  let lastNodes: Map<string, ModelNode> | null = null
  let lastEdges: Map<string, Connection> | null = null

  const pushModel = (s: Store) => {
    const nodesChanged = s.model.nodes !== lastNodes
    const edgesChanged = s.model.edges !== lastEdges
    if (nodesChanged || edgesChanged) {
      // Map identity swapped (loadModel, or external mutation) — full sync.
      renderer.setModel({ nodes: s.model.nodes, edges: s.model.edges })
      lastNodes = s.model.nodes
      lastEdges = s.model.edges
    } else {
      // Same Maps, just mutated in place. Renderer's quadtree is already
      // current for drag-bypass commits; for add/remove transactions the
      // renderer will catch up on the next setModel call. Re-cull only.
      renderer.syncIncremental(s.model.nodes, s.model.edges)
    }
  }
  const pushCamera = (s: Store) => {
    // RMM cameraScale composes multiplicatively with the user's free-zoom.
    renderer.setCamera({
      panX: s.camera.panX,
      panY: s.camera.panY,
      freeScale: s.camera.freeScale * s.zoom.cameraScale,
    })
  }
  const pushRmm = (s: Store) => {
    renderer.setRmm(s.zoom, s.focusedNodeId)
  }

  // Initial sync.
  pushModel(useOmniStore.getState())
  pushCamera(useOmniStore.getState())
  pushRmm(useOmniStore.getState())
  renderer.setSelection(useOmniStore.getState().selectedIds)

  let lastRev = useOmniStore.getState().rev
  let lastSelRev = useOmniStore.getState().selRev
  let lastZoomRev = useOmniStore.getState().zoomRev
  let lastCam = useOmniStore.getState().camera
  const unsub = useOmniStore.subscribe((s) => {
    if (s.rev !== lastRev) {
      lastRev = s.rev
      pushModel(s)
    }
    if (s.selRev !== lastSelRev) {
      lastSelRev = s.selRev
      renderer.setSelection(s.selectedIds)
    }
    if (s.zoomRev !== lastZoomRev) {
      lastZoomRev = s.zoomRev
      pushRmm(s)
      // RMM cameraScale changed — push camera too (composes).
      pushCamera(s)
    }
    if (s.camera !== lastCam) {
      lastCam = s.camera
      pushCamera(s)
    }
  })
  return unsub
}
