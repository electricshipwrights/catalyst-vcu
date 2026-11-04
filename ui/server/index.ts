import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import type { WireFrame } from '../shared/can'
import {
  BUSES,
  BUS_IFACE,
  SIM_SPEEDS,
  type BusName,
  type BusStatus,
  type ClientMsg,
  type GatewaySource,
  type ServerMsg,
  type ServerStatus,
  type SimParams,
  type SourceKind,
} from '../shared/bus'
import type { Bank } from '../shared/gateway'
import { VESSEL } from '../shared/vessel'
import { Gateway } from './gateway'
import { RouterSource, UdpOut } from './router'
import { BatterySim } from './sim'
import { CandumpSource, ReplaySource, type Source } from './sources'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIRS = [path.join(root, 'logs'), path.resolve(root, '..')]
const PORT = Number(process.env.BUS_PORT ?? 5190)

const BASE: SimParams = {
  panelA: [26, 26, 29, 29],
  propulsionA: 0,
  houseA: 0,
  heaterA: 0,
  inverterA: 0,
  mppts: [],
  tempC: 24,
  capacityAh: VESSEL.capacityAh,
  bms: true,
  mppt: true,
  charger: true,
  shore: false,
}

const INITIAL: Record<BusName, { params: SimParams; soc: number }> = {
  port: { params: { ...BASE, propulsionA: 70, houseA: 3, mppts: [0, 1] }, soc: 64 },
  stbd: { params: { ...BASE, propulsionA: 65, houseA: 15, mppts: [2, 3] }, soc: 71 },
}

function listLogs() {
  return LOG_DIRS.filter(existsSync).flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /\.(txt|log|slcan)$/i.test(f))
      .map((f) => path.relative(root, path.join(dir, f))),
  )
}

const gateway = new Gateway()

class Bus {
  source: SourceKind = 'sim'
  external: Source | null = null
  pending: WireFrame[] = []
  sim: BatterySim
  fps = 0
  private count = 0

  constructor(readonly name: BusName) {
    this.sim = new BatterySim(name, INITIAL[name].params, INITIAL[name].soc)
    this.sim.run((f) => {
      if (this.source === 'sim') this.push(f)
    })
    setInterval(() => {
      this.fps = this.count
      this.count = 0
    }, 1000)
  }

  push = (f: WireFrame) => {
    this.pending.push(f)
    gateway.push(this.name, f)
    this.count++
  }

  use(kind: SourceKind, external: Source | null = null) {
    this.external?.stop()
    this.external = external
    this.source = kind
    external?.start(this.push)
  }

  status(): BusStatus {
    return { bus: this.name, source: this.source, fps: this.fps, sim: this.sim.truth(), ...this.external?.status() }
  }
}

const buses = Object.fromEntries(BUSES.map((b) => [b, new Bus(b)])) as Record<BusName, Bus>

function useSpec(bus: Bus, spec: string) {
  const [kind, arg] = spec.split(/:(.*)/s)
  if (kind === 'sim' || kind === 'off') bus.use(kind)
  else if (kind === 'replay' && arg) bus.use('replay', new ReplaySource(path.resolve(arg)))
  else if (kind === 'candump') bus.use('candump', new CandumpSource(arg || BUS_IFACE[bus.name]))
  else throw new Error(`unknown source "${spec}" (sim | off | replay:<file> | candump[:iface])`)
}

// The gateway stream: the sims (as the router would send them) or the real router
let gatewaySource: GatewaySource = 'sim'
const router = new RouterSource()
let udpOut: UdpOut | null = null
const counts = new Map<number, number>()
let fps: Record<number, number> = {}

function useGateway(source: GatewaySource) {
  if (source === gatewaySource) return
  gatewaySource = source
  if (source === 'router') router.start(forward)
  else router.stop()
}

