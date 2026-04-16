import { useEffect, useRef, useState } from 'react'

/** Drives unzip open/close animation (0→1 open, 1→0 close) */
export function useUnzipAnim(popupKey: string | null) {
  const [progress, setProgress] = useState(0)
  const currentRef = useRef(0)
  const lastKeyRef = useRef<string | null>(null)

  if (popupKey) lastKeyRef.current = popupKey

  useEffect(() => {
    if (popupKey) {
      currentRef.current = 0
      setProgress(0)
      const startTime = performance.now()
      let rafId: number
      const tick = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / 400, 1)
        const eased = 1 - (1 - t) ** 3
        currentRef.current = eased
        setProgress(eased)
        if (t < 1) rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafId)
    } else {
      const from = currentRef.current
      if (from < 0.001) return
      const startTime = performance.now()
      let rafId: number
      const tick = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / 250, 1)
        const eased = 1 - (1 - t) ** 3
        const v = from * (1 - eased)
        currentRef.current = v
        setProgress(v)
        if (t < 1) {
          rafId = requestAnimationFrame(tick)
        } else {
          lastKeyRef.current = null
          currentRef.current = 0
          setProgress(0)
        }
      }
      rafId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafId)
    }
  }, [popupKey])

  const displayKey = (popupKey || progress > 0.001) ? (popupKey ?? lastKeyRef.current) : null
  return { progress, displayKey }
}
