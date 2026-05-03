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
  /**
   * Optional media payload kind. When set, the node renders the matching
   * asset (`mediaSrc`) instead of (or in addition to) its label. Mirrors
   * legacy `MediaNodeType`. Foundation only — full image/video/markdown/
   * math compositing arrives with Phase E.
   */
  mediaType?: 'image' | 'gif' | 'audio' | 'video' | 'markdown' | 'math'
  /**
   * Source URL or data-URI for the media payload (used when `mediaType` is
   * one of the binary kinds). For `markdown` / `math` the textual source
   * lives in `extra.contentSource` since strings are passed through the
   * label/extra channels rather than a media URL.
   */
  mediaSrc?: string
  /**
   * Optional original filename of the media asset, used by the bundle
   * exporter to round-trip the file extension and a stable display name.
   */
  mediaFileName?: string
  /**
   * Symmetric peer references for paired effect-graph editing. When this
   * node is opened in the FlowEffectEditor, every linked peer's effect
   * graph is rendered in a parallel column and cross-graph wires (stored
   * on the `Model.crossLinks` registry) are honoured by the runtime.
   */
  linkedNodeIds?: string[]
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
  /**
   * When true, the camera follows this connection during a flow Play cascade
   * \u2014 specifically tracks the head bead of the wire-reveal animation as it
   * travels from source to target. Combine with `cameraTracked` on the
   * source/target nodes to get smooth pan-along-flow camera motion.
   */
  cameraTracked?: boolean
  /** When set, this connection only appears once the named spawn effect runs. */
  dependsOnSpawn?: string
  /**
   * Citations / supporting references attached to this connection. Surfaced
   * by the in-canvas reference popup that opens over a selected edge
   * (legacy `unzipPopup` parity — the popup lives in `src/ui/`).
   */
  references?: ConnectionReference[]
  /** Forward-compat slot. */
  extra?: Record<string, unknown>
}

/** A single citation row attached to a connection. */
export interface ConnectionReference {
  title: string
  citation: string
  url: string
}

export interface GridSettings {
  /** When true, the grid lines are drawn over the canvas. */
  enabled: boolean
  /** When true, drag and drop snap to grid intersections. */
  snap: boolean
  /** Grid spacing in scene-percent units. Always > 0. */
  sizePercent: number
  /**
   * Visual style of the grid overlay. Default is `'lines'` (full crosshatch).
   * - `'dots'`  — a single dot at every intersection.
   * - `'tile'`  — a checkerboard fill (alternating cells lightly tinted).
   */
  appearance?: 'lines' | 'dots' | 'tile'
}

export const DEFAULT_GRID: GridSettings = {
  enabled: false,
  snap: false,
  sizePercent: 4,
  appearance: 'lines',
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
  /**
   * Cross-graph wires between two host nodes' flow effect graphs. Created
   * by the FlowEffectEditor when the user drags a wire from one host's
   * column into another linked host's column. Honoured by
   * [src/flow/runtime.ts](../flow/runtime.ts) at playback.
   */
  crossLinks?: CrossEffectLink[]
  /** Forward-compat slot. */
  extra?: Record<string, unknown>
}

/**
 * A wire that crosses from one node's effect graph into another's.
 * Stored on the parent model (not on either node) so removal stays
 * symmetric when either endpoint is deleted.
 *
 * `effectNodeId` records the inner effect-graph node the user actually
 * wired to, so the editor can anchor the visual at the right port. The
 * runtime ignores this field today — cross-links still fire the entire
 * peer effect — but storing it preserves authoring intent.
 */
export interface CrossEffectLink {
  id: string
  from: { nodeId: string; effectId: string; effectNodeId?: string }
  to: { nodeId: string; effectId: string; effectNodeId?: string }
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
  w: 5.1,
  h: 5,
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
