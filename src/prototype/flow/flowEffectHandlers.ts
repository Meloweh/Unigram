import { useHybridZoomStore } from '../model/useHybridZoomStore'
import type { EffectGraphNode } from '../model/sampleModels'
import type { FlowEffectCtx } from './flowTypes'
import { getMediaBlob } from '../model/mediaStore'
import {
  handleSpawnCircular, handleEmerge, handleDismiss, handleScale, handleTextFormat,
  handleRecord, handleRepeater, handleCloudLevitate, handleBubbleLevitate,
  handleTextGenerator,
} from './flowVisualEffects'

// Each handler returns the layerMaxDuration contribution for that effect.

export function handlePlayMedia(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const isReactive = !!gNode.config.audioReactive
  const reactiveEffect = (gNode.config.visualEffect as string) ?? 'glow-pulse'
  const reactiveIntensity = (gNode.config.reactiveIntensity as number) ?? 1
  const capturedNodeId = ctx.nodeId
  ctx.scheduleEffect(() => {
    ctx.triggerMediaPlay(capturedNodeId)
    // Listen for media completion to signal the flow DAG
    const article = document.querySelector(`[data-node-id="${CSS.escape(capturedNodeId)}"]`) as HTMLElement | null
    if (!article) return
    const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
    if (media) {
      const onMediaDone = () => {
        ctx.cleanup.mediaDone.add(capturedNodeId)
        media.removeEventListener('pause', onMediaDone)
        media.removeEventListener('ended', onMediaDone)
      }
      // Wait for playback to actually start before listening for pause/ended
      const onPlaying = () => {
        media.removeEventListener('playing', onPlaying)
        media.addEventListener('pause', onMediaDone)
        media.addEventListener('ended', onMediaDone)
      }
      media.addEventListener('playing', onPlaying)
    } else {
      // GIF or image node: no media element, signal completion immediately
      ctx.cleanup.mediaDone.add(capturedNodeId)
    }
    if (isReactive) {
      // Start audio-reactive visualization after a short delay for media to begin
      setTimeout(() => {
        const article = document.querySelector(`[data-node-id="${CSS.escape(capturedNodeId)}"]`) as HTMLElement | null
        if (!article) return
        const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
        if (!media) return

        let cached = ctx.audioCtxCache.get(media)
        if (!cached) {
          try {
            const audioCtx = new AudioContext()
            const analyser = audioCtx.createAnalyser()
            analyser.fftSize = 256
            const source = audioCtx.createMediaElementSource(media)
            source.connect(analyser)
            analyser.connect(audioCtx.destination)
            cached = { ctx: audioCtx, analyser }
            ctx.audioCtxCache.set(media, cached)
          } catch {
            return
          }
        }
        // Resume context if it was suspended (e.g. browser autoplay policy)
        if (cached.ctx.state === 'suspended') cached.ctx.resume()

        const { analyser } = cached
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        const origFilter = article.style.filter
        const origOpacity = article.style.opacity
        const origTransform = article.style.transform

        const arTick = () => {
          // Stop when media is paused or ended
          if (media.paused || media.ended) {
            article.style.filter = origFilter
            article.style.opacity = origOpacity
            article.style.transform = origTransform
            return
          }

          analyser.getByteFrequencyData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
          const amp = (sum / dataArray.length / 255) * reactiveIntensity

          switch (reactiveEffect) {
            case 'glow-pulse': {
              const glow = Math.round(amp * 30)
              article.style.filter = `drop-shadow(0 0 ${glow}px rgba(56, 189, 248, ${amp}))`
              break
            }
            case 'scale-bounce': {
              const scaleVal = 1 + amp * 0.15
              article.style.transform = origTransform.replace(/scale\([^)]*\)/, '').trim() + ` scale(${scaleVal})`
              break
            }
            case 'opacity-pulse': {
              const op = 0.4 + amp * 0.6
              article.style.opacity = `${op}`
              break
            }
            case 'color-shift': {
              const hue = Math.round(amp * 360)
              article.style.filter = `hue-rotate(${hue}deg) saturate(${1 + amp})`
              break
            }
          }
          requestAnimationFrame(arTick)
        }
        requestAnimationFrame(arTick)
      }, 100)
    }
  }, delay)
  // Use large cap duration; actual completion signalled by media pause/ended event
  return 600000
}

