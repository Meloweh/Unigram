/** Sample model data for recursive zoom prototype */

export type NodeShape = 'rectangle' | 'rounded-rect' | 'oval' | 'circle' | 'diamond' | 'hexagon' | 'parallelogram' | 'triangle'

export type MediaNodeType = 'image' | 'gif' | 'audio' | 'video' | 'markdown' | 'math'

export type ConnectionType = 'default' | 'flow'

export type FlowEffectKind = 'entry' | 'wait' | 'move' | 'color' | 'spawn' | 'spawn-circular' | 'play-media' | 'handoff-rmm' | 'return-rmm' | 'handoff-mpd' | 'camera' | 'break' | 'expand' | 'collapse' | 'record' | 'jitter' | 'float' | 'emerge' | 'scale' | 'text-format'

export interface TextFormatRange {
  start: number
  end: number
  bold?: boolean
  italic?: boolean
  strikethrough?: boolean
  color?: string
  fontSize?: number
}

export type ConnectionArrowStyle = 'standard' | 'triangle' | 'diamond' | 'circle' | 'none'
export type ConnectionDashStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot'

export type ThemeMode = 'light' | 'dark' | 'grey' | 'woody' | 'frutiger-aero' | 'steel' | 'sci-fi' | 'aqua' | 'biology' | 'medical'
export type BackgroundType = 'gradient' | 'solid' | 'image' | 'pattern'

export interface BackgroundConfig {
  type: BackgroundType
  value: string
  opacity?: number
  blur?: number
  fit?: 'cover' | 'contain' | 'tile'
}

export type GridStyle = 'dots' | 'lines' | 'dotted-lines'

export interface GridConfig {
  color?: string
  size?: number
  style?: GridStyle
}

export interface ModelCosmetics {
  themeMode?: ThemeMode
  background?: BackgroundConfig
  particleEffect?: string | null
  grid?: GridConfig
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
  /** Whether the camera tracks this node during flow animation */
  cameraTracked?: boolean
  /** Raw source text for markdown/math content nodes */
  contentSource?: string
  /** Whether a content node is in collapsed state (default: true) */
  contentCollapsed?: boolean
  /** Font size (rem) for rendered content in markdown/math nodes */
  contentFontSize?: number
  /** Inline text formatting ranges for the node label */
  textFormats?: TextFormatRange[]
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
  /** Optional text label displayed at the midpoint of the connection */
  label?: string
  /** Font size (rem) for the connection label */
  labelFontSize?: number
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

/**
 * Apply a formatting change to a character range within existing textFormats.
 * Splits/merges overlapping ranges as needed and returns a new array.
 */
export function applyFormatToRange(
  existing: TextFormatRange[],
  start: number,
  end: number,
  format: Omit<TextFormatRange, 'start' | 'end'>,
): TextFormatRange[] {
  if (start >= end) return existing
  // Flatten into per-character format map, then apply the new format, then coalesce
  const maxEnd = Math.max(end, ...existing.map(r => r.end))
  type CharFmt = { bold?: boolean; italic?: boolean; strikethrough?: boolean; color?: string; fontSize?: number }
  const chars: CharFmt[] = Array.from({ length: maxEnd }, () => ({}))

  // Lay down existing formats
  for (const r of existing) {
    for (let i = r.start; i < r.end && i < maxEnd; i++) {
      if (r.bold != null) chars[i].bold = r.bold
      if (r.italic != null) chars[i].italic = r.italic
      if (r.strikethrough != null) chars[i].strikethrough = r.strikethrough
      if (r.color != null) chars[i].color = r.color
      if (r.fontSize != null) chars[i].fontSize = r.fontSize
    }
  }

  // Apply new format
  for (let i = start; i < end && i < maxEnd; i++) {
    if (format.bold != null) chars[i].bold = format.bold
    if (format.italic != null) chars[i].italic = format.italic
    if (format.strikethrough != null) chars[i].strikethrough = format.strikethrough
    if (format.color != null) chars[i].color = format.color
    if (format.fontSize != null) chars[i].fontSize = format.fontSize
  }

  // Coalesce consecutive chars with identical formatting into ranges
  const result: TextFormatRange[] = []
  const fmtKey = (f: CharFmt) => `${f.bold ?? ''},${f.italic ?? ''},${f.strikethrough ?? ''},${f.color ?? ''},${f.fontSize ?? ''}`
  const isEmpty = (f: CharFmt) => !f.bold && !f.italic && !f.strikethrough && !f.color && f.fontSize == null

  let i = 0
  while (i < maxEnd) {
    if (isEmpty(chars[i])) { i++; continue }
    const key = fmtKey(chars[i])
    const rangeStart = i
    while (i < maxEnd && fmtKey(chars[i]) === key) i++
    const r: TextFormatRange = { start: rangeStart, end: i }
    if (chars[rangeStart].bold) r.bold = true
    if (chars[rangeStart].italic) r.italic = true
    if (chars[rangeStart].strikethrough) r.strikethrough = true
    if (chars[rangeStart].color) r.color = chars[rangeStart].color
    if (chars[rangeStart].fontSize != null) r.fontSize = chars[rangeStart].fontSize
    result.push(r)
  }

  return result
}
