/** Ambient particle effect definitions */

export interface ParticleConfig {
  count: number
  speed: [number, number]
  size: [number, number]
  opacity: [number, number]
  color: string | string[]
  shape: 'circle' | 'star' | 'square' | 'snowflake' | 'leaf' | 'hexagon' | 'spore'
  behavior: 'drift' | 'fall' | 'rise' | 'wander' | 'twinkle'
  wind?: number
  gravity?: number
}

export interface ParticlePreset {
  id: string
  name: string
  config: ParticleConfig
}

export const PARTICLE_PRESETS: ParticlePreset[] = [
  {
    id: 'floating-dust',
    name: 'Floating Dust',
    config: {
      count: 60,
      speed: [0.1, 0.4],
      size: [2, 5],
      opacity: [0.2, 0.45],
      color: '#94a3b8',
      shape: 'circle',
      behavior: 'drift',
    },
  },
  {
    id: 'stars',
    name: 'Stars',
    config: {
      count: 80,
      speed: [0, 0],
      size: [1, 3],
      opacity: [0.2, 0.8],
      color: ['#e2e8f0', '#bfdbfe', '#c4b5fd'],
      shape: 'circle',
      behavior: 'twinkle',
    },
  },
  {
    id: 'snow',
    name: 'Snow',
    config: {
      count: 100,
      speed: [0.3, 0.8],
      size: [2, 5],
      opacity: [0.4, 0.8],
      color: '#fff',
      shape: 'circle',
      behavior: 'fall',
      wind: 0.3,
    },
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    config: {
      count: 35,
      speed: [0.15, 0.5],
      size: [2, 5],
      opacity: [0.2, 0.9],
      color: ['#fbbf24', '#a3e635', '#86efac'],
      shape: 'circle',
      behavior: 'wander',
    },
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    config: {
      count: 40,
      speed: [0.2, 0.6],
      size: [3, 10],
      opacity: [0.1, 0.3],
      color: ['#bfdbfe', '#e0f2fe', '#dbeafe'],
      shape: 'circle',
      behavior: 'rise',
      wind: 0.15,
    },
  },
  {
    id: 'confetti',
    name: 'Confetti',
    config: {
      count: 50,
      speed: [0.3, 0.7],
      size: [3, 6],
      opacity: [0.5, 0.8],
      color: ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#fb923c'],
      shape: 'square',
      behavior: 'fall',
      wind: 0.4,
      gravity: 0.02,
    },
  },
  {
    id: 'aurora-motes',
    name: 'Aurora Motes',
    config: {
      count: 45,
      speed: [0.1, 0.35],
      size: [2, 7],
      opacity: [0.15, 0.45],
      color: ['#5eead4', '#a78bfa', '#f472b6', '#38bdf8'],
      shape: 'circle',
      behavior: 'drift',
    },
  },
  {
    id: 'falling-leaves',
    name: 'Falling Leaves',
    config: {
      count: 40,
      speed: [0.2, 0.55],
      size: [4, 9],
      opacity: [0.5, 0.85],
      color: ['#8B4513', '#D2691E', '#DAA520', '#228B22', '#CD853F'],
      shape: 'leaf',
      behavior: 'fall',
      wind: 0.35,
      gravity: 0.008,
    },
  },
  {
    id: 'glossy-bubbles',
    name: 'Glossy Bubbles',
    config: {
      count: 35,
      speed: [0.15, 0.45],
      size: [4, 12],
      opacity: [0.12, 0.28],
      color: ['#67e8f9', '#a5f3fc', '#bae6fd', '#c4b5fd'],
      shape: 'circle',
      behavior: 'rise',
      wind: 0.1,
    },
  },
  {
    id: 'sparks',
    name: 'Sparks',
    config: {
      count: 30,
      speed: [0.3, 0.7],
      size: [1, 3],
      opacity: [0.4, 0.9],
      color: ['#fb923c', '#f59e0b', '#fbbf24', '#fcd34d'],
      shape: 'circle',
      behavior: 'rise',
      wind: 0.2,
      gravity: -0.005,
    },
  },
  {
    id: 'data-hex',
    name: 'Data Hexagons',
    config: {
      count: 25,
      speed: [0.05, 0.2],
      size: [4, 8],
      opacity: [0.15, 0.4],
      color: ['#22d3ee', '#06b6d4', '#67e8f9', '#a78bfa'],
      shape: 'hexagon',
      behavior: 'drift',
    },
  },
  {
    id: 'ocean-bubbles',
    name: 'Ocean Bubbles',
    config: {
      count: 50,
      speed: [0.1, 0.5],
      size: [2, 8],
      opacity: [0.08, 0.25],
      color: ['#bae6fd', '#e0f2fe', '#cffafe', '#a5f3fc'],
      shape: 'circle',
      behavior: 'rise',
      wind: 0.12,
    },
  },
  {
    id: 'spores',
    name: 'Spores',
    config: {
      count: 30,
      speed: [0.08, 0.3],
      size: [3, 7],
      opacity: [0.2, 0.5],
      color: ['#86efac', '#4ade80', '#a3e635', '#bef264'],
      shape: 'spore',
      behavior: 'wander',
    },
  },
  {
    id: 'sterile-motes',
    name: 'Sterile Motes',
    config: {
      count: 40,
      speed: [0, 0],
      size: [1, 3],
      opacity: [0.15, 0.5],
      color: ['#e0f2fe', '#f0f9ff', '#dbeafe', '#bfdbfe'],
      shape: 'circle',
      behavior: 'twinkle',
    },
  },
]

export function getParticlePreset(id: string): ParticlePreset | undefined {
  return PARTICLE_PRESETS.find((p) => p.id === id)
}
