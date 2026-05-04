import type { ModelNode, TextFormatRange } from '../model/types'

interface RunState {
  format: TextFormatRange | null
  params: Record<string, number>
  startedAt: number
}

interface SessionState {
  original: TextFormatRange[] | undefined
  runs: Map<string, RunState>
}

const DEFAULT_KEY = '__default__'

export class TextFormatRunner {
  private sessions = new Map<string, SessionState>()

  start(node: ModelNode, params: Record<string, number>, key = DEFAULT_KEY): void {
    let session = this.sessions.get(node.id)
    if (!session) {
      session = {
        original: node.textFormats ? node.textFormats.map((r) => ({ ...r })) : undefined,
        runs: new Map(),
      }
      this.sessions.set(node.id, session)
    }
    const format = resolveFormat(node, params)
    session.runs.set(key, {
      format,
      params,
      startedAt: performance.now(),
    })
    applyFormats(node, session)
  }

  stop(node: ModelNode, key = DEFAULT_KEY): void {
    const session = this.sessions.get(node.id)
    if (!session) return
    session.runs.delete(key)
    if (session.runs.size === 0) {
      ;(node as { textFormats?: TextFormatRange[] }).textFormats = session.original
      this.sessions.delete(node.id)
      return
    }
    applyFormats(node, session)
  }

  get hasActiveRuns(): boolean {
    return this.sessions.size > 0
  }

  tick(nodes: ReadonlyMap<string, ModelNode>, now: number): boolean {
    let dirty = false
    for (const [id, session] of this.sessions) {
      const node = nodes.get(id)
      if (!node) {
        this.sessions.delete(id)
        continue
      }
      let changed = false
      for (const [key, run] of session.runs) {
        if (!run.format) continue
        const animationStyle = Math.round(run.params.animationStyle ?? 0)
        if (animationStyle === 0) continue
        const next = animatedFormat(run.format, run.params, now - run.startedAt, `${id}:${key}`)
        session.runs.set(key, { ...run, format: next })
        changed = true
      }
      if (changed) {
        applyFormats(node, session)
        dirty = true
      }
    }
    return dirty
  }

  stopAll(nodes: ReadonlyMap<string, ModelNode>): void {
    for (const [id, session] of [...this.sessions]) {
      const node = nodes.get(id)
      if (node) (node as { textFormats?: TextFormatRange[] }).textFormats = session.original
      this.sessions.delete(id)
    }
  }
}

function resolveFormat(node: ModelNode, params: Record<string, number>): TextFormatRange | null {
  const text = node.label ?? ''
  const start = Math.max(0, Math.min(text.length, Math.round(params.startIndex ?? 0)))
  const rawEnd = Math.round(params.endIndex ?? -1)
  const end = rawEnd < 0
    ? text.length
    : rawEnd === 0 && start === 0
      ? text.length
      : Math.max(start, Math.min(text.length, rawEnd))
  if (end <= start) return null
  const format: TextFormatRange = { start, end }
  if ((params.bold ?? 0) !== 0) format.bold = true
  if ((params.italic ?? 0) !== 0) format.italic = true
  if ((params.strikethrough ?? 0) !== 0) format.strikethrough = true
  const tint = params.tint
  if (typeof tint === 'number' && tint >= 0) {
    format.color = `#${(tint | 0).toString(16).padStart(6, '0').slice(-6)}`
  }
  if (params.fontSize && params.fontSize > 0) format.fontSize = params.fontSize
  return format
}

function applyFormats(node: ModelNode, session: SessionState): void {
  const formats: TextFormatRange[] = [...(session.original ?? [])]
  for (const run of session.runs.values()) {
    if (run.format) formats.push({ ...run.format })
  }
  ;(node as { textFormats?: TextFormatRange[] }).textFormats = formats.length > 0 ? formats : undefined
}

function animatedFormat(
  baseFormat: TextFormatRange,
  params: Record<string, number>,
  elapsed: number,
  seed: string,
): TextFormatRange {
  const style = Math.round(params.animationStyle ?? 0)
  const baseSize = params.fontSize && params.fontSize > 0 ? params.fontSize : baseFormat.fontSize
  const next: TextFormatRange = { ...baseFormat }
  const t = (elapsed / 1000) * 1.2 * Math.PI * 2
  const phase = (baseFormat.start % 17) * 0.41
  if (baseSize && baseSize > 0) next.fontSize = baseSize
  if (style === 1) {
    next.offsetX = Math.sin(t * 0.7 + phase) * 3
    next.offsetY = Math.sin(t * 0.5 + phase) * 5
    next.rotationDeg = Math.sin(t * 0.3 + phase) * 2
  } else if (style === 2) {
    next.offsetX = Math.sin(t * 0.6 + phase) * 4
    next.offsetY = Math.sin(t * 0.4 + phase) * 5
    const s = 1 + Math.sin(t * 0.8 + phase) * 0.04
    next.scaleX = s
    next.scaleY = s
  } else if (style === 3) {
    const step = Math.floor(elapsed / 45)
    next.offsetX = (jitter(seed, step * 2 + 11) * 2 - 1) * 4
    next.offsetY = (jitter(seed, step * 2 + 53) * 2 - 1) * 4
  } else if (style === 4) {
    next.offsetX = Math.sin(t * 0.3 + phase) * 8
    next.offsetY = Math.sin(t * 0.2 + phase * 1.3) * 3
    next.rotationDeg = Math.sin(t * 0.25 + phase) * 6
    const s = 1 + Math.sin(t * 0.4 + phase) * 0.06
    next.scaleX = s
    next.scaleY = s
  } else if (style === 5) {
    next.offsetX = Math.sin(t * 0.4 + phase) * 2
    next.offsetY = Math.sin(t * 0.6 + phase * 0.8) * 3
    next.skewXDeg = Math.sin(t * 0.5 + phase) * 3
    next.scaleY = 1 + Math.sin(t * 0.3 + phase * 1.2) * 0.05
  }
  return next
}

function jitter(seed: string, step: number): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h = Math.imul(h ^ step, 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff
}
