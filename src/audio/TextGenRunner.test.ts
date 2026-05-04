import { describe, expect, it } from 'vitest'
import { TextGenRunner, textGenFitLabelOf } from './TextGenRunner'
import type { ModelNode } from '../model/types'

function mkNode(id: string, label = ''): ModelNode {
  return {
    id,
    label,
    x: 0,
    y: 0,
    w: 10,
    h: 5,
    cellColor: '#fff',
    membraneColor: '#000',
    shape: 'cell',
  } as unknown as ModelNode
}

describe('TextGenRunner', () => {
  it('progressively reveals characters at the configured rate', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'original')
    const map = new Map([[node.id, node]])
    r.start(node, { text: 'hello', charsPerSec: 10, sound: 'none' }, 0)
    expect(node.label.trim()).toBe('')
    r.tick(map, 250) // 2.5 chars at 10 cps → floor 2
    expect(node.label.trimEnd()).toBe('he')
    r.tick(map, 1000) // full string + idle
    expect(node.label).toBe('hello')
  })

  it('restores the original label on stop', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'original')
    const map = new Map([[node.id, node]])
    r.start(node, { text: 'xyz', charsPerSec: 10, sound: 'none' }, 0)
    r.tick(map, 100)
    r.stop(node)
    expect(node.label).toBe('original')
    expect(r.has('n1')).toBe(false)
  })

  it('loops when configured and resets at end-hold expiry', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'original')
    const map = new Map([[node.id, node]])
    r.start(
      node,
      { text: 'hi', charsPerSec: 20, sound: 'none', loop: true, endHoldMs: 100 },
      0,
    )
    // Cycle = 100ms type + 100ms hold = 200ms; tick at 250 should reset.
    r.tick(map, 250)
    expect(r.has('n1')).toBe(true)
    expect(node.label.length).toBeLessThanOrEqual(2)
  })

  it('drops the run silently if the owning node is gone', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'original')
    r.start(node, { text: 'abc', charsPerSec: 10, sound: 'none' }, 0)
    r.tick(new Map(), 100)
    expect(r.has('n1')).toBe(false)
  })

  it('animates only the substring range and shows the suffix once complete', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'orig')
    const map = new Map([[node.id, node]])
    // Animate the middle of "Hello world" (chars 6..11 = "world")
    r.start(
      node,
      { text: 'Hello world', charsPerSec: 10, sound: 'none', startIndex: 6, endIndex: 11 },
      0,
    )
    // Initial: every portion is hidden until explicitly generated.
    expect(node.label.trim()).toBe('')
    // Mid-typing (3 chars): only the selected range appears at its source index.
    r.tick(map, 300) // 3 chars
    expect(node.label).toBe('      wor  ')
    expect(textGenFitLabelOf(node)).toBe('wor')
    // Fully typed: the selected range persists; untouched portions stay hidden.
    r.tick(map, 600)
    expect(node.label).toBe('      world')
    expect(textGenFitLabelOf(node)).toBe('world')
  })

  it('exposes a tight fit label while preserving source-index placeholders', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'orig')
    const map = new Map([[node.id, node]])
    r.start(
      node,
      { text: '11111 22222 333', charsPerSec: 100, sound: 'none', startIndex: 6, endIndex: 11 },
      0,
    )
    expect(node.label).toBe('               ')
    expect(textGenFitLabelOf(node)).toBe('')
    r.tick(map, 30)
    expect(node.label).toBe('      222      ')
    expect(textGenFitLabelOf(node)).toBe('222')
    r.stop(node)
    expect(textGenFitLabelOf(node)).toBeUndefined()
  })

  it('keeps non-generated portions hidden', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'orig')
    const map = new Map([[node.id, node]])
    r.start(
      node,
      { text: 'AB-CD-EF', charsPerSec: 10, sound: 'none', startIndex: 3, endIndex: 5 },
      0,
    )
    expect(node.label.trim()).toBe('')
    r.tick(map, 100)
    expect(node.label).toBe('   C    ')
    r.tick(map, 250)
    expect(node.label).toBe('   CD   ')
  })

  it('persists one generated range while a later generator fills another range', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'orig')
    const map = new Map([[node.id, node]])
    r.start(
      node,
      { text: 'ABCDE', charsPerSec: 20, sound: 'none', startIndex: 1, endIndex: 3 },
      0,
      'first',
    )
    r.tick(map, 200)
    expect(node.label).toBe(' BC  ')

    r.start(
      node,
      { text: 'ABCDE', charsPerSec: 20, sound: 'none', startIndex: 3, endIndex: 5 },
      200,
      'second',
    )
    r.tick(map, 250)
    expect(node.label).toBe(' BCD ')

    r.stop(node, 'second')
    expect(node.label).toBe(' BC  ')
    r.stop(node, 'first')
    expect(node.label).toBe('orig')
  })

  it('un-types the animated range over degenerationMs on stop', () => {
    const r = new TextGenRunner()
    const node = mkNode('n1', 'origin')
    const map = new Map([[node.id, node]])
    r.start(
      node,
      { text: 'hello', charsPerSec: 100, sound: 'none', degenerationMs: 1000 },
      0,
    )
    // Type to completion.
    r.tick(map, 60) // ~6 chars at 100cps, capped at 5
    expect(node.label).toBe('hello')
    // performance.now() drives degeneration start; mock it.
    const origNow = performance.now
    let fakeNow = 1000
    performance.now = () => fakeNow
    try {
      r.stop(node)
      expect(r.has('n1')).toBe(true) // still active during degeneration
      // 50% through degeneration → should be roughly half typed.
      fakeNow = 1500
      r.tick(map, 1500)
      expect(node.label.trim().length).toBeGreaterThanOrEqual(1)
      expect(node.label.trim().length).toBeLessThanOrEqual(4)
      // Past degeneration window → original restored.
      fakeNow = 2100
      r.tick(map, 2100)
      expect(node.label).toBe('origin')
      expect(r.has('n1')).toBe(false)
    } finally {
      performance.now = origNow
    }
  })
})
