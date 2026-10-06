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
  type ServerMsg,
  type ServerStatus,
  type SimParams,
  type SourceKind,
} from '../shared/bus'
import { BatterySim } from './sim'
import { CandumpSource, ReplaySource, type Source } from './sources'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIRS = [path.join(root, 'logs'), path.resolve(root, '..')]
const PORT = Number(process.env.BUS_PORT ?? 5190)

const BASE: SimParams = {
  solarA: 0,
  propulsionA: 0,
  houseA: 0,
  tempC: 24,
  capacityAh: 280,
  bms: true,
  mppt: true,
  motor: true,
  charger: true,
  shore: false,
  chargerMaxA: 110,
}

const INITIAL: Record<BusName, { params: SimParams; soc: number }> = {
  port: { params: { ...BASE, solarA: 142, propulsionA: 170, houseA: 32 }, soc: 64 },
  stbd: { params: { ...BASE, solarA: 168, propulsionA: 125, houseA: 13 }, soc: 71 },
}

function listLogs() {
  return LOG_DIRS.filter(existsSync).flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /\.(txt|log|slcan)$/i.test(f))
      .map((f) => path.relative(root, path.join(dir, f))),
  )
}

class Bus {
  source: SourceKind = 'sim'
  external: Source | null = null
  pending: WireFrame[] = []
  sim: BatterySim
  fps = 0
  private count = 0

  constructor(readonly name: BusName) {
    this.sim = new BatterySim(INITIAL[name].params, INITIAL[name].soc)
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

for (const arg of process.argv.slice(2)) {
  const m = /^--(port|stbd)=(.+)$/.exec(arg)
  if (m) useSpec(buses[m[1] as BusName], m[2])
}

const wss = new WebSocketServer({ port: PORT, path: '/bus' })

function broadcast(msg: ServerMsg) {
  const s = JSON.stringify(msg)
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s)
}

const statusMsg = (): ServerStatus => ({
  type: 'status',
  buses: BUSES.map((b) => buses[b].status()),
  logs: listLogs(),
  speed: buses.port.sim.speed,
})

function handle(msg: ClientMsg) {
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
}, 20)

setInterval(() => broadcast(statusMsg()), 250)

console.log(`bus server ws://localhost:${PORT}/bus  ${BUSES.map((b) => `${b}=${buses[b].source}`).join('  ')}`)
