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
    { id: 'monitor', label: 'Monitor', x: 52, y: 46 },
    { id: 'logger', label: 'Logger', x: 60, y: 52 },
  ],
  connections: [
    {
      from: 'svc-a',
      to: 'svc-b',
      evidence: [
        {
          title: 'Microservice Communication Patterns',
          citation: 'Newman, S. (2021). Building Microservices, 2nd ed., O\'Reilly, Ch. 4',
          url: 'https://example.com/newman-microservices',
        },
        {
          title: 'Async Messaging in Distributed Systems',
          citation: 'Hohpe, G. & Woolf, B. (2003). Enterprise Integration Patterns, Addison-Wesley',
          url: 'https://example.com/eip-hohpe',
        },
      ],
    },
    {
      from: 'svc-a',
      to: 'db',
      evidence: [
        {
          title: 'Database Per Service Pattern',
          citation: 'Richardson, C. (2018). Microservices Patterns, Manning, Ch. 2',
          url: 'https://example.com/richardson-db',
        },
      ],
    },
    { from: 'svc-b', to: 'gw' },
    {
      from: 'db',
      to: 'gw',
      evidence: [
        {
          title: 'API Gateway Aggregation',
          citation: 'Richardson, C. (2018). Microservices Patterns, Manning, Ch. 8',
          url: 'https://example.com/richardson-gateway',
        },
        {
          title: 'Gateway Routing Strategies',
          citation: 'Burns, B. (2018). Designing Distributed Systems, O\'Reilly, Ch. 5',
          url: 'https://example.com/burns-gateway',
        },
        {
          title: 'Low-Latency Data Access at the Edge',
          citation: 'Kleppmann, M. (2017). Designing Data-Intensive Applications, O\'Reilly, Ch. 11',
          url: 'https://example.com/kleppmann-edge',
        },
      ],
    },
    {
      from: 'monitor',
      to: 'logger',
      evidence: [
        {
          title: 'Structured Logging in Observability Pipelines',
          citation: 'Majors, C. et al. (2022). Observability Engineering, O\'Reilly, Ch. 7',
          url: 'https://example.com/majors-observability',
        },
        {
          title: 'Correlation IDs for Distributed Tracing',
          citation: 'Sridharan, C. (2018). Distributed Systems Observability, O\'Reilly, Ch. 4',
          url: 'https://example.com/sridharan-tracing',
        },
      ],
    },
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
