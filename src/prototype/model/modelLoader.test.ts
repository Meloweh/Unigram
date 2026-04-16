import { describe, it, expect, beforeEach } from 'vitest'
import { resolveModelPath, modelToFile, exportAllModels, clearLoaderCache, registerModelUrl, getModelUrl } from './modelLoader'
import type { Model } from './sampleModels'
import { useHybridZoomStore } from './useHybridZoomStore'

const store = useHybridZoomStore

describe('resolveModelPath', () => {
  it('resolves a relative path from the same directory', () => {
    const result = resolveModelPath('./alpha-internals.json', '/models/root.json')
    expect(result).toBe('/models/alpha-internals.json')
  })

  it('resolves a parent-relative path', () => {
    const result = resolveModelPath('../other/sub.json', '/models/root.json')
    expect(result).toBe('/other/sub.json')
  })
})

describe('registerModelUrl / getModelUrl', () => {
  beforeEach(() => clearLoaderCache())

  it('stores and retrieves a URL for a model ID', () => {
    registerModelUrl('test-model', '/models/test.json')
    expect(getModelUrl('test-model')).toBe('/models/test.json')
  })
})

describe('modelToFile', () => {
  beforeEach(() => clearLoaderCache())

  it('converts a runtime model back to file format with relative paths', () => {
    registerModelUrl('alpha-internals', '/models/alpha-internals.json')
    registerModelUrl('svc-a-internals', '/models/svc-a-internals.json')
    registerModelUrl('svc-a-security', '/models/svc-a-security.json')

    const model: Model = {
      id: 'alpha-internals',
      label: 'Alpha Internals',
      nodes: [
        { id: 'svc-a', label: 'Service A', x: 20, y: 25, childModelId: 'svc-a-internals', mpdIds: ['svc-a-internals', 'svc-a-security'] },
        { id: 'svc-b', label: 'Service B', x: 70, y: 20 },
      ],
      connections: [{ from: 'svc-a', to: 'svc-b' }],
    }

    const file = modelToFile(model)
    expect(file.id).toBe('alpha-internals')
    expect(file.nodes[0].childModel).toBe('./svc-a-internals.json')
    expect(file.nodes[0].mpdModels).toEqual(['./svc-a-internals.json', './svc-a-security.json'])
    expect(file.nodes[1].childModel).toBeUndefined()
    expect(file.nodes[1].mpdModels).toBeUndefined()
  })
})

describe('exportAllModels', () => {
  beforeEach(() => clearLoaderCache())

  it('exports all models keyed by filename', () => {
    registerModelUrl('root', '/models/root.json')
    registerModelUrl('alpha', '/models/alpha.json')

    const models: Record<string, Model> = {
      root: { id: 'root', label: 'Root', nodes: [], connections: [] },
      alpha: { id: 'alpha', label: 'Alpha', nodes: [], connections: [] },
    }

    const exported = exportAllModels(models)
    expect(Object.keys(exported)).toContain('root.json')
    expect(Object.keys(exported)).toContain('alpha.json')
    expect(exported['root.json'].id).toBe('root')
  })
})

describe('store registerModel', () => {
  beforeEach(() => store.setState(store.getInitialState()))

  it('registers a new model into the store', () => {
    const newModel: Model = {
      id: 'test-new',
      label: 'Test New',
      nodes: [{ id: 'n1', label: 'Node 1', x: 50, y: 50 }],
      connections: [],
    }

    store.getState().registerModel(newModel)
    expect(store.getState().models['test-new']).toBeDefined()
    expect(store.getState().models['test-new'].label).toBe('Test New')
  })

  it('overwrites an existing model', () => {
    const updated: Model = {
      id: 'root',
      label: 'Updated Root',
      nodes: [],
      connections: [],
    }

    store.getState().registerModel(updated)
    expect(store.getState().models['root'].label).toBe('Updated Root')
  })
})
