import type { Connection, Project } from '../model/types'

export interface SocialEdgeDraft {
  edgeId: string
  from: string
  to: string
}

let edgeDrafts: SocialEdgeDraft[] = []
const listeners = new Set<() => void>()

export function registerSocialEdgeDraft(edge: Pick<Connection, 'id' | 'from' | 'to'>): void {
  if (edgeDrafts.some((draft) => draft.edgeId === edge.id)) return
  edgeDrafts = [...edgeDrafts, { edgeId: edge.id, from: edge.from, to: edge.to }]
  emit()
}

export function clearSocialEdgeDraft(edgeId: string): void {
  const next = edgeDrafts.filter((draft) => draft.edgeId !== edgeId)
  if (next.length === edgeDrafts.length) return
  edgeDrafts = next
  emit()
}

export function clearSocialEdgeDrafts(): void {
  if (edgeDrafts.length === 0) return
  edgeDrafts = []
  emit()
}

export function getSocialEdgeDrafts(): SocialEdgeDraft[] {
  return edgeDrafts
}

export function getSocialEdgeDraftCount(): number {
  return edgeDrafts.length
}

export function subscribeSocialEdgeDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function projectWithoutSocialEdgeDrafts(snapshot: Project): Project {
  if (edgeDrafts.length === 0) return snapshot
  const ids = new Set(edgeDrafts.map((draft) => draft.edgeId))
  const models = new Map(snapshot.models)
  for (const [modelId, model] of snapshot.models) {
    let changed = false
    const edges = new Map(model.edges)
    for (const edgeId of ids) {
      if (edges.delete(edgeId)) changed = true
    }
    if (changed) models.set(modelId, { ...model, edges })
  }
  return { rootModelId: snapshot.rootModelId, models }
}

function emit(): void {
  for (const listener of listeners) listener()
}
