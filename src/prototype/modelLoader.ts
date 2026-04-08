import type { Model, ModelNode, ModelConnection, StudyEvidence } from './sampleModels'

// ---- JSON file schema (what's on disk) ----

interface ModelFileNode {
  id: string
  label: string
  x: number
  y: number
  childModel?: string   // relative file path, e.g. "./alpha-internals.json"
  mpdModels?: string[]  // relative file paths for MPD siblings
}

interface ModelFileConnection {
  from: string
  to: string
  evidence?: StudyEvidence[]
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
 */
export function modelToFile(model: Model): ModelFile {
  return {
    id: model.id,
    label: model.label,
    nodes: model.nodes.map((n) => {
      const fileNode: ModelFileNode = { id: n.id, label: n.label, x: n.x, y: n.y }
      if (n.childModelId) {
        const childUrl = modelIdToUrl.get(n.childModelId)
        const myUrl = modelIdToUrl.get(model.id)
        if (childUrl && myUrl) {
          // Compute relative path
          fileNode.childModel = toRelativePath(childUrl, myUrl)
        } else {
          // Fallback: use conventional filename
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
      return fileNode
    }),
    connections: model.connections.map((c) => ({
      from: c.from,
      to: c.to,
      ...(c.evidence ? { evidence: c.evidence } : {}),
    })),
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
