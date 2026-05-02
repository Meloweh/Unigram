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
import type { Connection, GridSettings, Model, ModelNode } from './types'
import type { ModelCosmetics } from '../theme/types'

interface ModelFile {
  id: string
  name: string
  grid?: GridSettings
  cosmetics?: ModelCosmetics
  nodes: ModelNode[]
  edges: Connection[]
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
  const file: ProjectFile = {
    version: 1,
    rootModelId: snapshot.rootModelId,
    models: {},
  }
  for (const [id, m] of snapshot.models) {
    file.models[id] = {
      id: m.id,
      name: m.name,
      ...(m.grid ? { grid: m.grid } : {}),
      ...(m.cosmetics ? { cosmetics: m.cosmetics } : {}),
      nodes: [...m.nodes.values()],
      edges: [...m.edges.values()],
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
    models.set(id, {
      id: mf.id,
      name: mf.name,
      nodes: new Map(mf.nodes.map((n) => [n.id, n])),
      edges: new Map(mf.edges.map((e) => [e.id, e])),
      ...(mf.grid ? { grid: mf.grid } : {}),
      ...(mf.cosmetics ? { cosmetics: mf.cosmetics } : {}),
      ...(mf.extra ? { extra: mf.extra } : {}),
    })
  }
  if (!models.has(file.rootModelId)) {
    throw new Error(`Bundle rootModelId "${file.rootModelId}" not present in models`)
  }
  return { rootModelId: file.rootModelId, models }
}
