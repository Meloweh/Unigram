import type { EffectGraphNode } from './sampleModels'
import type { FlowEffectCtx, TextFormatOrigStyles } from './flowTypes'

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
  const suffix = (gNode.config.suffix as string) ?? ''
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

  // Resolve target range
  if (targetMode === 'suffix' && suffix && ctx.node) {
    const idx = ctx.node.label.lastIndexOf(suffix)
    if (idx >= 0) {
      startIdx = idx
      endIdx = idx + suffix.length
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
    const pad = 32 + 4
    const vPad = 28 + 4
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
          } else {
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
  const captureMode = (gNode.config.captureMode as string) ?? 'tab'
  const hideCursor = gNode.config.hideCursor !== false
  const recWidth = (gNode.config.recordingWidth as number) || undefined
  const recHeight = (gNode.config.recordingHeight as number) || undefined
  const videoBitrateMbps = (gNode.config.videoBitrateMbps as number) || 32
  const codecPref = (gNode.config.codec as string) ?? 'vp9'
  const mimeTypes: Record<string, string[]> = {
    vp9: ['video/webm;codecs=vp09.00.10.08', 'video/webm;codecs=vp9', 'video/webm'],
    vp8: ['video/webm;codecs=vp8', 'video/webm'],
    h264: ['video/mp4;codecs=avc1.640034', 'video/webm;codecs=h264', 'video/webm'],
  }
  const chosenMime = (mimeTypes[codecPref] ?? mimeTypes.vp9).find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
  const capturedNodeId = ctx.nodeId
  // Collapse sidebars and hide toolbar before recording starts
  ctx.setForceCollapseSidebars(true)
  ctx.setHideToolbar(true)
  if (hideCursor) document.documentElement.style.cursor = 'none'
  ctx.scheduleEffect(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: recWidth },
          height: { ideal: recHeight },
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
