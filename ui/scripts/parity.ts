// Runs a scripted 220-second scenario through the prototype's display logic
// and writes the frames plus every 10 Hz reading to a fixture. The Rust port
// (app/core/tests/parity.rs) replays the same frames and must match.
//
//   pnpm parity

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toHex, type Frame } from '../shared/can'
import {
  ELCON_FLAGS,
  ELCON_STATUS,
  MOTOR_STATUS,
  ORION_LIMITS,
  ORION_PACK,
  ORION_RELAYS_DEFAULT,
  PGN_BATTERY_STATUS,
  encodeBatteryStatus,
  encodeElconStatus,
  encodeMotorStatus,
  encodeOrionLimits,
  encodeOrionPack,
  n2kId,
} from '../shared/protocol'
import { EtaHold } from '../src/display/etaHold'
import { powerView, type PowerView } from '../src/display/power'
import { emptyRaw, ingest, read, type Currents } from '../src/display/sideState'
import { StepFilter } from '../src/display/stepFilter'
import type { SideReading } from '../src/display/useSide'

const END_MS = 220_000
const TICK_MS = 100

// Scenario, in seconds
const bmsOn = (t: number) => (t >= 3 && t < 100) || t >= 112
const soc = (t: number) => (t < 60 ? 64 - 0.02 * t : t < 100 ? Math.min(100, 98.8 + (t - 60) * 0.05) : 41 - 0.01 * (t - 112))
// From 180 s: the bench's "Full throttle" preset (solar 55, propulsion 320, house 10)
const fullThrottle = (t: number) => t >= 180
// Two MPPTs per side, about 34 A each at full sun
const solar22 = (t: number) => (fullThrottle(t) ? 30 + 3 * Math.sin(t / 3) : t < 130 ? 32 + 3 * Math.sin(t / 3) : 0.3)
const solar23 = (t: number) => (t < 40 ? 30 + 2 * Math.sin(t / 5) : null)
const motorOn = (t: number) => (t >= 3 && t < 110) || fullThrottle(t)
const propulsion = (t: number) =>
  !motorOn(t) || (t >= 60 && t < 100)
    ? 0
    : fullThrottle(t)
      ? 320 + 4 * Math.sin(t * 2)
      : t < 10
        ? 0
        : t < 25
          ? 300 + 3 * Math.sin(t * 2)
          : 70 + Math.sin(t)
const chargerOn = (t: number) => t >= 60 && t < 100
const shore = (t: number) => t < 90
const charger = (t: number) => (chargerOn(t) && shore(t) ? 40 : 0)
const house = (t: number) => (fullThrottle(t) ? 10 : t < 150 ? 12 : 0.4)
const packA = (t: number) => propulsion(t) + house(t) - solar22(t) - (solar23(t) ?? 0) - charger(t)

type Timed = { at: number; frame: Frame }
const frames: Timed[] = []
const push = (at: number, id: number, ext: boolean, data: Uint8Array) => frames.push({ at, frame: { id, ext, data, t: at } })

for (let k = 0; k * TICK_MS < END_MS; k++) {
  const at = k * TICK_MS + 37
  const t = at / 1000
  if (bmsOn(t)) {
    const d = encodeOrionPack({ packA: packA(t), packV: 52 + soc(t) / 50, soc: soc(t), relays: ORION_RELAYS_DEFAULT })
    if (k % 50 === 0) d[7] ^= 0xff
    push(at, ORION_PACK, false, d)
  }
  const mt = (k * TICK_MS + 55) / 1000
  if (motorOn(mt)) push(k * TICK_MS + 55, MOTOR_STATUS, false, encodeMotorStatus({ a: propulsion(mt) }))
}

