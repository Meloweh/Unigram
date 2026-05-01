export type TextGenSoundPreset = 'none' | 'undertale' | 'inscryption' | 'pokemon' | 'typewriter' | 'terminal'

export const TEXT_GEN_SOUND_PRESETS: { id: TextGenSoundPreset; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'undertale', label: 'Undertale' },
  { id: 'inscryption', label: 'Inscryption' },
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'terminal', label: 'Terminal' },
]

// Shared AudioContext — created lazily on first sound, reused across all presets
let sharedCtx: AudioContext | null = null
function getCtx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext()
  if (sharedCtx.state === 'suspended') sharedCtx.resume()
  return sharedCtx
}

// Pre-generated white-noise buffer (1 channel, 4096 samples)
let noiseBuffer: AudioBuffer | null = null
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const len = 4096
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return noiseBuffer
}

interface ActiveSound {
  osc?: OscillatorNode
  gain?: GainNode
  source?: AudioBufferSourceNode
  ctx: AudioContext
}

/**
 * Play a single dialog-generation sound tick.
 * Returns an ActiveSound that can be stored for cleanup.
 * Each call creates short-lived nodes that self-disconnect.
 */
export function playGenSound(preset: TextGenSoundPreset, charIndex: number): ActiveSound | null {
  if (preset === 'none') return null
  const ctx = getCtx()
  const now = ctx.currentTime

  switch (preset) {
    case 'undertale': {
      // Square wave, 300-500Hz random per char, 40ms
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 300 + Math.random() * 200
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.04)
      return { osc, gain, ctx }
    }
    case 'inscryption': {
      // Low sine wave, 180-250Hz, subtle pitch walk based on charIndex, 60ms
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 180 + (charIndex % 7) * 10 + Math.random() * 20
      gain.gain.setValueAtTime(0.15, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.06)
      return { osc, gain, ctx }
    }
    case 'pokemon': {
      // Triangle wave, 400-600Hz, alternating pitch, 30ms
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = charIndex % 2 === 0 ? 480 : 560
      gain.gain.setValueAtTime(0.13, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.03)
      return { osc, gain, ctx }
    }
    case 'typewriter': {
      // White noise burst, 15ms, clicky
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      const filter = ctx.createBiquadFilter()
      source.buffer = getNoiseBuffer(ctx)
      filter.type = 'highpass'
      filter.frequency.value = 3000
      gain.gain.setValueAtTime(0.18, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015)
      source.connect(filter).connect(gain).connect(ctx.destination)
      source.start(now)
      source.stop(now + 0.015)
      return { source, gain, ctx }
    }
    case 'terminal': {
      // Square wave, fixed 800Hz, 20ms, staccato
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 800
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.02)
      return { osc, gain, ctx }
    }
  }
}
