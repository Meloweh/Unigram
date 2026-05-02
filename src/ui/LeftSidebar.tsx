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
import type { NodeShape } from '../model/types'
import { createShapeDragPreview } from './dragPreview'

/** dataTransfer MIME used by the palette → canvas drop. */
export const DRAG_MIME_SHAPE = 'application/omnigram-shape'

interface ShapeEntry {
  id: NodeShape
  label: string
  icon: string
}

const STANDARD: ShapeEntry[] = [
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'rounded-rect', label: 'Rounded', icon: '▢' },
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

export function LeftSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [openSection, setOpenSection] = useState<'nodes' | 'cosmetic' | null>('nodes')

  const spawn = (shape: NodeShape) => {
    const store = useOmniStore.getState()
    const id = store.addNode({ x: 50, y: 50, shape, label: '' })
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

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Expand build palette"
        style={collapsedStripStyle('left')}
      >
        <span style={collapsedChevronStyle}>›</span>
      </button>
    )
  }

  return (
    <div style={shellStyle('left')}>
      <div style={contentStyle}>
        <div style={titleStyle}>Components</div>
        <Section
          title="Nodes"
          open={openSection === 'nodes'}
          onToggle={() => setOpenSection(openSection === 'nodes' ? null : 'nodes')}
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
          open={openSection === 'cosmetic'}
          onToggle={() => setOpenSection(openSection === 'cosmetic' ? null : 'cosmetic')}
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
        <div style={hintStyle}>Click to add at centre · drag to position.</div>
      </div>
      <button
        onClick={() => setCollapsed(true)}
        title="Collapse panel"
        style={toggleColumnStyle('left')}
      >
        ‹
      </button>
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
        background: '#1a2030',
        color: '#cfe',
        border: '1px solid #2a3142',
        borderRadius: 4,
        padding: '6px 8px',
        font: '12px system-ui, sans-serif',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span style={{ fontSize: 16, width: 18, textAlign: 'center' }}>{entry.icon}</span>
      <span>{entry.label}</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          color: '#fff',
          border: 'none',
          padding: '4px 0',
          font: '600 12px system-ui, sans-serif',
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
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>}
    </div>
  )
}

// ---- shared sidebar shell styles ------------------------------------------

export function shellStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: 8,
    top: 8,
    bottom: 8,
    width: 240,
    background: 'rgba(16,19,26,0.92)',
    color: '#cfe',
    font: '12px system-ui, sans-serif',
    borderRadius: 6,
    border: '1px solid #2a3142',
    display: 'flex',
    flexDirection: side === 'left' ? 'row' : 'row-reverse',
    overflow: 'hidden',
    zIndex: 5,
  }
}

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  overflowY: 'auto',
}

const titleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  color: '#fff',
  borderBottom: '1px solid #2a3142',
  paddingBottom: 6,
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#7a8aa0',
  fontStyle: 'italic',
  marginTop: 'auto',
}

export function toggleColumnStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 18,
    background: 'rgba(28,34,46,0.7)',
    color: '#7a8aa0',
    border: 'none',
    borderLeft: side === 'left' ? '1px solid #2a3142' : 'none',
    borderRight: side === 'right' ? '1px solid #2a3142' : 'none',
    cursor: 'pointer',
    font: '14px system-ui, sans-serif',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}

export function collapsedStripStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: 0,
    top: '20%',
    bottom: '20%',
    width: 16,
    background: 'rgba(28,34,46,0.85)',
    color: '#7a8aa0',
    border: '1px solid #2a3142',
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

const collapsedChevronStyle: React.CSSProperties = {
  font: 'bold 14px system-ui, sans-serif',
  color: '#cfe',
}
