import { useSyncExternalStore } from 'react'
import type { ClientMsg, ServerMsg, ServerStatus } from '../shared/bus'
import { decodeCannelloni, type GatewayFrame } from '../shared/gateway'

// The gateway's stream (binary messages), as the board will get it over UDP
type GatewayListener = (frames: GatewayFrame[]) => void
const gatewayListeners = new Set<GatewayListener>()
const statusListeners = new Set<() => void>()
let status: ServerStatus | null = null
let ws: WebSocket | null = null
let disposed = false

function setStatus(s: ServerStatus | null) {
  status = s
  statusListeners.forEach((l) => l())
}

function connect() {
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bus`)
  ws = sock
  sock.binaryType = 'arraybuffer'
  sock.onmessage = (e) => {
    // Binary: a bus number, then that bus's cannelloni packet
    if (e.data instanceof ArrayBuffer) {
      const msg = new Uint8Array(e.data)
      const frames = decodeCannelloni(msg[0], msg.subarray(1))
      return frames && gatewayListeners.forEach((l) => l(frames))
    }
    // Text: status (and per-side frames, which only the Slint build still reads)
    const msg = JSON.parse(e.data) as ServerMsg
    if (msg.type === 'status') setStatus(msg)
  }
  sock.onclose = () => {
    if (ws === sock) ws = null
    setStatus(null)
    if (!disposed) setTimeout(connect, 1000)
  }
}

connect()

import.meta.hot?.dispose(() => {
  disposed = true
  ws?.close()
})

export function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export function onGatewayFrames(listener: GatewayListener) {
  gatewayListeners.add(listener)
  return () => {
    gatewayListeners.delete(listener)
  }
}

function subscribeStatus(l: () => void) {
  statusListeners.add(l)
  return () => {
    statusListeners.delete(l)
  }
}

export const useServerStatus = () => useSyncExternalStore(subscribeStatus, () => status)
