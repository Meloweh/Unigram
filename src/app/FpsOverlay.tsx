/**
 * FpsOverlay — minimal HUD showing current renderer FPS, visible-node count,
 * and total node count. Bypasses React's reconciler on the hot path by
 * writing `textContent` from a `setInterval` poll.
 */

import { useEffect, useRef } from 'react'
import type { SceneRenderer } from '../scene/SceneRenderer'

interface Props {
  renderer: SceneRenderer | null
}

export function FpsOverlay({ renderer }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!renderer || !ref.current) return
    const el = ref.current
    const id = window.setInterval(() => {
      const s = renderer.getStats()
      el.textContent = `${s.fps} fps  ·  visible ${s.visibleNodes}/${s.totalNodes} nodes  ·  ${s.visibleEdges} edges`
    }, 250)
    return () => window.clearInterval(id)
  }, [renderer])
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        padding: '4px 8px',
        font: '12px ui-monospace, Menlo, monospace',
        background: 'var(--ug-glass)',
        color: 'var(--ug-text)',
        border: '1px solid var(--ug-border-light)',
        borderRadius: 4,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      …
    </div>
  )
}
