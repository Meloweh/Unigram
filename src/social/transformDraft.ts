import type { Model, Project } from '../model/types'
import type { NodeGeometry, TransformProposalEntry } from './forumTypes'

type TransformDraftEntry = TransformProposalEntry & { modelId: string }

const EPSILON = 0.0001

let baseline = new Map<string, NodeGeometry>()
let touched = new Set<string>()
let entries: TransformDraftEntry[] = []
const listeners = new Set<() => void>()

export function captureTransformBaseline(snapshot: Project): void {
  const next = new Map<string, NodeGeometry>()
  for (const model of snapshot.models.values()) {
    for (const node of model.nodes.values()) {
      next.set(keyFor(model.id, node.id), geometryOf(node))
    }
  }
  baseline = next
  touched = new Set()
  entries = []
  emit()
}

export function markTransformDraftTouched(modelId: string, nodeIds: Iterable<string>): void {
  let changed = false
  for (const nodeId of nodeIds) {
    const key = keyFor(modelId, nodeId)
    if (touched.has(key)) continue
    touched.add(key)
    changed = true
  }
  if (changed) emit()
}

export function recomputeTransformDraft(snapshot: Project): TransformDraftEntry[] {
  const next: TransformDraftEntry[] = []
  for (const model of snapshot.models.values()) {
    for (const node of model.nodes.values()) {
      const key = keyFor(model.id, node.id)
      const current = geometryOf(node)
      const original = baseline.get(key)
      if (!original) {
        baseline.set(key, current)
        continue
      }
      if (touched.has(key) && geometryChanged(original, current)) {
        next.push({ modelId: model.id, nodeId: node.id, from: original, to: current })
      }
    }
  }
  if (!sameEntries(entries, next)) {
    entries = next
    emit()
  }
  return entries
}

export function getTransformDraftEntries(modelId?: string): TransformProposalEntry[] {
  return entries
    .filter((entry) => !modelId || entry.modelId === modelId)
    .map(({ nodeId, from, to }) => ({ nodeId, from, to }))
}

export function getTransformDraftCount(modelId?: string): number {
  return entries.filter((entry) => !modelId || entry.modelId === modelId).length
}

export function subscribeTransformDraft(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function projectWithServerGeometry(snapshot: Project): Project {
  if (entries.length === 0) return snapshot
  const dirty = new Map(entries.map((entry) => [keyFor(entry.modelId, entry.nodeId), entry.from]))
  const models = new Map<string, Model>()
  for (const [modelId, model] of snapshot.models) {
    let changed = false
    const nodes = new Map(model.nodes)
    for (const node of model.nodes.values()) {
      const original = dirty.get(keyFor(modelId, node.id))
      if (!original) continue
      nodes.set(node.id, { ...node, ...original })
      changed = true
    }
    models.set(modelId, changed ? { ...model, nodes } : model)
  }
  return { rootModelId: snapshot.rootModelId, models }
}

export function acceptTransformProposalBaseline(
  transforms: readonly TransformProposalEntry[],
  modelId: string,
): void {
  let changed = false
  for (const transform of transforms) {
    const key = keyFor(modelId, transform.nodeId)
    baseline.set(key, transform.to)
    touched.delete(key)
    changed = true
  }
  if (changed) {
    entries = entries.filter((entry) => {
      if (entry.modelId !== modelId) return true
      return !transforms.some((transform) => transform.nodeId === entry.nodeId && sameGeometry(transform.to, entry.to))
    })
    emit()
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function keyFor(modelId: string, nodeId: string): string {
  return `${modelId}\u0000${nodeId}`
}

function geometryOf(node: NodeGeometry): NodeGeometry {
  return { x: node.x, y: node.y, w: node.w, h: node.h }
}

function geometryChanged(a: NodeGeometry, b: NodeGeometry): boolean {
  return !sameGeometry(a, b)
}

function sameGeometry(a: NodeGeometry, b: NodeGeometry): boolean {
  return (
    Math.abs(a.x - b.x) <= EPSILON &&
    Math.abs(a.y - b.y) <= EPSILON &&
    Math.abs(a.w - b.w) <= EPSILON &&
    Math.abs(a.h - b.h) <= EPSILON
  )
}

function sameEntries(a: readonly TransformDraftEntry[], b: readonly TransformDraftEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const aa = a[i]
    const bb = b[i]
    if (aa.modelId !== bb.modelId || aa.nodeId !== bb.nodeId) return false
    if (!sameGeometry(aa.from, bb.from) || !sameGeometry(aa.to, bb.to)) return false
  }
  return true
}
