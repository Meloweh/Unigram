import { useEffect, useRef } from 'react'
import type { StudyEvidence } from './sampleModels'
import { useHybridZoomStore, type UnzipLevel } from './useHybridZoomStore'

interface UnzipPopupProps {
  connectionKey: string
  level: UnzipLevel
  evidence: StudyEvidence[]
  anchorX: number
  anchorY: number
}

export function UnzipPopup({ connectionKey, level, evidence, anchorX, anchorY }: UnzipPopupProps) {
  const { closeUnzip, unzipDeeper, unzipShallower } = useHybridZoomStore()
  const popupRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeUnzip()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeUnzip])

  if (evidence.length === 0) return null

  return (
    <div
      ref={popupRef}
      className={`unzip-popup unzip-level-${level}`}
      style={{
        left: `${anchorX}%`,
        top: `${anchorY}%`,
      }}
      data-connection={connectionKey}
      onWheel={(e) => {
        e.stopPropagation()
        if (e.deltaY < 0) {
          unzipDeeper()
        } else {
          unzipShallower()
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="unzip-header">
        <span className="unzip-level-badge">L{level}</span>
        <span className="unzip-title">
          {evidence.length} {evidence.length === 1 ? 'study' : 'studies'}
        </span>
        <button className="unzip-close" type="button" onClick={closeUnzip}>
          ×
        </button>
      </div>
      <ul className="unzip-list">
        {evidence.map((study, i) => (
          <li key={i} className="unzip-study">
            <div className="unzip-study-title">{study.title}</div>
            {level >= 2 && (
              <div className="unzip-study-citation">{study.citation}</div>
            )}
            {level >= 3 && (
              <a
                className="unzip-study-url"
                href={study.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {study.url}
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="unzip-hint">
        {level < 3 ? 'Scroll up for more detail' : 'Scroll down to collapse'}
      </div>
    </div>
  )
}
