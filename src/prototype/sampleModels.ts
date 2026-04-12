/** Sample model data for recursive zoom prototype */

export type NodeShape = 'rectangle' | 'rounded-rect' | 'oval' | 'circle' | 'diamond' | 'hexagon' | 'parallelogram' | 'triangle'

export type MediaNodeType = 'image' | 'gif' | 'audio' | 'video'

export type ConnectionType = 'default' | 'flow'

export type FlowEffectKind = 'entry' | 'wait' | 'move' | 'color' | 'spawn' | 'play-media' | 'handoff-rmm' | 'return-rmm' | 'handoff-mpd'

export type ConnectionArrowStyle = 'standard' | 'triangle' | 'diamond' | 'circle' | 'none'
export type ConnectionDashStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot'

export type ThemeMode = 'light' | 'dark' | 'grey'
export type BackgroundType = 'gradient' | 'solid' | 'image' | 'pattern'

export interface BackgroundConfig {
  type: BackgroundType
  value: string
  opacity?: number
  blur?: number
  fit?: 'cover' | 'contain' | 'tile'
}

export interface ModelCosmetics {
  themeMode?: ThemeMode
  background?: BackgroundConfig
  particleEffect?: string | null
}

export interface EffectGraphNode {
  id: string
  kind: FlowEffectKind
  label: string
  x: number
  y: number
  config: Record<string, unknown>
}

export interface EffectGraphEdge {
  from: string
  to: string
}

export interface FlowEffect {
  id: string
  label: string
  locked?: boolean
  graph: {
    nodes: EffectGraphNode[]
    edges: EffectGraphEdge[]
  }
}

export interface ModelNode {
  id: string
  label: string
  /** Canonical position as percentage of model canvas */
  x: number
  y: number
  /** Visual shape of the node (default: 'rounded-rect') */
  shape?: NodeShape
  /** Fill / cell background color (default: '#f4f8fd') */
  cellColor?: string
  /** Border / membrane stroke color (default: '#365f8f') */
  membraneColor?: string
  /** Whether the membrane border is visible (default: true) */
  membraneVisible?: boolean
  /** ID of the child model this node opens on zoom (if any) */
  childModelId?: string
  /** Available MPD (Multi-Parallel-Dimension) model IDs for this node.
   *  The dial appears when this array has more than one entry.
   *  childModelId should always be one of these. */
  mpdIds?: string[]
  /** Whether the node is locked (cannot be moved by dragging or untangle) */
  locked?: boolean
  /** Media node type — when set, the node hosts media content */
  mediaType?: MediaNodeType
  /** Data URL or object URL of the media file */
  mediaSrc?: string
  /** Original filename of the media */
  mediaFileName?: string
  /** Custom node width in px (overrides auto-sizing) */
  nodeWidth?: number
  /** Custom node height in px (overrides auto-sizing) */
  nodeHeight?: number
  /** Playback start time in seconds (for gif/audio/video) */
  playStart?: number
  /** Playback end time in seconds (for gif/audio/video) */
  playEnd?: number
  /** Cover image data URL for audio nodes */
  audioCoverSrc?: string
  /** Flow animation effects configured on this node */
  flowEffects?: FlowEffect[]
  /** Whether this node is invisible while a flow animation is running */
  hideDuringFlow?: boolean
}

export interface StudyEvidence {
  title: string
  citation: string
  url: string
}

export interface ModelConnection {
  from: string
  to: string
  evidence?: StudyEvidence[]
  type?: ConnectionType
  /** Whether this connection is invisible while a flow animation is running */
  hideDuringFlow?: boolean
  /** Custom stroke color (overrides default) */
  strokeColor?: string
  /** Custom stroke width in px (default: 2 for normal, 3 for flow) */
  strokeWidth?: number
  /** Line dash style */
  strokeDash?: ConnectionDashStyle
  /** Arrowhead style at the target end */
  arrowStyle?: ConnectionArrowStyle
}

export interface Model {
  id: string
  label: string
  nodes: ModelNode[]
  connections: ModelConnection[]
}

/** Lookup table of all models by ID */
const models: Record<string, Model> = {}

function register(model: Model) {
  models[model.id] = model
}

// ---- Minimal seed data (empty root) ----
register({
  id: 'root',
  label: 'Untitled Diagram',
  nodes: [],
  connections: [],
})

export function getModel(id: string): Model | undefined {
  return models[id]
}

/** Returns a deep clone of all registered models for mutable store initialization */
export function getInitialModels(): Record<string, Model> {
  return JSON.parse(JSON.stringify(models))
}

export function getRootModel(): Model {
  return models['root']
}
