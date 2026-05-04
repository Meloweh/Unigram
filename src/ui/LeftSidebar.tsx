/* eslint-disable react-refresh/only-export-components -- co-located style helpers used by LeftSidebar and RightSidebar */
/**
 * LeftSidebar — build palette.
 *
 * Click a shape button to spawn a node of that shape at the canvas centre.
 * Newly created nodes become the only selection so the right inspector
 * jumps straight to them. The collapsed state is a slim full-height strip
 * along the screen edge, matching the legacy Unigram chrome.
 */

import { useState } from 'react'
import { useOmniStore } from '../model/store'
import type { ConnectionKind, NodeShape } from '../model/types'
import { createShapeDragPreview } from './dragPreview'
import { cosmeticNodeDefaults, isCosmeticShape } from '../scene/cosmeticGeometry'
import { defaultCosmeticEffect } from '../flow/cosmeticEffects'

/** dataTransfer MIME used by the palette → canvas drop. */
export const DRAG_MIME_SHAPE = 'application/omnigram-shape'
export const DRAG_MIME_MEDIA = 'application/omnigram-media'

interface ShapeEntry {
  id: NodeShape
  label: string
  icon: string
}

const STANDARD: ShapeEntry[] = [
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'rounded-rect', label: 'Rounded Rectangle', icon: '▢' },
  { id: 'oval', label: 'Oval', icon: '⬭' },
  { id: 'circle', label: 'Circle', icon: '●' },
  { id: 'diamond', label: 'Diamond', icon: '◆' },
  { id: 'hexagon', label: 'Hexagon', icon: '⬡' },
  { id: 'parallelogram', label: 'Parallelogram', icon: '▱' },
  { id: 'triangle', label: 'Triangle', icon: '△' },
]

const COSMETIC: ShapeEntry[] = [
  { id: 'chat-bubble', label: 'Chat Bubble', icon: '💬' },
  { id: 'thinking-cloud', label: 'Thinking Cloud', icon: '💭' },
]

/**
 * Media node "types" — each entry spawns a regular rectangular node with
 * the matching `mediaType` flag set. Renderer presentation arrives in a
 * later phase; for now the badge in the right inspector confirms the type.
 */
type MediaKind = NonNullable<import('../model/types').ModelNode['mediaType']>
interface MediaEntry { id: MediaKind; label: string; icon: string }
const MEDIA: MediaEntry[] = [
  { id: 'image', label: 'Image Node', icon: '🖼' },
  { id: 'gif', label: 'Gif Node', icon: '🎞' },
  { id: 'audio', label: 'Audio Node', icon: '🔊' },
  { id: 'video', label: 'Video Node', icon: '🎬' },
  { id: 'markdown', label: 'Markdown', icon: '𝕄' },
  { id: 'math', label: 'Math', icon: '∑' },
]

