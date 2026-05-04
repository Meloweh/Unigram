/**
 * TextGenRunner — progressively reveals ranges of a node's source label.
 *
 * Legacy parity note: generator nodes operate on explicit source-text
 * portions. Text outside generated ranges stays hidden, and already generated
 * portions remain visible until the owning flow run stops. Multiple generator
 * nodes can therefore "fill in" different ranges of the same label.
 */

import type { ModelNode } from '../model/types'
import { playGenSound, type TextGenSoundPreset } from './textGenSounds'

export const TEXT_GEN_VISIBLE_LABEL = Symbol.for('omnigram.textGenVisibleLabel')

export interface TextGenConfig {
  text: string
  charsPerSec?: number
  sound?: TextGenSoundPreset
  loop?: boolean
  endHoldMs?: number
  startIndex?: number
  endIndex?: number
  degenerationMs?: number
}

interface RangeRun {
  key: string
  config: Required<TextGenConfig>
  startedAt: number
  lastIndex: number
  rangeStart: number
  rangeEnd: number
  completed: boolean
  degenStartedAt: number | null
  degenFromIndex: number
}

interface Session {
  originalLabel: string
  sourceText: string
  runs: Map<string, RangeRun>
}

const DEFAULT_KEY = '__default__'

export interface TextGenVisibleLabel {
  text: string
  start: number
  end: number
}

export function textGenFitLabelOf(node: ModelNode): string | undefined {
  return textGenVisibleLabelOf(node)?.text
}

export function textGenVisibleLabelOf(node: ModelNode): TextGenVisibleLabel | undefined {
  return (node as unknown as Record<symbol, TextGenVisibleLabel | undefined>)[TEXT_GEN_VISIBLE_LABEL]
}

export class TextGenRunner {
  private sessions = new Map<string, Session>()

  start(node: ModelNode, config: TextGenConfig, now: number, key = DEFAULT_KEY): void {
    let session = this.sessions.get(node.id)
    if (!session) {
      session = { originalLabel: node.label || '', sourceText: config.text || node.label || '', runs: new Map() }
      this.sessions.set(node.id, session)
    }
    const source = session.sourceText
    const rawStart = config.startIndex ?? 0
    const rawEnd = config.endIndex ?? -1
    const rangeStart = Math.max(0, Math.min(source.length, Math.round(rawStart)))
    const rangeEnd = rawEnd < 0
      ? source.length
      : Math.max(rangeStart, Math.min(source.length, Math.round(rawEnd)))
    session.runs.set(key, {
      key,
      config: {
        text: source,
        charsPerSec: config.charsPerSec ?? 24,
        sound: config.sound ?? 'none',
        loop: config.loop ?? false,
        endHoldMs: config.endHoldMs ?? 1500,
        startIndex: rangeStart,
        endIndex: rangeEnd,
        degenerationMs: Math.max(0, config.degenerationMs ?? 0),
      },
      startedAt: now,
      lastIndex: 0,
      rangeStart,
      rangeEnd,
      completed: false,
      degenStartedAt: null,
      degenFromIndex: 0,
    })
    this.render(node, session)
  }

  stop(node: ModelNode, key = DEFAULT_KEY): void {
    const session = this.sessions.get(node.id)
    if (!session) return
    const run = session.runs.get(key)
    if (!run) return
    if (run.config.degenerationMs > 0 && run.degenStartedAt === null && run.lastIndex > 0) {
      run.degenStartedAt = performance.now()
      run.degenFromIndex = run.lastIndex
      run.completed = false
      return
    }
    session.runs.delete(key)
    if (session.runs.size === 0) {
      ;(node as { label: string }).label = session.originalLabel
      clearTextGenFitLabel(node)
      this.sessions.delete(node.id)
    } else {
      this.render(node, session)
    }
  }

  has(nodeId: string): boolean {
    return this.sessions.has(nodeId)
  }

