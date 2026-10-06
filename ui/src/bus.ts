import { useSyncExternalStore } from 'react'
import { fromWire, type Frame } from '../shared/can'
import type { BusName, ClientMsg, ServerMsg, ServerStatus } from '../shared/bus'

type FrameListener = (frames: Frame[]) => void

const frameListeners: Record<BusName, Set<FrameListener>> = { port: new Set(), stbd: new Set() }
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
  sock.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMsg
    if (msg.type === 'status') return setStatus(msg)
    const listeners = frameListeners[msg.bus]
    if (listeners.size) {
      const frames = msg.frames.map(fromWire)
      listeners.forEach((l) => l(frames))
    }
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

export function onFrames(bus: BusName, listener: FrameListener) {
  frameListeners[bus].add(listener)
  return () => {
    frameListeners[bus].delete(listener)
  }
}

function subscribeStatus(l: () => void) {
  statusListeners.add(l)
  return () => {
    statusListeners.delete(l)
  }
}

export const useServerStatus = () => useSyncExternalStore(subscribeStatus, () => status)
