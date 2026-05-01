import { useEffect, useRef } from 'react'

/**
 * Continuously measures frames-per-second via rAF.
 * Returns a MutableRefObject whose `.current` stays up-to-date.
 * Writes directly to a DOM element (via `targetRef`) to avoid
 * triggering React re-renders in the parent component.
 */
export function useFps(targetRef?: React.RefObject<HTMLSpanElement | null>): React.MutableRefObject<number> {
  const fpsRef = useRef(0)
  const frames = useRef(0)
  const lastTime = useRef(performance.now())
  const raf = useRef(0)

  useEffect(() => {
    const tick = (now: number) => {
      frames.current++
      const elapsed = now - lastTime.current
      if (elapsed >= 500) {
        const value = Math.round(frames.current * 1000 / elapsed)
        fpsRef.current = value
        frames.current = 0
        lastTime.current = now

        // Update DOM directly — no setState, no React re-render
        const el = targetRef?.current
        if (el) {
          el.textContent = `FPS: ${value}`
          el.style.color = value >= 50 ? '#4caf50' : value >= 25 ? '#ff9800' : '#f44336'
        }
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [targetRef])

  return fpsRef
}
