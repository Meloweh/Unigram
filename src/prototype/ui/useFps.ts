import { useEffect, useRef, useState } from 'react'

/** Continuously measures frames-per-second via rAF. Returns a smoothed FPS value. */
export function useFps(): number {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const lastTime = useRef(performance.now())
  const raf = useRef(0)

  useEffect(() => {
    const tick = (now: number) => {
      frames.current++
      const elapsed = now - lastTime.current
      if (elapsed >= 500) {
        setFps(Math.round(frames.current * 1000 / elapsed))
        frames.current = 0
        lastTime.current = now
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])

  return fps
}
