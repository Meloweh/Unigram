/**
 * Bridges the Zustand store ↔ SceneRenderer.
 *
 * - Subscribes to `rev` to push committed model snapshots into the renderer.
 * - Subscribes to `camera` to push hot-path camera changes (these can be
 *   skipped on input paths that already wrote the renderer directly — the
 *   bridge tolerates redundant writes via dirty-key short-circuits in pools).
 *
 * Returns an `unsubscribe` function. Idempotent — safe to mount/unmount.
 */

import type { SceneRenderer } from '../scene/SceneRenderer'
import { useOmniStore, type Store } from '../model/store'

export function bindStoreToRenderer(renderer: SceneRenderer): () => void {
  const pushModel = (s: Store) => {
    renderer.setModel({ nodes: s.model.nodes, edges: s.model.edges })
  }
  const pushCamera = (s: Store) => {
    renderer.setCamera(s.camera)
  }

  // Initial sync.
  pushModel(useOmniStore.getState())
  pushCamera(useOmniStore.getState())

  let lastRev = useOmniStore.getState().rev
  let lastCam = useOmniStore.getState().camera
  const unsub = useOmniStore.subscribe((s) => {
    if (s.rev !== lastRev) {
      lastRev = s.rev
      pushModel(s)
    }
    if (s.camera !== lastCam) {
      lastCam = s.camera
      pushCamera(s)
    }
  })
  return unsub
}
