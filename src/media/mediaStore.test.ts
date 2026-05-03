import { describe, it, expect, beforeEach } from 'vitest'
import { storeMediaBlob, getMediaBlob, clearMediaStore } from './mediaStore'

describe('mediaStore', () => {
  beforeEach(() => clearMediaStore())

  it('returns the same URL for byte-identical blobs (dedup by hash)', async () => {
    const a = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const b = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const u1 = await storeMediaBlob(a)
    const u2 = await storeMediaBlob(b)
    expect(u1).toBe(u2)
  })

  it('returns distinct URLs for different content', async () => {
    const a = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const b = new Blob([new Uint8Array([1, 2, 3, 5])], { type: 'image/png' })
    const u1 = await storeMediaBlob(a)
    const u2 = await storeMediaBlob(b)
    expect(u1).not.toBe(u2)
  })

  it('round-trips a blob through getMediaBlob', async () => {
    const a = new Blob([new Uint8Array([7, 7, 7])], { type: 'audio/mp3' })
    const url = await storeMediaBlob(a)
    const got = getMediaBlob(url)
    expect(got).not.toBeNull()
    expect(got!.size).toBe(3)
    expect(got!.type).toBe('audio/mp3')
  })
})
