/**
 * Legacy bundle importer — reads the v0 (`public/models/*.json`) schema and
 * produces a `ProjectSnapshot` compatible with `loadProject()`.
 *
 * The v0 schema differs from the new project bundle in three ways:
 *   1. One model per JSON file (cross-file refs via relative paths in
 *      `childModel` / `mpdModels`), not a single `project.json`.
 *   2. Field names: `label` (vs `name`), `connections` (vs `edges`), no
 *      explicit edge ids.
 *   3. Node visuals (shape/colors/size) are mostly absent — defaults apply.
 *
 * This importer takes a root URL and a `fetcher` (defaults to global
 * `fetch`). It walks the reference graph, depth-first, peeking referenced
 * files only enough to discover their `id`, then translates each file into
 * a `Model`.
 */

import type {
  Connection,
  CosmeticType,
  Model,
  ModelNode,
  Project,
} from './types'
import { DEFAULT_EDGE, DEFAULT_NODE } from './types'
import { SCENE_H, SCENE_W } from '../scene/sceneConstants'
import { DEFAULT_COSMETIC_TIP_ANGLE, DEFAULT_COSMETIC_TIP_LENGTH } from '../scene/cosmeticGeometry'

interface LegacyNode {
  id: string
  label: string
  x: number
  y: number
  childModel?: string
  mpdModels?: string[]
  shape?: ModelNode['shape']
  cosmeticType?: CosmeticType
  tipAngle?: number
  tipLength?: number
  cellColor?: string
  membraneColor?: string
  nodeWidth?: number
  nodeHeight?: number
  locked?: boolean
  hideDuringFlow?: boolean
  cameraTracked?: boolean
  mediaType?: ModelNode['mediaType']
  mediaFile?: string
  mediaFileName?: string
  audioCoverFile?: string
  contentSource?: string
  contentCollapsed?: boolean
  contentFontSize?: number
}

interface LegacyConnection {
  from: string
  to: string
  strokeColor?: string
  strokeWidth?: number
  strokeDash?: Connection['dash']
  arrowStyle?: Connection['arrowStyle']
  label?: string
  labelFontSize?: number
}

interface LegacyFile {
  id: string
  label: string
  nodes: LegacyNode[]
  connections: LegacyConnection[]
}

export type LegacyFetcher = (url: string) => Promise<unknown>

const defaultFetcher: LegacyFetcher = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`)
  return r.json()
}

/** Resolve a relative model ref against a base URL. */
function resolveRef(ref: string, baseUrl: string): string {
  // Use a synthetic origin so node-fetch in tests can resolve relatives too.
  const base = baseUrl.includes('://')
    ? baseUrl
    : `https://localhost${baseUrl.startsWith('/') ? '' : '/'}${baseUrl}`
  return new URL(ref, base).pathname
}

/**
 * Walk the legacy reference graph starting at `rootUrl`, returning a
 * `ProjectSnapshot`. Each unique URL is fetched at most once.
 */
export async function importLegacyBundle(
  rootUrl: string,
  fetcher: LegacyFetcher = defaultFetcher,
): Promise<Project> {
  const filesByUrl = new Map<string, LegacyFile>()
  const urlToId = new Map<string, string>()

  const fetchOnce = async (url: string): Promise<LegacyFile> => {
    const cached = filesByUrl.get(url)
    if (cached) return cached
    const data = await fetcher(url)
    if (!isLegacyFile(data)) throw new Error(`Not a legacy model file: ${url}`)
    filesByUrl.set(url, data)
    urlToId.set(url, data.id)
    // Recurse into refs so the closure is fully populated before translation.
    const refs = collectRefs(data)
    await Promise.all(
      [...refs].map((ref) => fetchOnce(resolveRef(ref, url))),
    )
    return data
  }

  await fetchOnce(rootUrl)
  const rootId = urlToId.get(rootUrl)!

  // Translate each fetched file into a Model.
  const models = new Map<string, Model>()
  for (const [url, file] of filesByUrl) {
    models.set(file.id, translate(file, url, urlToId))
  }
  return { rootModelId: rootId, models }
}

