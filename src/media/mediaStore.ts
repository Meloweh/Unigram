/**
 * In-memory media blob store with content-hash deduplication.
 *
 * Ports the legacy [src/old/model/mediaStore.ts](../old/model/mediaStore.ts)
 * Map<url, Blob> registry and adds a SHA-256 dedup layer so importing the
 * same image / audio / video twice yields one URL (and one entry in any
 * exported `.unigram` bundle — see [model/projectBundle.ts](../model/projectBundle.ts)).
 *
 * Hash strategy: SHA-256 over the **first 64 KiB** of the blob plus its
 * `size` and `type`. Cheap (< 1 ms for typical media), avoids reading the
 * full file into memory for large videos, and collisions on the prefix
 * are vanishingly rare given the size+type tiebreakers. Tests cover the
 * "same blob → same url" guarantee.
 *
 * Retention: the legacy 10 MB soft cap is preserved (older entries are
 * dropped when the running byte total exceeds the threshold). Dropped
 * URLs are revoked via `URL.revokeObjectURL` so the browser releases the
 * underlying memory.
 */

const RETAIN_LIMIT_BYTES = 10 * 1024 * 1024

interface Entry {
  url: string
  blob: Blob
  insertedAt: number
}

// Insertion-ordered map → oldest-first iteration for retention pruning.
const byUrl = new Map<string, Entry>()
const byHash = new Map<string, string>()
let totalBytes = 0

/**
 * Compute a stable content key for a blob. Reads up to 64 KiB and hashes
 * the bytes alongside the blob's size and MIME type. Returns a hex string.
 */
async function hashBlob(blob: Blob): Promise<string> {
  const head = await blob.slice(0, 64 * 1024).arrayBuffer()
  const buf = new ArrayBuffer(head.byteLength + 16)
  const view = new DataView(buf)
  new Uint8Array(buf, 0, head.byteLength).set(new Uint8Array(head))
  view.setFloat64(head.byteLength, blob.size, true)
  // Encode the type into the trailing 8 bytes via a stable cheap fold.
  const t = blob.type || ''
  let acc = 0
  for (let i = 0; i < t.length; i++) acc = ((acc * 31) | 0) + t.charCodeAt(i)
  view.setInt32(head.byteLength + 8, acc | 0, true)
  view.setInt32(head.byteLength + 12, t.length, true)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Store a media blob. Returns the canonical URL; if the same content has
 * been stored before, returns the existing URL without creating a new
 * object URL (so React refs and node `mediaSrc` stay stable across edits).
 */
export async function storeMediaBlob(blob: Blob): Promise<string> {
  const hash = await hashBlob(blob)
  const existing = byHash.get(hash)
  if (existing && byUrl.has(existing)) return existing
  const url = URL.createObjectURL(blob)
  const entry: Entry = { url, blob, insertedAt: Date.now() }
  byUrl.set(url, entry)
  byHash.set(hash, url)
  totalBytes += blob.size
  pruneIfOver()
  return url
}

/**
 * Retrieve a previously-stored blob by URL. Returns null when the URL is
 * unknown (dropped by retention or never stored).
 */
export function getMediaBlob(url: string): Blob | null {
  return byUrl.get(url)?.blob ?? null
}

/**
 * Fetch a blob from any URL (data:, blob:, http:) and stash it through the
 * dedup layer. Useful for legacy-bundle import where the source is a
 * data-URI.
 */
export async function fetchMediaBlob(src: string): Promise<string> {
  const res = await fetch(src)
  const blob = await res.blob()
  return storeMediaBlob(blob)
}

/** Best-effort MIME lookup for a stored URL. Returns '' when unknown. */
export function getMediaMime(url: string): string {
  return byUrl.get(url)?.blob.type ?? ''
}

/**
 * Clear all stored blobs and revoke their object URLs. Test-only escape
 * hatch; production code should rely on the retention pruner.
 */
export function clearMediaStore(): void {
  for (const e of byUrl.values()) URL.revokeObjectURL(e.url)
  byUrl.clear()
  byHash.clear()
  totalBytes = 0
}

function pruneIfOver(): void {
  if (totalBytes <= RETAIN_LIMIT_BYTES) return
  // Drop oldest entries until we're back under the cap. Reverse-lookup
  // the hash map to clear stale entries.
  for (const [url, entry] of byUrl) {
    if (totalBytes <= RETAIN_LIMIT_BYTES) break
    URL.revokeObjectURL(url)
    byUrl.delete(url)
    totalBytes -= entry.blob.size
    for (const [hash, mappedUrl] of byHash) {
      if (mappedUrl === url) { byHash.delete(hash); break }
    }
  }
}
