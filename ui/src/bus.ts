import { useSyncExternalStore } from 'react'
import type { ClientMsg, ServerMsg, ServerStatus } from '../shared/bus'
import { decodeCannelloni, type GatewayFrame } from '../shared/gateway'
import { LocalBus } from './localBus'

// The gateway's stream (binary messages), as the board will get it over UDP:
// decoded for the React display and the bench, and as packets for the Slint one
type GatewayListener = (frames: GatewayFrame[]) => void
type PacketListener = (bus: number, packet: Uint8Array) => void
const gatewayListeners = new Set<GatewayListener>()
const packetListeners = new Set<PacketListener>()
const statusListeners = new Set<() => void>()
let status: ServerStatus | null = null
let ws: WebSocket | null = null
let disposed = false

// Built for a static host (VITE_BUS=local): no bus server, so the page runs the sims
const local = import.meta.env.VITE_BUS === 'local' ? new LocalBus(receive, setStatus) : null

function setStatus(s: ServerStatus | null) {
  status = s
  statusListeners.forEach((l) => l())
}

// A bus's cannelloni packet, from the server or the local sims
function receive(bus: number, packet: Uint8Array) {
  packetListeners.forEach((l) => l(bus, packet))
  const frames = decodeCannelloni(bus, packet)
  if (frames) gatewayListeners.forEach((l) => l(frames))
}

function connect() {
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bus`)
  ws = sock
  sock.binaryType = 'arraybuffer'
  sock.onmessage = (e) => {
    // Binary: a bus number, then that bus's cannelloni packet
    if (e.data instanceof ArrayBuffer) {
      const msg = new Uint8Array(e.data)
      return receive(msg[0], msg.subarray(1))
    }
    // Text: status
    const msg = JSON.parse(e.data) as ServerMsg
    if (msg.type === 'status') setStatus(msg)
  }
  sock.onclose = () => {
    if (ws === sock) ws = null
    setStatus(null)
    if (!disposed) setTimeout(connect, 1000)
  }
}

if (!local) connect()

import.meta.hot?.dispose(() => {
  disposed = true
  ws?.close()
  local?.stop()
})

export function send(msg: ClientMsg) {
  if (local) local.handle(msg)
  else if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export function onGatewayPackets(listener: PacketListener) {
  packetListeners.add(listener)
  return () => {
    packetListeners.delete(listener)
  }
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
