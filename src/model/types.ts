/**
 * Stage 1 model schema. Deliberately minimal: only the fields the renderer,
 * store, and basic editing controllers need. Future-stage fields (RMM, MPD,
 * media, flow effects, content) round-trip via `extra` so JSON imports of
 * later schemas don't lose data.
 */

export type NodeShape =
  | 'rectangle'
  | 'rounded-rect'
  | 'circle'
  | 'oval'
  | 'diamond'
  | 'hexagon'
  | 'parallelogram'
  | 'triangle'
  | 'chat-bubble'
  | 'thinking-cloud'

/** Pixel-space tip offset relative to node centre (cosmetic shapes only). */
export interface CosmeticTip {
  x: number
  y: number
}

export interface ModelNode {
  id: string
  /** Position in scene percent (0–100 of `SCENE_W` / `SCENE_H`). */
  x: number
  y: number
  /** Size in scene percent. Width and height are independent. */
  w: number
  h: number
  label: string
  shape: NodeShape
  /** Fill color (any CSS color or `#rrggbb`). */
  cellColor: string
  /** Border / membrane color. */
  membraneColor: string
  /** Optional child-model id for RMM zoom. */
  childModelId?: string
  /**
   * MPD dimensions for this node — alternate child-model ids the user can
   * dial through. The first entry is treated as the "default" / canonical
   * child (`childModelId`). Optional; absent means the node has no MPD.
   */
  mpdDimensions?: string[]
  /** Cosmetic-only tail/trail tip (in scene-percent of node size). */
  tip?: CosmeticTip
  /** Stage 5 flow effects attached to this node (override-based, render-only). */
  flowEffects?: import('../flow/types').FlowEffect[]
  /** When true, drag and untangle skip this node. */
  locked?: boolean
  /** When true, the node is hidden while a flow effect is playing. */
  hideDuringFlow?: boolean
  /** When true, viewport `move`/`camera` flow effects keep this node in view. */
  cameraTracked?: boolean
  /** Forward-compat slot for fields owned by later stages. */
  extra?: Record<string, unknown>
}

export type ConnectionKind = 'default' | 'flow'

export type ConnectionDashStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot'

export type ConnectionArrowStyle =
  | 'none'
  | 'standard'
  | 'filled-triangle'
  | 'line-arrow'
  | 'stealth'
  | 'diamond'

export interface Connection {
  id: string
  /** Source node id. */
  from: string
  /** Target node id. */
  to: string
  /** Stroke color. */
  color: string
  /** Stroke width in scene percent. */
  width: number
  /** Connection kind — `flow` connections animate during playback. */
  kind?: ConnectionKind
  /** Stroke dash pattern. */
  dash?: ConnectionDashStyle
  /** Arrow head style at the target end. */
  arrowStyle?: ConnectionArrowStyle
  /** Optional mid-line label. */
  label?: string
  /** Label font size in scene pixels (defaults to 22). */
  labelFontSize?: number
  /** When set, this connection only appears once the named spawn effect runs. */
  dependsOnSpawn?: string
  /** Forward-compat slot. */
  extra?: Record<string, unknown>
}

export interface GridSettings {
  /** When true, the grid lines are drawn over the canvas. */
  enabled: boolean
  /** When true, drag and drop snap to grid intersections. */
  snap: boolean
  /** Grid spacing in scene-percent units. Always > 0. */
  sizePercent: number
}

export const DEFAULT_GRID: GridSettings = {
  enabled: false,
  snap: false,
  sizePercent: 4,
}

export interface Model {
  id: string
  name: string
  nodes: Map<string, ModelNode>
  edges: Map<string, Connection>
  /** Diagram-level grid + snap configuration. */
  grid?: GridSettings
  /** Diagram-level cosmetics (theme, background, particles). */
  cosmetics?: import('../theme/types').ModelCosmetics
  /** Forward-compat slot. */
  extra?: Record<string, unknown>
}

export interface Project {
  /** Currently focused model id. */
  rootModelId: string
  models: Map<string, Model>
}

/** Stage 1 default visual constants for newly-created nodes. */
export const DEFAULT_NODE: Pick<
  ModelNode,
  'w' | 'h' | 'shape' | 'cellColor' | 'membraneColor'
> = {
  w: 8,
  h: 4,
  shape: 'rounded-rect',
  cellColor: '#f4f8fd',
  membraneColor: '#365f8f',
}

export const DEFAULT_EDGE: Pick<Connection, 'color' | 'width' | 'kind' | 'dash' | 'arrowStyle'> = {
  color: '#365f8f',
  width: 0.15,
  kind: 'default',
  dash: 'solid',
  arrowStyle: 'standard',
}
