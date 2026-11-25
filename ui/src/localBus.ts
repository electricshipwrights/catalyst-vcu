// The bench without a bus server, for a static host (built with VITE_BUS=local):
// the page runs both sims and the gateway stand-in itself, and hands bus.ts
// the same packets and status the server would. Replay, candump and the real
// router need the server.
import { BUSES, type BusName, type ClientMsg, type ServerStatus } from '../shared/bus'
import type { WireFrame } from '../shared/can'
import { Gateway } from '../server/gateway'
import { allocationOf, applySimMsg, makeSims, packetFrames } from '../server/simBench'

export class LocalBus {
  private gateway = new Gateway()
  private sims = makeSims()
  private sources: Record<BusName, 'sim' | 'off'> = { port: 'sim', stbd: 'sim' }
  private counts: Record<BusName, number> = { port: 0, stbd: 0 }
  private fps: Record<BusName, number> = { port: 0, stbd: 0 }
  private gatewayCounts = new Map<number, number>()
  private gatewayFps: Record<number, number> = {}
  private timers: ReturnType<typeof setInterval>[] = []

  constructor(
    onPacket: (bus: number, packet: Uint8Array) => void,
    onStatus: (s: ServerStatus) => void,
  ) {
    for (const b of BUSES) this.sims[b].run((f) => this.sources[b] === 'sim' && this.push(b, f))
    const every = (ms: number, fn: () => void) => this.timers.push(setInterval(fn, ms))
    every(20, () => {
      for (const { bus, packet } of this.gateway.flush()) {
        this.gatewayCounts.set(bus, (this.gatewayCounts.get(bus) ?? 0) + packetFrames(packet))
        onPacket(bus, packet)
      }
    })
    every(1000, () => {
      this.gateway.allocation(allocationOf(this.sims))
      this.gateway.time(this.sims.port.clock())
      this.fps = { ...this.counts }
      this.counts = { port: 0, stbd: 0 }
      this.gatewayFps = Object.fromEntries(this.gatewayCounts)
      this.gatewayCounts.clear()
    })
    every(250, () => onStatus(this.status()))
    onStatus(this.status())
  }

  private push(bus: BusName, f: WireFrame) {
    this.gateway.push(bus, f)
    this.counts[bus]++
  }

  handle(msg: ClientMsg) {
    if (applySimMsg(this.sims, this.gateway, msg)) return
    if (msg.type === 'tx') msg.frames.forEach((f) => this.push(msg.bus, f))
    else if (msg.type === 'source' && msg.source !== 'replay') this.sources[msg.bus] = msg.source
  }

  status(): ServerStatus {
    return {
      type: 'status',
      buses: BUSES.map((b) => ({ bus: b, source: this.sources[b], fps: this.fps[b], sim: this.sims[b].truth() })),
      gateway: { source: 'sim', fps: this.gatewayFps, router: null, udpOut: null, local: true },
      logs: [],
      speed: this.sims.port.speed,
      inlet: this.sims.port.inlet,
    }
  }

  stop() {
    this.timers.forEach(clearInterval)
    BUSES.forEach((b) => this.sims[b].stop())
  }
}
