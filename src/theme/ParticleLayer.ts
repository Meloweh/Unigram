/**
 * Ambient particle layer rendered into the existing PixiJS scene.
 *
 * Particles live in screen-space (not world-space), so they remain anchored
 * to the viewport regardless of camera pan/zoom — same behaviour the legacy
 * `ParticleOverlay` had as a sibling overlay. Each particle is a single
 * `Graphics` instance pooled across the layer's lifetime.
 *
 * Counts are bounded by the preset (≤100) so this layer adds at most a few
 * hundred sprites — well within the perf budget for stage 4.
 */

import { Container, Graphics } from 'pixi.js'
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
  introDelay: number
  introAlpha: number
  rotation: number
  rotationSpeed: number
}

const STAGGER_FRAMES = 150
const INTRO_FADE_SPEED = 0.025

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

function drawShape(gfx: Graphics, config: ParticleConfig, size: number, color: string) {
  gfx.clear()
  const c = hexToNum(color.startsWith('#') ? color : '#94a3b8')
  const s = Math.max(size, 2)
  if (config.shape === 'square') {
    gfx.rect(-s / 2, -s / 2, s, s).fill({ color: c })
  } else if (config.shape === 'leaf') {
    gfx.moveTo(0, -s)
    gfx.bezierCurveTo(s * 0.8, -s * 0.6, s * 0.8, s * 0.3, 0, s)
    gfx.bezierCurveTo(-s * 0.8, s * 0.3, -s * 0.8, -s * 0.6, 0, -s)
    gfx.fill({ color: c })
    gfx.moveTo(0, -s * 0.7).lineTo(0, s * 0.7).stroke({ color: c, width: 0.4, alpha: 0.5 })
  } else if (config.shape === 'hexagon') {
    const r = s / 2
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const hx = Math.cos(angle) * r
      const hy = Math.sin(angle) * r
      if (i === 0) gfx.moveTo(hx, hy)
      else gfx.lineTo(hx, hy)
    }
    gfx.closePath()
    gfx.fill({ color: c })
  } else if (config.shape === 'spore') {
    const r = s / 2
    gfx.circle(0, 0, r).fill({ color: c })
    const bumps = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < bumps; i++) {
      const angle = ((Math.PI * 2) / bumps) * i
      gfx.circle(Math.cos(angle) * r * 0.7, Math.sin(angle) * r * 0.7, r * 0.35).fill({
        color: c,
        alpha: 0.6,
      })
    }
  } else {
    gfx.circle(0, 0, s / 2).fill({ color: c })
  }
}

export class ParticleLayer {
  readonly container: Container
  private particles: Particle[] = []
  private config: ParticleConfig | null = null
  private vpW = 1
  private vpH = 1

  constructor() {
    this.container = new Container()
    this.container.eventMode = 'none'
  }

  setViewport(w: number, h: number): void {
    this.vpW = w
    this.vpH = h
  }

  /** Set or clear the active preset. Builds/destroys particles as needed. */
  setPreset(id: string | null): void {
    this.clear()
    if (!id) return
    const preset = getParticlePreset(id)
    if (!preset) return
    const config = preset.config
    this.config = config
    for (let i = 0; i < config.count; i++) {
      const introDelay = Math.floor((i / config.count) * STAGGER_FRAMES)
      const p = this.spawn(config, introDelay, true)
      this.particles.push(p)
      this.container.addChild(p.gfx)
    }
  }

  private spawn(config: ParticleConfig, introDelay: number, randomY: boolean): Particle {
    const size = rand(config.size[0], config.size[1])
    const speed = rand(config.speed[0], config.speed[1])
    const opacity = rand(config.opacity[0], config.opacity[1])
    let vx = 0
    let vy = 0
    const x = Math.random() * Math.max(1, this.vpW)
    let y = randomY ? Math.random() * Math.max(1, this.vpH) : 0
    switch (config.behavior) {
      case 'fall':
        vy = speed
        vx = (config.wind ?? 0) * (Math.random() - 0.3)
        if (!randomY) y = -size
        break
      case 'rise':
        vy = -speed
        vx = (config.wind ?? 0) * (Math.random() - 0.5)
        if (!randomY) y = this.vpH + size
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
    const gfx = new Graphics()
    gfx.eventMode = 'none'
    drawShape(gfx, config, size, pickColor(config.color))
    return {
      gfx,
      x,
      y,
      vx,
      vy,
      baseOpacity: opacity,
      size,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.01 + Math.random() * 0.03,
      introDelay,
      introAlpha: 0,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed:
        config.shape === 'leaf' || config.shape === 'hexagon'
          ? (Math.random() - 0.5) * 0.06
          : 0,
    }
  }

  /** Advance particles by `frames` (1.0 = nominal 16.67 ms). */
  tick(frames: number): void {
    const config = this.config
    if (!config || this.particles.length === 0) return
    // Per-axis terminal velocity (px/frame). Prevents `gravity` from
    // accelerating particles indefinitely when they wrap around the viewport.
    const TERMINAL = 6
    const baseSpeedMax = config.speed[1]
    for (const p of this.particles) {
      // Intro stagger.
      if (p.introDelay > 0) {
        p.introDelay -= frames
        p.gfx.alpha = 0
        continue
      }
      if (p.introAlpha < 1) p.introAlpha = Math.min(1, p.introAlpha + INTRO_FADE_SPEED * frames)
      // Behaviour update.
      if (config.behavior === 'wander') {
        // Random walk.
        p.vx += (Math.random() - 0.5) * 0.05
        p.vy += (Math.random() - 0.5) * 0.05
        p.vx *= 0.97
        p.vy *= 0.97
      } else if (config.gravity) {
        p.vy += config.gravity * frames
        // Clamp to terminal velocity so confetti et al. don't runaway.
        if (p.vy > TERMINAL) p.vy = TERMINAL
        else if (p.vy < -TERMINAL) p.vy = -TERMINAL
      }
      p.x += p.vx * frames
      p.y += p.vy * frames
      p.phase += p.phaseSpeed * frames
      p.rotation += p.rotationSpeed * frames
      // Twinkle: animate alpha sin-wave around base.
      let alpha = p.baseOpacity
      if (config.behavior === 'twinkle') {
        alpha = p.baseOpacity * (0.72 + 0.28 * Math.sin(p.phase))
      }
      p.gfx.alpha = alpha * p.introAlpha
      // Wrap around viewport. For falling/rising particles, reset vertical
      // speed on wrap so accumulated gravity doesn't carry over to the
      // newly-spawned position.
      const m = p.size + 2
      if (p.x < -m) p.x = this.vpW + m
      else if (p.x > this.vpW + m) p.x = -m
      if (p.y < -m) {
        p.y = this.vpH + m
        if (config.behavior === 'rise') p.vy = -baseSpeedMax * (0.3 + Math.random() * 0.7)
      } else if (p.y > this.vpH + m) {
        p.y = -m
        if (config.behavior === 'fall') p.vy = baseSpeedMax * (0.3 + Math.random() * 0.7)
      }
      p.gfx.x = p.x
      p.gfx.y = p.y
      p.gfx.rotation = p.rotation
    }
  }

  clear(): void {
    for (const p of this.particles) {
      this.container.removeChild(p.gfx)
      p.gfx.destroy()
    }
    this.particles.length = 0
    this.config = null
  }

  destroy(): void {
    this.clear()
    this.container.destroy({ children: true })
  }
}
