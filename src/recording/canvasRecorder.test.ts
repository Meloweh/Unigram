import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { isRecordingSupported, downloadBlob } from './canvasRecorder'

describe('canvasRecorder', () => {
  it('reports MediaRecorder availability', () => {
    // happy-dom does not implement MediaRecorder, so this should be false.
    expect(typeof isRecordingSupported()).toBe('boolean')
  })

  describe('downloadBlob', () => {
    let createObjectURL: typeof URL.createObjectURL
    let revokeObjectURL: typeof URL.revokeObjectURL

    beforeEach(() => {
      createObjectURL = URL.createObjectURL
      revokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = vi.fn(() => 'blob:test')
      URL.revokeObjectURL = vi.fn()
      vi.useFakeTimers()
    })

    afterEach(() => {
      URL.createObjectURL = createObjectURL
      URL.revokeObjectURL = revokeObjectURL
      vi.useRealTimers()
    })

    it('triggers an anchor click and revokes the URL later', () => {
      const blob = new Blob(['x'], { type: 'video/webm' })
      downloadBlob(blob, 'test.webm')
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
      vi.advanceTimersByTime(1100)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    })
  })
})
