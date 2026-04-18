import { useEffect, useMemo, type MutableRefObject } from 'react'
import type { Model } from '../model/sampleModels'

type CosmeticConfig = { cosmeticKind: string; amplitude: number; speed: number; scalePulse: boolean }

/**
 * Always-play autonomous animation for cosmetic nodes (bubble-levitate, cloud-levitate).
 * Extracted from PrototypeViewport.
 */
export function useCosmeticAnimations(
  model: Model,
  alwaysPlayAnimsRef: MutableRefObject<Map<string, { rafId: number; el: HTMLElement; cleanup: () => void }>>,
) {
  // Pre-compute which nodes want cosmetic animation and their configs.
  // Only re-runs when model.nodes changes — avoids O(n) on every render.
  const wantedConfigs = useMemo(() => {
    const configs = new Map<string, CosmeticConfig>()
    for (const node of model.nodes) {
      if (!node.cosmeticType) continue
      const effects = node.flowEffects ?? []
      const cosmeticKind = node.cosmeticType === 'thinking-cloud' ? 'cloud-levitate' : 'bubble-levitate'
      let shouldPlay = true
      const lockedCosmeticEffect = effects.find(e => e.locked && e.graph.nodes.some(n => n.kind === cosmeticKind))
      if (lockedCosmeticEffect && lockedCosmeticEffect.alwaysPlay === false) {
        shouldPlay = false
      }
      for (const fx of effects) {
        if (fx.graph.nodes.some(n => n.kind === cosmeticKind)) {
          if (fx.alwaysPlay === false) shouldPlay = false
          else if (fx.alwaysPlay === true) shouldPlay = true
        }
      }
      if (!shouldPlay) continue
      let amplitude = cosmeticKind === 'cloud-levitate' ? 8 : 10
      let speed = cosmeticKind === 'cloud-levitate' ? 0.8 : 0.5
      let scalePulse = cosmeticKind === 'bubble-levitate'
      for (const fx of effects) {
        for (const gNode of fx.graph.nodes) {
          if (gNode.kind === cosmeticKind) {
            amplitude = (gNode.config.amplitude as number) ?? amplitude
            speed = (gNode.config.speed as number) ?? speed
            if (cosmeticKind === 'bubble-levitate') {
              scalePulse = gNode.config.scalePulse !== false
            }
          }
        }
      }
      configs.set(node.id, { cosmeticKind, amplitude, speed, scalePulse })
    }
    return configs
  }, [model.nodes])

  // Reconcile running animations — runs every render but O(k) where k = cosmetic nodes (typically few)
  useEffect(() => {
    const activeMap = alwaysPlayAnimsRef.current

    // Stop animations for nodes no longer wanted or whose DOM element was culled
    for (const [nodeId, entry] of activeMap) {
      if (!wantedConfigs.has(nodeId) || !entry.el.isConnected) {
        cancelAnimationFrame(entry.rafId)
        entry.cleanup()
        activeMap.delete(nodeId)
      }
    }

    // Start animations for newly wanted nodes whose DOM element is available
    for (const [nodeId, cfg] of wantedConfigs) {
      if (activeMap.has(nodeId)) continue

      const wrapperEl = document.querySelector(`[data-node-wrapper="${CSS.escape(nodeId)}"]`) as HTMLElement | null
      const articleEl = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
      const el = wrapperEl ?? articleEl
      if (!el) continue
      const isWrapper = !!wrapperEl

      const phaseX = Math.random() * Math.PI * 2
      const phaseY = Math.random() * Math.PI * 2
      const start = performance.now()
      const entry = {
        rafId: 0,
        el,
        cleanup: () => { el.style.transform = isWrapper ? 'translate(-50%, -50%)' : ''; el.style.filter = '' },
      }

      const animate = (now: number) => {
        if (!entry.el.isConnected) {
          activeMap.delete(nodeId)
          return
        }
        const elapsed = (now - start) / 1000
        const s = elapsed * cfg.speed * Math.PI * 2
        if (cfg.cosmeticKind === 'cloud-levitate') {
          const dx = Math.sin(s * 0.7 + phaseX) * cfg.amplitude * 0.4
          const dy = Math.sin(s * 0.5 + phaseY) * cfg.amplitude
          const rot = Math.sin(s * 0.3 + phaseX) * 1.5
          el.style.transform = isWrapper
            ? `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`
            : `translate(${dx}px, ${dy}px) rotate(${rot}deg)`
        } else {
          const dx = Math.sin(s * 0.6 + phaseX) * cfg.amplitude * 0.6
          const dy = Math.sin(s * 0.4 + phaseY) * cfg.amplitude
          const sc = cfg.scalePulse ? 1 + Math.sin(s * 0.8) * 0.03 : 1
          el.style.transform = isWrapper
            ? `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${sc})`
            : `translate(${dx}px, ${dy}px) scale(${sc})`
        }
        entry.rafId = requestAnimationFrame(animate)
      }
      entry.rafId = requestAnimationFrame(animate)
      activeMap.set(nodeId, entry)
    }
  }) // runs every render to pick up viewport-culling changes, but O(k) not O(n)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [, entry] of alwaysPlayAnimsRef.current) {
        cancelAnimationFrame(entry.rafId)
        entry.cleanup()
      }
      alwaysPlayAnimsRef.current.clear()
    }
  }, [])
}
