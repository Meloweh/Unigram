import { useState } from 'react'
import type { MediaNodeType } from './sampleModels'

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

export function LeftSidebar() {
  const [collapsed, setCollapsed] = useState(false)

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
        </div>
      )}
    </div>
  )
}
