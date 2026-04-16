import type { TextFormatRange } from './sampleModels'

/** Render a label string with inline TextFormatRange styling as React elements.
 *  Always wraps text runs in <span data-offset="N"> so flow effect nodes can target them. */
export function renderFormattedLabel(label: string, formats?: TextFormatRange[]): React.ReactNode {
  if (!label) return '\u00A0'

  // Build per-character format lookup
  type CharFmt = { bold?: boolean; italic?: boolean; strikethrough?: boolean; color?: string; fontSize?: number }
  const chars: CharFmt[] = Array.from({ length: label.length }, () => ({}))
  if (formats) {
    for (const r of formats) {
      for (let i = r.start; i < r.end && i < label.length; i++) {
        if (r.bold) chars[i].bold = true
        if (r.italic) chars[i].italic = true
        if (r.strikethrough) chars[i].strikethrough = true
        if (r.color) chars[i].color = r.color
        if (r.fontSize != null) chars[i].fontSize = r.fontSize
      }
    }
  }

  // Coalesce into styled spans — always produces <span data-offset> elements
  const fmtKey = (f: CharFmt) => `${f.bold ?? ''},${f.italic ?? ''},${f.strikethrough ?? ''},${f.color ?? ''},${f.fontSize ?? ''}`
  const segments: React.ReactNode[] = []
  let si = 0
  while (si < label.length) {
    // Handle newlines
    if (label[si] === '\n') {
      segments.push(<br key={`br-${si}`} />)
      si++
      continue
    }
    const key = fmtKey(chars[si])
    const start = si
    while (si < label.length && fmtKey(chars[si]) === key && label[si] !== '\n') si++
    const text = label.slice(start, si)
    const f = chars[start]
    const style: React.CSSProperties = {}
    if (f.bold) style.fontWeight = 'bold'
    if (f.italic) style.fontStyle = 'italic'
    if (f.strikethrough) style.textDecoration = 'line-through'
    if (f.color) style.color = f.color
    if (f.fontSize != null) style.fontSize = `${f.fontSize}px`
    segments.push(<span key={`s-${start}`} data-offset={start} style={Object.keys(style).length ? style : undefined}>{text}</span>)
  }
  return segments
}
