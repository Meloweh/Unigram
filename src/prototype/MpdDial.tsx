export interface MpdBarProps {
  /** Available MPD model references (labels + ids) */
  options: { id: string; label: string }[]
  /** Index of the currently active option */
  activeIndex: number
  /** Called when the user selects a new MPD */
  onSelect: (index: number) => void
}

/**
 * Full-width horizontal bar for MPD dimension switching.
 * Each option is a tab-style button; the active one is highlighted.
 */
export function MpdBar({ options, activeIndex, onSelect }: MpdBarProps) {
  return (
    <div className="mpd-bar">
      {options.map((opt, i) => (
        <button
          key={opt.id}
          type="button"
          className={`mpd-bar-option ${i === activeIndex ? 'active' : ''}`}
          onClick={() => onSelect(i)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
