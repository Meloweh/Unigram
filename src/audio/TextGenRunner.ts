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
}

interface RunState {
  config: Required<TextGenConfig>
  startedAt: number
  /** Original label restored on stop. */
  originalLabel: string
  /** Last-emitted character index (so we know when to play sounds). */
  lastIndex: number
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
    this.runs.set(node.id, {
      config: {
        text: config.text,
        charsPerSec: config.charsPerSec ?? 24,
        sound: config.sound ?? 'none',
        loop: config.loop ?? false,
        endHoldMs: config.endHoldMs ?? 1500,
      },
      startedAt: now,
      originalLabel: node.label,
      lastIndex: 0,
    })
    ;(node as { label: string }).label = ''
  }

  stop(node: ModelNode): void {
    const run = this.runs.get(node.id)
    if (!run) return
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
      const total = run.config.text.length
      const cycleMs = (total / run.config.charsPerSec) * 1000
      let elapsed = now - run.startedAt
      // Loop wrap.
      if (run.config.loop && elapsed > cycleMs + run.config.endHoldMs) {
        run.startedAt = now
        run.lastIndex = 0
        ;(node as { label: string }).label = ''
        elapsed = 0
        dirty = true
      }
      const desired = Math.min(total, Math.floor((elapsed / 1000) * run.config.charsPerSec))
      if (desired !== run.lastIndex) {
        ;(node as { label: string }).label = run.config.text.slice(0, desired)
        // Play one sound per advancing character (capped to avoid floods on
        // tab catch-up; one sound per tick is enough for the audible effect).
        if (desired > run.lastIndex && run.config.sound !== 'none') {
          playGenSound(run.config.sound, desired)
        }
        run.lastIndex = desired
        dirty = true
      }
      // Non-looping: stop once fully typed and held.
      if (!run.config.loop && elapsed > cycleMs + run.config.endHoldMs) {
        // Leave the final text in place but drop the run so we stop ticking.
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