for (const arg of process.argv.slice(2)) {
  const m = /^--(port|stbd)=(.+)$/.exec(arg)
  if (m) useSpec(buses[m[1] as BusName], m[2])
  if (arg === '--gateway=router') useGateway('router')
  const udp = /^--udp(?:=(.+))?$/.exec(arg)
  if (udp) udpOut = new UdpOut(udp[1] ?? '255.255.255.255')
}

const wss = new WebSocketServer({ port: PORT, path: '/bus' })

function broadcast(msg: ServerMsg) {
  const s = JSON.stringify(msg)
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s)
}

// A bus's cannelloni packet to the browsers, as a binary message: the bus
// number (its UDP port − 20000), then the packet
function forward(bus: number, packet: Uint8Array) {
  counts.set(bus, (counts.get(bus) ?? 0) + ((packet[3] << 8) | packet[4]))
  const msg = new Uint8Array(1 + packet.length)
  msg[0] = bus
  msg.set(packet, 1)
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg)
}

setInterval(() => {
  fps = Object.fromEntries(counts)
  counts.clear()
}, 1000)

const statusMsg = (): ServerStatus => ({
  type: 'status',
  buses: BUSES.map((b) => buses[b].status()),
  gateway: { source: gatewaySource, fps, router: router.from, udpOut: udpOut?.address ?? null },
  logs: listLogs(),
  speed: buses.port.sim.speed,
})

// Which side each MPPT is on, from the sims (the gateway's own frame)
const allocation = (): Bank[] =>
  [0, 1, 2, 3].map((i) => BUSES.find((b) => buses[b].sim.params.mppts.includes(i)) ?? 'none')

function handle(msg: ClientMsg) {
  if (msg.type === 'gateway') return useGateway(msg.source)
  if (msg.type === 'allocation') {
    BUSES.forEach((b) => buses[b].sim.patch({ mppts: msg.sides.flatMap((s, i) => (s === b ? [i] : [])) }))
    gateway.allocation(allocation())
    return
  }
  if (msg.type === 'panels') {
    if (msg.a.length === 4) BUSES.forEach((b) => buses[b].sim.patch({ panelA: msg.a.map((a) => Math.min(100, Math.max(0, Number(a) || 0))) }))
    return
  }
  if (msg.type === 'speed') {
    if (SIM_SPEEDS.includes(msg.speed)) BUSES.forEach((b) => (buses[b].sim.speed = msg.speed))
    return
  }
  const bus = buses[msg.bus]
  if (!bus) return
  if (msg.type === 'sim') bus.sim.patch(msg.patch)
  else if (msg.type === 'tx') msg.frames.forEach(bus.push)
  else if (msg.source === 'replay') {
    if (!listLogs().includes(msg.file)) return
    const file = path.join(root, msg.file)
    if (bus.external instanceof ReplaySource && bus.external.file === file) bus.external.speed = msg.speed
    else bus.use('replay', new ReplaySource(file, msg.speed))
  } else bus.use(msg.source)
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify(statusMsg()))
  ws.on('message', (raw) => {
    try {
      handle(JSON.parse(raw.toString()))
    } catch (e) {
      console.error('bad client message', e)
    }
  })
})

setInterval(() => {
  for (const b of BUSES) {
    const bus = buses[b]
    if (!bus.pending.length) continue
    broadcast({ type: 'frames', bus: b, frames: bus.pending })
    bus.pending = []
  }
  // The sims' frames as the router would send them (dropped while the real
  // router is the source)
  for (const { bus, packet } of gateway.flush()) {
    if (gatewaySource !== 'sim') continue
    forward(bus, packet)
    udpOut?.send(bus, packet)
  }
}, 20)

setInterval(() => gateway.allocation(allocation()), 1000)

setInterval(() => broadcast(statusMsg()), 250)

console.log(`bus server ws://localhost:${PORT}/bus  ${BUSES.map((b) => `${b}=${buses[b].source}`).join('  ')}`)