export function LeftSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  // Open sections are tracked as a Set so toggling one section never closes
  // another (parity with legacy: each header is independently expandable).
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['nodes']))
  const isOpen = (id: string) => openSections.has(id)
  const toggleSection = (id: string) =>
    setOpenSections((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const connKind = useOmniStore((s) => s.defaultConnectionKind)

  const spawn = (shape: NodeShape) => {
    const store = useOmniStore.getState()
    const id = store.addNode({
      x: 50,
      y: 50,
      label: '',
      ...(isCosmeticShape(shape)
        ? { ...cosmeticNodeDefaults(shape), flowEffects: [defaultCosmeticEffect(shape)] }
        : { shape }),
    })
    store.select(id)
  }

  const spawnMedia = (mediaType: MediaKind) => {
    const store = useOmniStore.getState()
    // Use a rectangle with the media-type flag set; the inspector will
    // surface a file picker to populate `mediaSrc`.
    const id = store.addNode({ x: 50, y: 50, shape: 'rounded-rect', label: mediaType, mediaType })
    store.select(id)
  }

  const startDrag = (e: React.DragEvent, shape: NodeShape) => {
    e.dataTransfer.setData(DRAG_MIME_SHAPE, shape)
    e.dataTransfer.effectAllowed = 'copy'
    const preview = createShapeDragPreview(shape)
    e.dataTransfer.setDragImage(preview, preview.width / 2, preview.height / 2)
    // The preview must outlive the dragstart handler. Cleanup happens once
    // the browser is done compositing it (next frame is enough on every
    // engine; we use a generous timeout to be safe).
    window.setTimeout(() => preview.remove(), 0)
  }

  // Single persistent shell so the collapse/expand width transition runs.
  return (
    <div style={shellStyle('left', collapsed)}>
      <div style={animatedContentStyle(collapsed)}>
        <div style={titleStyle}>Components</div>
        <Section
          title="Nodes"
          open={isOpen('nodes')}
          onToggle={() => toggleSection('nodes')}
        >
          {STANDARD.map((s) => (
            <PaletteItem
              key={s.id}
              entry={s}
              onClick={() => spawn(s.id)}
              onDragStart={(e) => startDrag(e, s.id)}
            />
          ))}
        </Section>
        <Section
          title="Cosmetic"
          open={isOpen('cosmetic')}
          onToggle={() => toggleSection('cosmetic')}
        >
          {COSMETIC.map((s) => (
            <PaletteItem
              key={s.id}
              entry={s}
              onClick={() => spawn(s.id)}
              onDragStart={(e) => startDrag(e, s.id)}
            />
          ))}
        </Section>
        <Section
          title="Node Types"
          open={isOpen('media')}
          onToggle={() => toggleSection('media')}
        >
          {MEDIA.map((m) => (
            <PaletteItem
              key={m.id}
              entry={{ id: 'rounded-rect' as NodeShape, label: m.label, icon: m.icon }}
              onClick={() => spawnMedia(m.id)}
              onDragStart={(e) => {
                // Re-use the shape drag protocol; the inspector will offer
                // a file picker once the dropped node is selected. Also
                // tag the drag with the media kind so the drop handler can
                // pre-set `mediaType` and the inspector dropdown shows it.
                e.dataTransfer.setData(DRAG_MIME_SHAPE, 'rounded-rect')
                e.dataTransfer.setData(DRAG_MIME_MEDIA, m.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
            />
          ))}
        </Section>
        <Section
          title="Connection Types"
          open={isOpen('connections')}
          onToggle={() => toggleSection('connections')}
        >
          <ConnectionKindRadio
            value={connKind}
            onChange={(k) => useOmniStore.getState().setDefaultConnectionKind(k)}
          />
        </Section>
      </div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand build palette' : 'Collapse panel'}
        style={toggleColumnStyle()}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </div>
  )
}

function ConnectionKindRadio({
  value,
  onChange,
}: {
  value: ConnectionKind
  onChange: (k: ConnectionKind) => void
}) {
  const options: { id: ConnectionKind; label: string; hint: string }[] = [
    { id: 'default', label: 'Default', hint: 'Static connection' },
    { id: 'flow', label: 'Flow', hint: 'Animates during Play; orange' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {options.map((o) => (
        <label
          key={o.id}
          title={o.hint}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            borderRadius: 4,
            background: value === o.id ? 'var(--ug-surface-raised)' : 'transparent',
            border: '1px solid ' + (value === o.id ? 'var(--ug-accent)' : 'var(--ug-border-light)'),
            cursor: 'pointer',
            color: 'var(--ug-text)',
            font: '14px system-ui, sans-serif',
          }}
        >
          <input
            type="radio"
            name="omni-conn-kind"
            value={o.id}
            checked={value === o.id}
            onChange={() => onChange(o.id)}
          />
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 2,
              background: o.id === 'flow' ? '#f59e0b' : 'var(--ug-text)',
              borderRadius: 1,
            }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

function PaletteItem({
  entry,
  onClick,
  onDragStart,
}: {
  entry: ShapeEntry
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      title={`Click to add · drag to place — ${entry.label}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'transparent',
        color: 'var(--ug-text)',
        border: 'none',
        borderRadius: 6,
        padding: '5px 8px',
        font: 'calc(13px * var(--ug-ui-scale) / 1.5) system-ui, sans-serif',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        minHeight: 28,
      }}
    >
      <span style={{ fontSize: 17, width: 22, textAlign: 'center', color: 'var(--ug-primary)' }}>{entry.icon}</span>
      <span style={{ fontSize: '0.82em' }}>{entry.label}</span>
    </button>
  )
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 8 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          background: 'transparent',
          color: 'var(--ug-text-heading)',
          border: 'none',
          borderRadius: 6,
          padding: '5px 4px',
          font: '600 0.82rem system-ui, sans-serif',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            transition: 'transform 120ms',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ›
        </span>
        {title}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '4px 0 4px 6px' }}>{children}</div>}
    </div>
  )
}

// ---- shared sidebar shell styles ------------------------------------------

/**
 * Width of the expanded panel at scale=1. Actual rendered width is this
 * multiplied by `--ug-ui-scale` (default 1.5 — see [src/index.css](../index.css)).
 */
export const SIDEBAR_EXPANDED_W = 190
/** Width of the collapsed strip at scale=1 (also the width of the
 *  expand/collapse toggle column — widened from 18 → 27 (×1.5) so the
 *  arrow target is comfortably clickable on touch displays). */
export const SIDEBAR_COLLAPSED_W = 27
/** Collapse / expand transition duration (ms). */
export const SIDEBAR_TRANSITION_MS = 180

/** Helper: scale a pixel literal by the global UI scale variable. */
const scaled = (px: number) => `calc(${px}px * var(--ug-ui-scale))`

/**
 * Outer shell — flush against the screen edge (legacy parity), with rounded
 * corners only on the inner side. Animates `width` so collapse/expand feels
 * connected instead of abruptly swapping DOM trees. Toggle column lives on
 * the inner edge: render order is content → toggle for both sides via the
 * `flex-direction` trick (left = row, right = row-reverse).
 */
export function shellStyle(side: 'left' | 'right', collapsed = false): React.CSSProperties {
  const expandedW = side === 'left' ? 176 : SIDEBAR_EXPANDED_W
  return {
    position: 'absolute',
    [side]: 0,
    top: 0,
    bottom: 0,
    width: collapsed ? scaled(19) : scaled(expandedW),
    background: 'var(--ug-glass-strong)',
    backdropFilter: 'blur(10px)',
    color: 'var(--ug-text)',
    font: `${scaled(14)} system-ui, sans-serif`,
    borderRadius: side === 'left' ? `0 ${scaled(8)} ${scaled(8)} 0` : `${scaled(8)} 0 0 ${scaled(8)}`,
    border: '1px solid var(--ug-border)',
    [side === 'left' ? 'borderLeft' : 'borderRight']: 'none',
    boxShadow: '0 2px 16px var(--ug-shadow)',
    display: 'flex',
    flexDirection: side === 'left' ? 'row' : 'row-reverse',
    overflow: collapsed ? 'hidden' : 'visible',
    zIndex: 12,
    transition: `width 250ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
  }
}

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '12px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  overflowY: 'auto',
}

export const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '0.78rem',
  color: 'var(--ug-text)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 10,
  padding: '0 2px',
}

export function toggleColumnStyle(): React.CSSProperties {
  return {
    flexShrink: 0,
    width: scaled(19),
    background: 'transparent',
    color: 'var(--ug-primary)',
    border: 'none',
    cursor: 'pointer',
    font: `700 ${scaled(15)} system-ui, sans-serif`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}

/**
 * Animated content wrapper — fades + clips body when the parent shell is
 * collapsed so width-animation reveals the body smoothly. `pointer-events`
 * are dropped while collapsed so hidden buttons don't intercept clicks
 * meant for the toggle. When collapsed we also zero out the flex basis +
 * padding so the toggle column is not pushed outside the (narrow) shell
 * and clipped by `overflow: hidden`.
 */
export function animatedContentStyle(collapsed: boolean): React.CSSProperties {
  return {
    ...contentStyle,
    flex: collapsed ? '0 0 0px' : 1,
    padding: collapsed ? 0 : scaled(12),
    opacity: collapsed ? 0 : 1,
    pointerEvents: collapsed ? 'none' : 'auto',
    transition: `opacity ${SIDEBAR_TRANSITION_MS}ms ease`,
  }
}

export function collapsedStripStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: 0,
    // Reduce strip height to ~40 % of the viewport so it reads as a tab,
    // not a full-height panel (legacy Unigram parity).
    top: '30%',
    bottom: '30%',
    width: 16,
    background: 'var(--ug-glass)',
    color: 'var(--ug-text-muted)',
    border: '1px solid var(--ug-border)',
    [side === 'left' ? 'borderLeft' : 'borderRight']: 'none',
    borderRadius: side === 'left' ? '0 6px 6px 0' : '6px 0 0 6px',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  }
}
