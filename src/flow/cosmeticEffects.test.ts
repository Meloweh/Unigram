import { describe, expect, it } from 'vitest'
import { defaultCosmeticEffect } from './cosmeticEffects'

describe('defaultCosmeticEffect', () => {
  it('creates a locked always-play cloud levitation effect', () => {
    const effect = defaultCosmeticEffect('thinking-cloud')
    expect(effect.locked).toBe(true)
    expect(effect.alwaysPlay).toBe(true)
    expect(effect.graph.nodes[0].kind).toBe('cloud-levitate')
  })

  it('creates a locked always-play bubble levitation effect', () => {
    const effect = defaultCosmeticEffect('chat-bubble')
    expect(effect.locked).toBe(true)
    expect(effect.alwaysPlay).toBe(true)
    expect(effect.graph.nodes[0].kind).toBe('bubble-levitate')
  })
})
