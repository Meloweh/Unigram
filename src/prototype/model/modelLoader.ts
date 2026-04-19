import type { Model, ModelNode, ModelConnection, StudyEvidence, NodeShape, MediaNodeType, CosmeticType, ConnectionType, FlowEffect, ConnectionDashStyle, ConnectionArrowStyle, ModelCosmetics, ThemeMode, TextFormatRange } from './sampleModels'
import { fetchMediaBlob, getMediaMime, isBlobUrl, storeMediaBlob } from './mediaStore'
import JSZip from 'jszip'

// ---- JSON file schema (what's on disk) ----

interface ModelFileNode {
  id: string
  label: string
  x: number
  y: number
  childModel?: string   // relative file path, e.g. "./alpha-internals.json"
  mpdModels?: string[]  // relative file paths for MPD siblings
  shape?: NodeShape
  cellColor?: string
  membraneColor?: string
  membraneVisible?: boolean
  locked?: boolean
  mediaType?: MediaNodeType
  mediaFile?: string       // path to media file inside the bundle (e.g. "media/node-123.mp4")
  mediaFileName?: string
  nodeWidth?: number
  nodeHeight?: number
  playStart?: number
  playEnd?: number
  audioCoverFile?: string  // path to audio cover image inside the bundle
  flowEffects?: FlowEffect[]
  hideDuringFlow?: boolean
  cameraTracked?: boolean
  contentSource?: string
  contentCollapsed?: boolean
  contentFontSize?: number
  textFormats?: TextFormatRange[]
  cosmeticType?: CosmeticType
  tipAngle?: number
  tipLength?: number
}

interface ModelFileConnection {
  from: string
  to: string
  evidence?: StudyEvidence[]
  type?: ConnectionType
  hideDuringFlow?: boolean
  strokeColor?: string
  strokeWidth?: number
  strokeDash?: ConnectionDashStyle
  arrowStyle?: ConnectionArrowStyle
  label?: string
  labelFontSize?: number
}

interface ModelFile {
  id: string
  label: string
  nodes: ModelFileNode[]
  connections: ModelFileConnection[]
}

// ---- Resolution cache ----

/** Maps a resolved URL to the model ID it contains */
const urlToModelId = new Map<string, string>()

/** Maps a model ID to its resolved file URL (for saving) */
const modelIdToUrl = new Map<string, string>()

/** In-flight fetch promises to avoid duplicate requests */
const inflight = new Map<string, Promise<Model>>()

// ---- Public API ----

/**
 * Resolve a relative model path against a base URL.
 * e.g. resolveModelPath("./alpha-internals.json", "/models/root.json")
 *      → "/models/alpha-internals.json"
 */
export function resolveModelPath(ref: string, baseUrl: string): string {
  const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1)
  return new URL(ref, window.location.origin + base).pathname
}

/**
 * Load a model from a JSON file URL. Returns cached if already loaded.
 * Resolves childModel/mpdModels paths into model IDs by pre-fetching
 * referenced files' headers (id field).
 */
