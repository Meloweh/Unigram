import { describe, expect, it } from 'vitest'
import { TextGenRunner } from './TextGenRunner'
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
    expect(node.label).toBe('')
    r.tick(map, 250) // 2.5 chars at 10 cps → floor 2
    expect(node.label).toBe('he')
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
})
