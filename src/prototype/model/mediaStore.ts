/**
 * Media blob store — keeps large media blobs out of the Zustand state tree.
 *
 * Instead of storing 100 MB+ base64 data URLs in node.mediaSrc (which are
 * re-processed on every React render / state update), we store a short
 * `blob:` object URL and keep the Blob here for later retrieval (e.g. save).
 */

const blobMap = new Map<string, Blob>()

/** Store a Blob, return an object URL suitable for <video>/<img>/<audio> src. */
export function storeMediaBlob(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  blobMap.set(url, blob)
  return url
}

/** Retrieve the original Blob for a blob: URL (for save/export). */
export function getMediaBlob(url: string): Blob | undefined {
  return blobMap.get(url)
}

/** Revoke an object URL and remove its Blob from the store. */
export function revokeMedia(url: string): void {
  if (blobMap.has(url)) {
    URL.revokeObjectURL(url)
    blobMap.delete(url)
  }
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