export async function loadModel(
  fileUrl: string,
  registerModel: (model: Model) => void,
): Promise<Model> {
  // Already loaded?
  const cachedId = urlToModelId.get(fileUrl)
  if (cachedId) return Promise.resolve({ id: cachedId } as Model) // caller uses store

  // Deduplicate in-flight
  if (inflight.has(fileUrl)) return inflight.get(fileUrl)!

  const promise = (async () => {
    const resp = await fetch(fileUrl)
    if (!resp.ok) throw new Error(`Failed to load model: ${fileUrl} (${resp.status})`)
    const file: ModelFile = await resp.json()

    // Register URL ↔ ID mapping
    urlToModelId.set(fileUrl, file.id)
    modelIdToUrl.set(file.id, fileUrl)

    // Resolve node references: childModel path → model ID, mpdModels paths → model IDs
    // We need to peek into each referenced file to get its ID.
    const pathToId = new Map<string, string>()
    const refsToResolve = new Set<string>()

    for (const node of file.nodes) {
      if (node.childModel) refsToResolve.add(node.childModel)
      if (node.mpdModels) node.mpdModels.forEach((p) => refsToResolve.add(p))
    }

    // Resolve all unique references in parallel
    await Promise.all(
      [...refsToResolve].map(async (ref) => {
        const resolvedUrl = resolveModelPath(ref, fileUrl)
        // Check cache first
        const existing = urlToModelId.get(resolvedUrl)
        if (existing) {
          pathToId.set(ref, existing)
          return
        }
        // Peek: fetch just enough to get the ID
        const peekResp = await fetch(resolvedUrl)
        if (!peekResp.ok) {
          console.warn(`Could not resolve model ref: ${ref} → ${resolvedUrl}`)
          return
        }
        const peekFile: ModelFile = await peekResp.json()
        urlToModelId.set(resolvedUrl, peekFile.id)
        modelIdToUrl.set(peekFile.id, resolvedUrl)
        pathToId.set(ref, peekFile.id)
      }),
    )

    // Convert file nodes to runtime nodes
    const nodes: ModelNode[] = file.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      x: n.x,
      y: n.y,
      childModelId: n.childModel ? pathToId.get(n.childModel) : undefined,
      mpdIds: n.mpdModels?.map((p) => pathToId.get(p)).filter(Boolean) as string[] | undefined,
    }))

    const connections: ModelConnection[] = file.connections.map((c) => ({
      from: c.from,
      to: c.to,
      evidence: c.evidence,
    }))

    const model: Model = {
      id: file.id,
      label: file.label,
      nodes,
      connections,
    }

    registerModel(model)
    return model
  })()

  inflight.set(fileUrl, promise)
  promise.finally(() => inflight.delete(fileUrl))
  return promise
}

/**
 * Load a model by its runtime ID. Requires the model to have been seen before
 * (i.e. its URL was resolved during a parent load). Returns null if unknown.
 */
export async function loadModelById(
  modelId: string,
  registerModel: (model: Model) => void,
): Promise<Model | null> {
  const url = modelIdToUrl.get(modelId)
  if (!url) return null
  return loadModel(url, registerModel)
}

/**
 * Convert a runtime Model back to the JSON file format for saving.
 * mediaMap: if provided, media data URLs are extracted into it as { bundlePath → dataUrl }
 */
export function modelToFile(model: Model, mediaMap?: Map<string, string>, mediaDedup?: Map<string, string>): ModelFile {
  return {
    id: model.id,
    label: model.label,
    nodes: model.nodes.map((n) => {
      const fileNode: ModelFileNode = { id: n.id, label: n.label, x: n.x, y: n.y }
      if (n.childModelId) {
        const childUrl = modelIdToUrl.get(n.childModelId)
        const myUrl = modelIdToUrl.get(model.id)
        if (childUrl && myUrl) {
          fileNode.childModel = toRelativePath(childUrl, myUrl)
        } else {
          fileNode.childModel = './' + n.childModelId + '.json'
        }
      }
      if (n.mpdIds && n.mpdIds.length > 0) {
        const myUrl = modelIdToUrl.get(model.id)
        fileNode.mpdModels = n.mpdIds
          .map((id) => {
            const url = modelIdToUrl.get(id)
            if (url && myUrl) return toRelativePath(url, myUrl)
            return './' + id + '.json'
          })
          .filter(Boolean) as string[]
      }
      // Visual properties
      if (n.shape) fileNode.shape = n.shape
      if (n.cellColor) fileNode.cellColor = n.cellColor
      if (n.membraneColor) fileNode.membraneColor = n.membraneColor
      if (n.membraneVisible === false) fileNode.membraneVisible = false
      if (n.locked) fileNode.locked = true
      if (n.nodeWidth != null) fileNode.nodeWidth = n.nodeWidth
      if (n.nodeHeight != null) fileNode.nodeHeight = n.nodeHeight
      // Media properties
      if (n.mediaType) fileNode.mediaType = n.mediaType
      if (n.mediaFileName) fileNode.mediaFileName = n.mediaFileName
      if (n.playStart != null) fileNode.playStart = n.playStart
      if (n.playEnd != null) fileNode.playEnd = n.playEnd
      // Extract media data URLs into the media map for the bundle (deduplicated)
      if (n.mediaSrc && mediaMap) {
        const existing = mediaDedup?.get(n.mediaSrc)
        if (existing) {
          fileNode.mediaFile = existing
        } else {
          const ext = guessExtension(n.mediaSrc, n.mediaFileName)
          const path = `media/${n.id}${ext}`
          mediaMap.set(path, n.mediaSrc)
          mediaDedup?.set(n.mediaSrc, path)
          fileNode.mediaFile = path
        }
      }
      if (n.audioCoverSrc && mediaMap) {
        const existing = mediaDedup?.get(n.audioCoverSrc)
        if (existing) {
          fileNode.audioCoverFile = existing
        } else {
          const ext = guessExtension(n.audioCoverSrc, undefined)
          const path = `media/${n.id}-cover${ext}`
          mediaMap.set(path, n.audioCoverSrc)
          mediaDedup?.set(n.audioCoverSrc, path)
          fileNode.audioCoverFile = path
        }
      }
      if (n.flowEffects?.length) fileNode.flowEffects = n.flowEffects
      if (n.hideDuringFlow) fileNode.hideDuringFlow = true
      if (n.cameraTracked) fileNode.cameraTracked = true
      if (n.contentSource) fileNode.contentSource = n.contentSource
      if (n.contentCollapsed != null) fileNode.contentCollapsed = n.contentCollapsed
      if (n.contentFontSize != null) fileNode.contentFontSize = n.contentFontSize
      if (n.textFormats?.length) fileNode.textFormats = n.textFormats
      if (n.cosmeticType) fileNode.cosmeticType = n.cosmeticType
      if (n.tipAngle != null) fileNode.tipAngle = n.tipAngle
      if (n.tipLength != null) fileNode.tipLength = n.tipLength
      return fileNode
    }),
    connections: model.connections.map((c) => {
      const fc: ModelFileConnection = { from: c.from, to: c.to }
      if (c.evidence) fc.evidence = c.evidence
      if (c.type) fc.type = c.type
      if (c.hideDuringFlow) fc.hideDuringFlow = true
      if (c.strokeColor) fc.strokeColor = c.strokeColor
      if (c.strokeWidth != null) fc.strokeWidth = c.strokeWidth
      if (c.strokeDash) fc.strokeDash = c.strokeDash
      if (c.arrowStyle) fc.arrowStyle = c.arrowStyle
      if (c.label) fc.label = c.label
      if (c.labelFontSize != null) fc.labelFontSize = c.labelFontSize
      return fc
    }),
  }
}

