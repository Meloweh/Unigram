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
        membraneVisible: false,
        textFormats: [{ start: 0, end: 5, bold: true }],
        previewOf: { hostNodeId: 'host', spawnEffectNodeId: 'spawn', itemIndex: 1 },
      },
      { id: 'n2', label: 'Plain', x: 30, y: 30 },
      {
        id: 'n3',
        label: 'Media',
        x: 40,
        y: 40,
        mediaType: 'audio',
        mediaFile: './audio/theme.mp3',
        mediaFileName: 'theme.mp3',
        audioCoverFile: './covers/theme.png',
        contentSource: '# Notes',
        contentCollapsed: false,
        contentFontSize: 1.25,
      },
      {
        id: 'n4',
        label: 'Thought',
        x: 45,
        y: 45,
        cosmeticType: 'thinking-cloud',
        tipAngle: 1.2,
        tipLength: 32,
        nodeWidth: 180,
        nodeHeight: 100,
      },
    ],
    connections: [
      {
        from: 'n1',
        to: 'n2',
        type: 'flow',
        strokeColor: '#ff0000',
        strokeWidth: 0.3,
        strokeDash: 'dash-dot',
        arrowStyle: 'circle',
        label: 'rel',
        hideDuringFlow: true,
        dependsOnSpawn: 'spawn',
        evidence: [{ title: 'Paper', citation: 'Doe 2024', url: 'https://example.test/paper' }],
      },
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
    expect(e.kind).toBe('flow')
    expect(e.dash).toBe('dash-dot')
    expect(e.arrowStyle).toBe('circle')
    expect(e.hideDuringFlow).toBe(true)
    expect(e.dependsOnSpawn).toBe('spawn')
    expect(e.references).toEqual([{ title: 'Paper', citation: 'Doe 2024', url: 'https://example.test/paper' }])
  })

  it('preserves legacy visual and preview fields', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    const n1 = snap.models.get('root')!.nodes.get('n1')!
    expect(n1.membraneVisible).toBe(false)
    expect(n1.textFormats).toEqual([{ start: 0, end: 5, bold: true }])
    expect(n1.previewOf).toEqual({ hostNodeId: 'host', spawnEffectNodeId: 'spawn', itemIndex: 1 })
  })

  it('renames v0 `label` field to `name`', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    expect(snap.models.get('root')!.name).toBe('Root')
  })

  it('preserves legacy media and content fields', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    const n3 = snap.models.get('root')!.nodes.get('n3')!
    expect(n3.mediaType).toBe('audio')
    expect(n3.mediaSrc).toBe('/models/audio/theme.mp3')
    expect(n3.mediaFileName).toBe('theme.mp3')
    expect(n3.audioCoverSrc).toBe('/models/covers/theme.png')
    expect(n3.contentSource).toBe('# Notes')
    expect(n3.contentCollapsed).toBe(false)
    expect(n3.contentFontSize).toBe(1.25)
  })

  it('preserves legacy cosmetic fields and translates pixel size', async () => {
    const snap = await importLegacyBundle('/models/root.json', fetcher)
    const n4 = snap.models.get('root')!.nodes.get('n4')!
    expect(n4.cosmeticType).toBe('thinking-cloud')
    expect(n4.shape).toBe('thinking-cloud')
    expect(n4.tipAngle).toBe(1.2)
    expect(n4.tipLength).toBe(32)
    expect(n4.w).toBeCloseTo(9.375)
    expect(n4.h).toBeCloseTo(9.259)
  })

  it('rejects malformed files', async () => {
    const bad: LegacyFetcher = async () => ({ wrong: 'shape' })
    await expect(importLegacyBundle('/x.json', bad)).rejects.toThrow()
  })
})
