/** GPU-accelerated ambient particle overlay using PixiJS */
import { useEffect, useRef } from 'react'
import { Application, Graphics } from 'pixi.js'
import { getParticlePreset, type ParticleConfig } from './particles'

interface Particle {
  gfx: Graphics
  x: number
  y: number
  vx: number
  vy: number
  baseOpacity: number
  size: number
  phase: number
  phaseSpeed: number
  /** Frames remaining before this particle begins appearing */
  introDelay: number
  /** Current intro fade progress 0→1 */
  introAlpha: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickColor(color: string | string[]): string {
  if (typeof color === 'string') return color
  return color[Math.floor(Math.random() * color.length)]
}

function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/** Intro stagger duration in frames (~60fps). Particles spread their entry over this window. */
const STAGGER_FRAMES = 150 // ~2.5 seconds
/** Per-particle fade-in speed (alpha increment per frame) */
const INTRO_FADE_SPEED = 0.025 // ~40 frames = ~0.67s to full opacity

/**
 * Compute the PixiJS stage transform that replicates the CSS scene transform.
 *
 * CSS: transform-origin: center; transform: translate(tx, ty) scale(s)
 * PixiJS: stage.position = (stageX, stageY), stage.scale = s
 *
 * Mapping: stageX = vpW/2 * (1 - s) + tx,  stageY = vpH/2 * (1 - s) + ty
 */
function computeStageTransform(vpW: number, vpH: number, tx: number, ty: number, s: number) {
  return {
    x: (vpW / 2) * (1 - s) + tx,
    y: (vpH / 2) * (1 - s) + ty,
  }
}

function createParticle(config: ParticleConfig, gridW: number, gridH: number, introDelay: number): Omit<Particle, 'gfx'> {
  const size = rand(config.size[0], config.size[1])
  const speed = rand(config.speed[0], config.speed[1])
  const opacity = rand(config.opacity[0], config.opacity[1])

  let vx = 0, vy = 0
  const x = Math.random() * gridW
  const y = Math.random() * gridH
  switch (config.behavior) {
    case 'fall':
      vy = speed
      vx = (config.wind ?? 0) * (Math.random() - 0.3)
      break
    case 'rise':
      vy = -speed
      vx = (config.wind ?? 0) * (Math.random() - 0.5)
      break
    case 'drift':
      vx = (Math.random() - 0.5) * speed
      vy = (Math.random() - 0.5) * speed
      break
    case 'wander':
      vx = (Math.random() - 0.5) * speed * 0.5
      vy = (Math.random() - 0.5) * speed * 0.5
      break
    case 'twinkle':
      vx = 0
      vy = 0
      break
  }

  return {
    x, y, vx, vy,
    baseOpacity: opacity,
    size,
    phase: Math.random() * Math.PI * 2,
    phaseSpeed: 0.01 + Math.random() * 0.03,
    introDelay,
    introAlpha: 0,
  }
}

function drawShape(gfx: Graphics, config: ParticleConfig, size: number, color: string) {
  gfx.clear()
  const c = hexToNum(color.startsWith('#') ? color : '#94a3b8')
  // Ensure minimum visible radius of 1px
  const effectiveSize = Math.max(size, 2)
  if (config.shape === 'square') {
    gfx.rect(-effectiveSize / 2, -effectiveSize / 2, effectiveSize, effectiveSize).fill({ color: c })
  } else {
    gfx.circle(0, 0, effectiveSize / 2).fill({ color: c })
  }
}

interface ParticleOverlayProps {
  presetId: string | null
  /** CSS translate-x of the scene (cx + panOffset.x) */
  sceneTx: number
  /** CSS translate-y of the scene (cy + panOffset.y) */
  sceneTy: number
  /** Camera zoom scale */
  sceneScale: number
  /** Viewport dimensions in pixels */
  vpSize: { w: number; h: number }
  /** Dynamic grid extent in percentage units */
  gridExtent: { minX: number; minY: number; maxX: number; maxY: number }
}

export function ParticleOverlay({ presetId, sceneTx, sceneTy, sceneScale, vpSize, gridExtent }: ParticleOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Store scene transform in refs so the ticker can access latest values
  const sceneTxRef = useRef(sceneTx)
  const sceneTyRef = useRef(sceneTy)
  const sceneScaleRef = useRef(sceneScale)
  const vpSizeRef = useRef(vpSize)
  const gridExtentRef = useRef(gridExtent)
  sceneTxRef.current = sceneTx
  sceneTyRef.current = sceneTy
  sceneScaleRef.current = sceneScale
  vpSizeRef.current = vpSize
  gridExtentRef.current = gridExtent

  // Single effect that owns the full PixiJS lifecycle.
  // Keyed on presetId so a new app is created whenever the preset changes,
  // eliminating the race between async app.init() and preset state.
  useEffect(() => {
    if (!presetId || !containerRef.current) return
    const container = containerRef.current
    const particles: Particle[] = []

    const app = new Application()
    let destroyed = false

    const initPromise = app.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    }).then(() => {
      if (destroyed) { app.destroy(true); return }
      container.appendChild(app.canvas as HTMLCanvasElement)

      // Spawn particles for _this_ preset (captured in closure — no race)
      const preset = getParticlePreset(presetId)
      if (preset) {
        const cfg = preset.config
        const vpW = app.screen.width
        const vpH = app.screen.height
        // Grid bounds in world (scene) coords — 2× the actual grid extent for large render distance
        const ext = gridExtentRef.current
        const vpW2 = vpSizeRef.current.w
        const vpH2 = vpSizeRef.current.h
        const gridBaseW = (ext.maxX - ext.minX) / 100 * vpW2
        const gridBaseH = (ext.maxY - ext.minY) / 100 * vpH2
        const gridW = gridBaseW * 2
        const gridH = gridBaseH * 2
        // Origin offset so the 2× area is centered on the grid extent
        const originX = ext.minX / 100 * vpW2 - gridBaseW / 2
        const originY = ext.minY / 100 * vpH2 - gridBaseH / 2

        for (let i = 0; i < cfg.count; i++) {
          const introDelay = Math.floor(Math.random() * STAGGER_FRAMES)
          const data = createParticle(cfg, gridW, gridH, introDelay)
          data.x += originX
          data.y += originY
          const gfx = new Graphics()
          const color = pickColor(cfg.color)
          drawShape(gfx, cfg, data.size, color)
          gfx.x = data.x
          gfx.y = data.y
          gfx.alpha = 0
          app.stage.addChild(gfx)
          particles.push({ ...data, gfx })
        }
      }

      // Animation loop
      app.ticker.add(() => {
        const vpW = app.screen.width
        const vpH = app.screen.height
        const tx = sceneTxRef.current
        const ty = sceneTyRef.current
        const s = sceneScaleRef.current

        // Apply scene transform to the PixiJS stage so particles are in world space
        const st = computeStageTransform(vpW, vpH, tx, ty, s)
        app.stage.x = st.x
        app.stage.y = st.y
        app.stage.scale.set(s)

        const preset = getParticlePreset(presetId)
        if (!preset) return
        const cfg = preset.config

        // Grid bounds for wrapping — particles stay within 2× grid area
        const ext2 = gridExtentRef.current
        const vpW3 = vpSizeRef.current.w
        const vpH3 = vpSizeRef.current.h
        const gridBaseW2 = (ext2.maxX - ext2.minX) / 100 * vpW3
        const gridBaseH2 = (ext2.maxY - ext2.minY) / 100 * vpH3
        const gridW = gridBaseW2 * 2
        const gridH = gridBaseH2 * 2
        const oX = ext2.minX / 100 * vpW3 - gridBaseW2 / 2
        const oY = ext2.minY / 100 * vpH3 - gridBaseH2 / 2
        const margin = 20 // small margin in world px

        for (const p of particles) {
          // Intro delay countdown
          if (p.introDelay > 0) {
            p.introDelay--
            p.gfx.alpha = 0
            continue
          }

          // Fade in
          if (p.introAlpha < 1) {
            p.introAlpha = Math.min(1, p.introAlpha + INTRO_FADE_SPEED)
          }

          // Update position
          if (cfg.behavior === 'wander') {
            p.vx += (Math.random() - 0.5) * 0.02
            p.vy += (Math.random() - 0.5) * 0.02
            const maxSpd = cfg.speed[1]
            const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
            if (spd > maxSpd) { p.vx *= maxSpd / spd; p.vy *= maxSpd / spd }
          }

          if (cfg.gravity) p.vy += cfg.gravity

          // Terminal velocity — cap speed to prevent unbounded acceleration
          const maxSpeed = cfg.speed[1] * 3
          if (Math.abs(p.vy) > maxSpeed) p.vy = Math.sign(p.vy) * maxSpeed
          if (Math.abs(p.vx) > maxSpeed) p.vx = Math.sign(p.vx) * maxSpeed

          p.x += p.vx
          p.y += p.vy
          p.phase += p.phaseSpeed

          // Wrap around within grid bounds (origin-offset).
          // Use modular wrap so particles stranded outside after a
          // viewport resize or grid extent change are immediately repositioned.
          if (p.x < oX - margin || p.x > oX + gridW + margin) p.x = oX + (((p.x - oX) % gridW) + gridW) % gridW
          if (p.y < oY - margin || p.y > oY + gridH + margin) p.y = oY + (((p.y - oY) % gridH) + gridH) % gridH

          // Update graphics
          p.gfx.x = p.x
          p.gfx.y = p.y

          // Compute base alpha from behavior
          let alpha: number
          if (cfg.behavior === 'twinkle') {
            alpha = lerp(cfg.opacity[0], cfg.opacity[1], (Math.sin(p.phase) + 1) / 2)
          } else if (cfg.behavior === 'wander') {
            alpha = p.baseOpacity * (0.7 + 0.3 * Math.sin(p.phase))
          } else {
            alpha = p.baseOpacity
          }
          p.gfx.alpha = alpha * p.introAlpha
        }
      })
    })

    return () => {
      destroyed = true
      initPromise.then(() => {
        for (const p of particles) p.gfx.destroy()
        app.destroy(true)
      })
    }
  }, [presetId])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    />
  )
}
