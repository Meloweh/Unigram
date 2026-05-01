import { describe, expect, it } from 'vitest'
import type { Connection, ModelNode } from './types'
import { applyPatch, invertPatch, type Patch, UndoStack } from './undo'

const node = (id: string, x = 0, y = 0): ModelNode => ({
  id,
  x,
  y,
  w: 8,
  h: 4,
  label: id,
  shape: 'rounded-rect',
  cellColor: '#fff',
  membraneColor: '#000',
})

const edge = (id: string, from: string, to: string): Connection => ({
  id,
  from,
  to,
  color: '#000',
  width: 0.1,
})

describe('invertPatch', () => {
  it('inverts add↔remove for nodes', () => {
    const p: Patch = { kind: 'node', op: 'add', node: node('a') }
    expect(invertPatch(p)).toEqual({ kind: 'node', op: 'remove', node: node('a') })
  })
  it('inverts add↔remove for edges', () => {
    const p: Patch = { kind: 'edge', op: 'remove', edge: edge('e', 'a', 'b') }
    expect(invertPatch(p)).toEqual({ kind: 'edge', op: 'add', edge: edge('e', 'a', 'b') })
  })
  it('swaps before/after for updates', () => {
    const before = node('a', 0, 0)
    const after = node('a', 9, 9)
    const p: Patch = { kind: 'node', op: 'update', id: 'a', before, after }
    expect(invertPatch(p)).toEqual({ kind: 'node', op: 'update', id: 'a', before: after, after: before })
  })
})

describe('applyPatch', () => {
  it('add then invert leaves the maps empty', () => {
    const nodes = new Map<string, ModelNode>()
    const edges = new Map<string, Connection>()
    const p: Patch = { kind: 'node', op: 'add', node: node('a') }
    applyPatch(p, nodes, edges)
    expect(nodes.size).toBe(1)
    applyPatch(invertPatch(p), nodes, edges)
    expect(nodes.size).toBe(0)
  })
})

describe('UndoStack', () => {
  it('returns null when empty', () => {
    const s = new UndoStack()
    expect(s.undo()).toBeNull()
    expect(s.redo()).toBeNull()
  })

  it('push then undo returns the inverse in reverse order', () => {
    const s = new UndoStack()
    const p1: Patch = { kind: 'node', op: 'add', node: node('a') }
    const p2: Patch = { kind: 'node', op: 'add', node: node('b') }
    s.push([p1, p2])
    const inv = s.undo()!
    expect(inv).toHaveLength(2)
    // Inverted in REVERSE so dependent ops unwind correctly.
    expect(inv[0]).toEqual({ kind: 'node', op: 'remove', node: node('b') })
    expect(inv[1]).toEqual({ kind: 'node', op: 'remove', node: node('a') })
  })

  it('redo replays the original transaction', () => {
    const s = new UndoStack()
    const p: Patch = { kind: 'node', op: 'add', node: node('a') }
    s.push([p])
    s.undo()
    const re = s.redo()
    expect(re).toEqual([p])
  })

  it('pushing a new transaction clears the redo stack', () => {
    const s = new UndoStack()
    s.push([{ kind: 'node', op: 'add', node: node('a') }])
    s.undo()
    expect(s.canRedo()).toBe(true)
    s.push([{ kind: 'node', op: 'add', node: node('b') }])
    expect(s.canRedo()).toBe(false)
  })

  it('drops the oldest transaction past the cap', () => {
    const s = new UndoStack(3)
    for (let i = 0; i < 5; i++) {
      s.push([{ kind: 'node', op: 'add', node: node(`n${i}`) }])
    }
    expect(s.depth).toBe(3)
    // The 3 retained should be n2, n3, n4 (oldest two dropped).
    const last = s.undo()!
    expect(last[0]).toMatchObject({ kind: 'node', op: 'remove', node: { id: 'n4' } })
  })

  it('ignores empty transactions', () => {
    const s = new UndoStack()
    s.push([])
    expect(s.depth).toBe(0)
    expect(s.canUndo()).toBe(false)
  })
})
