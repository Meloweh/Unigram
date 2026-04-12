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

function createParticle(config: ParticleConfig, w: number, h: number): Omit<Particle, 'gfx'> {
  const size = rand(config.size[0], config.size[1])
  const speed = rand(config.speed[0], config.speed[1])
  const opacity = rand(config.opacity[0], config.opacity[1])

  let vx = 0, vy = 0
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
    x: Math.random() * w,
    y: Math.random() * h,
    vx,
    vy,
    baseOpacity: opacity,
    size,
    phase: Math.random() * Math.PI * 2,
    phaseSpeed: 0.01 + Math.random() * 0.03,
  }
}

function drawShape(gfx: Graphics, config: ParticleConfig, size: number, color: string) {
  gfx.clear()
  const c = hexToNum(color.startsWith('#') ? color : '#94a3b8')
  if (config.shape === 'square') {
    gfx.rect(-size / 2, -size / 2, size, size).fill({ color: c })
  } else {
    // circle (default for all shapes — star/snowflake could be custom sprites later)
    gfx.circle(0, 0, size / 2).fill({ color: c })
  }
}

export function ParticleOverlay({ presetId }: { presetId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const presetRef = useRef<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current

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
      appRef.current = app

      // Spawn initial particles if preset is already set
      if (presetRef.current) {
        spawnParticles(app, presetRef.current)
      }

      // Animation loop
      app.ticker.add(() => {
        const w = app.screen.width
        const h = app.screen.height
        const preset = presetRef.current ? getParticlePreset(presetRef.current) : null
        if (!preset) return
        const cfg = preset.config

        for (const p of particlesRef.current) {
          // Update position
          if (cfg.behavior === 'wander') {
            p.vx += (Math.random() - 0.5) * 0.02
            p.vy += (Math.random() - 0.5) * 0.02
            const maxSpd = cfg.speed[1]
            const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
            if (spd > maxSpd) { p.vx *= maxSpd / spd; p.vy *= maxSpd / spd }
          }

          if (cfg.gravity) p.vy += cfg.gravity

          p.x += p.vx
          p.y += p.vy
          p.phase += p.phaseSpeed

          // Wrap around
          if (p.x < -20) p.x = w + 20
          if (p.x > w + 20) p.x = -20
          if (p.y < -20) p.y = h + 20
          if (p.y > h + 20) p.y = -20

          // Update graphics
          p.gfx.x = p.x
          p.gfx.y = p.y

          // Twinkle / opacity oscillation
          if (cfg.behavior === 'twinkle') {
            p.gfx.alpha = lerp(cfg.opacity[0], cfg.opacity[1], (Math.sin(p.phase) + 1) / 2)
          } else if (cfg.behavior === 'wander' || cfg.behavior === 'fireflies' as string) {
            p.gfx.alpha = p.baseOpacity * (0.7 + 0.3 * Math.sin(p.phase))
          } else {
            p.gfx.alpha = p.baseOpacity
          }
        }
      })
    })

    return () => {
      destroyed = true
      initPromise.then(() => {
        clearParticles()
        if (appRef.current) {
          appRef.current.destroy(true)
          appRef.current = null
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Respond to preset changes
  useEffect(() => {
    presetRef.current = presetId
    if (appRef.current) {
      clearParticles()
      if (presetId) spawnParticles(appRef.current, presetId)
    }
  }, [presetId])

  function clearParticles() {
    for (const p of particlesRef.current) {
      p.gfx.destroy()
    }
    particlesRef.current = []
  }

  function spawnParticles(app: Application, id: string) {
    const preset = getParticlePreset(id)
    if (!preset) return
    const cfg = preset.config
    const w = app.screen.width
    const h = app.screen.height
    const particles: Particle[] = []

    for (let i = 0; i < cfg.count; i++) {
      const data = createParticle(cfg, w, h)
      const gfx = new Graphics()
      const color = pickColor(cfg.color)
      drawShape(gfx, cfg, data.size, color)
      gfx.x = data.x
      gfx.y = data.y
      gfx.alpha = data.baseOpacity
      app.stage.addChild(gfx)
      particles.push({ ...data, gfx })
    }

    particlesRef.current = particles
  }

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
