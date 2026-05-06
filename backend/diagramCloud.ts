import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export interface StoredDiagram {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  visits: number
  popularity: number
  bundleBase64?: string
}

interface DiagramDb {
  diagrams: StoredDiagram[]
}

const DB_DIR = '.omnigram-cloud'
const DB_FILE = 'diagrams.json'
const MAX_BODY_BYTES = 40 * 1024 * 1024

export function diagramCloudPlugin(): Plugin {
  return {
    name: 'omnigram-diagram-cloud-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/diagrams', async (req, res) => {
        try {
          await handleDiagramsRequest(req, res)
        } catch (err) {
          if (err instanceof NotFoundError) {
            sendJson(res, 404, { error: err.message })
            return
          }
          if (err instanceof BadRequestError) {
            sendJson(res, 400, { error: err.message })
            return
          }
          console.error('Diagram cloud API failed:', err)
          sendJson(res, 500, { error: 'Internal diagram cloud error' })
        }
      })
    },
  }
}

async function handleDiagramsRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://omnigram.local')
  const id = url.pathname.replace(/^\/+/, '')
  if (req.method === 'GET' && id === '') {
    const query = url.searchParams.get('q') ?? ''
    const diagrams = await listDiagrams(query)
    sendJson(res, 200, { diagrams: diagrams.map(withoutBundle) })
    return
  }

  if (req.method === 'POST' && id === '') {
    const body = await readJsonBody<{ title?: unknown }>(req)
    const title = typeof body.title === 'string' && body.title.trim().length > 0
      ? body.title.trim()
      : 'Untitled diagram'
    const diagram = await createDiagram(title)
    sendJson(res, 201, withoutBundle(diagram))
    return
  }

  if (req.method === 'GET' && id !== '') {
    const diagram = await getDiagram(id)
    sendJson(res, 200, diagram)
    return
  }

  if (req.method === 'PUT' && id !== '') {
    const body = await readJsonBody<{ title?: unknown; bundleBase64?: unknown }>(req)
    const title = typeof body.title === 'string' ? body.title.trim() : undefined
    const bundleBase64 = typeof body.bundleBase64 === 'string' ? body.bundleBase64 : undefined
    const diagram = await updateDiagram(id, { title, bundleBase64 })
    sendJson(res, 200, withoutBundle(diagram))
    return
  }

  sendJson(res, 405, { error: 'Method not allowed' })
}

async function listDiagrams(query: string): Promise<StoredDiagram[]> {
  const db = await readDb()
  const q = query.trim().toLowerCase()
  const all = db.diagrams
  const filtered = q.length === 0
    ? all
    : all.filter((diagram) => diagram.title.toLowerCase().includes(q))
  return filtered
    .sort((a, b) => b.popularity - a.popularity || b.visits - a.visits || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
}

async function createDiagram(title: string): Promise<StoredDiagram> {
  const db = await readDb()
  const now = new Date().toISOString()
  const diagram: StoredDiagram = {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    visits: 0,
    popularity: 0,
  }
  db.diagrams.push(diagram)
  await writeDb(db)
  return diagram
}

async function getDiagram(id: string): Promise<StoredDiagram> {
  const db = await readDb()
  const diagram = db.diagrams.find((item) => item.id === id)
  if (!diagram) throw new NotFoundError('Diagram not found')
  diagram.visits += 1
  diagram.updatedAt = new Date().toISOString()
  await writeDb(db)
  return diagram
}

async function updateDiagram(id: string, patch: { title?: string; bundleBase64?: string }): Promise<StoredDiagram> {
  const db = await readDb()
  const diagram = db.diagrams.find((item) => item.id === id)
  if (!diagram) throw new NotFoundError('Diagram not found')
  if (patch.title && patch.title.length > 0) diagram.title = patch.title
  if (patch.bundleBase64 !== undefined) diagram.bundleBase64 = patch.bundleBase64
  diagram.updatedAt = new Date().toISOString()
  diagram.popularity = Math.max(diagram.popularity, diagram.visits)
  await writeDb(db)
  return diagram
}

function withoutBundle(diagram: StoredDiagram): Omit<StoredDiagram, 'bundleBase64'> {
  const { bundleBase64, ...summary } = diagram
  void bundleBase64
  return summary
}

async function readDb(): Promise<DiagramDb> {
  const file = dbPath()
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as Partial<DiagramDb>
    return { diagrams: Array.isArray(parsed.diagrams) ? parsed.diagrams : [] }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { diagrams: [] }
    throw err
  }
}

async function writeDb(db: DiagramDb): Promise<void> {
  await mkdir(join(process.cwd(), DB_DIR), { recursive: true })
  await writeFile(dbPath(), `${JSON.stringify(db, null, 2)}\n`, 'utf8')
}

function dbPath(): string {
  return join(process.cwd(), DB_DIR, DB_FILE)
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_BODY_BYTES) throw new BadRequestError('Request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new BadRequestError('Invalid JSON request body')
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(raw))
  res.end(raw)
}

class NotFoundError extends Error {}
class BadRequestError extends Error {}
