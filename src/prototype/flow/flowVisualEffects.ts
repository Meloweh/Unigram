import type { EffectGraphNode } from '../model/sampleModels'
import type { FlowEffectCtx, TextFormatOrigStyles } from './flowTypes'
import { playGenSound } from './textGeneratorSounds'
import type { TextGenSoundPreset } from './textGeneratorSounds'
import { connectOBS } from './obsWebSocket'

// Visual effect handlers: spawn-circular, emerge, scale, text-format, record, and no-op kinds.
// Each handler returns the layerMaxDuration contribution for that effect.

export function handleSpawnCircular(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const scItems = (gNode.config.spawnCircularItems as Array<{
    label: string; animation: string; connectionType: string
  }>) ?? []
  const distance = (gNode.config.distance as number) ?? 120
  const delayBetweenMs = (gNode.config.delayBetweenMs as number) ?? 200
  const count = scItems.length
  const totalSpawnDur = count > 0 ? (count - 1) * delayBetweenMs + 400 : 0
  ctx.scheduleEffect(() => {
    if (!ctx.node || count === 0) return
    scItems.forEach((item, idx) => {
      setTimeout(() => {
        const angle = (2 * Math.PI * idx) / count - Math.PI / 2 // start from top
        const spawnX = ctx.node.x + Math.cos(angle) * distance
        const spawnY = ctx.node.y + Math.sin(angle) * distance
        const newId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        ctx.addNode(ctx.frameModelId, { id: newId, label: item.label, x: spawnX, y: spawnY })
        if (item.connectionType !== 'none') {
          ctx.addConnection(ctx.frameModelId, {
            from: ctx.nodeId, to: newId,
            type: item.connectionType === 'flow' ? 'flow' : 'default',
          })
        }
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-node-id="${CSS.escape(newId)}"]`) as HTMLElement | null
          if (el) {
            if (item.animation === 'zip-in') {
              el.style.opacity = '0'
              el.style.transform = 'scale(0.3)'
              el.style.transition = 'opacity 300ms ease, transform 300ms ease'
              requestAnimationFrame(() => {
                el.style.opacity = '1'
                el.style.transform = 'scale(1)'
              })
            } else {
              el.style.transform = 'scale(0)'
              el.style.transition = 'transform 400ms ease'
              requestAnimationFrame(() => {
                el.style.transform = 'scale(1)'
              })
            }
          }
        })
      }, idx * delayBetweenMs)
    })
  }, delay)
  return totalSpawnDur
}

export function handleEmerge(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const animation = (gNode.config.animation as string) ?? 'scale-in'
  const emergeDur = (gNode.config.durationMs as number) ?? 600
  ctx.scheduleEffect(() => {
    // Cosmetic nodes: animate the wrapper; regular: animate the article
    const wrapperEl = document.querySelector(`[data-node-wrapper="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    const articleEl = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    const el = wrapperEl ?? articleEl
    if (!el) return

    // Find the parent node via incoming flow connections
    const incomingConn = ctx.model.connections.find(c => c.to === ctx.nodeId && c.type === 'flow')
    const parentEl = incomingConn
      ? document.querySelector(`[data-node-id="${CSS.escape(incomingConn.from)}"]`) as HTMLElement | null
      : null
    const connKey = incomingConn ? `${incomingConn.from}->${ctx.nodeId}` : ''

    if (animation === 'fade-in') {
      el.style.opacity = '0'
      el.style.transition = `opacity ${emergeDur}ms ease`
      // Also animate the connection during fade-in
      const fadeStart = performance.now()
      const animateFadeConn = (now: number) => {
        const t = Math.min((now - fadeStart) / emergeDur, 1)
        if (connKey) {
          ctx.setEmergeAnimations(prev => {
            const next = new Map(prev)
            if (t >= 1) next.delete(connKey)
            else next.set(connKey, t)
            return next
          })
        }
        if (t < 1) requestAnimationFrame(animateFadeConn)
      }
      requestAnimationFrame(() => {
        el.style.opacity = '1'
        requestAnimationFrame(animateFadeConn)
        setTimeout(() => {
          el.style.transition = ''
        }, emergeDur)
      })
    } else if (parentEl) {
      // scale-in: rAF-driven, animating both node transform and real connection
      const parentRect = parentEl.getBoundingClientRect()
      const selfRect = el.getBoundingClientRect()
      const dx = parentRect.left + parentRect.width / 2 - (selfRect.left + selfRect.width / 2)
      const dy = parentRect.top + parentRect.height / 2 - (selfRect.top + selfRect.height / 2)

      el.style.opacity = '1'
      el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`
      el.style.transition = 'none'

      const startTime = performance.now()
      const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
      const animateEmerge = (now: number) => {
        const raw = Math.min((now - startTime) / emergeDur, 1)
        const t = easeOutCubic(raw)

        // Interpolate node position and scale
        const currDx = dx * (1 - t)
        const currDy = dy * (1 - t)
        el.style.transform = `translate(calc(-50% + ${currDx}px), calc(-50% + ${currDy}px)) scale(${t})`

        // Drive the real connection via emergeAnimations state
        if (connKey) {
          ctx.setEmergeAnimations(prev => {
            const next = new Map(prev)
            if (raw >= 1) next.delete(connKey)
            else next.set(connKey, t)
            return next
          })
        }

        if (raw < 1) {
          requestAnimationFrame(animateEmerge)
        } else {
          el.style.transform = 'translate(-50%, -50%)'
        }
      }
      requestAnimationFrame(animateEmerge)
    } else {
      // No parent — just scale in from self center
      el.style.opacity = '1'
      el.style.transform = 'translate(-50%, -50%) scale(0)'
      el.style.transition = `transform ${emergeDur}ms ease`
      requestAnimationFrame(() => {
        el.style.transform = 'translate(-50%, -50%) scale(1)'
        setTimeout(() => {
          el.style.transition = ''
          el.style.transform = 'translate(-50%, -50%)'
        }, emergeDur)
      })
    }
    // Remove from hidden list since it's now visible
    const hidIdx = ctx.cleanup.emergeHidden.indexOf(el)
    if (hidIdx >= 0) ctx.cleanup.emergeHidden.splice(hidIdx, 1)
  }, delay)
  return emergeDur
}

export function handleDismiss(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const animation = (gNode.config.animation as string) ?? 'scale-out'
  const dismissDur = (gNode.config.durationMs as number) ?? 600
  ctx.scheduleEffect(() => {
    const wrapperEl = document.querySelector(`[data-node-wrapper="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    const articleEl = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    const el = wrapperEl ?? articleEl
    if (!el) return

    // Track for restoration when flow ends
    ctx.cleanup.dismissHidden.push(el)

    if (animation === 'fade-out') {
      el.style.transition = `opacity ${dismissDur}ms ease`
      requestAnimationFrame(() => {
        el.style.opacity = '0'
        setTimeout(() => {
          el.style.transition = ''
        }, dismissDur)
      })
    } else if (animation === 'scale-to-source') {
      // Find the parent node via incoming flow connections (reverse of emerge scale-in)
      const incomingConn = ctx.model.connections.find(c => c.to === ctx.nodeId && c.type === 'flow')
      const parentEl = incomingConn
        ? document.querySelector(`[data-node-id="${CSS.escape(incomingConn.from)}"]`) as HTMLElement | null
        : null

      if (parentEl) {
        const parentRect = parentEl.getBoundingClientRect()
        const selfRect = el.getBoundingClientRect()
        const dx = parentRect.left + parentRect.width / 2 - (selfRect.left + selfRect.width / 2)
        const dy = parentRect.top + parentRect.height / 2 - (selfRect.top + selfRect.height / 2)

        el.style.transition = 'none'
        const startTime = performance.now()
        const easeInCubic = (t: number) => t ** 3
        const animateDismiss = (now: number) => {
          const raw = Math.min((now - startTime) / dismissDur, 1)
          const t = easeInCubic(raw)
          const s = 1 - t
          const currDx = dx * t
          const currDy = dy * t
          el.style.transform = `translate(calc(-50% + ${currDx}px), calc(-50% + ${currDy}px)) scale(${s})`
          if (raw < 1) {
            requestAnimationFrame(animateDismiss)
          } else {
            el.style.opacity = '0'
            el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`
          }
        }
        requestAnimationFrame(animateDismiss)
      } else {
        // No parent — just scale out from self center
        const startTime = performance.now()
        const easeInCubic = (t: number) => t ** 3
        const animateDismiss = (now: number) => {
          const raw = Math.min((now - startTime) / dismissDur, 1)
          const t = easeInCubic(raw)
          const s = 1 - t
          el.style.transform = `translate(-50%, -50%) scale(${s})`
          if (raw < 1) {
            requestAnimationFrame(animateDismiss)
          } else {
            el.style.opacity = '0'
            el.style.transform = 'translate(-50%, -50%) scale(0)'
          }
        }
        requestAnimationFrame(animateDismiss)
      }
    } else {
      // scale-out: shrink to center
      const startTime = performance.now()
      const easeInCubic = (t: number) => t ** 3
      const animateDismiss = (now: number) => {
        const raw = Math.min((now - startTime) / dismissDur, 1)
        const t = easeInCubic(raw)
        const s = 1 - t
        el.style.transform = `translate(-50%, -50%) scale(${s})`
        if (raw < 1) {
          requestAnimationFrame(animateDismiss)
        } else {
          el.style.opacity = '0'
          el.style.transform = 'translate(-50%, -50%) scale(0)'
        }
      }
      requestAnimationFrame(animateDismiss)
    }
  }, delay)
  return dismissDur
}

export function handleScale(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const targetWidth = (gNode.config.targetWidth as number) ?? 200
  const targetHeight = (gNode.config.targetHeight as number) ?? 120
  const scaleDur = (gNode.config.durationMs as number) ?? 500
  const keepPlaying = !!(gNode.config.keepPlaying ?? gNode.config.persistent)
  ctx.scheduleEffect(() => {
    if (!ctx.node) return
    const article = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    if (!article) return
    const el = (article.parentElement?.style.position === 'absolute' || article.parentElement?.style.position === 'fixed')
      ? article.parentElement : article
    const startW = el.offsetWidth
    const startH = el.offsetHeight
    const start = performance.now()
    const animateScale = (now: number) => {
      const t = Math.min((now - start) / scaleDur, 1)
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const w = startW + (targetWidth - startW) * ease
      const h = startH + (targetHeight - startH) * ease
      el.style.width = `${w}px`
      el.style.minWidth = `${w}px`
      el.style.height = `${h}px`
      el.style.minHeight = `${h}px`
      if (t < 1) {
        requestAnimationFrame(animateScale)
      } else if (keepPlaying) {
        // Hold at target size — stopFlowAnimation will revert via scaleRevertTimersRef
        const timer = window.setTimeout(() => {
          // Animate back when flow stops (timer cleared by stopFlowAnimation)
          const revertStart = performance.now()
          const animateRevert = (now2: number) => {
            const t2 = Math.min((now2 - revertStart) / scaleDur, 1)
            const ease2 = t2 < 0.5 ? 2 * t2 * t2 : 1 - (-2 * t2 + 2) ** 2 / 2
            const w2 = targetWidth + (startW - targetWidth) * ease2
            const h2 = targetHeight + (startH - targetHeight) * ease2
            el.style.width = `${w2}px`
            el.style.minWidth = `${w2}px`
            el.style.height = `${h2}px`
            el.style.minHeight = `${h2}px`
            if (t2 < 1) requestAnimationFrame(animateRevert)
            else {
              el.style.width = `${startW}px`
              el.style.minWidth = `${startW}px`
              el.style.height = `${startH}px`
              el.style.minHeight = `${startH}px`
            }
          }
          requestAnimationFrame(animateRevert)
        }, 999999999) // effectively never — cleared by stopFlowAnimation
        ctx.cleanup.scaleTimers.push(timer)
      } else {
        // Animate back to original after brief hold
        const revertStart = performance.now()
        const animateRevert = (now2: number) => {
          const t2 = Math.min((now2 - revertStart) / scaleDur, 1)
          const ease2 = t2 < 0.5 ? 2 * t2 * t2 : 1 - (-2 * t2 + 2) ** 2 / 2
          const w2 = targetWidth + (startW - targetWidth) * ease2
          const h2 = targetHeight + (startH - targetHeight) * ease2
          el.style.width = `${w2}px`
          el.style.minWidth = `${w2}px`
          el.style.height = `${h2}px`
          el.style.minHeight = `${h2}px`
          if (t2 < 1) {
            requestAnimationFrame(animateRevert)
          } else {
            el.style.width = `${startW}px`
            el.style.minWidth = `${startW}px`
            el.style.height = `${startH}px`
            el.style.minHeight = `${startH}px`
          }
        }
        const timer = window.setTimeout(() => {
          requestAnimationFrame(animateRevert)
        }, 200)
        ctx.cleanup.scaleTimers.push(timer)
      }
    }
    requestAnimationFrame(animateScale)
  }, delay)
  return keepPlaying ? 0 : scaleDur * 2 + 200
}

export function handleTextFormat(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const targetMode = (gNode.config.targetMode as string) ?? 'indices'
  let startIdx = (gNode.config.startIndex as number) ?? 0
  let endIdx = (gNode.config.endIndex as number) ?? 0
  const startSubstring = (gNode.config.startSubstring as string) ?? ''
  const endSubstring = (gNode.config.endSubstring as string) ?? ''
  const fmtBold = gNode.config.bold === true
  const fmtItalic = gNode.config.italic === true
  const fmtStrike = gNode.config.strikethrough === true
  const fmtColor = (gNode.config.color as string) || ''
  const fmtFontSize = (gNode.config.fontSize as number) ?? 0
  const rescaleDur = (gNode.config.rescaleDurationMs as number) ?? 0
  const rawResetMode = (gNode.config.resetMode as string) ?? 'node'
  const keepPlaying = !!(gNode.config.keepPlaying ?? (rawResetMode === 'persist'))
  const resetMode = keepPlaying ? 'persist' : rawResetMode
  const holdDur = (gNode.config.durationMs as number) ?? 1000
  const levitateStyle = (gNode.config.levitateStyle as string) ?? 'none'

  // Resolve target range from two substrings
  if (targetMode === 'substrings' && ctx.node) {
    const label = ctx.node.label
    if (startSubstring) {
      const idx = label.indexOf(startSubstring)
      if (idx >= 0) startIdx = idx
    }
    if (endSubstring) {
      const idx = label.indexOf(endSubstring)
      if (idx >= 0) endIdx = idx + endSubstring.length
    }
  }

  if (startIdx >= endIdx) return 0

  ctx.scheduleEffect(() => {
    const article = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    if (!article) return
    const labelEl = article.querySelector('.host-label:not(.host-label-editing)') as HTMLElement | null
    if (!labelEl) return

    // Each span has data-offset="N" (character offset of its first char)
    const spans = labelEl.querySelectorAll<HTMLElement>('span[data-offset]')
    if (spans.length === 0) return

    // Build span ranges from data-offset + textContent length
    const spanRanges: { el: HTMLElement; start: number; end: number }[] = []
    spans.forEach(sp => {
      const off = parseInt(sp.getAttribute('data-offset') ?? '0', 10)
      const len = (sp.textContent ?? '').length
      spanRanges.push({ el: sp, start: off, end: off + len })
    })

    // Split spans at the format boundaries [startIdx, endIdx) so that
    // formatting applies only to the in-range portion of partially-overlapping spans.
    for (let i = spanRanges.length - 1; i >= 0; i--) {
      const sr = spanRanges[i]
      const text = sr.el.textContent ?? ''
      if (sr.start < startIdx && sr.end > startIdx) {
        // Split at startIdx: [sr.start, startIdx) stays, [startIdx, sr.end) is new
        const splitOff = startIdx - sr.start
        const before = document.createElement('span')
        before.setAttribute('data-offset', String(sr.start))
        before.textContent = text.slice(0, splitOff)
        // Copy inline styles
        before.style.cssText = sr.el.style.cssText
        sr.el.parentNode!.insertBefore(before, sr.el)
        sr.el.setAttribute('data-offset', String(startIdx))
        sr.el.textContent = text.slice(splitOff)
        spanRanges.splice(i, 0, { el: before, start: sr.start, end: startIdx })
        sr.start = startIdx
        i++ // re-check the right half for endIdx split
      }
    }
    for (let i = spanRanges.length - 1; i >= 0; i--) {
      const sr = spanRanges[i]
      const text = sr.el.textContent ?? ''
      if (sr.start < endIdx && sr.end > endIdx) {
        // Split at endIdx: [sr.start, endIdx) stays, [endIdx, sr.end) is new
        const splitOff = endIdx - sr.start
        const after = document.createElement('span')
        after.setAttribute('data-offset', String(endIdx))
        after.textContent = text.slice(splitOff)
        // Copy inline styles
        after.style.cssText = sr.el.style.cssText
        sr.el.parentNode!.insertBefore(after, sr.el.nextSibling)
        sr.el.textContent = text.slice(0, splitOff)
        spanRanges.splice(i + 1, 0, { el: after, start: endIdx, end: sr.end })
        sr.end = endIdx
      }
    }

    // The wrapper is the article's parent if it has absolute/fixed positioning, else the article
    const wrapper = (article.parentElement?.style.position === 'absolute' || article.parentElement?.style.position === 'fixed')
      ? article.parentElement : article

    // Capture original wrapper size for revert
    const origWrapperStyles = {
      width: wrapper.style.width,
      minWidth: wrapper.style.minWidth,
      height: wrapper.style.height,
      minHeight: wrapper.style.minHeight,
      transition: wrapper.style.transition,
    }

    // Collect affected spans and their original styles
    const affected: { sr: typeof spanRanges[0]; origStyles: TextFormatOrigStyles }[] = []
    for (const sr of spanRanges) {
      if (sr.end <= startIdx || sr.start >= endIdx) continue
      affected.push({
        sr,
        origStyles: {
          fontWeight: sr.el.style.fontWeight,
          fontStyle: sr.el.style.fontStyle,
          textDecoration: sr.el.style.textDecoration,
          color: sr.el.style.color,
          fontSize: sr.el.style.fontSize,
          transition: sr.el.style.transition,
        },
      })
    }

    // If font size changes with rescale, measure target size synchronously
    // by temporarily applying font-size without transition
    const artCS = getComputedStyle(article)
    const pad = parseFloat(artCS.paddingLeft) + parseFloat(artCS.paddingRight) + 4
    const vPad = parseFloat(artCS.paddingTop) + parseFloat(artCS.paddingBottom) + 4
    let targetW = 0
    let targetH = 0
    if (fmtFontSize > 0 && rescaleDur > 0) {
      // Temporarily set font-size without transition to measure
      for (const { sr } of affected) {
        sr.el.style.transition = 'none'
        sr.el.style.fontSize = `${fmtFontSize}px`
      }
      // Force layout to measure
      targetW = Math.max(160, labelEl.scrollWidth + pad)
      targetH = Math.max(60, labelEl.scrollHeight + vPad)
      // Revert font-size so we can animate from original
      for (const { sr, origStyles } of affected) {
        sr.el.style.fontSize = origStyles.fontSize
      }
      // Force layout flush so browser registers the reverted value
      void labelEl.offsetHeight
    }

    // Apply formatting to overlapping spans
    for (const { sr, origStyles } of affected) {
      if (fmtBold) sr.el.style.fontWeight = 'bold'
      if (fmtItalic) sr.el.style.fontStyle = 'italic'
      if (fmtStrike) sr.el.style.textDecoration = 'line-through'
      if (fmtColor) sr.el.style.color = fmtColor
      if (fmtFontSize > 0) {
        if (rescaleDur > 0) {
          sr.el.style.transition = `font-size ${rescaleDur}ms ease`
        }
        sr.el.style.fontSize = `${fmtFontSize}px`
      }

      // Always store backups so interrupt can restore formatting
      ctx.cleanup.textFormatBackups.push({ el: sr.el, orig: origStyles })

      // Schedule revert for non-persist mode
      if (resetMode === 'node') {
        const timer = window.setTimeout(() => {
          sr.el.style.fontWeight = origStyles.fontWeight
          sr.el.style.fontStyle = origStyles.fontStyle
          sr.el.style.textDecoration = origStyles.textDecoration
          sr.el.style.color = origStyles.color
          if (fmtFontSize > 0 && rescaleDur > 0) {
            sr.el.style.fontSize = origStyles.fontSize || ''
            setTimeout(() => { sr.el.style.transition = origStyles.transition }, rescaleDur)
          } else {
            sr.el.style.fontSize = origStyles.fontSize || ''
            sr.el.style.transition = origStyles.transition
          }
          // Remove from backups since timer handled the revert
          const bkIdx = ctx.cleanup.textFormatBackups.findIndex(b => b.el === sr.el)
          if (bkIdx >= 0) ctx.cleanup.textFormatBackups.splice(bkIdx, 1)
        }, holdDur)
        ctx.cleanup.textFormatTimers.push(timer)
      }
    }

    // Levitate animation on affected spans
    if (levitateStyle !== 'none' && affected.length > 0) {
      const levStart = performance.now()
      const levEntries: { rafId: number; cleanup: () => void }[] = []
      for (let i = 0; i < affected.length; i++) {
        const spanEl = affected[i].sr.el
        const origTransform = spanEl.style.transform
        const phase = i * 0.7 // per-span phase offset for organic feel
        spanEl.style.display = 'inline-block' // needed for transform on inline spans
        const entry = {
          rafId: 0,
          cleanup: () => { spanEl.style.transform = origTransform; spanEl.style.display = '' },
        }
        const animateSpan = (now: number) => {
          const t = (now - levStart) / 1000
          if (resetMode === 'node' && t * 1000 >= holdDur) {
            entry.cleanup()
            return
          }
          const s = t * 1.2 * Math.PI * 2
          if (levitateStyle === 'cloudy') {
            const dx = Math.sin(s * 0.7 + phase) * 3
            const dy = Math.sin(s * 0.5 + phase) * 5
            const rot = Math.sin(s * 0.3 + phase) * 2
            spanEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`
          } else if (levitateStyle === 'jittery') {
            const dx = (Math.random() - 0.5) * 4
            const dy = (Math.random() - 0.5) * 4
            spanEl.style.transform = `translate(${dx}px, ${dy}px)`
          } else if (levitateStyle === 'drunken') {
            const dx = Math.sin(s * 0.3 + phase) * 8
            const dy = Math.sin(s * 0.2 + phase * 1.3) * 3
            const rot = Math.sin(s * 0.25 + phase) * 6
            const sc = 1 + Math.sin(s * 0.4 + phase) * 0.06
            spanEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${sc})`
          } else if (levitateStyle === 'watery') {
            const dx = Math.sin(s * 0.4 + phase) * 2
            const dy = Math.sin(s * 0.6 + phase * 0.8) * 3
            const skX = Math.sin(s * 0.5 + phase) * 3
            const scY = 1 + Math.sin(s * 0.3 + phase * 1.2) * 0.05
            spanEl.style.transform = `translate(${dx}px, ${dy}px) skewX(${skX}deg) scaleY(${scY})`
          } else {
            // bubbly (default)
            const dx = Math.sin(s * 0.6 + phase) * 4
            const dy = Math.sin(s * 0.4 + phase) * 5
            const sc = 1 + Math.sin(s * 0.8 + phase) * 0.04
            spanEl.style.transform = `translate(${dx}px, ${dy}px) scale(${sc})`
          }
          entry.rafId = requestAnimationFrame(animateSpan)
        }
        entry.rafId = requestAnimationFrame(animateSpan)
        levEntries.push(entry)
      }
      ctx.cleanup.levitateAnims.push(...levEntries)
    }

    // Animate wrapper to match font-size change
    if (fmtFontSize > 0) {
      if (rescaleDur > 0) {
        // Animated: set wrapper transition and target size simultaneously with font-size
        const wrapTrans = `width ${rescaleDur}ms ease, min-width ${rescaleDur}ms ease, height ${rescaleDur}ms ease, min-height ${rescaleDur}ms ease`
        wrapper.style.transition = wrapTrans
        wrapper.style.width = `${targetW}px`
        wrapper.style.minWidth = `${targetW}px`
        wrapper.style.height = `${targetH}px`
        wrapper.style.minHeight = `${targetH}px`

        if (resetMode === 'node') {
          // Revert wrapper smoothly after hold duration
          const wrapTimer = window.setTimeout(() => {
            // Ensure transition is still set for revert animation
            wrapper.style.transition = wrapTrans
            wrapper.style.width = origWrapperStyles.width || ''
            wrapper.style.minWidth = origWrapperStyles.minWidth || ''
            wrapper.style.height = origWrapperStyles.height || ''
            wrapper.style.minHeight = origWrapperStyles.minHeight || ''
            // Clean up transition after revert animation completes
            setTimeout(() => {
              wrapper.style.transition = origWrapperStyles.transition
            }, rescaleDur)
          }, holdDur)
          ctx.cleanup.textFormatTimers.push(wrapTimer)
        } else {
          ctx.cleanup.wrapperBackups.push({
            el: wrapper, orig: origWrapperStyles,
          })
        }
      } else {
        // Instant: measure after one frame and set immediately
        requestAnimationFrame(() => {
          const newW = Math.max(160, labelEl.scrollWidth + pad)
          const newH = Math.max(60, labelEl.scrollHeight + vPad)
          wrapper.style.width = `${newW}px`
          wrapper.style.minWidth = `${newW}px`
          wrapper.style.height = `${newH}px`
          wrapper.style.minHeight = `${newH}px`

          if (resetMode === 'node') {
            const wrapTimer = window.setTimeout(() => {
              wrapper.style.width = origWrapperStyles.width
              wrapper.style.minWidth = origWrapperStyles.minWidth
              wrapper.style.height = origWrapperStyles.height
              wrapper.style.minHeight = origWrapperStyles.minHeight
              wrapper.style.transition = origWrapperStyles.transition
            }, holdDur)
            ctx.cleanup.textFormatTimers.push(wrapTimer)
          } else {
            ctx.cleanup.wrapperBackups.push({
              el: wrapper, orig: origWrapperStyles,
            })
          }
        })
      }
    }
  }, delay)
  return resetMode === 'persist' ? 0 : holdDur
}

export function handleRecord(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const recordMode = (gNode.config.recordMode as string) ?? 'browser'
  const captureMode = (gNode.config.captureMode as string) ?? 'tab'
  const hideCursor = gNode.config.hideCursor !== false
  const recWidth = (gNode.config.recordingWidth as number) || undefined
  const recHeight = (gNode.config.recordingHeight as number) || undefined
  const videoBitrateMbps = (gNode.config.videoBitrateMbps as number) || 32
  const fps = (gNode.config.fps as number) || 30
  const codecPref = (gNode.config.codec as string) ?? 'vp9'
  const capturedNodeId = ctx.nodeId

  // Collapse sidebars and hide toolbar before recording starts
  ctx.setForceCollapseSidebars(true)
  ctx.setHideToolbar(true)
  if (hideCursor) document.documentElement.style.cursor = 'none'

  if (recordMode === 'obs') {
    // ---- OBS WebSocket mode ----
    const obsHost = (gNode.config.obsHost as string) || 'localhost'
    const obsPort = (gNode.config.obsPort as number) || 4455
    const obsPassword = (gNode.config.obsPassword as string) || ''

    ctx.scheduleEffect(async () => {
      try {
        const conn = await connectOBS(obsHost, obsPort, obsPassword)
        ctx.obsWsRef.current = conn
        await conn.request('StartRecord')
        ctx.cleanup.mediaDone.add(capturedNodeId)
      } catch (err) {
        // Connection or auth failed — restore UI and let flow proceed
        console.error('OBS recording failed:', err)
        document.documentElement.style.cursor = ''
        ctx.setForceCollapseSidebars(false)
        ctx.setHideToolbar(false)
        ctx.cleanup.mediaDone.add(capturedNodeId)
      }
    }, delay + 400)
    return 600000
  }

  // ---- Browser recording mode ----
  const mimeTypes: Record<string, string[]> = {
    vp9: ['video/webm;codecs=vp09.00.10.08', 'video/webm;codecs=vp9', 'video/webm'],
    vp8: ['video/webm;codecs=vp8', 'video/webm'],
    h264: ['video/mp4;codecs=avc1.640034', 'video/webm;codecs=h264', 'video/webm'],
  }
  const chosenMime = (mimeTypes[codecPref] ?? mimeTypes.vp9).find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
  ctx.scheduleEffect(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: recWidth },
          height: { ideal: recHeight },
          frameRate: { ideal: fps },
        },
        audio: true,
        // @ts-expect-error -- preferCurrentTab is a newer Chrome API
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      })

      // Viewport-only: try CropTarget (Chrome 104+)
      if (captureMode === 'viewport' && ctx.viewportRef.current) {
        try {
          // @ts-expect-error -- CropTarget is not yet in TS typings
          if (typeof CropTarget !== 'undefined') {
            // @ts-expect-error -- CropTarget.fromElement
            const cropTarget = await CropTarget.fromElement(ctx.viewportRef.current)
            const videoTrack = stream.getVideoTracks()[0]
            // @ts-expect-error -- cropTo is newer Chrome API
            if (videoTrack?.cropTo) await videoTrack.cropTo(cropTarget)
          }
        } catch {
          // Fallback: full tab capture
        }
      }

      ctx.flowRecordStreamRef.current = stream
      ctx.flowRecordChunksRef.current = []
      const recorder = new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: videoBitrateMbps * 1_000_000 })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) ctx.flowRecordChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        // Stop stream tracks
        stream.getTracks().forEach(t => t.stop())
        ctx.flowRecordStreamRef.current = null
        // Restore UI — expand sidebars, show toolbar, restore cursor
        document.documentElement.style.cursor = ''
        ctx.setForceCollapseSidebars(false)
        ctx.setHideToolbar(false)
        // Download recording — deferred so UI restores first
        const chunks = ctx.flowRecordChunksRef.current
        ctx.flowRecordChunksRef.current = []
        ctx.flowRecorderRef.current = null
        setTimeout(() => {
          const isMp4 = chosenMime.startsWith('video/mp4')
          const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' })
          if (blob.size > 0) {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `unigram-recording-${Date.now()}.${isMp4 ? 'mp4' : 'webm'}`
            a.click()
            URL.revokeObjectURL(url)
          }
        }, 100)
      }
      // Also handle user closing the browser share dialog
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop()
      })
      ctx.flowRecorderRef.current = recorder
      recorder.start()
      // Signal that recording is ready — flow can proceed
      ctx.cleanup.mediaDone.add(capturedNodeId)
    } catch {
      // User cancelled the getDisplayMedia prompt
      document.documentElement.style.cursor = ''
      ctx.setForceCollapseSidebars(false)
      ctx.setHideToolbar(false)
      // Signal done so flow doesn't hang
      ctx.cleanup.mediaDone.add(capturedNodeId)
    }
  }, delay + 400) // 400ms extra to let sidebars animate closed
  // Use large cap; actual completion signalled by cleanup.mediaDone
  return 600000
}

export function handleRepeater(_ctx: FlowEffectCtx, _gNode: EffectGraphNode, _delay: number): number {
  return 0
}

export function handleCloudLevitate(_ctx: FlowEffectCtx, _gNode: EffectGraphNode, _delay: number): number {
  // These animations are always-playing; flow should not reset them
  return 0
}

export function handleBubbleLevitate(_ctx: FlowEffectCtx, _gNode: EffectGraphNode, _delay: number): number {
  // These animations are always-playing; flow should not reset them
  return 0
}

export function handleTextGenerator(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const targetMode = (gNode.config.targetMode as string) ?? 'indices'
  let startIdx = (gNode.config.startIndex as number) ?? 0
  let endIdx = (gNode.config.endIndex as number) ?? 0
  const startSubstring = (gNode.config.startSubstring as string) ?? ''
  const endSubstring = (gNode.config.endSubstring as string) ?? ''
  const speed = (gNode.config.speed as number) || 50
  const mode = (gNode.config.mode as string) ?? 'letter'
  const soundPreset = (gNode.config.soundPreset as TextGenSoundPreset) ?? 'none'
  const useNodeDuration = !!(gNode.config.useNodeDuration)
  const nodeDurationMs = (gNode.config.nodeDurationMs as number) ?? 1000
  const useDegeneration = !!(gNode.config.useDegeneration)
  const degenerationDurationMs = (gNode.config.degenerationDurationMs as number) ?? 0

  // Resolve target range from two substrings
  if (targetMode === 'substrings' && ctx.node) {
    const label = ctx.node.label
    if (startSubstring) {
      const idx = label.indexOf(startSubstring)
      if (idx >= 0) startIdx = idx
    }
    if (endSubstring) {
      const idx = label.indexOf(endSubstring)
      if (idx >= 0) endIdx = idx + endSubstring.length
    }
  }

  // Default: generate the entire label when indices are both 0
  if (startIdx === 0 && endIdx === 0 && ctx.node) {
    endIdx = ctx.node.label.length
  }

  if (startIdx >= endIdx) {
    return 0
  }

  ctx.scheduleEffect(() => {
    const article = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    if (!article) return
    const labelEl = article.querySelector('.host-label:not(.host-label-editing)') as HTMLElement | null
    if (!labelEl) return

    const spans = labelEl.querySelectorAll<HTMLElement>('span[data-offset]')
    if (spans.length === 0) return

    // Build span range map. Use data-textgen-orig (set by a prior generator) for range
    // calculation so that a second generator can still find its target spans even though
    // a prior generator already emptied their textContent.
    const spanRanges: { el: HTMLElement; start: number; end: number; origText: string; managed: boolean }[] = []
    spans.forEach(sp => {
      const off = parseInt(sp.getAttribute('data-offset') ?? '0', 10)
      const backupText = sp.getAttribute('data-textgen-orig')
      const text = backupText ?? sp.textContent ?? ''
      spanRanges.push({ el: sp, start: off, end: off + text.length, origText: text, managed: backupText != null })
    })

    // Split spans at [startIdx, endIdx) boundaries so the generator only
    // operates on the exact range, leaving pre/post-range text untouched.
    // When splitting a managed span (already hidden by another generator),
    // the new fragment spans must also be managed (empty textContent + data-textgen-orig).
    for (let i = spanRanges.length - 1; i >= 0; i--) {
      const sr = spanRanges[i]
      if (sr.start < startIdx && sr.end > startIdx) {
        const splitOff = startIdx - sr.start
        const before = document.createElement('span')
        before.setAttribute('data-offset', String(sr.start))
        before.style.cssText = sr.el.style.cssText
        const beforeText = sr.origText.slice(0, splitOff)
        if (sr.managed) {
          before.setAttribute('data-textgen-orig', beforeText)
          before.textContent = ''
          ctx.cleanup.textGenHiddenSpans.push({ el: before, origVisibility: '__textgen_text__' })
        } else {
          before.textContent = beforeText
        }
        sr.el.parentNode!.insertBefore(before, sr.el)
        const newOrigText = sr.origText.slice(splitOff)
        sr.el.setAttribute('data-offset', String(startIdx))
        if (sr.managed) {
          sr.el.setAttribute('data-textgen-orig', newOrigText)
          sr.el.textContent = ''
        } else {
          sr.el.textContent = newOrigText
        }
        spanRanges.splice(i, 0, { el: before, start: sr.start, end: startIdx, origText: beforeText, managed: sr.managed })
        sr.start = startIdx
        sr.origText = newOrigText
        i++ // re-check right half for endIdx split
      }
    }
    for (let i = spanRanges.length - 1; i >= 0; i--) {
      const sr = spanRanges[i]
      if (sr.start < endIdx && sr.end > endIdx) {
        const splitOff = endIdx - sr.start
        const after = document.createElement('span')
        after.setAttribute('data-offset', String(endIdx))
        after.style.cssText = sr.el.style.cssText
        const afterText = sr.origText.slice(splitOff)
        if (sr.managed) {
          after.setAttribute('data-textgen-orig', afterText)
          after.textContent = ''
          ctx.cleanup.textGenHiddenSpans.push({ el: after, origVisibility: '__textgen_text__' })
        } else {
          after.textContent = afterText
        }
        sr.el.parentNode!.insertBefore(after, sr.el.nextSibling)
        const newOrigText = sr.origText.slice(0, splitOff)
        if (sr.managed) {
          sr.el.setAttribute('data-textgen-orig', newOrigText)
          sr.el.textContent = ''
        } else {
          sr.el.textContent = newOrigText
        }
        spanRanges.splice(i + 1, 0, { el: after, start: endIdx, end: sr.end, origText: afterText, managed: sr.managed })
        sr.end = endIdx
        sr.origText = newOrigText
      }
    }

    // Collect only spans fully within [startIdx, endIdx)
    const affected = spanRanges.filter(sr => sr.start >= startIdx && sr.end <= endIdx && sr.end > sr.start)
    if (affected.length === 0) return

    // Store original textContent for cleanup via data attribute + sentinel
    for (const sr of affected) {
      sr.el.setAttribute('data-textgen-orig', sr.origText)
      ctx.cleanup.textGenHiddenSpans.push({ el: sr.el, origVisibility: '__textgen_text__' })
    }

    // Truncate affected spans to empty — they are exactly [startIdx, endIdx) after splitting
    for (const sr of affected) {
      sr.el.textContent = ''
    }

    // Hide spans outside our range that aren't already managed by another generator.
    // Each text portion must be explicitly generated by its own Generator Node.
    for (const sr of spanRanges) {
      if (sr.start >= startIdx && sr.end <= endIdx) continue // in-range, handled above
      if (sr.el.hasAttribute('data-textgen-orig')) continue // already managed by another generator
      sr.el.setAttribute('data-textgen-orig', sr.origText)
      sr.el.textContent = ''
      ctx.cleanup.textGenHiddenSpans.push({ el: sr.el, origVisibility: '__textgen_text__' })
    }

    // Wrapper for resize animation
    const wrapper = (article.parentElement?.style.position === 'absolute' || article.parentElement?.style.position === 'fixed')
      ? article.parentElement : article
    const artCS = getComputedStyle(article)
    const pad = parseFloat(artCS.paddingLeft) + parseFloat(artCS.paddingRight) + 4
    const vPad = parseFloat(artCS.paddingTop) + parseFloat(artCS.paddingBottom) + 4

    // Back up wrapper sizing for cleanup
    if (wrapper) {
      wrapper.setAttribute('data-textgen-orig-width', wrapper.style.width)
      wrapper.setAttribute('data-textgen-orig-minwidth', wrapper.style.minWidth)
      wrapper.setAttribute('data-textgen-orig-height', wrapper.style.height)
      wrapper.setAttribute('data-textgen-orig-minheight', wrapper.style.minHeight)
      wrapper.setAttribute('data-textgen-orig-transition', wrapper.style.transition)
      ctx.cleanup.textGenHiddenSpans.push({ el: wrapper as HTMLElement, origVisibility: '__textgen_wrapper__' })
    }

    // Recalculate wrapper size based on currently visible text
    const resizeToContent = () => {
      requestAnimationFrame(() => {
        const newW = Math.max(160, labelEl.scrollWidth + pad)
        const newH = Math.max(60, labelEl.scrollHeight + vPad)
        wrapper.style.transition = 'width 150ms ease, min-width 150ms ease, height 150ms ease, min-height 150ms ease'
        wrapper.style.width = `${newW}px`
        wrapper.style.minWidth = `${newW}px`
        wrapper.style.height = `${newH}px`
        wrapper.style.minHeight = `${newH}px`
      })
    }

    // Reveal up to a given character index across affected spans
    const revealUpTo = (charEnd: number) => {
      for (const sr of affected) {
        const visEnd = Math.min(charEnd, sr.end) - sr.start
        if (visEnd <= 0) {
          sr.el.textContent = ''
        } else if (visEnd >= sr.origText.length) {
          sr.el.textContent = sr.origText
          sr.el.style.visibility = 'visible'
        } else {
          sr.el.textContent = sr.origText.slice(0, visEnd)
          sr.el.style.visibility = 'visible'
        }
      }
    }

    // Build reveal steps based on mode
    type RevealStep = { charEnd: number }
    const steps: RevealStep[] = []
    if (mode === 'word') {
      const label = ctx.node.label
      let pos = startIdx
      while (pos < endIdx) {
        while (pos < endIdx && /\s/.test(label[pos])) pos++
        if (pos >= endIdx) break
        while (pos < endIdx && !/\s/.test(label[pos])) pos++
        // Include trailing whitespace in this step
        while (pos < endIdx && /\s/.test(label[pos])) pos++
        steps.push({ charEnd: pos })
      }
      if (steps.length === 0) steps.push({ charEnd: endIdx })
    } else {
      for (let i = startIdx + 1; i <= endIdx; i++) {
        steps.push({ charEnd: i })
      }
    }

    const stepCount = steps.length

    // Schedule generation steps
    for (let i = 0; i < stepCount; i++) {
      const t = window.setTimeout(() => {
        revealUpTo(steps[i].charEnd)
        if (soundPreset !== 'none' && speed >= 15) {
          const snd = playGenSound(soundPreset, i)
          if (snd) ctx.cleanup.textGenAudioNodes.push(snd)
        }
        resizeToContent()
      }, i * speed)
      ctx.cleanup.textGenTimers.push(t)
    }

    // Schedule degeneration if enabled
    if (useDegeneration) {
      const genDuration = speed * stepCount
      const degenStart = genDuration + (useNodeDuration ? nodeDurationMs : 0)
      const degenStepDelay = stepCount > 1 ? degenerationDurationMs / stepCount : degenerationDurationMs
      for (let i = 0; i < stepCount; i++) {
        const prevCharEnd = (stepCount - 1 - i > 0) ? steps[stepCount - 2 - i].charEnd : startIdx
        const t = window.setTimeout(() => {
          revealUpTo(prevCharEnd)
          resizeToContent()
        }, degenStart + i * degenStepDelay)
        ctx.cleanup.textGenTimers.push(t)
      }
    }

    // Initial resize
    resizeToContent()
  }, delay)

  // Compute total duration
  const stepCount = (() => {
    if (startIdx >= endIdx) return 0
    if (mode === 'word' && ctx.node) {
      const genText = ctx.node.label.slice(startIdx, endIdx)
      let count = 0
      let pos = 0
      while (pos < genText.length) {
        while (pos < genText.length && /\s/.test(genText[pos])) pos++
        if (pos >= genText.length) break
        count++
        while (pos < genText.length && !/\s/.test(genText[pos])) pos++
        while (pos < genText.length && /\s/.test(genText[pos])) pos++
      }
      return count || 1
    }
    return endIdx - startIdx
  })()
  const genDuration = speed * stepCount
  let total = genDuration
  if (useNodeDuration) total += nodeDurationMs
  if (useDegeneration) total += degenerationDurationMs
  return total
}