/**
 * Export all loaded models as a map of { filename: ModelFile } for download.
 */
export function exportAllModels(models: Record<string, Model>): Record<string, ModelFile> {
  const result: Record<string, ModelFile> = {}
  for (const model of Object.values(models)) {
    const url = modelIdToUrl.get(model.id)
    const filename = url ? url.substring(url.lastIndexOf('/') + 1) : `${model.id}.json`
    result[filename] = modelToFile(model)
  }
  return result
}

/** Get the file URL for a model ID (if known) */
export function getModelUrl(modelId: string): string | undefined {
  return modelIdToUrl.get(modelId)
}

/** Register a URL ↔ ID mapping manually (for imported files) */
export function registerModelUrl(modelId: string, url: string): void {
  urlToModelId.set(url, modelId)
  modelIdToUrl.set(modelId, url)
}

/** Clear all caches (for testing) */
export function clearLoaderCache(): void {
  urlToModelId.clear()
  modelIdToUrl.clear()
  inflight.clear()
}

// ---- Helpers ----

function toRelativePath(targetUrl: string, baseUrl: string): string {
  const baseParts = baseUrl.split('/')
  const targetParts = targetUrl.split('/')
  baseParts.pop() // remove filename
  // Find common prefix
  let common = 0
  while (common < baseParts.length && common < targetParts.length && baseParts[common] === targetParts[common]) {
    common++
  }
  const ups = baseParts.length - common
  const rest = targetParts.slice(common)
  return (ups > 0 ? '../'.repeat(ups) : './') + rest.join('/')
}

/** Guess file extension from a data URL or filename */
function guessExtension(srcUrl: string, filename?: string): string {
  if (filename) {
    const dot = filename.lastIndexOf('.')
    if (dot >= 0) return filename.substring(dot)
  }
  // Try data URL mime
  const match = srcUrl.match(/^data:([^;,]+)/)
  if (match) {
    const mime = match[1]
    const map: Record<string, string> = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
      'image/webp': '.webp', 'image/svg+xml': '.svg',
      'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
      'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
    }
    return map[mime] ?? '.bin'
  }
  // Try blob URL mime from store
  if (isBlobUrl(srcUrl)) {
    const mime = getMediaMime(srcUrl)
    if (mime) {
      const map: Record<string, string> = {
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
        'image/webp': '.webp', 'image/svg+xml': '.svg',
        'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
        'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
      }
      return map[mime] ?? '.bin'
    }
  }
  return '.bin'
}

