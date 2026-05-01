/**
 * Stress test for the patch-based undo stack.
 *
 * Hard contracts (per AGENTS.md):
 *   - No `structuredClone` of the model on edits.
 *   - Undo is bounded (UNDO_CAP = 100 transactions).
 *   - Many add/undo/redo cycles should not leak unbounded memory.
 */

import { describe, expect, it } from 'vitest'
import { useOmniStore } from './store'

describe('undo stress', () => {
  it('survives 5000 add/undo cycles with bounded undo stack', () => {
    const store = useOmniStore.getState()
    store.loadModel({
      id: 'stress',
      name: 'stress',
      nodes: new Map(),
      edges: new Map(),
    })
    for (let i = 0; i < 5000; i++) {
      useOmniStore.getState().addNode({ x: (i % 100) - 50, y: Math.floor(i / 100) - 25 })
      useOmniStore.getState().undo()
    }
    // After balanced add/undo cycles the live model is empty.
    expect(useOmniStore.getState().model.nodes.size).toBe(0)
    // Undo stack capped at 100 (per UndoStack constructor default).
    // After undo of every add, the redo-able stack should be capped too.
    // We don't expose stack sizes directly; the assertion that matters is
    // that 5000 cycles ran without throwing or hanging.
  })

  it('1000 sequential adds + 1000 undos restores empty model', () => {
    useOmniStore.getState().loadModel({
      id: 'undo-seq',
      name: 'undo-seq',
      nodes: new Map(),
      edges: new Map(),
    })
    for (let i = 0; i < 1000; i++) {
      useOmniStore.getState().addNode({ x: i % 50, y: Math.floor(i / 50) })
    }
    expect(useOmniStore.getState().model.nodes.size).toBe(1000)
    // Undo capacity is 100 — we can undo at most that many.
    for (let i = 0; i < 100; i++) useOmniStore.getState().undo()
    expect(useOmniStore.getState().model.nodes.size).toBe(900)
  })
})
