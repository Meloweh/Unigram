/**
 * Synthesised dialog-tick sounds for text-generator effects. Ported nearly
 * verbatim from `src/old/flow/textGeneratorSounds.ts` — the AudioContext is
 * lazy and reused; each tick spins up short-lived Web Audio nodes that
 * self-disconnect when their oscillator/source ends.
 *
 * Calling `playGenSound('none', _)` is a no-op and never creates an
 * AudioContext, so the runtime is safe to import from non-browser tests.
 */

export type TextGenSoundPreset =
  | 'none'
  | 'undertale'
  | 'inscryption'
  | 'pokemon'
  | 'typewriter'
  | 'terminal'

export const TEXT_GEN_SOUND_PRESETS: { id: TextGenSoundPreset; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'undertale', label: 'Undertale' },
  { id: 'inscryption', label: 'Inscryption' },
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'terminal', label: 'Terminal' },
]

let sharedCtx: AudioContext | null = null
function getCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext()
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => { /* ignore */ })
  return sharedCtx
}

let noiseBuffer: AudioBuffer | null = null
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const len = 4096
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return noiseBuffer
}

/**
 * Play a single dialog-generation tick. Safe to call rapidly (each call
 * creates short-lived nodes that GC themselves once the oscillator ends).
 */
export function playGenSound(preset: TextGenSoundPreset, charIndex: number): void {
  if (preset === 'none') return
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  switch (preset) {
    case 'undertale': {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 300 + Math.random() * 200
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now); osc.stop(now + 0.04)
      return
    }
    case 'inscryption': {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 180 + (charIndex % 7) * 10 + Math.random() * 20
      gain.gain.setValueAtTime(0.15, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now); osc.stop(now + 0.06)
      return
    }
    case 'pokemon': {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = charIndex % 2 === 0 ? 480 : 560
      gain.gain.setValueAtTime(0.13, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now); osc.stop(now + 0.03)
      return
    }
    case 'typewriter': {
      const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter()
      source.buffer = getNoiseBuffer(ctx)
      filter.type = 'highpass'
      filter.frequency.value = 3000
      gain.gain.setValueAtTime(0.18, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015)
      source.connect(filter).connect(gain).connect(ctx.destination)
      source.start(now); source.stop(now + 0.015)
      return
    }
    case 'terminal': {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 800
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now); osc.stop(now + 0.02)
      return
    }
  }
}
