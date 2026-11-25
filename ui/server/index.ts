import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import type { WireFrame } from '../shared/can'
import {
  BUSES,
  BUS_IFACE,
  type BusName,
  type BusStatus,
  type ClientMsg,
  type GatewaySource,
  type ServerMsg,
  type ServerStatus,
  type SourceKind,
} from '../shared/bus'
import { Gateway } from './gateway'
import { RouterSource, UdpOut } from './router'
import type { BatterySim } from './sim'
import { allocationOf, applySimMsg, makeSims, packetFrames } from './simBench'
import { CandumpSource, ReplaySource, type Source } from './sources'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIRS = [path.join(root, 'logs'), path.resolve(root, '..')]
const PORT = Number(process.env.BUS_PORT ?? 5190)

function listLogs() {
  return LOG_DIRS.filter(existsSync).flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /\.(txt|log|slcan)$/i.test(f))
      .map((f) => path.relative(root, path.join(dir, f))),
  )
}

const gateway = new Gateway()
const sims = makeSims()

class Bus {
  source: SourceKind = 'sim'
  external: Source | null = null
  fps = 0
  private count = 0

  constructor(
    readonly name: BusName,
    readonly sim: BatterySim,
  ) {
    this.sim.run((f) => {
      if (this.source === 'sim') this.push(f)
    })
    setInterval(() => {
      this.fps = this.count
      this.count = 0
    }, 1000)
  }

  push = (f: WireFrame) => {
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

const buses = Object.fromEntries(BUSES.map((b) => [b, new Bus(b, sims[b])])) as Record<BusName, Bus>

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
  counts.set(bus, (counts.get(bus) ?? 0) + packetFrames(packet))
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
  gateway: { source: gatewaySource, fps, router: router.from, udpOut: udpOut?.address ?? null, local: false },
  logs: listLogs(),
  speed: buses.port.sim.speed,
  inlet: buses.port.sim.inlet,
})

function handle(msg: ClientMsg) {
  if (msg.type === 'gateway') return useGateway(msg.source)
  if (applySimMsg(sims, gateway, msg) || (msg.type !== 'tx' && msg.type !== 'source')) return
  const bus = buses[msg.bus]
  if (!bus) return
  if (msg.type === 'tx') msg.frames.forEach(bus.push)
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
  // The sims' frames as the router would send them (dropped while the real
  // router is the source)
  for (const { bus, packet } of gateway.flush()) {
    if (gatewaySource !== 'sim') continue
    forward(bus, packet)
    udpOut?.send(bus, packet)
  }
}, 20)

setInterval(() => gateway.allocation(allocationOf(sims)), 1000)

setInterval(() => broadcast(statusMsg()), 250)

console.log(`bus server ws://localhost:${PORT}/bus  ${BUSES.map((b) => `${b}=${buses[b].source}`).join('  ')}`)
