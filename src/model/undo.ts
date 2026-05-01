/**
 * Patch-based undo. Each patch describes a single entity-level change that can
 * be applied or inverted in O(1). The store is responsible for invoking
 * `applyPatch` on undo/redo; the patches themselves are pure data.
 *
 * Camera state is intentionally NOT modeled here (per spec §4.7).
 */

import type { Connection, ModelNode } from './types'

export type Patch =
  | { kind: 'node'; op: 'add'; node: ModelNode }
  | { kind: 'node'; op: 'remove'; node: ModelNode }
  | { kind: 'node'; op: 'update'; id: string; before: ModelNode; after: ModelNode }
  | { kind: 'edge'; op: 'add'; edge: Connection }
  | { kind: 'edge'; op: 'remove'; edge: Connection }
  | { kind: 'edge'; op: 'update'; id: string; before: Connection; after: Connection }

export function invertPatch(p: Patch): Patch {
  switch (p.op) {
    case 'add':
      return p.kind === 'node'
        ? { kind: 'node', op: 'remove', node: p.node }
        : { kind: 'edge', op: 'remove', edge: p.edge }
    case 'remove':
      return p.kind === 'node'
        ? { kind: 'node', op: 'add', node: p.node }
        : { kind: 'edge', op: 'add', edge: p.edge }
    case 'update':
      return p.kind === 'node'
        ? { kind: 'node', op: 'update', id: p.id, before: p.after, after: p.before }
        : { kind: 'edge', op: 'update', id: p.id, before: p.after, after: p.before }
  }
}

/** Apply a patch to live nodes/edges maps. Mutates in place. */
export function applyPatch(
  patch: Patch,
  nodes: Map<string, ModelNode>,
  edges: Map<string, Connection>,
): void {
  switch (patch.op) {
    case 'add':
      if (patch.kind === 'node') nodes.set(patch.node.id, patch.node)
      else edges.set(patch.edge.id, patch.edge)
      return
    case 'remove':
      if (patch.kind === 'node') nodes.delete(patch.node.id)
      else edges.delete(patch.edge.id)
      return
    case 'update':
      if (patch.kind === 'node') nodes.set(patch.id, patch.after)
      else edges.set(patch.id, patch.after)
      return
  }
}

/**
 * Bounded ring buffer of patch groups. A "transaction" is an array of patches
 * applied/undone atomically (e.g. a multi-node delete or a drag commit).
 */
export class UndoStack {
  private undoStack: Patch[][] = []
  private redoStack: Patch[][] = []
  private readonly max: number

  constructor(max = 100) {
    this.max = max
  }

  push(transaction: Patch[]): void {
    if (transaction.length === 0) return
    this.undoStack.push(transaction)
    if (this.undoStack.length > this.max) this.undoStack.shift()
    this.redoStack.length = 0
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Pops a transaction and returns its inverse, ready to apply. */
  undo(): Patch[] | null {
    const tx = this.undoStack.pop()
    if (!tx) return null
    this.redoStack.push(tx)
    // Inverted in reverse order so dependent patches unwind correctly.
    const inverted: Patch[] = []
    for (let i = tx.length - 1; i >= 0; i--) inverted.push(invertPatch(tx[i]))
    return inverted
  }

  redo(): Patch[] | null {
    const tx = this.redoStack.pop()
    if (!tx) return null
    this.undoStack.push(tx)
    return tx
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }

  get depth(): number {
    return this.undoStack.length
  }
}
