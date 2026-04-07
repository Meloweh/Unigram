/** Sample model data for recursive zoom prototype */

export interface ModelNode {
  id: string
  label: string
  /** Canonical position as percentage of model canvas */
  x: number
  y: number
  /** ID of the child model this node opens on zoom (if any) */
  childModelId?: string
}

export interface ModelConnection {
  from: string
  to: string
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

// ---- Level 0: Root model ----
register({
  id: 'root',
  label: 'System Overview',
  nodes: [
    { id: 'node-alpha', label: 'Node Alpha', x: 50, y: 50, childModelId: 'alpha-internals' },
  ],
  connections: [],
})

// ---- Level 1: Alpha internals ----
register({
  id: 'alpha-internals',
  label: 'Alpha Internals',
  nodes: [
    { id: 'svc-a', label: 'Service A', x: 20, y: 25, childModelId: 'svc-a-internals' },
    { id: 'svc-b', label: 'Service B', x: 70, y: 20 },
    { id: 'db', label: 'Database', x: 30, y: 70 },
    { id: 'gw', label: 'Gateway', x: 75, y: 65 },
  ],
  connections: [
    { from: 'svc-a', to: 'svc-b' },
    { from: 'svc-a', to: 'db' },
    { from: 'svc-b', to: 'gw' },
    { from: 'db', to: 'gw' },
  ],
})

// ---- Level 2: Service A internals ----
register({
  id: 'svc-a-internals',
  label: 'Service A Details',
  nodes: [
    { id: 'handler', label: 'Request Handler', x: 25, y: 30 },
    { id: 'cache', label: 'Cache Layer', x: 70, y: 25 },
    { id: 'repo', label: 'Repository', x: 45, y: 70 },
  ],
  connections: [
    { from: 'handler', to: 'cache' },
    { from: 'handler', to: 'repo' },
    { from: 'cache', to: 'repo' },
  ],
})

export function getModel(id: string): Model | undefined {
  return models[id]
}

export function getRootModel(): Model {
  return models['root']
}