for (let s = 0; s * 1000 < END_MS; s++) {
  const at22 = s * 1000 + 210
  push(at22, n2kId(PGN_BATTERY_STATUS, 0x22), true, encodeBatteryStatus({ instance: 0, v: 52.1, a: solar22(at22 / 1000), tempC: null, sid: s }))
  const t23 = (s * 1000 + 640) / 1000
  const s23 = solar23(t23)
  if (s23 != null) push(s * 1000 + 640, n2kId(PGN_BATTERY_STATUS, 0x23), true, encodeBatteryStatus({ instance: 1, v: 52.1, a: s23, tempC: 31, sid: s }))
  // Ignored: a source that isn't an MPPT, and a status with no current
  push(s * 1000 + 300, n2kId(PGN_BATTERY_STATUS, 0x30), true, encodeBatteryStatus({ instance: 2, v: 52.1, a: 99, tempC: null, sid: s }))
  if (s === 50) push(s * 1000 + 310, n2kId(PGN_BATTERY_STATUS, 0x22), true, encodeBatteryStatus({ instance: 0, v: 52.1, a: null, tempC: null, sid: s }))
  const tl = (s * 1000 + 770) / 1000
  if (bmsOn(tl)) push(s * 1000 + 770, ORION_LIMITS, false, encodeOrionLimits({ dcl: 494, ccl: 182, tHi: 31, tLo: 24 }))
  const tc = (s * 1000 + 500) / 1000
  if (chargerOn(tc)) {
    const flags = shore(tc) ? 0 : ELCON_FLAGS.inputVoltage | ELCON_FLAGS.stopped
    push(s * 1000 + 500, ELCON_STATUS, true, encodeElconStatus({ v: 54.2, a: charger(tc), flags }))
  }
}

frames.sort((a, b) => a.at - b.at)

// Mirrors the interval body of useSide()
const raw = emptyRaw()
const filters = { solarA: new StepFilter(), chargerA: new StepFilter(), propulsionA: new StepFilter(), houseA: new StepFilter() }
const etaHold = new EtaHold()

function tick(now: number): SideReading {
  const r = read(raw, now)
  if (!r.online) {
    Object.values(filters).forEach((f) => f.clear())
    etaHold.clear()
    return r
  }
  const smooth: Currents = {
    solarA: filters.solarA.push(now, r.solarA),
    chargerA: filters.chargerA.push(now, r.chargerA),
    propulsionA: filters.propulsionA.push(now, r.propulsionA),
    houseA: filters.houseA.push(now, r.houseA) ?? r.houseA,
  }
  const smoothNetA = (smooth.solarA ?? 0) + (smooth.chargerA ?? 0) - (smooth.propulsionA ?? 0) - smooth.houseA
  return { ...r, smooth, etaNetA: etaHold.push(now, smoothNetA) }
}

const view = (v: PowerView) =>
  v.online ? [v.soc, v.shore, v.solarA, v.inA, v.outA, v.propulsionA, v.netA, v.eta] : null

const ticks: unknown[] = []
let cursor = 0
for (let now = TICK_MS; now <= END_MS; now += TICK_MS) {
  while (cursor < frames.length && frames[cursor].at <= now) {
    ingest(raw, frames[cursor].frame, frames[cursor].at)
    cursor++
  }
  const r = tick(now)
  const reading = r.online
    ? [r.solarA, r.chargerA, r.propulsionA, r.houseA, r.smooth.solarA, r.smooth.chargerA, r.smooth.propulsionA, r.smooth.houseA, r.etaNetA]
    : null
  ticks.push([now, reading, view(powerView(r, 'smooth')), view(powerView(r, 'instant'))])
}

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/core/tests/fixtures/parity.json')
mkdirSync(path.dirname(out), { recursive: true })
const json = {
  frames: frames.map((f) => [f.at, f.frame.id, f.frame.ext, toHex(f.frame.data)]),
  ticks,
}
writeFileSync(out, JSON.stringify(json).replaceAll('],[', '],\n['))
const etas = new Set(ticks.flatMap((t) => [(t as unknown[])[2], (t as unknown[])[3]]).map((v) => (v ? (v as unknown[])[7] : 'offline')))
console.log(`${frames.length} frames, ${ticks.length} ticks → ${path.relative(process.cwd(), out)}`)
console.log(`eta values seen: ${[...etas].slice(0, 12).join(' | ')}${etas.size > 12 ? ` … (${etas.size} total)` : ''}`)
