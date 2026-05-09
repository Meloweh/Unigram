/**
 * Stage 4 project bundle (`.unigram` zip).
 *
 * Layout inside the zip:
 *   project.json   — { rootModelId, models: { [id]: ModelFile } }
 *
 * The schema mirrors our in-memory `Model` exactly, except `nodes` and
 * `edges` are arrays (Map → array on export, array → Map on import). We
 * preserve `extra` slots round-trip so future stages don't lose data.
 *
 * We deliberately do NOT split each model into its own JSON file (legacy
 * did that to support relative-path references across files). Our store
 * uses ids natively, so a single project.json is simpler and lossless.
 */

import JSZip from 'jszip'
import { DEFAULT_GRID, type Connection, type CrossEffectLink, type GridSettings, type Model, type ModelNode } from './types'
import type { ModelCosmetics } from '../theme/types'
import { getMediaBlob, storeMediaBlob } from '../media/mediaStore'
import { DEFAULT_COSMETIC_TIP_ANGLE, DEFAULT_COSMETIC_TIP_LENGTH, isCosmeticShape } from '../scene/cosmeticGeometry'

interface ModelFile {
  id?: string
  name: string
  grid?: GridSettings
  cosmetics?: ModelCosmetics
  nodes: ModelNode[]
  edges: Connection[]
  crossLinks?: CrossEffectLink[]
  extra?: Record<string, unknown>
}

interface ProjectFile {
  version: 1
  rootModelId: string
  models: Record<string, ModelFile>
}

export interface ProjectSnapshot {
  rootModelId: string
  models: Map<string, Model>
}

