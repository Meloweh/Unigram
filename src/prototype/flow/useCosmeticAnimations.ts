import { useEffect, type MutableRefObject } from 'react'
import type { Model } from '../model/sampleModels'

/**
 * Always-play autonomous animation for cosmetic nodes (bubble-levitate, cloud-levitate).
 * Extracted from PrototypeViewport.
 */
export function useCosmeticAnimations(
  model: Model,
  alwaysPlayAnimsRef: MutableRefObject<Map<string, { rafId: number; el: HTMLElement; cleanup: () => void }>>,
) {
  // ---- Always-play autonomous animation for cosmetic nodes ----
  useEffect(() => {
    const activeMap = alwaysPlayAnimsRef.current
    const wantedNodeIds = new Set<string>()

    for (const node of model.nodes) {
      if (!node.cosmeticType) continue
      const effects = node.flowEffects ?? []
      // Check locked cosmetic effects + virtual default
      const cosmeticKind = node.cosmeticType === 'thinking-cloud' ? 'cloud-levitate' : 'bubble-levitate'
      let shouldPlay = true // default: always-play unless explicitly disabled
      const lockedCosmeticEffect = effects.find(e => e.locked && e.graph.nodes.some(n => n.kind === cosmeticKind))
      if (lockedCosmeticEffect && lockedCosmeticEffect.alwaysPlay === false) {
        shouldPlay = false
      }
      // Also check any non-locked effect with levitate kind
      for (const fx of effects) {
        if (fx.graph.nodes.some(n => n.kind === cosmeticKind)) {
          if (fx.alwaysPlay === false) shouldPlay = false
          else if (fx.alwaysPlay === true) shouldPlay = true
        }
      }
      if (shouldPlay) wantedNodeIds.add(node.id)
    }

    // Stop animations for nodes no longer wanted
    for (const [nodeId, entry] of activeMap) {
      if (!wantedNodeIds.has(nodeId)) {
        cancelAnimationFrame(entry.rafId)
        entry.cleanup()
        activeMap.delete(nodeId)
      }
    }

    // Restart animations whose DOM element was culled (unmounted) and recreated
    for (const [nodeId, entry] of activeMap) {
      if (!entry.el || !entry.el.isConnected) {
        cancelAnimationFrame(entry.rafId)
        entry.cleanup()
        activeMap.delete(nodeId)
      }
    }

    // Start animations for newly wanted nodes
    for (const nodeId of wantedNodeIds) {
      if (activeMap.has(nodeId)) continue
      const node = model.nodes.find(n => n.id === nodeId)
      if (!node) continue

      // Get config from the effect graph node
      const cosmeticKind = node.cosmeticType === 'thinking-cloud' ? 'cloud-levitate' : 'bubble-levitate'
      let amplitude = cosmeticKind === 'cloud-levitate' ? 8 : 10
      let speed = cosmeticKind === 'cloud-levitate' ? 0.8 : 0.5
      let scalePulse = cosmeticKind === 'bubble-levitate'
      for (const fx of (node.flowEffects ?? [])) {
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

      // Prefer wrapper element (cosmetic nodes) so SVG + article move together;
      // fall back to article for non-cosmetic nodes
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
        const elapsed = (now - start) / 1000
        const s = elapsed * speed * Math.PI * 2
        if (cosmeticKind === 'cloud-levitate') {
          // Gentle bob + slight horizontal drift + subtle rotation
          const dx = Math.sin(s * 0.7 + phaseX) * amplitude * 0.4
          const dy = Math.sin(s * 0.5 + phaseY) * amplitude
          const rot = Math.sin(s * 0.3 + phaseX) * 1.5
          el.style.transform = isWrapper
            ? `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`
            : `translate(${dx}px, ${dy}px) rotate(${rot}deg)`
        } else {
          // Bubble levitate: drift + oscillation + scale pulse
          const dx = Math.sin(s * 0.6 + phaseX) * amplitude * 0.6
          const dy = Math.sin(s * 0.4 + phaseY) * amplitude
          const sc = scalePulse ? 1 + Math.sin(s * 0.8) * 0.03 : 1
          el.style.transform = isWrapper
            ? `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${sc})`
            : `translate(${dx}px, ${dy}px) scale(${sc})`
        }
        entry.rafId = requestAnimationFrame(animate)
      }
      entry.rafId = requestAnimationFrame(animate)
      activeMap.set(nodeId, entry)
    }
  }) // runs every render to pick up model changes

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
