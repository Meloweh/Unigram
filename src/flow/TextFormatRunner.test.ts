import { describe, expect, it } from 'vitest'
import { TextFormatRunner } from './TextFormatRunner'
import type { ModelNode } from '../model/types'

function node(): ModelNode {
  return {
    id: 'n1',
    x: 0,
    y: 0,
    w: 5,
    h: 5,
    label: 'Hello world',
    shape: 'rounded-rect',
    cellColor: '#fff',
    membraneColor: '#000',
  }
}

describe('TextFormatRunner', () => {
  it('applies and restores temporary text formats', () => {
    const n = node()
    const runner = new TextFormatRunner()
    runner.start(n, { startIndex: 0, endIndex: 5, bold: 1, tint: 0xff00aa, fontSize: 24 })
    expect(n.textFormats).toEqual([
      { start: 0, end: 5, bold: true, color: '#ff00aa', fontSize: 24 },
    ])
    runner.stop(n)
    expect(n.textFormats).toBeUndefined()
  })

  it('restores the original ranges when interrupted', () => {
    const n = node()
    n.textFormats = [{ start: 6, end: 11, italic: true }]
    const runner = new TextFormatRunner()
    runner.start(n, { startIndex: 0, endIndex: -1, strikethrough: 1 })
    expect(n.textFormats).toHaveLength(2)
    runner.stop(n)
    expect(n.textFormats).toEqual([{ start: 6, end: 11, italic: true }])
  })

  it('keeps multiple active text-format nodes composed independently', () => {
    const n = node()
    const runner = new TextFormatRunner()
    runner.start(n, { startIndex: 0, endIndex: 5, bold: 1 }, 'first')
    runner.start(n, { startIndex: 6, endIndex: 11, italic: 1 }, 'second')
    expect(n.textFormats).toEqual([
      { start: 0, end: 5, bold: true },
      { start: 6, end: 11, italic: true },
    ])
    runner.stop(n, 'first')
    expect(n.textFormats).toEqual([{ start: 6, end: 11, italic: true }])
    runner.stop(n, 'second')
    expect(n.textFormats).toBeUndefined()
  })

  it('adds legacy-style xy transforms for animated text formats', () => {
    const n = node()
    const runner = new TextFormatRunner()
    runner.start(n, { startIndex: 0, endIndex: 5, animationStyle: 1, fontSize: 24 }, 'cloud')
    runner.tick(new Map([[n.id, n]]), performance.now() + 100)
    const fmt = n.textFormats?.[0]
    expect(fmt?.fontSize).toBe(24)
    expect(Math.abs(fmt?.offsetX ?? 0) + Math.abs(fmt?.offsetY ?? 0)).toBeGreaterThan(0)
  })
})