/** Serialize the project to a `.unigram` zip blob. */
export async function exportBundle(snapshot: ProjectSnapshot): Promise<Blob> {
  const zip = new JSZip()
  const mediaAssets = new Map<string, string>()
  const file: ProjectFile = {
    version: 1,
    rootModelId: snapshot.rootModelId,
    models: {},
  }
  for (const [id, m] of snapshot.models) {
    const nodes: ModelNode[] = []
    for (const node of m.nodes.values()) {
      nodes.push(await serializeNodeMedia(node, zip, mediaAssets))
    }
    file.models[id] = {
      id: m.id,
      name: m.name,
      ...(m.grid ? { grid: m.grid } : {}),
      ...(m.cosmetics ? { cosmetics: m.cosmetics } : {}),
      nodes,
      edges: [...m.edges.values()],
      ...(m.crossLinks ? { crossLinks: m.crossLinks } : {}),
      ...(m.extra ? { extra: m.extra } : {}),
    }
  }
  zip.file('project.json', JSON.stringify(file, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

/** Parse a `.unigram` zip blob back into in-memory models. */
export async function importBundle(blob: Blob): Promise<ProjectSnapshot> {
  const zip = await JSZip.loadAsync(blob)
  const entry = zip.file('project.json')
  if (!entry) throw new Error('Invalid bundle: missing project.json')
  const text = await entry.async('string')
  const file = JSON.parse(text) as ProjectFile
  if (file.version !== 1) throw new Error(`Unsupported bundle version: ${file.version}`)
  const models = new Map<string, Model>()
  for (const [id, mf] of Object.entries(file.models)) {
    const nodes: ModelNode[] = []
    for (const node of mf.nodes) nodes.push(migrateCosmeticNode(await hydrateNodeMedia(node, zip)))
    const modelId = mf.id || id
    const model: Model = {
      id: modelId,
      name: mf.name,
      nodes: new Map(nodes.map((n) => [n.id, n])),
      edges: new Map(mf.edges.map((e) => [e.id, e])),
      grid: mf.grid ?? DEFAULT_GRID,
      ...(mf.cosmetics ? { cosmetics: mf.cosmetics } : {}),
      ...(mf.crossLinks ? { crossLinks: mf.crossLinks } : {}),
      ...(mf.extra ? { extra: mf.extra } : {}),
    }
    models.set(modelId, model)
    if (id !== modelId && !models.has(id)) models.set(id, { ...model, id })
  }
  const rootModelId = resolveRootModelId(file.rootModelId, models)
  return { rootModelId, models }
}

function resolveRootModelId(rootModelId: string, models: Map<string, Model>): string {
  if (models.has(rootModelId)) return rootModelId
  if (models.size === 1) return models.keys().next().value as string
  const firstRootish = [...models.keys()].find((id) => id.toLowerCase().includes('root'))
  if (firstRootish) return firstRootish
  const first = models.keys().next().value as string | undefined
  if (first) return first
  throw new Error(`Bundle rootModelId "${rootModelId}" not present in models`)
}

function migrateCosmeticNode(node: ModelNode): ModelNode {
  if (!isCosmeticShape(node.shape)) return node
  if (node.cosmeticType && node.tipAngle != null && node.tipLength != null) return node
  return {
    ...node,
    cosmeticType: node.cosmeticType ?? node.shape,
    tipAngle: node.tipAngle ?? DEFAULT_COSMETIC_TIP_ANGLE,
    tipLength: node.tipLength ?? DEFAULT_COSMETIC_TIP_LENGTH,
  }
}

async function serializeNodeMedia(node: ModelNode, zip: JSZip, mediaAssets: Map<string, string>): Promise<ModelNode> {
  let next = node
  if (node.mediaSrc) {
    const mediaSrc = await writeMediaAsset(zip, mediaAssets, node.mediaSrc, node.mediaFileName, `${node.id}-media`)
    if (mediaSrc !== node.mediaSrc) next = { ...next, mediaSrc }
  }
  if (node.audioCoverSrc) {
    const audioCoverSrc = await writeMediaAsset(zip, mediaAssets, node.audioCoverSrc, undefined, `${node.id}-cover`)
    if (audioCoverSrc !== node.audioCoverSrc) next = { ...next, audioCoverSrc }
  }
  return next
}

async function writeMediaAsset(
  zip: JSZip,
  mediaAssets: Map<string, string>,
  src: string,
  fileName: string | undefined,
  fallbackName: string,
): Promise<string> {
  const blob = getMediaBlob(src)
  if (!blob) return src
  const cached = mediaAssets.get(src)
  if (cached) return cached
  const ext = extensionFor(fileName, blob.type)
  const path = `media/${safePathPart(fallbackName)}${ext}`
  zip.file(path, blob)
  mediaAssets.set(src, path)
  return path
}

async function hydrateNodeMedia(node: ModelNode, zip: JSZip): Promise<ModelNode> {
  let next = migrateContentSource(node)
  if (next.mediaSrc?.startsWith('media/')) {
    const entry = zip.file(next.mediaSrc)
    if (entry) {
      const blob = withInferredMime(await entry.async('blob'), next.mediaSrc)
      next = { ...next, mediaSrc: await storeMediaBlob(blob) }
    }
  }
  if (next.audioCoverSrc?.startsWith('media/')) {
    const entry = zip.file(next.audioCoverSrc)
    if (entry) {
      const blob = withInferredMime(await entry.async('blob'), next.audioCoverSrc)
      next = { ...next, audioCoverSrc: await storeMediaBlob(blob) }
    }
  }
  return next
}

function migrateContentSource(node: ModelNode): ModelNode {
  if (node.contentSource || typeof node.extra?.contentSource !== 'string') return node
  return { ...node, contentSource: node.extra.contentSource }
}

function extensionFor(fileName: string | undefined, mime: string): string {
  const fromName = fileName?.match(/\.[a-z0-9]+$/i)?.[0]
  if (fromName) return fromName.toLowerCase()
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/png') return '.png'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'audio/mpeg') return '.mp3'
  if (mime === 'audio/wav') return '.wav'
  if (mime === 'video/mp4') return '.mp4'
  if (mime === 'video/webm') return '.webm'
  return '.bin'
}

function safePathPart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '_')
}

function withInferredMime(blob: Blob, path: string): Blob {
  if (blob.type) return blob
  const type = mimeForPath(path)
  return type ? new Blob([blob], { type }) : blob
}

function mimeForPath(path: string): string {
  const ext = path.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.gif': return 'image/gif'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.mp4': return 'video/mp4'
    case '.webm': return 'video/webm'
    default: return ''
  }
}
