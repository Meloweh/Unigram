import { useState, useEffect } from 'react'
import type { ConnectionType, MediaNodeType, CosmeticType } from './sampleModels'

interface SectionItem {
  id: string
  label: string
  icon: string
}

const nodeShapes: SectionItem[] = [
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'rounded-rect', label: 'Rounded Rectangle', icon: '▢' },
  { id: 'oval', label: 'Oval', icon: '⬭' },
  { id: 'circle', label: 'Circle', icon: '●' },
  { id: 'diamond', label: 'Diamond', icon: '◆' },
  { id: 'hexagon', label: 'Hexagon', icon: '⬡' },
  { id: 'parallelogram', label: 'Parallelogram', icon: '▱' },
  { id: 'triangle', label: 'Triangle', icon: '△' },
]

interface MediaTypeItem {
  id: MediaNodeType
  label: string
  icon: string
}

const mediaNodeTypes: MediaTypeItem[] = [
  { id: 'image', label: 'Image Node', icon: '🖼' },
  { id: 'gif', label: 'Gif Node', icon: '🎞' },
  { id: 'audio', label: 'Audio Node', icon: '🔊' },
  { id: 'video', label: 'Video Node', icon: '🎬' },
  { id: 'markdown', label: 'Markdown', icon: '𝕄' },
  { id: 'math', label: 'Math', icon: '∑' },
]

interface CosmeticItem {
  id: CosmeticType
  label: string
  icon: string
}

const cosmeticNodeTypes: CosmeticItem[] = [
  { id: 'chat-bubble', label: 'Chat Bubble', icon: '💬' },
  { id: 'thinking-cloud', label: 'Thinking Cloud', icon: '💭' },
]

function SidebarSection({ title, items, defaultOpen = false }: {
  title: string
  items: SectionItem[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="sidebar-section">
      <button
        type="button"
        className="sidebar-section-header"
        onClick={() => setOpen(!open)}
      >
        <span className={`sidebar-chevron ${open ? 'open' : ''}`}>›</span>
        {title}
      </button>
      {open && (
        <div className="sidebar-section-body">
          {items.map((item) => (
            <div
              key={item.id}
              className="sidebar-shape-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/unigram-shape', item.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={`Drag to add ${item.label}`}
            >
              <span className="sidebar-shape-icon">{item.icon}</span>
              <span className="sidebar-shape-label">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NodeTypesSection() {
  const [open, setOpen] = useState(false)
  return (
    <div className="sidebar-section">
      <button
        type="button"
        className="sidebar-section-header"
        onClick={() => setOpen(!open)}
      >
        <span className={`sidebar-chevron ${open ? 'open' : ''}`}>›</span>
        Node Types
      </button>
      {open && (
        <div className="sidebar-section-body">
          {mediaNodeTypes.map((item) => (
            <div
              key={item.id}
              className="sidebar-shape-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/unigram-media-type', item.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={`Drag to add ${item.label}`}
            >
              <span className="sidebar-shape-icon">{item.icon}</span>
              <span className="sidebar-shape-label">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CosmeticNodeSection() {
  const [open, setOpen] = useState(false)
  return (
    <div className="sidebar-section">
      <button
        type="button"
        className="sidebar-section-header"
        onClick={() => setOpen(!open)}
      >
        <span className={`sidebar-chevron ${open ? 'open' : ''}`}>›</span>
        Cosmetic
      </button>
      {open && (
        <div className="sidebar-section-body">
          {cosmeticNodeTypes.map((item) => (
            <div
              key={item.id}
              className="sidebar-shape-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/unigram-cosmetic-type', item.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={`Drag to add ${item.label}`}
            >
              <span className="sidebar-shape-icon">{item.icon}</span>
              <span className="sidebar-shape-label">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConnectionTypesSection({ value, onChange }: {
  value: ConnectionType
  onChange: (type: ConnectionType) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="sidebar-section">
      <button
        type="button"
        className="sidebar-section-header"
        onClick={() => setOpen(!open)}
      >
        <span className={`sidebar-chevron ${open ? 'open' : ''}`}>›</span>
        Connection Types
      </button>
      {open && (
        <div className="sidebar-section-body">
          <label className="sidebar-radio-item">
            <input
              type="radio"
              name="connection-type"
              checked={value === 'default'}
              onChange={() => onChange('default')}
            />
            <span className="sidebar-radio-label">Default</span>
          </label>
          <label className="sidebar-radio-item">
            <input
              type="radio"
              name="connection-type"
              checked={value === 'flow'}
              onChange={() => onChange('flow')}
            />
            <span className="sidebar-radio-label">Flow</span>
          </label>
        </div>
      )}
    </div>
  )
}

export function LeftSidebar({ connectionType, onConnectionTypeChange, forceCollapsed }: {
  connectionType: ConnectionType
  onConnectionTypeChange: (type: ConnectionType) => void
  forceCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    if (forceCollapsed !== undefined) setCollapsed(forceCollapsed)
  }, [forceCollapsed])

  return (
    <div className={`sidebar sidebar-left ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand panel' : 'Collapse panel'}
      >
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && (
        <div className="sidebar-content">
          <div className="sidebar-title">Components</div>
          <SidebarSection title="Nodes" items={nodeShapes} defaultOpen />
          <NodeTypesSection />
          <CosmeticNodeSection />
          <ConnectionTypesSection value={connectionType} onChange={onConnectionTypeChange} />
        </div>
      )}
    </div>
  )
}
