import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE, DEFAULT_NODE, type Model, type Project } from '../model/types'
import {
  capturePublicGraphBaseline,
  getPublicGraphDraftSteps,
  projectWithoutPublicGraphDrafts,
} from './publicGraphDraft'

describe('public graph draft diff', () => {
  it('turns local public edits into deterministic proposal steps', () => {
    const baseline = projectWith(modelWithBaseGraph())
    capturePublicGraphBaseline(baseline)
    const currentModel = cloneModel(modelWithBaseGraph())
    const alpha = currentModel.nodes.get('a')
    const beta = currentModel.nodes.get('b')
    const edge = currentModel.edges.get('edge-ab')
    expect(alpha && beta && edge).toBeTruthy()
    currentModel.nodes.set('a', { ...alpha!, x: 28, y: 20, w: 16, h: 9 })
    currentModel.nodes.set('b', { ...beta!, label: 'Beta renamed' })
    currentModel.nodes.set('c', { ...DEFAULT_NODE, id: 'c', label: 'Gamma', x: 50, y: 50, w: 12, h: 7 })
    currentModel.edges.set('edge-ab', {
      ...edge!,
      label: 'evidence',
      references: [{ title: 'Paper', citation: 'A. Example', url: 'https://example.test' }],
    })
    currentModel.edges.set('edge-ac', { ...DEFAULT_EDGE, id: 'edge-ac', from: 'a', to: 'c', label: 'new path' })

    const steps = getPublicGraphDraftSteps(projectWith(currentModel))
    expect(steps.map((step) => step.action)).toEqual([
      'add-node',
      'add-edge',
      'rename-node',
      'rename-edge',
      'modify-references',
      'commit-transform',
    ])
    expect(steps[0]).toMatchObject({ action: 'add-node', nodeId: 'c', newNodeLabel: 'Gamma' })
    expect(steps[1]).toMatchObject({ action: 'add-edge', edgeId: 'edge-ac', sourceNodeId: 'a', targetNodeId: 'c' })
    expect(steps[5]).toMatchObject({ action: 'commit-transform', transforms: [{ nodeId: 'a' }] })
  })

  it('projects autosave back to the server baseline', () => {
    const baseline = projectWith(modelWithBaseGraph())
    capturePublicGraphBaseline(baseline)
    const currentModel = cloneModel(modelWithBaseGraph())
    currentModel.nodes.set('a', { ...currentModel.nodes.get('a')!, x: 42 })
    currentModel.nodes.set('c', { ...DEFAULT_NODE, id: 'c', label: 'Gamma', x: 40, y: 40, w: 12, h: 7 })

    const projected = projectWithoutPublicGraphDrafts(projectWith(currentModel))
    const projectedModel = projected.models.get('root')
    expect(projectedModel?.nodes.has('c')).toBe(false)
    expect(projectedModel?.nodes.get('a')?.x).toBe(10)
  })

  it('captures local RMM and MPD dimension additions as chain steps', () => {
    const baseline = projectWith(modelWithBaseGraph())
    capturePublicGraphBaseline(baseline)
    const currentModel = cloneModel(modelWithBaseGraph())
    currentModel.nodes.set('a', {
      ...currentModel.nodes.get('a')!,
      childModelId: 'rmm-1',
      mpdDimensions: ['root', 'mpd-1'],
    })
    const current: Project = {
      rootModelId: 'root',
      models: new Map([
        ['root', currentModel],
        ['rmm-1', { id: 'rmm-1', name: 'Nested detail', nodes: new Map(), edges: new Map() }],
        ['mpd-1', { id: 'mpd-1', name: 'Alternate lens', nodes: new Map(), edges: new Map() }],
      ]),
    }

    expect(getPublicGraphDraftSteps(current)).toEqual([
      { action: 'add-rmm', nodeId: 'a', name: 'Nested detail' },
      { action: 'add-mpd', nodeId: 'a', name: 'Alternate lens' },
    ])
  })
})

function modelWithBaseGraph(): Model {
  return {
    id: 'root',
    name: 'Public baseline',
    nodes: new Map([
      ['a', { ...DEFAULT_NODE, id: 'a', label: 'Alpha', x: 10, y: 10, w: 12, h: 7 }],
      ['b', { ...DEFAULT_NODE, id: 'b', label: 'Beta', x: 30, y: 10, w: 12, h: 7 }],
    ]),
    edges: new Map([
      ['edge-ab', { ...DEFAULT_EDGE, id: 'edge-ab', from: 'a', to: 'b' }],
    ]),
  }
}

function cloneModel(model: Model): Model {
  return {
    ...model,
    nodes: new Map([...model.nodes].map(([id, node]) => [id, { ...node }])),
    edges: new Map([...model.edges].map(([id, edge]) => [id, { ...edge, references: edge.references?.map((ref) => ({ ...ref })) }])),
  }
}

function projectWith(model: Model): Project {
  return { rootModelId: model.id, models: new Map([[model.id, model]]) }
}
