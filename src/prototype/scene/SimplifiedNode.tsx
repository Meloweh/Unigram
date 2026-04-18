import { memo } from 'react'
import type { ModelNode } from '../model/sampleModels'
import { NODE_MIN_W, NODE_MIN_H } from './sceneConstants'

/** Lightweight node for low-zoom LOD — colored rect + truncated label only */
export const SimplifiedNode = memo(function SimplifiedNode({
  node, posX, posY, isSelected, isDragging, defaultCellColor, defaultMembraneColor,
}: {
  node: ModelNode
  posX: number
  posY: number
  isSelected: boolean
  isDragging: boolean
  defaultCellColor: string
  defaultMembraneColor: string
}) {
  const cellColor = node.cellColor ?? defaultCellColor
  const membraneColor = node.membraneColor ?? defaultMembraneColor
  const w = node.nodeWidth ?? NODE_MIN_W
  const h = node.nodeHeight ?? NODE_MIN_H

  return (
    <div
      data-node-id={node.id}
      style={{
        position: 'absolute',
        left: `${posX}%`,
        top: `${posY}%`,
        width: w,
        height: h,
        transform: 'translate(-50%, -50%)',
        transition: isDragging ? 'none' : 'left 0.35s cubic-bezier(0.25,0.1,0.25,1), top 0.35s cubic-bezier(0.25,0.1,0.25,1)',
        background: cellColor,
        border: `2px solid ${isSelected ? 'rgba(14, 79, 143, 1)' : membraneColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        fontSize: '0.7rem',
        color: 'var(--ug-text)',
        padding: '4px 6px',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        pointerEvents: 'auto',
        boxSizing: 'border-box',
      }}
    >
      {node.label.slice(0, 30)}
    </div>
  )
})