export function handleWait(_ctx: FlowEffectCtx, gNode: EffectGraphNode, _delay: number): number {
  const dur = (gNode.config.durationMs as number) ?? 300
  return dur
}

export function handleColor(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const dur = (gNode.config.durationMs as number) ?? 300
  const color = (gNode.config.color as string) ?? '#f59e0b'
  const keepPlaying = !!(gNode.config.keepPlaying ?? gNode.config.permanent)
  ctx.scheduleEffect(() => {
    const el = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    if (el) {
      ctx.cleanup.colorBackups.push({ el, bg: el.style.background })
      el.style.transition = `background ${dur}ms ease`
      el.style.background = color
      if (!keepPlaying) {
        setTimeout(() => {
          el.style.background = ''
          el.style.transition = ''
        }, dur)
      }
    }
  }, delay)
  return keepPlaying ? 0 : dur
}

export function handleMove(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const waypoints = (gNode.config.waypoints as Array<{dx: number; dy: number; durationMs: number}>) ?? []
  const roundtrip = !!gNode.config.roundtrip
  const keepPlaying = !!gNode.config.keepPlaying
  // Compute total duration across all waypoints
  let totalWpDur = 0
  for (const wp of waypoints) totalWpDur += (wp.durationMs ?? 500)
  if (roundtrip) totalWpDur += (waypoints.length > 0 ? (waypoints[waypoints.length - 1].durationMs ?? 500) : 500)
  const capturedNodeId = ctx.nodeId
  const capturedModelId = ctx.frameModelId
  const origX = ctx.node.x
  const origY = ctx.node.y
  ctx.scheduleEffect(() => {
    if (!ctx.node) return
    let cancelled = false
    const runOnce = () => {
      let wpDelay = 0
      let cumDx = 0
      let cumDy = 0
      for (const wp of waypoints) {
        const wpDur = wp.durationMs ?? 500
        const dx = wp.dx ?? 0
        const dy = wp.dy ?? 0
        cumDx += dx
        cumDy += dy
        const targetX = origX + cumDx
        const targetY = origY + cumDy
        ctx.scheduleEffect(() => {
          if (!cancelled) ctx.updateNodeProps(capturedModelId, capturedNodeId, { x: targetX, y: targetY })
        }, wpDelay)
        wpDelay += wpDur
      }
      if (roundtrip) {
        const lastWpDur = waypoints.length > 0 ? (waypoints[waypoints.length - 1].durationMs ?? 500) : 500
        ctx.scheduleEffect(() => {
          if (!cancelled) ctx.updateNodeProps(capturedModelId, capturedNodeId, { x: origX, y: origY })
        }, wpDelay)
        wpDelay += lastWpDur
      }
      if (keepPlaying) {
        ctx.scheduleEffect(() => {
          if (!cancelled) runOnce()
        }, wpDelay)
      }
    }
    runOnce()
    if (keepPlaying) {
      ctx.cleanup.keepPlayingAnims.push({
        rafId: 0,
        cleanup: () => {
          cancelled = true
          ctx.updateNodeProps(capturedModelId, capturedNodeId, { x: origX, y: origY })
        },
      })
    }
  }, delay)
  return keepPlaying ? 0 : totalWpDur
}

