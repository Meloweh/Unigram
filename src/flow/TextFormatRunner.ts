import type { ModelNode, TextFormatRange } from '../model/types'

interface RunState {
  original: TextFormatRange[] | undefined
  format: TextFormatRange | null
  params: Record<string, number>
  startedAt: number
}

export class TextFormatRunner {
  private runs = new Map<string, RunState>()

  start(node: ModelNode, params: Record<string, number>): void {
    const previous = this.runs.get(node.id)
    if (previous) {
      ;(node as { textFormats?: TextFormatRange[] }).textFormats = previous.original
    }
    const original = node.textFormats ? node.textFormats.map((r) => ({ ...r })) : undefined
    const text = node.label ?? ''
    const start = Math.max(0, Math.min(text.length, Math.round(params.startIndex ?? 0)))
    const rawEnd = Math.round(params.endIndex ?? -1)
    const end = rawEnd < 0
      ? text.length
      : rawEnd === 0 && start === 0
        ? text.length
      : Math.max(start, Math.min(text.length, rawEnd))
    const format: TextFormatRange = { start, end }
    if ((params.bold ?? 0) !== 0) format.bold = true
    if ((params.italic ?? 0) !== 0) format.italic = true
    if ((params.strikethrough ?? 0) !== 0) format.strikethrough = true
    const tint = params.tint
    if (typeof tint === 'number' && tint >= 0) {
      format.color = `#${(tint | 0).toString(16).padStart(6, '0').slice(-6)}`
    }
    if (params.fontSize && params.fontSize > 0) format.fontSize = params.fontSize
    const liveFormat = end > start ? format : null
    this.runs.set(node.id, { original, format: liveFormat, params, startedAt: performance.now() })
    const next = liveFormat ? [...(original ?? []), liveFormat] : original
    ;(node as { textFormats?: TextFormatRange[] }).textFormats = next
  }

  stop(node: ModelNode): void {
    const run = this.runs.get(node.id)
    if (!run) return
    ;(node as { textFormats?: TextFormatRange[] }).textFormats = run.original
    this.runs.delete(node.id)
  }

  get hasActiveRuns(): boolean {
    return this.runs.size > 0
  }

  tick(nodes: ReadonlyMap<string, ModelNode>, now: number): boolean {
    let dirty = false
    for (const [id, run] of this.runs) {
      const node = nodes.get(id)
      if (!node || !run.format) continue
      const animationStyle = Math.round(run.params.animationStyle ?? 0)
      if (animationStyle === 0) continue
      const elapsed = now - run.startedAt
      const base = run.params.fontSize && run.params.fontSize > 0 ? run.params.fontSize : 26
      const next = { ...run.format }
      if (animationStyle === 1) {
        next.fontSize = base + Math.sin(elapsed * 0.004) * 1.5
      } else if (animationStyle === 2) {
        next.fontSize = base + Math.sin(elapsed * 0.008) * 2.2
      } else if (animationStyle === 3) {
        const step = Math.floor(elapsed / 45)
        next.fontSize = base + (jitter(id, step) * 2 - 1) * 2.5
      } else if (animationStyle === 4) {
        next.fontSize = base + Math.sin(elapsed * 0.003) * 3
      } else if (animationStyle === 5) {
        next.fontSize = base + Math.sin(elapsed * 0.006) * 1.2
      }
      ;(node as { textFormats?: TextFormatRange[] }).textFormats = [...(run.original ?? []), next]
      dirty = true
    }
    return dirty
  }

  stopAll(nodes: ReadonlyMap<string, ModelNode>): void {
    for (const [id, run] of [...this.runs]) {
      const node = nodes.get(id)
      if (node) (node as { textFormats?: TextFormatRange[] }).textFormats = run.original
      this.runs.delete(id)
    }
  }
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