function collectRefs(f: LegacyFile): Set<string> {
  const out = new Set<string>()
  for (const n of f.nodes) {
    if (n.childModel) out.add(n.childModel)
    if (n.mpdModels) for (const p of n.mpdModels) out.add(p)
  }
  return out
}

function translate(
  f: LegacyFile,
  fileUrl: string,
  urlToId: Map<string, string>,
): Model {
  const refToId = (ref: string): string | undefined =>
    urlToId.get(resolveRef(ref, fileUrl))

  const nodes = new Map<string, ModelNode>()
  for (const ln of f.nodes) {
    const childModelId = ln.childModel ? refToId(ln.childModel) : undefined
    const mpdDimensions = ln.mpdModels
      ?.map(refToId)
      .filter((x): x is string => typeof x === 'string')
    const cosmeticType = ln.cosmeticType
    const shape = cosmeticType ?? ln.shape ?? DEFAULT_NODE.shape
    const node: ModelNode = {
      id: ln.id,
      label: ln.label ?? '',
      x: ln.x,
      y: ln.y,
      w: ln.nodeWidth != null ? (ln.nodeWidth / SCENE_W) * 100 : DEFAULT_NODE.w,
      h: ln.nodeHeight != null ? (ln.nodeHeight / SCENE_H) * 100 : DEFAULT_NODE.h,
      shape,
      cellColor: ln.cellColor ?? DEFAULT_NODE.cellColor,
      membraneColor: ln.membraneColor ?? DEFAULT_NODE.membraneColor,
      ...(cosmeticType ? { cosmeticType, tipAngle: ln.tipAngle ?? DEFAULT_COSMETIC_TIP_ANGLE, tipLength: ln.tipLength ?? DEFAULT_COSMETIC_TIP_LENGTH } : {}),
      ...(childModelId ? { childModelId } : {}),
      ...(mpdDimensions && mpdDimensions.length > 0 ? { mpdDimensions } : {}),
      ...(ln.locked ? { locked: true } : {}),
      ...(ln.hideDuringFlow ? { hideDuringFlow: true } : {}),
      ...(ln.cameraTracked ? { cameraTracked: true } : {}),
      ...(ln.mediaType ? { mediaType: ln.mediaType } : {}),
      ...(ln.mediaFile ? { mediaSrc: resolveRef(ln.mediaFile, fileUrl) } : {}),
      ...(ln.mediaFileName ? { mediaFileName: ln.mediaFileName } : {}),
      ...(ln.audioCoverFile ? { audioCoverSrc: resolveRef(ln.audioCoverFile, fileUrl) } : {}),
      ...(ln.contentSource !== undefined ? { contentSource: ln.contentSource } : {}),
      ...(ln.contentCollapsed !== undefined ? { contentCollapsed: ln.contentCollapsed } : {}),
      ...(ln.contentFontSize !== undefined ? { contentFontSize: ln.contentFontSize } : {}),
    }
    nodes.set(node.id, node)
  }

  const edges = new Map<string, Connection>()
  let edgeCounter = 0
  for (const lc of f.connections ?? []) {
    const id = `e_${f.id}_${++edgeCounter}`
    const edge: Connection = {
      id,
      from: lc.from,
      to: lc.to,
      color: lc.strokeColor ?? DEFAULT_EDGE.color,
      width: lc.strokeWidth ?? DEFAULT_EDGE.width,
      kind: DEFAULT_EDGE.kind,
      dash: lc.strokeDash ?? DEFAULT_EDGE.dash,
      arrowStyle: lc.arrowStyle ?? DEFAULT_EDGE.arrowStyle,
      ...(lc.label ? { label: lc.label } : {}),
      ...(lc.labelFontSize ? { labelFontSize: lc.labelFontSize } : {}),
    }
    edges.set(edge.id, edge)
  }

  return {
    id: f.id,
    name: f.label ?? f.id,
    nodes,
    edges,
  }
}

function isLegacyFile(x: unknown): x is LegacyFile {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    Array.isArray(o.nodes) &&
    (o.connections === undefined || Array.isArray(o.connections))
  )
}