export function handleSpawn(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const spawnItems = (gNode.config.spawnItems as Array<{
    label: string; offsetX: number; offsetY: number;
    animation: string; connectionType: string
  }>) ?? []
  ctx.scheduleEffect(() => {
    if (!ctx.node) return
    for (let i = 0; i < spawnItems.length; i++) {
      const item = spawnItems[i]
      const previewId = `preview-${ctx.nodeId}-${gNode.id}-${i}`
      const existingPreview = ctx.model.nodes.find(n => n.id === previewId)

      let targetId: string
      if (existingPreview) {
        // Activate the preview facade: clear previewOf, restore opacity
        targetId = previewId
        ctx.cleanup.activatedPreviews.push({ nodeId: previewId, previewOf: existingPreview.previewOf! })
        ctx.updateNodeProps(ctx.frameModelId, previewId, { previewOf: undefined })
        // Reveal connections that depend on this preview
        // (handled by ModelSceneContent hiding logic — cleared because flow will re-render)
      } else {
        targetId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const spawnX = ctx.node.x + item.offsetX
        const spawnY = ctx.node.y + item.offsetY
        ctx.addNode(ctx.frameModelId, { id: targetId, label: item.label, x: spawnX, y: spawnY })
        if (item.connectionType !== 'none') {
          ctx.addConnection(ctx.frameModelId, {
            from: ctx.nodeId, to: targetId,
            type: item.connectionType === 'flow' ? 'flow' : 'default',
          })
        }
      }
      ctx.cleanup.spawnedNodeIds.push(targetId)
      // Spawn animation on the DOM element
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-node-id="${CSS.escape(targetId)}"]`) as HTMLElement | null
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
    }
  }, delay)
  return 400
}

export function handleHandoffRmm(ctx: FlowEffectCtx, _gNode: EffectGraphNode, delay: number): number {
  ctx.scheduleEffect(() => {
    if (!ctx.node?.childModelId) {
      console.warn('[Flow] Handoff to RMM: node has no childModelId')
      return
    }
    // Select the node so zoomIn() targets it, then animate zoom
    ctx.selectNode(ctx.nodeId)
    const targetChildModelId = ctx.node.childModelId
    const zoomInterval = setInterval(() => {
      const curFrame = ctx.currentFrame()
      // Once we've pushed into the child model, stop zooming and trigger child effects
      if (curFrame.modelId === targetChildModelId) {
        clearInterval(zoomInterval)
        // Read fresh model data from the store (not the stale closure)
        const freshModels = useHybridZoomStore.getState().models
        const childModel = freshModels[targetChildModelId]
        if (childModel) {
          for (const childNode of childModel.nodes) {
            const effects = childNode.flowEffects ?? []
            for (const fx of effects) {
              const rmmEntry = fx.graph.nodes.find(
                gn => gn.kind === 'entry' && gn.config.triggeredByRmmParent
              )
              if (rmmEntry) {
                // Delay to let the freshly-rendered child model settle,
                // then call via ref to get the latest startFlowAnimation (which now sees child model)
                setTimeout(() => {
                  ctx.startFlowAnimationRef.current(childNode.id)
                }, 300)
                return
              }
            }
          }
          console.warn('[Flow] Handoff to RMM: no entry with "Triggered by RMM Parent" found in child model')
        }
        return
      }
      ctx.zoomIn()
    }, 50)
    // Safety: clear after 5s in case something goes wrong
    setTimeout(() => clearInterval(zoomInterval), 5000)
  }, delay)
  return 1200
}

export function handleReturnRmm(ctx: FlowEffectCtx, _gNode: EffectGraphNode, delay: number): number {
  ctx.scheduleEffect(() => {
    if (ctx.stack.length <= 1) {
      console.warn('[Flow] Return from RMM: already at root level')
      return
    }
    const parentModelId = ctx.stack[ctx.stack.length - 2].modelId
    const zoomInterval = setInterval(() => {
      const freshState = useHybridZoomStore.getState()
      const curFrame = freshState.stack[freshState.stack.length - 1]
      // Keep zooming out until we're back in the parent AND progress is at 0
      if (curFrame.modelId === parentModelId && curFrame.snapshot.progress <= 0) {
        clearInterval(zoomInterval)
        return
      }
      ctx.zoomOut()
    }, 50)
    // Safety: clear after 5s
    setTimeout(() => clearInterval(zoomInterval), 5000)
  }, delay)
  return 1200
}

export function handleHandoffMpd(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const targetMpdId = (gNode.config.targetMpdId as string) ?? ''
  ctx.scheduleEffect(() => {
    if (!targetMpdId) {
      console.warn('[Flow] Handoff to MPD: no target MPD selected')
      return
    }
    if (ctx.node?.mpdIds && ctx.node.mpdIds.length > 1) {
      ctx.switchNodeMpd(targetMpdId, ctx.node.mpdIds)
    } else {
      ctx.switchFrameMpd(targetMpdId)
    }
  }, delay)
  return 400
}

export function handleEntry(_ctx: FlowEffectCtx, _gNode: EffectGraphNode, _delay: number): number {
  return 0
}

export function handleCamera(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const panX = (gNode.config.panX as number) ?? 0
  const panY = (gNode.config.panY as number) ?? 0
  const zoom = (gNode.config.zoom as number) ?? 1
  const rotation = (gNode.config.rotation as number) ?? 0
  const camDur = (gNode.config.durationMs as number) ?? 1000
  const panXDurationMs = (gNode.config.panXDurationMs as number) ?? 1000
  const panYDurationMs = (gNode.config.panYDurationMs as number) ?? 1000
  const zoomDurationMs = (gNode.config.zoomDurationMs as number) ?? 1000
  const rotationDurationMs = (gNode.config.rotationDurationMs as number) ?? 1000
  const panXResetMode = (gNode.config.panXResetMode as string) ?? 'attr'
  const panYResetMode = (gNode.config.panYResetMode as string) ?? 'attr'
  const zoomResetMode = (gNode.config.zoomResetMode as string) ?? 'attr'
  const rotationResetMode = (gNode.config.rotationResetMode as string) ?? 'attr'
  const panXEasing = (gNode.config.panXEasing as string) ?? 'ease-out'
  const panYEasing = (gNode.config.panYEasing as string) ?? 'ease-out'
  const zoomEasing = (gNode.config.zoomEasing as string) ?? 'ease-out'
  const rotationEasing = (gNode.config.rotationEasing as string) ?? 'ease-out'
  ctx.scheduleEffect(() => {
    // Clear any active fadeout from a previous camera node
    ctx.flowCameraFadeoutRef.current = null
    ctx.flowCameraOverrideRef.current = {
      panX, panY, zoom, rotation,
      durationMs: camDur,
      panXDurationMs, panYDurationMs, zoomDurationMs, rotationDurationMs,
      panXResetMode, panYResetMode, zoomResetMode, rotationResetMode,
      panXEasing, panYEasing, zoomEasing, rotationEasing,
      startTime: performance.now(),
      startPan: { x: ctx.panOffsetRef.current.x, y: ctx.panOffsetRef.current.y },
      startFreeScale: ctx.freeScaleRef.current,
    }
  }, delay)
  return camDur
}

export function handleBreak(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const axis = (gNode.config.axis as string) ?? 'horizontal'
  const shakeIntensity = (gNode.config.shakeIntensity as number) ?? 8
  const shakeDurationMs = (gNode.config.shakeDurationMs as number) ?? 300
  const fallDurationMs = (gNode.config.fallDurationMs as number) ?? 600
  const totalBreakDur = Math.max(shakeDurationMs, fallDurationMs)
  ctx.scheduleEffect(() => {
    const article = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    if (!article) return

    // Clone the node and create two halves
    const rect = article.getBoundingClientRect()
    const clone1 = article.cloneNode(true) as HTMLElement
    const clone2 = article.cloneNode(true) as HTMLElement

    // Position clones absolutely in the viewport
    for (const clone of [clone1, clone2]) {
      clone.style.position = 'fixed'
      clone.style.left = `${rect.left}px`
      clone.style.top = `${rect.top}px`
      clone.style.width = `${rect.width}px`
      clone.style.height = `${rect.height}px`
      clone.style.zIndex = '10000'
      clone.style.pointerEvents = 'none'
      clone.style.transition = 'none'
      clone.style.animation = 'none'
      clone.style.boxShadow = 'none'
      clone.style.filter = 'none'
      clone.classList.remove('focused', 'flow-active', 'multi-selected')
      clone.removeAttribute('data-node-id')
    }

    if (axis === 'vertical') {
      // Left half / right half
      clone1.style.clipPath = 'inset(0 50% 0 0)'
      clone2.style.clipPath = 'inset(0 0 0 50%)'
    } else {
      // Top half / bottom half
      clone1.style.clipPath = 'inset(0 0 50% 0)'
      clone2.style.clipPath = 'inset(50% 0 0 0)'
    }

    document.body.appendChild(clone1)
    document.body.appendChild(clone2)

    // Hide original and track it for restoration
    article.style.opacity = '0'
    ctx.cleanup.brokenElements.push(article)

    // Animate fall + fade
    const fallStart = performance.now()
    const animateFall = (now: number) => {
      const t = Math.min((now - fallStart) / fallDurationMs, 1)
      const ease = t * t // ease-in (gravity)
      const fadeOut = Math.max(0, 1 - t * 1.5)

      if (axis === 'vertical') {
        // Left half goes left
        clone1.style.transform = `translate(${-80 * ease}px, ${20 * ease}px) rotate(${-15 * ease}deg)`
        clone1.style.opacity = `${fadeOut}`
        // Right half goes right
        clone2.style.transform = `translate(${80 * ease}px, ${20 * ease}px) rotate(${15 * ease}deg)`
        clone2.style.opacity = `${fadeOut}`
      } else {
        // Top half moves up and left
        clone1.style.transform = `translate(${-20 * ease}px, ${-80 * ease}px) rotate(${-15 * ease}deg)`
        clone1.style.opacity = `${fadeOut}`
        // Bottom half falls down and right
        clone2.style.transform = `translate(${20 * ease}px, ${120 * ease}px) rotate(${10 * ease}deg)`
        clone2.style.opacity = `${fadeOut}`
      }

      if (t < 1) {
        requestAnimationFrame(animateFall)
      } else {
        clone1.remove()
        clone2.remove()
      }
    }
    requestAnimationFrame(animateFall)

    // Screen shake
    const shakeStart = performance.now()
    const animateShake = (now: number) => {
      const t = Math.min((now - shakeStart) / shakeDurationMs, 1)
      if (t < 1) {
        const decay = 1 - t
        ctx.setShakeOffset({
          x: (Math.random() * 2 - 1) * shakeIntensity * decay,
          y: (Math.random() * 2 - 1) * shakeIntensity * decay,
        })
        requestAnimationFrame(animateShake)
      } else {
        ctx.setShakeOffset({ x: 0, y: 0 })
      }
    }
    requestAnimationFrame(animateShake)
  }, delay)
  return totalBreakDur
}

export function handleExpand(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const dur = (gNode.config.durationMs as number) ?? 300
  ctx.scheduleEffect(() => {
    const nd = ctx.model.nodes.find(n => n.id === ctx.nodeId)
    const expandedH = Math.max(nd?.nodeHeight ?? 60, 160)
    ctx.updateNodeProps(ctx.frameModelId, ctx.nodeId, { contentCollapsed: false, nodeHeight: expandedH })
  }, delay)
  return dur
}

export function handleCollapse(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const dur = (gNode.config.durationMs as number) ?? 300
  ctx.scheduleEffect(() => {
    ctx.updateNodeProps(ctx.frameModelId, ctx.nodeId, { contentCollapsed: true, nodeHeight: 60 })
  }, delay)
  return dur
}

export function handleJitter(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const intensity = (gNode.config.intensity as number) ?? 4
  const durationMs = (gNode.config.durationMs as number) ?? 1000
  const keepPlaying = !!gNode.config.keepPlaying
  ctx.scheduleEffect(() => {
    const el = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    if (!el) return
    const start = performance.now()
    const entry = { rafId: 0, cleanup: () => { el.style.transform = 'translate(-50%, -50%)' } }
    if (keepPlaying) ctx.cleanup.keepPlayingAnims.push(entry)
    const animateJitter = (now: number) => {
      if (!keepPlaying) {
        const t = (now - start) / durationMs
        if (t >= 1) {
          el.style.transform = 'translate(-50%, -50%)'
          return
        }
        const decay = 1 - t
        const dx = (Math.random() * 2 - 1) * intensity * decay
        const dy = (Math.random() * 2 - 1) * intensity * decay
        el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      } else {
        const dx = (Math.random() * 2 - 1) * intensity
        const dy = (Math.random() * 2 - 1) * intensity
        el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      }
      entry.rafId = requestAnimationFrame(animateJitter)
    }
    entry.rafId = requestAnimationFrame(animateJitter)
  }, delay)
  return keepPlaying ? 0 : durationMs
}

export function handleFloat(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const amplitude = (gNode.config.amplitude as number) ?? 6
  const speed = (gNode.config.speed as number) ?? 1
  const durationMs = (gNode.config.durationMs as number) ?? 3000
  const keepPlaying = !!gNode.config.keepPlaying
  ctx.scheduleEffect(() => {
    const el = document.querySelector(`[data-node-id="${CSS.escape(ctx.nodeId)}"]`) as HTMLElement | null
    if (!el) return
    const phaseX = Math.random() * Math.PI * 2
    const phaseY = Math.random() * Math.PI * 2
    const start = performance.now()
    const entry = { rafId: 0, cleanup: () => { el.style.transform = 'translate(-50%, -50%)' } }
    if (keepPlaying) ctx.cleanup.keepPlayingAnims.push(entry)
    const animateFloat = (now: number) => {
      const elapsed = now - start
      if (!keepPlaying) {
        const t = elapsed / durationMs
        if (t >= 1) {
          el.style.transform = 'translate(-50%, -50%)'
          return
        }
        const s = t * speed * Math.PI * 2 * (durationMs / 1000)
        const dx = Math.sin(s * 1.3 + phaseX) * amplitude * 0.7 + Math.sin(s * 2.1 + phaseX + 1) * amplitude * 0.3
        const dy = Math.sin(s * 0.9 + phaseY) * amplitude * 0.7 + Math.cos(s * 1.7 + phaseY + 2) * amplitude * 0.3
        el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      } else {
        const s = (elapsed / 1000) * speed * Math.PI * 2
        const dx = Math.sin(s * 1.3 + phaseX) * amplitude * 0.7 + Math.sin(s * 2.1 + phaseX + 1) * amplitude * 0.3
        const dy = Math.sin(s * 0.9 + phaseY) * amplitude * 0.7 + Math.cos(s * 1.7 + phaseY + 2) * amplitude * 0.3
        el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      }
      entry.rafId = requestAnimationFrame(animateFloat)
    }
    entry.rafId = requestAnimationFrame(animateFloat)
  }, delay)
  return keepPlaying ? 0 : durationMs
}

export function handleSegmentPlay(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const startTime = (gNode.config.startTime as number) ?? 0
  const endTime = (gNode.config.endTime as number) ?? 0
  if (endTime <= startTime) return 0
  const durationMs = (endTime - startTime) * 1000
  const capturedNodeId = ctx.nodeId
  ctx.scheduleEffect(() => {
    const article = document.querySelector(`[data-node-id="${CSS.escape(capturedNodeId)}"]`) as HTMLElement | null
    if (!article) return
    const media = article.querySelector('video') as HTMLVideoElement | null
    if (!media) return
    media.currentTime = startTime
    media.play().catch(() => {})
    const onTimeUpdate = () => {
      if (media.currentTime >= endTime) {
        media.pause()
        media.removeEventListener('timeupdate', onTimeUpdate)
        ctx.cleanup.mediaDone.add(capturedNodeId)
      }
    }
    media.addEventListener('timeupdate', onTimeUpdate)
    // Cleanup if media ends early
    const onEnded = () => {
      media.removeEventListener('timeupdate', onTimeUpdate)
      media.removeEventListener('ended', onEnded)
      ctx.cleanup.mediaDone.add(capturedNodeId)
    }
    media.addEventListener('ended', onEnded)
  }, delay)
  return durationMs
}

export function handleAudioClip(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  const clipKey = (gNode.config.clipKey as string) ?? ''
  if (!clipKey) return 0
  const blob = getMediaBlob(clipKey)
  if (!blob) return 0
  const capturedNodeId = ctx.nodeId
  const audio = new Audio()
  const objUrl = URL.createObjectURL(blob)
  audio.src = objUrl
  ctx.scheduleEffect(() => {
    const onEnded = () => {
      audio.removeEventListener('ended', onEnded)
      URL.revokeObjectURL(objUrl)
      ctx.cleanup.mediaDone.add(capturedNodeId)
    }
    audio.addEventListener('ended', onEnded)
    audio.play().catch(() => {})
  }, delay)
  // Return 0 — duration unknown ahead of time; completion signalled via mediaDone
  return 0
}

export function dispatchEffect(ctx: FlowEffectCtx, gNode: EffectGraphNode, delay: number): number {
  switch (gNode.kind) {
    case 'play-media': return handlePlayMedia(ctx, gNode, delay)
    case 'wait': return handleWait(ctx, gNode, delay)
    case 'color': return handleColor(ctx, gNode, delay)
    case 'move': return handleMove(ctx, gNode, delay)
    case 'spawn': return handleSpawn(ctx, gNode, delay)
    case 'handoff-rmm': return handleHandoffRmm(ctx, gNode, delay)
    case 'return-rmm': return handleReturnRmm(ctx, gNode, delay)
    case 'handoff-mpd': return handleHandoffMpd(ctx, gNode, delay)
    case 'entry': return handleEntry(ctx, gNode, delay)
    case 'camera': return handleCamera(ctx, gNode, delay)
    case 'break': return handleBreak(ctx, gNode, delay)
    case 'expand': return handleExpand(ctx, gNode, delay)
    case 'collapse': return handleCollapse(ctx, gNode, delay)
    case 'jitter': return handleJitter(ctx, gNode, delay)
    case 'float': return handleFloat(ctx, gNode, delay)
    case 'spawn-circular': return handleSpawnCircular(ctx, gNode, delay)
    case 'emerge': return handleEmerge(ctx, gNode, delay)
    case 'dismiss': return handleDismiss(ctx, gNode, delay)
    case 'scale': return handleScale(ctx, gNode, delay)
    case 'text-format': return handleTextFormat(ctx, gNode, delay)
    case 'record': return handleRecord(ctx, gNode, delay)
    case 'repeater': return handleRepeater(ctx, gNode, delay)
    case 'cloud-levitate': return handleCloudLevitate(ctx, gNode, delay)
    case 'bubble-levitate': return handleBubbleLevitate(ctx, gNode, delay)
    case 'text-generator': return handleTextGenerator(ctx, gNode, delay)
    case 'segment-play': return handleSegmentPlay(ctx, gNode, delay)
    case 'audio-clip': return handleAudioClip(ctx, gNode, delay)
    default: return 0
  }
}
