/**
 * Stage 1 model schema. Deliberately minimal: only the fields the renderer,
 * store, and basic editing controllers need. Future-stage fields (RMM, MPD,
 * media, flow effects, content) round-trip via `extra` so JSON imports of
 * later schemas don't lose data.
 */

export type NodeShape = 'rectangle' | 'rounded-rect' | 'circle'

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
  /** Forward-compat slot for fields owned by later stages. */
  extra?: Record<string, unknown>
}

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
  /** Forward-compat slot. */
  extra?: Record<string, unknown>
}

export interface Model {
  id: string
  name: string
  nodes: Map<string, ModelNode>
  edges: Map<string, Connection>
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

export const DEFAULT_EDGE: Pick<Connection, 'color' | 'width'> = {
  color: '#365f8f',
  width: 0.15,
}
