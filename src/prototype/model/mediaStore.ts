/**
 * Media blob store — keeps large media blobs out of the Zustand state tree.
 *
 * Small blobs (images, audio) are retained in a JS Map for fast sync access.
 * Large blobs (video >10 MB) are NOT retained — the browser keeps them alive
 * via the object URL.  On export they are fetched back from the URL.
 */

/** Threshold above which we don't retain the Blob in JS heap (10 MB). */
const RETAIN_LIMIT = 10 * 1024 * 1024

const blobMap = new Map<string, Blob>()
const mimeMap = new Map<string, string>()

/** Store a Blob, return an object URL suitable for <video>/<img>/<audio> src. */
export function storeMediaBlob(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  mimeMap.set(url, blob.type)
  if (blob.size <= RETAIN_LIMIT) {
    blobMap.set(url, blob)
  }
  // For large blobs the object URL keeps the data alive in native memory;
  // we intentionally do NOT hold a JS reference.
  return url
}

/** Retrieve the Blob synchronously (only available for small blobs). */
export function getMediaBlob(url: string): Blob | undefined {
  return blobMap.get(url)
}

/** Retrieve the Blob for any blob URL (fetches from browser if not retained). */
export async function fetchMediaBlob(url: string): Promise<Blob | undefined> {
  const cached = blobMap.get(url)
  if (cached) return cached
  try {
    const resp = await fetch(url)
    return await resp.blob()
  } catch {
    return undefined
  }
}

/** Return the MIME type stored for a blob URL (synchronous, lightweight). */
export function getMediaMime(url: string): string | undefined {
  return mimeMap.get(url)
}

/** Revoke an object URL and remove its data from the store. */
export function revokeMedia(url: string): void {
  URL.revokeObjectURL(url)
  blobMap.delete(url)
  mimeMap.delete(url)
}

/** Convert a data URL string to a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.substring(0, comma)     // "data:mime;base64"
  const mime = meta.split(':')[1].split(';')[0]
  const b64 = dataUrl.substring(comma + 1)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Returns true if the string is a blob: object URL managed by this store. */
export function isBlobUrl(url: string): boolean {
  return url.startsWith('blob:')
}
