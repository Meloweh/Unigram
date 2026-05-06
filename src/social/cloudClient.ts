export interface DiagramSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  visits: number
  popularity: number
}

export interface DiagramDetail extends DiagramSummary {
  bundleBase64?: string
}

export async function searchCloudDiagrams(query: string): Promise<DiagramSummary[]> {
  const res = await fetch(`/api/diagrams?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const body = await res.json() as { diagrams?: DiagramSummary[] }
  return Array.isArray(body.diagrams) ? body.diagrams : []
}

export async function createCloudDiagram(title: string): Promise<DiagramSummary> {
  const res = await fetch('/api/diagrams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`Diagram creation failed (${res.status})`)
  return await res.json() as DiagramSummary
}

export async function getCloudDiagram(id: string): Promise<DiagramDetail> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Diagram load failed (${res.status})`)
  return await res.json() as DiagramDetail
}

export async function saveCloudDiagram(
  id: string,
  payload: { title: string; bundleBase64: string },
): Promise<DiagramSummary> {
  const res = await fetch(`/api/diagrams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Diagram save failed (${res.status})`)
  return await res.json() as DiagramSummary
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let raw = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i])
  return btoa(raw)
}

export function base64ToBlob(value: string, type = 'application/zip'): Blob {
  const raw = atob(value)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new Blob([bytes], { type })
}
