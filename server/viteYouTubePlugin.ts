import type { Plugin } from 'vite'
import { spawn } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { createReadStream } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//

export default function youtubeProxyPlugin(): Plugin {
  return {
    name: 'youtube-proxy',
    configureServer(server) {
      server.middlewares.use('/api/youtube', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        // Parse JSON body
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          let url: string | undefined
          try {
            const parsed = JSON.parse(body)
            url = parsed.url
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid JSON body' }))
            return
          }

          if (!url || typeof url !== 'string') {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing or invalid "url" field' }))
            return
          }
          if (!YOUTUBE_URL_RE.test(url)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'URL must be a youtube.com or youtu.be link' }))
            return
          }

          let tempDir: string | null = null
          let aborted = false

          res.on('close', () => {
            if (!res.writableFinished) aborted = true
          })

          const run = async () => {
            tempDir = await mkdtemp(join(tmpdir(), 'unigram-yt-'))
            const outPath = join(tempDir, 'video.mp4')

            const code = await new Promise<number | null>((resolve, reject) => {
              const ytdlp = spawn('yt-dlp', [
                '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                '-o', outPath,
                '--no-playlist',
                '--merge-output-format', 'mp4',
                '--', url!,
              ])

              ytdlp.stderr.on('data', (data: Buffer) => {
                process.stderr.write(data)
              })

              ytdlp.on('error', reject)
              ytdlp.on('close', resolve)
            })

            if (aborted) {
              await rm(tempDir, { recursive: true }).catch(() => {})
              return
            }

            if (code !== 0) {
              await rm(tempDir, { recursive: true }).catch(() => {})
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `yt-dlp exited with code ${code}` }))
              return
            }

            res.setHeader('Content-Type', 'video/mp4')
            const stream = createReadStream(outPath)
            stream.pipe(res)
            stream.on('end', () => {
              rm(tempDir!, { recursive: true }).catch(() => {})
            })
            stream.on('error', () => {
              rm(tempDir!, { recursive: true }).catch(() => {})
              if (!res.headersSent) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Failed to read downloaded video' }))
              }
            })
          }

          run().catch((err) => {
            if (tempDir) rm(tempDir, { recursive: true }).catch(() => {})
            if (!res.headersSent) {
              const msg = err instanceof Error ? err.message : String(err)
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                error: msg.includes('ENOENT')
                  ? 'yt-dlp is not installed. Install it with: pip install yt-dlp'
                  : `yt-dlp error: ${msg}`,
              }))
            }
          })
        })
      })
    },
  }
}
