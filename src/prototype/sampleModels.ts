/** Sample model data for recursive zoom prototype */

export type NodeShape = 'rectangle' | 'rounded-rect' | 'oval' | 'circle' | 'diamond' | 'hexagon' | 'parallelogram' | 'triangle'

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