  get hasActiveRuns(): boolean {
    for (const session of this.sessions.values()) {
      for (const run of session.runs.values()) {
        if (!run.completed || run.degenStartedAt !== null || run.config.loop) return true
      }
    }
    return false
  }

  tick(nodes: ReadonlyMap<string, ModelNode>, now: number): boolean {
    let dirty = false
    for (const [id, session] of [...this.sessions]) {
      const node = nodes.get(id)
      if (!node) {
        this.sessions.delete(id)
        continue
      }
      let sessionDirty = false
      for (const run of session.runs.values()) {
        const rangeLen = run.rangeEnd - run.rangeStart
        if (rangeLen <= 0) {
          run.completed = true
          continue
        }
        if (run.degenStartedAt !== null) {
          const t = Math.min(1, (now - run.degenStartedAt) / Math.max(1, run.config.degenerationMs))
          const desired = Math.max(0, Math.floor(run.degenFromIndex * (1 - t)))
          if (desired !== run.lastIndex) {
            run.lastIndex = desired
            sessionDirty = true
          }
          if (t >= 1) {
            session.runs.delete(run.key)
            sessionDirty = true
          }
          continue
        }
        if (run.completed && !run.config.loop) continue
        const cycleMs = (rangeLen / run.config.charsPerSec) * 1000
        let elapsed = now - run.startedAt
        if (run.config.loop && elapsed > cycleMs + run.config.endHoldMs) {
          run.startedAt = now
          run.lastIndex = 0
          run.completed = false
          elapsed = 0
          sessionDirty = true
        }
        const desired = Math.min(rangeLen, Math.floor((elapsed / 1000) * run.config.charsPerSec))
        if (desired !== run.lastIndex) {
          if (desired > run.lastIndex && run.config.sound !== 'none') playGenSound(run.config.sound, desired)
          run.lastIndex = desired
          sessionDirty = true
        }
        if (!run.config.loop && elapsed > cycleMs + run.config.endHoldMs) {
          run.completed = true
        }
      }
      if (session.runs.size === 0) {
        ;(node as { label: string }).label = session.originalLabel
        clearTextGenFitLabel(node)
        this.sessions.delete(id)
        dirty = true
      } else if (sessionDirty) {
        this.render(node, session)
        dirty = true
      }
    }
    return dirty
  }

  stopAll(nodes: ReadonlyMap<string, ModelNode>): void {
    for (const [id, session] of [...this.sessions]) {
      const node = nodes.get(id)
      if (node) {
        ;(node as { label: string }).label = session.originalLabel
        clearTextGenFitLabel(node)
      }
      this.sessions.delete(id)
    }
  }

  private render(node: ModelNode, session: Session): void {
    const source = session.sourceText
    const out: string[] = source.split('').map((ch) => (ch === '\n' ? '\n' : ' '))
    let firstVisible = Infinity
    let lastVisible = -1
    for (const run of session.runs.values()) {
      const rangeLen = run.rangeEnd - run.rangeStart
      const typed = Math.max(0, Math.min(rangeLen, run.lastIndex))
      for (let i = 0; i < typed; i++) {
        const idx = run.rangeStart + i
        out[idx] = source[idx]
        firstVisible = Math.min(firstVisible, idx)
        lastVisible = Math.max(lastVisible, idx)
      }
    }
    ;(node as { label: string }).label = out.join('')
    setTextGenFitLabel(
      node,
      firstVisible <= lastVisible
        ? { text: out.slice(firstVisible, lastVisible + 1).join(''), start: firstVisible, end: lastVisible + 1 }
        : { text: '', start: 0, end: 0 },
    )
  }
}

function setTextGenFitLabel(node: ModelNode, label: TextGenVisibleLabel): void {
  Object.defineProperty(node, TEXT_GEN_VISIBLE_LABEL, {
    value: label,
    writable: true,
    configurable: true,
  })
}

function clearTextGenFitLabel(node: ModelNode): void {
  delete (node as unknown as Record<symbol, TextGenVisibleLabel | undefined>)[TEXT_GEN_VISIBLE_LABEL]
}
