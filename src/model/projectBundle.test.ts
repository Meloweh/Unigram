import { describe, expect, it } from 'vitest'
import { exportBundle, importBundle } from './projectBundle'
import type { Model } from './types'

const mkModel = (id: string, name: string): Model => ({
  id,
  name,
  nodes: new Map([
    [
      'n1',
      {
        id: 'n1',
        x: 25,
        y: 30,
        w: 8,
        h: 4,
        label: 'hello',
        shape: 'rounded-rect',
        cellColor: '#fff',
        membraneColor: '#000',
        mpdDimensions: [id, 'mpd_x'],
      },
    ],
    [
      'n2',
      {
        id: 'n2',
        x: 70,
        y: 60,
        w: 6,
        h: 6,
        label: 'world',
        shape: 'circle',
        cellColor: '#abc',
        membraneColor: '#123',
        childModelId: 'child',
      },
    ],
  ]),
  edges: new Map([
    [
      'e1',
      { id: 'e1', from: 'n1', to: 'n2', color: '#444', width: 0.2 },
    ],
  ]),
  grid: { enabled: true, snap: true, sizePercent: 5 },
})

describe('projectBundle round-trip', () => {
  it('preserves nodes, edges, grid, mpd, child refs across export/import', async () => {
    const root = mkModel('root', 'My Project')
    const child = mkModel('child', 'Child')
    const models = new Map<string, Model>([
      ['root', root],
      ['child', child],
    ])
    const blob = await exportBundle({ rootModelId: 'root', models })
    const restored = await importBundle(blob)
    expect(restored.rootModelId).toBe('root')
    expect(restored.models.size).toBe(2)
    const r = restored.models.get('root')!
    expect(r.name).toBe('My Project')
    expect(r.grid).toEqual({ enabled: true, snap: true, sizePercent: 5 })
    expect(r.nodes.size).toBe(2)
    expect(r.nodes.get('n1')?.label).toBe('hello')
    expect(r.nodes.get('n1')?.mpdDimensions).toEqual(['root', 'mpd_x'])
    expect(r.nodes.get('n2')?.childModelId).toBe('child')
    expect(r.edges.size).toBe(1)
    expect(r.edges.get('e1')).toMatchObject({ from: 'n1', to: 'n2', color: '#444', width: 0.2 })
    const c = restored.models.get('child')!
    expect(c.name).toBe('Child')
    expect(c.nodes.size).toBe(2)
  })

  it('rejects bundles with missing project.json or wrong version', async () => {
    const empty = new Blob([''], { type: 'application/zip' })
    await expect(importBundle(empty)).rejects.toThrow()
  })

  it('round-trips diagram cosmetics (theme, background, particles)', async () => {
    const m = mkModel('root', 'Themed')
    m.cosmetics = {
      themeMode: 'sci-fi',
      background: { type: 'gradient', value: 'linear-gradient(45deg,#000,#222)' },
      particleEffect: 'fireflies',
    }
    const blob = await exportBundle({
      rootModelId: 'root',
      models: new Map([['root', m]]),
    })
    const restored = await importBundle(blob)
    const r = restored.models.get('root')!
    expect(r.cosmetics?.themeMode).toBe('sci-fi')
    expect(r.cosmetics?.background?.type).toBe('gradient')
    expect(r.cosmetics?.particleEffect).toBe('fireflies')
  })
})
