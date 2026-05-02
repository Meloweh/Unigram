import { describe, expect, it } from 'vitest'
import { importLegacyBundle, type LegacyFetcher } from './legacyImport'

const FILES: Record<string, unknown> = {
  '/models/root.json': {
    id: 'root',
    label: 'Root',
    nodes: [
      {
        id: 'n1',
        label: 'Alpha',
        x: 50,
        y: 50,
        childModel: './alpha.json',
        mpdModels: ['./alpha.json', './alpha-perf.json'],
      },
      { id: 'n2', label: 'Plain', x: 30, y: 30 },
    ],
    connections: [
      { from: 'n1', to: 'n2', strokeColor: '#ff0000', strokeWidth: 0.3, label: 'rel' },
    ],
  },
  '/models/alpha.json': {
    id: 'alpha',
    label: 'Alpha Internals',
    nodes: [{ id: 'a1', label: 'A1', x: 10, y: 10 }],
    connections: [],
  },
  '/models/alpha-perf.json': {
    id: 'alpha-perf',
    label: 'Alpha Perf',
    nodes: [{ id: 'p1', label: 'P1', x: 5, y: 5 }],
    connections: [],
  },
}

const fetcher: LegacyFetcher = async (url) => {
  if (!(url in FILES)) throw new Error(`Missing fixture: ${url}`)
  return FILES[url]
}

describe('importLegacyBundle', () => {
  it('walks references and assembles a project snapshot', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    expect(snap.rootModelId).toBe('root')
    expect(snap.models.size).toBe(3)
    expect(snap.models.has('alpha')).toBe(true)
    expect(snap.models.has('alpha-perf')).toBe(true)
  })

  it('resolves childModel paths to model ids', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    const root = snap.models.get('root')!
    const n1 = root.nodes.get('n1')!
    expect(n1.childModelId).toBe('alpha')
    expect(n1.mpdDimensions).toEqual(['alpha', 'alpha-perf'])
  })

  it('translates connections with default fallbacks and label', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    const root = snap.models.get('root')!
    expect(root.edges.size).toBe(1)
    const e = [...root.edges.values()][0]
    expect(e.from).toBe('n1')
    expect(e.to).toBe('n2')
    expect(e.color).toBe('#ff0000')
    expect(e.label).toBe('rel')
  })

  it('renames v0 `label` field to `name`', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    expect(snap.models.get('root')!.name).toBe('Root')
  })

  it('rejects malformed files', async () => {
    const bad: LegacyFetcher = async () => ({ wrong: 'shape' })
    await expect(importLegacyBundle('/x.json', bad)).rejects.toThrow()
  })
})