/** Convert a data URL to a Uint8Array for inclusion in a zip */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const b64 = dataUrl.substring(comma + 1)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Convert binary data + file path back to a data URL */
function bytesToDataUrl(bytes: Uint8Array, path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  }
  const mime = mimeMap[ext] ?? 'application/octet-stream'
  let binaryString = ''
  for (let i = 0; i < bytes.length; i++) binaryString += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binaryString)}`
}

/** Convert binary data + file path to a blob URL stored in the media store. */
function bytesToBlobUrl(bytes: Uint8Array, path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  }
  const mime = mimeMap[ext] ?? 'application/octet-stream'
  return storeMediaBlob(new Blob([bytes], { type: mime }))
}

/**
 * Collect model IDs reachable from the root via childModelId and mpdIds.
 */
function collectReachableModelIds(models: Record<string, Model>, rootId: string): Set<string> {
  const reachable = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.pop()!
    if (reachable.has(id)) continue
    const model = models[id]
    if (!model) continue
    reachable.add(id)
    for (const node of model.nodes) {
      if (node.childModelId) queue.push(node.childModelId)
      if (node.mpdIds) {
        for (const mpdId of node.mpdIds) queue.push(mpdId)
      }
    }
  }
  return reachable
}

/**
 * Export all models + media as a .unigram zip bundle.
 * Returns a Blob ready for download.
 * Only includes models reachable from the root and their media.
 */
export async function exportBundle(
  models: Record<string, Model>,
  cosmetics?: Record<string, ModelCosmetics>,
  appThemeMode?: ThemeMode,
): Promise<Blob> {
  const zip = new JSZip()
  const mediaMap = new Map<string, string>() // bundle path → data URL
  const mediaDedup = new Map<string, string>() // data URL → bundle path (dedup)

  // Only export models reachable from root
  const reachable = collectReachableModelIds(models, 'root')

  const projectData: Record<string, ModelFile> = {}
  for (const model of Object.values(models)) {
    if (!reachable.has(model.id)) continue
    const url = modelIdToUrl.get(model.id)
    const filename = url ? url.substring(url.lastIndexOf('/') + 1) : `${model.id}.json`
    projectData[filename] = modelToFile(model, mediaMap, mediaDedup)
  }

  // Add project JSON
  zip.file('project.json', JSON.stringify(projectData, null, 2))

  // Add settings (cosmetics + app theme) — only for reachable models
  const settings: Record<string, unknown> = {}
  if (appThemeMode) settings.appThemeMode = appThemeMode
  if (cosmetics) {
    const filtered: Record<string, ModelCosmetics> = {}
    for (const [id, cos] of Object.entries(cosmetics)) {
      if (reachable.has(id)) filtered[id] = cos
    }
    if (Object.keys(filtered).length > 0) settings.modelCosmetics = filtered
  }
  if (Object.keys(settings).length > 0) {
    zip.file('settings.json', JSON.stringify(settings, null, 2))
  }

  // Add media files
  for (const [path, srcUrl] of mediaMap) {
    if (isBlobUrl(srcUrl)) {
      const blob = await fetchMediaBlob(srcUrl)
      if (blob) zip.file(path, blob)
    } else {
      zip.file(path, dataUrlToBytes(srcUrl))
    }
  }

  return zip.generateAsync({ type: 'blob' })
}

/**
 * Import a .unigram zip bundle. Returns the models with media data URLs restored.
 */
export async function importBundle(
  blob: Blob,
  registerModel: (model: Model) => void,
  resetToRoot: () => void,
  restoreSettings?: (settings: { appThemeMode?: ThemeMode; modelCosmetics?: Record<string, ModelCosmetics> }) => void,
): Promise<void> {
  const zip = await JSZip.loadAsync(blob)

  const projectFile = zip.file('project.json')
  if (!projectFile) throw new Error('Invalid bundle: missing project.json')
  const projectData: Record<string, Record<string, unknown>> = JSON.parse(await projectFile.async('string'))

  // Build media lookup: bundle path → blob URL
  const mediaLookup = new Map<string, string>()
  const mediaFolder = zip.folder('media')
  if (mediaFolder) {
    const mediaFiles: { path: string; file: JSZip.JSZipObject }[] = []
    mediaFolder.forEach((relativePath, file) => {
      if (!file.dir) mediaFiles.push({ path: 'media/' + relativePath, file })
    })
    await Promise.all(
      mediaFiles.map(async ({ path, file }) => {
        const bytes = await file.async('uint8array')
        mediaLookup.set(path, bytesToBlobUrl(bytes, path))
      }),
    )
  }

  // Restore settings (cosmetics + app theme) if present
  const settingsFile = zip.file('settings.json')
  if (settingsFile && restoreSettings) {
    try {
      const settings = JSON.parse(await settingsFile.async('string'))
      restoreSettings(settings)
    } catch { /* ignore malformed settings */ }
  }

  clearLoaderCache()

  // Build ID lookup from all model files
  const idLookup = new Map<string, string>()
  for (const [filename, fileData] of Object.entries(projectData)) {
    const mf = fileData as { id: string }
    idLookup.set('./' + filename, mf.id)
    idLookup.set(filename, mf.id)
    registerModelUrl(mf.id, '/models/' + filename)
  }

  // Register all models
  for (const [, fileData] of Object.entries(projectData)) {
    const mf = fileData as {
      id: string; label: string
      nodes: ModelFileNode[]
      connections: ModelFileConnection[]
    }

    registerModel({
      id: mf.id,
      label: mf.label,
      nodes: mf.nodes.map((n) => {
        const node: ModelNode = {
          id: n.id, label: n.label, x: n.x, y: n.y,
        }
        // Child model / MPD references
        if (n.childModel) node.childModelId = idLookup.get(n.childModel)
        if (n.mpdModels?.length) {
          node.mpdIds = n.mpdModels.map((p) => idLookup.get(p)).filter(Boolean) as string[]
        }
        // Visual properties
        if (n.shape) node.shape = n.shape
        if (n.cellColor) node.cellColor = n.cellColor
        if (n.membraneColor) node.membraneColor = n.membraneColor
        if (n.membraneVisible === false) node.membraneVisible = false
        if (n.locked) node.locked = true
        if (n.nodeWidth != null) node.nodeWidth = n.nodeWidth
        if (n.nodeHeight != null) node.nodeHeight = n.nodeHeight
        // Media properties
        if (n.mediaType) node.mediaType = n.mediaType
        if (n.mediaFileName) node.mediaFileName = n.mediaFileName
        if (n.playStart != null) node.playStart = n.playStart
        if (n.playEnd != null) node.playEnd = n.playEnd
        if (n.mediaFile && mediaLookup.has(n.mediaFile)) {
          node.mediaSrc = mediaLookup.get(n.mediaFile)
        }
        if (n.audioCoverFile && mediaLookup.has(n.audioCoverFile)) {
          node.audioCoverSrc = mediaLookup.get(n.audioCoverFile)
        }
        // Flow effects
        if (n.flowEffects?.length) node.flowEffects = n.flowEffects
        if (n.hideDuringFlow) node.hideDuringFlow = true
        if (n.cameraTracked) node.cameraTracked = true
        if (n.contentSource) node.contentSource = n.contentSource
        if (n.contentCollapsed != null) node.contentCollapsed = n.contentCollapsed
        if (n.contentFontSize != null) node.contentFontSize = n.contentFontSize
        if (n.textFormats?.length) node.textFormats = n.textFormats
        if (n.cosmeticType) node.cosmeticType = n.cosmeticType
        if (n.tipAngle != null) node.tipAngle = n.tipAngle
        if (n.tipLength != null) node.tipLength = n.tipLength
        return node
      }),
      connections: mf.connections.map((c) => {
        const conn: ModelConnection = { from: c.from, to: c.to }
        if (c.evidence) conn.evidence = c.evidence
        if (c.type) conn.type = c.type
        if (c.hideDuringFlow) conn.hideDuringFlow = true
        if (c.strokeColor) conn.strokeColor = c.strokeColor
        if (c.strokeWidth != null) conn.strokeWidth = c.strokeWidth
        if (c.strokeDash) conn.strokeDash = c.strokeDash
        if (c.arrowStyle) conn.arrowStyle = c.arrowStyle
        if (c.label) conn.label = c.label
        if (c.labelFontSize != null) conn.labelFontSize = c.labelFontSize
        return conn
      }),
    })
  }

  resetToRoot()
}
