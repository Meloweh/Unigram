import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportBundle, importBundle } from './projectBundle'
import { DEFAULT_GRID, type Model } from './types'
import { clearMediaStore, getMediaBlob, storeMediaBlob } from '../media/mediaStore'

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
        mpdDimensions: [id, 'mpd_x', 'external:graph-2:hello'],
        externalMpdLinks: {
          'external:graph-2:hello': {
            id: 'external:graph-2:hello',
            diagramId: 'graph-2',
            diagramTitle: 'Graph Two',
            nodeLabel: 'hello',
          },
        },
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
        childModelId: 'external-rmm:graph-2:world',
        externalRmmLink: {
          id: 'external-rmm:graph-2:world',
          diagramId: 'graph-2',
          diagramTitle: 'Graph Two',
          nodeLabel: 'world',
        },
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
  crossLinks: [
    {
      id: 'xl1',
      from: { nodeId: 'n1', effectId: 'fx1', effectNodeId: 'out' },
      to: { nodeId: 'n2', effectId: 'fx2', effectNodeId: 'in' },
    },
  ],
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
    expect(r.nodes.get('n1')?.mpdDimensions).toEqual(['root', 'mpd_x', 'external:graph-2:hello'])
    expect(r.nodes.get('n1')?.externalMpdLinks?.['external:graph-2:hello']).toMatchObject({
      diagramId: 'graph-2',
      diagramTitle: 'Graph Two',
      nodeLabel: 'hello',
    })
    expect(r.nodes.get('n2')?.childModelId).toBe('external-rmm:graph-2:world')
    expect(r.nodes.get('n2')?.externalRmmLink).toMatchObject({
      diagramId: 'graph-2',
      diagramTitle: 'Graph Two',
      nodeLabel: 'world',
    })
    expect(r.edges.size).toBe(1)
    expect(r.edges.get('e1')).toMatchObject({ from: 'n1', to: 'n2', color: '#444', width: 0.2 })
    expect(r.crossLinks).toEqual(root.crossLinks)
    const c = restored.models.get('child')!
    expect(c.name).toBe('Child')
    expect(c.nodes.size).toBe(2)
  })

  it('rejects bundles with missing project.json or wrong version', async () => {
    const empty = new Blob([''], { type: 'application/zip' })
    await expect(importBundle(empty)).rejects.toThrow()
  })

  it('loads bundles whose model map key differs from the embedded model id', async () => {
    const root = mkModel('root', 'Key Mismatch')
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify({
      version: 1,
      rootModelId: 'root',
      models: {
        current: {
          id: root.id,
          name: root.name,
          nodes: [...root.nodes.values()],
          edges: [...root.edges.values()],
        },
      },
    }))
    const blob = await zip.generateAsync({ type: 'blob' })
    const restored = await importBundle(blob)
    expect(restored.models.has('root')).toBe(true)
    expect(restored.models.get('root')?.name).toBe('Key Mismatch')
    expect(restored.models.get('root')?.grid).toEqual(DEFAULT_GRID)
  })

  it('uses the root model key when the embedded model id drifted', async () => {
    const root = mkModel('current', 'Root Key Wins')
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify({
      version: 1,
      rootModelId: 'root',
      models: {
        root: {
          id: root.id,
          name: root.name,
          nodes: [...root.nodes.values()],
          edges: [...root.edges.values()],
        },
      },
    }))
    const blob = await zip.generateAsync({ type: 'blob' })
    const restored = await importBundle(blob)
    expect(restored.rootModelId).toBe('root')
    expect(restored.models.get('root')?.name).toBe('Root Key Wins')
  })

  it('falls back to the only saved model when rootModelId is stale', async () => {
    const only = mkModel('current', 'Only Model')
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify({
      version: 1,
      rootModelId: 'root',
      models: {
        current: {
          id: only.id,
          name: only.name,
          nodes: [...only.nodes.values()],
          edges: [...only.edges.values()],
        },
      },
    }))
    const blob = await zip.generateAsync({ type: 'blob' })
    const restored = await importBundle(blob)
    expect(restored.rootModelId).toBe('current')
    expect(restored.models.get('current')?.name).toBe('Only Model')
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

  it('migrates old cosmetic shape-only nodes on import', async () => {
    const root = mkModel('root', 'Old Cosmetic')
    root.nodes.set('cloud', {
      id: 'cloud',
      x: 20,
      y: 20,
      w: 9,
      h: 9,
      label: 'idea',
      shape: 'thinking-cloud',
      cellColor: '#fff',
      membraneColor: '#000',
    })
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify({
      version: 1,
      rootModelId: 'root',
      models: {
        root: {
          id: root.id,
          name: root.name,
          nodes: [...root.nodes.values()],
          edges: [...root.edges.values()],
        },
      },
    }))
    const restored = await importBundle(await zip.generateAsync({ type: 'blob' }))
    const cloud = restored.models.get('root')!.nodes.get('cloud')!
    expect(cloud.cosmeticType).toBe('thinking-cloud')
    expect(cloud.tipAngle).toBeCloseTo(Math.PI * 0.75)
    expect(cloud.tipLength).toBe(20)
  })

  it('round-trips stored media blobs and first-class content fields', async () => {
    clearMediaStore()
    const imageUrl = await storeMediaBlob(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
    const coverUrl = await storeMediaBlob(new Blob([new Uint8Array([4, 5, 6])], { type: 'image/jpeg' }))
    const root = mkModel('root', 'Media')
    root.nodes.set('media', {
      id: 'media',
      x: 10,
      y: 10,
      w: 8,
      h: 8,
      label: '',
      shape: 'rounded-rect',
      cellColor: '#fff',
      membraneColor: '#000',
      mediaType: 'image',
      mediaSrc: imageUrl,
      mediaFileName: 'photo.png',
      audioCoverSrc: coverUrl,
      contentSource: '# Hello',
      contentCollapsed: false,
      contentFontSize: 1.1,
    })
    const blob = await exportBundle({ rootModelId: 'root', models: new Map([['root', root]]) })
    clearMediaStore()
    const restored = await importBundle(blob)
    const node = restored.models.get('root')!.nodes.get('media')!
    expect(node.mediaType).toBe('image')
    expect(node.mediaFileName).toBe('photo.png')
    expect(node.contentSource).toBe('# Hello')
    expect(node.contentCollapsed).toBe(false)
    expect(node.contentFontSize).toBe(1.1)
    expect(node.mediaSrc).toMatch(/^blob:/)
    expect(node.audioCoverSrc).toMatch(/^blob:/)
    expect(getMediaBlob(node.mediaSrc!)?.type).toBe('image/png')
    expect(getMediaBlob(node.audioCoverSrc!)?.type).toBe('image/jpeg')
  })

  it('writes shared media blobs once per bundle export', async () => {
    clearMediaStore()
    const imageUrl = await storeMediaBlob(new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' }))
    const root = mkModel('root', 'Shared Media')
    root.nodes.set('m1', {
      id: 'm1',
      x: 10,
      y: 10,
      w: 8,
      h: 8,
      label: '',
      shape: 'rounded-rect',
      cellColor: '#fff',
      membraneColor: '#000',
      mediaType: 'image',
      mediaSrc: imageUrl,
      mediaFileName: 'shared.png',
    })
    root.nodes.set('m2', {
      id: 'm2',
      x: 20,
      y: 10,
      w: 8,
      h: 8,
      label: '',
      shape: 'rounded-rect',
      cellColor: '#fff',
      membraneColor: '#000',
      mediaType: 'image',
      mediaSrc: imageUrl,
      mediaFileName: 'shared.png',
    })

    const zip = await JSZip.loadAsync(await exportBundle({ rootModelId: 'root', models: new Map([['root', root]]) }))
    const mediaEntries = Object.keys(zip.files).filter((path) => path.startsWith('media/') && !zip.files[path].dir)
    expect(mediaEntries).toHaveLength(1)
    const project = JSON.parse(await zip.file('project.json')!.async('string')) as { models: { root: { nodes: Array<{ id: string; mediaSrc?: string }> } } }
    const mediaNodes = project.models.root.nodes.filter((node) => node.id === 'm1' || node.id === 'm2')
    expect(new Set(mediaNodes.map((node) => node.mediaSrc))).toEqual(new Set(mediaEntries))
  })
})
