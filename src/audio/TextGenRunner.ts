/**
 * TextGenRunner — progressively reveals a node's label one character at a
 * time, with optional Web Audio dialog ticks. Mutates `ModelNode.label`
 * directly (the same hot-path technique used by drag) and *does not* commit
 * to the store; on stop, the original label is restored.
 *
 * One runner instance per `SceneRenderer`; the renderer ticks it every frame
 * while any runs are active and marks itself dirty when a character has
 * changed since the last tick.
 */

import type { ModelNode } from '../model/types'
import { playGenSound, type TextGenSoundPreset } from './textGenSounds'

export interface TextGenConfig {
  /** Final string to type out. */
  text: string
  /** Characters per second. Default: 24. */
  charsPerSec?: number
  /** Sound preset (or 'none'). */
  sound?: TextGenSoundPreset
  /** When true, restart from blank after `endHoldMs` once full text is shown. */
  loop?: boolean
  /** Time to hold the fully-typed string before looping (ms). Default: 1500. */
  endHoldMs?: number
  /** First char index of the animated range (inclusive). Chars before this
   *  are shown verbatim from the start. Default: 0. */
  startIndex?: number
  /** Last char index of the animated range (exclusive); -1 or undefined
   *  means "to end of text". Chars after this appear once the range is
   *  fully typed. Default: -1. */
  endIndex?: number
  /** When > 0, on `stop()` the runner un-types the animated range over
   *  this duration before restoring `originalLabel`. Default: 0. */
  degenerationMs?: number
}

interface RunState {
  config: Required<TextGenConfig>
  startedAt: number
  /** Original label restored on stop. */
  originalLabel: string
  /** Last-emitted character index within the animated range (so we know
   *  when to play sounds and to seed degeneration). */
  lastIndex: number
  /** Resolved animated-range bounds within `config.text`. */
  rangeStart: number
  rangeEnd: number
  /** When set, the run is in degeneration phase: lastIndex is being lerped
   *  back to 0. Stored so degeneration starts from the currently-visible
   *  character count rather than restarting from full. */
  degenStartedAt: number | null
  degenFromIndex: number
}

export class TextGenRunner {
  private runs = new Map<string, RunState>()

  start(node: ModelNode, config: TextGenConfig, now: number): void {
    // If a run is already active for this node, restore its original label
    // before recording the new one — guards against compound originals.
    const prev = this.runs.get(node.id)
    if (prev) {
      ;(node as { label: string }).label = prev.originalLabel
    }
    const text = config.text
    const rawStart = config.startIndex ?? 0
    const rawEnd = config.endIndex ?? -1
    const rangeStart = Math.max(0, Math.min(text.length, rawStart))
    const rangeEnd =
      rawEnd < 0 ? text.length : Math.max(rangeStart, Math.min(text.length, rawEnd))
    this.runs.set(node.id, {
      config: {
        text,
        charsPerSec: config.charsPerSec ?? 24,
        sound: config.sound ?? 'none',
        loop: config.loop ?? false,
        endHoldMs: config.endHoldMs ?? 1500,
        startIndex: rangeStart,
        endIndex: rangeEnd,
        degenerationMs: Math.max(0, config.degenerationMs ?? 0),
      },
      startedAt: now,
      originalLabel: node.label,
      lastIndex: 0,
      rangeStart,
      rangeEnd,
      degenStartedAt: null,
      degenFromIndex: 0,
    })
    // Initial display: prefix only — the animated range is blank.
    ;(node as { label: string }).label = text.slice(0, rangeStart)
  }

  stop(node: ModelNode): void {
    const run = this.runs.get(node.id)
    if (!run) return
    if (run.config.degenerationMs > 0 && run.degenStartedAt === null) {
      // Begin un-typing rather than snapping back. The tick loop owns the
      // restore once degeneration completes.
      run.degenStartedAt = performance.now()
      run.degenFromIndex = run.lastIndex
      return
    }
    ;(node as { label: string }).label = run.originalLabel
    this.runs.delete(node.id)
  }

  has(nodeId: string): boolean {
    return this.runs.has(nodeId)
  }

  get hasActiveRuns(): boolean {
    return this.runs.size > 0
  }

  /**
   * Advance every active run. Returns true if any node label changed and
   * the renderer should mark itself dirty.
   */
  tick(nodes: ReadonlyMap<string, ModelNode>, now: number): boolean {
    let dirty = false
    for (const [id, run] of [...this.runs]) {
      const node = nodes.get(id)
      if (!node) {
        // Owning node was deleted — drop the run silently.
        this.runs.delete(id)
        continue
      }
      const text = run.config.text
      const rangeLen = run.rangeEnd - run.rangeStart
      // Degeneration phase: lerp lastIndex back to 0 over degenerationMs.
      if (run.degenStartedAt !== null) {
        const t = Math.min(
          1,
          (now - run.degenStartedAt) / Math.max(1, run.config.degenerationMs),
        )
        const desired = Math.max(0, Math.floor(run.degenFromIndex * (1 - t)))
        if (desired !== run.lastIndex) {
          ;(node as { label: string }).label = renderLabel(text, run.rangeStart, run.rangeEnd, desired)
          run.lastIndex = desired
          dirty = true
        }
        if (t >= 1) {
          ;(node as { label: string }).label = run.originalLabel
          this.runs.delete(id)
          dirty = true
        }
        continue
      }
      const cycleMs = (rangeLen / run.config.charsPerSec) * 1000
      let elapsed = now - run.startedAt
      // Loop wrap.
      if (run.config.loop && elapsed > cycleMs + run.config.endHoldMs) {
        run.startedAt = now
        run.lastIndex = 0
        ;(node as { label: string }).label = renderLabel(text, run.rangeStart, run.rangeEnd, 0)
        elapsed = 0
        dirty = true
      }
      const desired = Math.min(rangeLen, Math.floor((elapsed / 1000) * run.config.charsPerSec))
      if (desired !== run.lastIndex) {
        ;(node as { label: string }).label = renderLabel(text, run.rangeStart, run.rangeEnd, desired)
        if (desired > run.lastIndex && run.config.sound !== 'none') {
          playGenSound(run.config.sound, desired)
        }
        run.lastIndex = desired
        dirty = true
      }
      // Non-looping: stop once fully typed and held.
      if (!run.config.loop && elapsed > cycleMs + run.config.endHoldMs) {
        this.runs.delete(id)
      }
    }
    return dirty
  }

  /** Cancel every active run, restoring original labels. */
  stopAll(nodes: ReadonlyMap<string, ModelNode>): void {
    for (const [id, run] of [...this.runs]) {
      const node = nodes.get(id)
      if (node) (node as { label: string }).label = run.originalLabel
      this.runs.delete(id)
    }
  }
}

/**
 * Compose the visible label given the animated range and how many chars
 * within that range have been revealed. Prefix (before rangeStart) is
 * always shown; suffix (after rangeEnd) appears only once the range is
 * fully typed (mirrors legacy substring behaviour where the surrounding
 * static text snaps in once the animation completes).
 */
function renderLabel(text: string, rangeStart: number, rangeEnd: number, typed: number): string {
  const prefix = text.slice(0, rangeStart)
  const rangeLen = rangeEnd - rangeStart
  const animated = text.slice(rangeStart, rangeStart + Math.min(rangeLen, typed))
  const suffix = typed >= rangeLen ? text.slice(rangeEnd) : ''
  return prefix + animated + suffix
}
