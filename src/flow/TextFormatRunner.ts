import type { ModelNode, TextFormatRange } from '../model/types'

interface RunState {
  original: TextFormatRange[] | undefined
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
    this.runs.set(node.id, { original })
    const next = end > start ? [...(original ?? []), format] : original
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

  stopAll(nodes: ReadonlyMap<string, ModelNode>): void {
    for (const [id, run] of [...this.runs]) {
      const node = nodes.get(id)
      if (node) (node as { textFormats?: TextFormatRange[] }).textFormats = run.original
      this.runs.delete(id)
    }
  }
}
