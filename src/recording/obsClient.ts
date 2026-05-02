/**
 * OBS WebSocket v5 client (recording control only).
 * Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 *
 * Ported from `src/old/flow/obsWebSocket.ts`. We expose a tiny surface:
 * connect → start/stop record → close. No event subscriptions, no scene
 * switching — recording is the only thing this app needs.
 */

const OP_HELLO = 0
const OP_IDENTIFY = 1
const OP_IDENTIFIED = 2
const OP_REQUEST = 6
const OP_REQUEST_RESPONSE = 7

interface ObsMessage {
  op: number
  d: Record<string, unknown>
}

async function computeAuth(password: string, salt: string, challenge: string): Promise<string> {
  const enc = new TextEncoder()
  const step1 = await crypto.subtle.digest('SHA-256', enc.encode(password + salt))
  const step1b64 = btoa(String.fromCharCode(...new Uint8Array(step1)))
  const step2 = await crypto.subtle.digest('SHA-256', enc.encode(step1b64 + challenge))
  return btoa(String.fromCharCode(...new Uint8Array(step2)))
}

export interface ObsConnection {
  request: (type: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>>
  close: () => void
}

export function connectObs(host: string, port: number, password: string): Promise<ObsConnection> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(`ws://${host}:${port}`)
    } catch {
      reject(new Error('Failed to open OBS WebSocket'))
      return
    }
    const pending = new Map<
      string,
      { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
    >()
    let counter = 0
    const request = (type: string, data?: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((res, rej) => {
        const requestId = `req_${++counter}`
        pending.set(requestId, { resolve: res, reject: rej })
        ws.send(
          JSON.stringify({
            op: OP_REQUEST,
            d: { requestType: type, requestId, ...(data ? { requestData: data } : {}) },
          } satisfies ObsMessage),
        )
      })
    const close = () => {
      try { ws.close() } catch { /* ignore */ }
    }
    ws.onclose = () => {
      for (const p of pending.values()) p.reject(new Error('OBS WebSocket closed'))
      pending.clear()
    }
    ws.onerror = () => reject(new Error('OBS WebSocket connect failed (is OBS running with WS enabled?)'))
    ws.onmessage = async (event) => {
      let msg: ObsMessage
      try { msg = JSON.parse(event.data as string) as ObsMessage } catch { return }
      if (msg.op === OP_HELLO) {
        const auth = msg.d.authentication as { challenge: string; salt: string } | undefined
        const identify: ObsMessage = { op: OP_IDENTIFY, d: { rpcVersion: 1 } }
        if (auth && password) {
          ;(identify.d as Record<string, unknown>).authentication = await computeAuth(
            password,
            auth.salt,
            auth.challenge,
          )
        }
        ws.send(JSON.stringify(identify))
      } else if (msg.op === OP_IDENTIFIED) {
        resolve({ request, close })
      } else if (msg.op === OP_REQUEST_RESPONSE) {
        const requestId = msg.d.requestId as string
        const p = pending.get(requestId)
        if (!p) return
        pending.delete(requestId)
        const status = msg.d.requestStatus as { result: boolean; code: number; comment?: string }
        if (status?.result) p.resolve((msg.d.responseData as Record<string, unknown>) ?? {})
        else p.reject(new Error(status?.comment ?? `OBS request failed (code ${status?.code})`))
      }
    }
  })
}

/** Convenience helpers — fire-and-forget recording toggles. */
export async function obsStartRecord(c: ObsConnection): Promise<void> {
  await c.request('StartRecord')
}

export async function obsStopRecord(c: ObsConnection): Promise<string | undefined> {
  const r = await c.request('StopRecord')
  return r.outputPath as string | undefined
}
