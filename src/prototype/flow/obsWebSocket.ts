/**
 * Minimal OBS WebSocket v5 client for controlling recording.
 * Protocol reference: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 */

// OBS WebSocket v5 opcodes
const OP_HELLO = 0
const OP_IDENTIFY = 1
const OP_IDENTIFIED = 2
const OP_REQUEST = 6
const OP_REQUEST_RESPONSE = 7

interface OBSMessage {
  op: number
  d: Record<string, unknown>
}

/**
 * Compute the OBS WebSocket v5 authentication string.
 * auth = base64(SHA256(base64(SHA256(password + salt)) + challenge))
 */
async function computeAuth(password: string, salt: string, challenge: string): Promise<string> {
  const enc = new TextEncoder()
  const step1 = await crypto.subtle.digest('SHA-256', enc.encode(password + salt))
  const step1b64 = btoa(String.fromCharCode(...new Uint8Array(step1)))
  const step2 = await crypto.subtle.digest('SHA-256', enc.encode(step1b64 + challenge))
  return btoa(String.fromCharCode(...new Uint8Array(step2)))
}

export interface OBSConnection {
  ws: WebSocket
  request: (requestType: string, requestData?: Record<string, unknown>) => Promise<Record<string, unknown>>
  close: () => void
}

/**
 * Connect to OBS WebSocket, authenticate, and return a connection handle.
 */
export function connectOBS(host: string, port: number, password: string): Promise<OBSConnection> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(`ws://${host}:${port}`)
    } catch {
      reject(new Error('Failed to create WebSocket connection to OBS'))
      return
    }

    const pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>()
    let reqCounter = 0

    const request = (requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> => {
      return new Promise((res, rej) => {
        const requestId = `req_${++reqCounter}`
        pending.set(requestId, { resolve: res, reject: rej })
        const msg: OBSMessage = {
          op: OP_REQUEST,
          d: { requestType, requestId, ...(requestData ? { requestData } : {}) },
        }
        ws.send(JSON.stringify(msg))
      })
    }

    const close = () => {
      try { ws.close() } catch { /* ignore */ }
    }

    ws.onclose = () => {
      for (const p of pending.values()) p.reject(new Error('OBS WebSocket closed'))
      pending.clear()
    }

    ws.onerror = () => {
      reject(new Error('Could not connect to OBS WebSocket. Is OBS running with WebSocket enabled?'))
    }

    ws.onmessage = async (event) => {
      let msg: OBSMessage
      try {
        msg = JSON.parse(event.data as string) as OBSMessage
      } catch {
        return
      }

      if (msg.op === OP_HELLO) {
        const auth = msg.d.authentication as { challenge: string; salt: string } | undefined
        const identifyMsg: OBSMessage = {
          op: OP_IDENTIFY,
          d: { rpcVersion: 1 },
        }
        if (auth && password) {
          (identifyMsg.d as Record<string, unknown>).authentication = await computeAuth(password, auth.salt, auth.challenge)
        }
        ws.send(JSON.stringify(identifyMsg))
      } else if (msg.op === OP_IDENTIFIED) {
        resolve({ ws, request, close })
      } else if (msg.op === OP_REQUEST_RESPONSE) {
        const requestId = msg.d.requestId as string
        const p = pending.get(requestId)
        if (p) {
          pending.delete(requestId)
          const status = msg.d.requestStatus as { result: boolean; code: number; comment?: string }
          if (status?.result) {
            p.resolve((msg.d.responseData as Record<string, unknown>) ?? {})
          } else {
            p.reject(new Error(status?.comment ?? `OBS request failed (code ${status?.code})`))
          }
        }
      }
    }
  })
}
