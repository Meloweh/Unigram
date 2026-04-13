import express from 'express'
import cors from 'cors'
import { spawn } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { createReadStream } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const app = express()
app.use(cors())
app.use(express.json())

const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//

app.post('/api/youtube', (req, res) => {
  const { url } = req.body as { url?: string }
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "url" field' })
    return
  }
  if (!YOUTUBE_URL_RE.test(url)) {
    res.status(400).json({ error: 'URL must be a youtube.com or youtu.be link' })
    return
  }

  let tempDir: string | null = null
  let aborted = false

  // Detect actual client disconnect (not just request body consumed)
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
        '--', url,
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
      res.status(500).json({ error: `yt-dlp exited with code ${code}` })
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
      if (!res.headersSent) res.status(500).json({ error: 'Failed to read downloaded video' })
    })
  }

  run().catch((err) => {
    if (tempDir) rm(tempDir, { recursive: true }).catch(() => {})
    if (!res.headersSent) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({
        error: msg.includes('ENOENT')
          ? 'yt-dlp is not installed. Install it with: pip install yt-dlp'
          : `yt-dlp error: ${msg}`,
      })
    }
  })
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`[Unigram Server] YouTube proxy running on http://localhost:${PORT}`)
})
