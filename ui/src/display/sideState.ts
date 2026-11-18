import type { BusName } from '../../shared/bus'
import type { Frame } from '../../shared/can'
import { DEFAULT_ALLOCATION, MPPT_ALLOCATION, decodeAllocation, type Bank } from '../../shared/gateway'
import {
  ELCON_FLAGS,
  ELCON_STATUS,
  HEATER_SOURCES,
  INVERTER_SOURCES,
  MOTOR_STATUS,
  MPPT_SOURCES,
  MPPT_SOURCE_LIST,
  ORION_LIMITS,
  ORION_PACK,
  PGN_BATTERY_STATUS,
  decodeBatteryStatus,
  decodeElconStatus,
  decodeMotorStatus,
  decodeOrionLimits,
  decodeOrionPack,
  n2kPgn,
  n2kSource,
  type ElconStatus,
  type OrionLimits,
  type OrionPack,
} from '../../shared/protocol'

const BMS_STALE_MS = 2000
const DEVICE_STALE_MS = 5000
const CHARGER_STALE_MS = 2000
const SOLAR_IDLE_A = 0.5

export type Currents = {
  solarA: number | null
  chargerA: number | null
  propulsionA: number | null
  houseA: number // everything but propulsion, derived
  // The parts of houseA that report themselves (on CAN6); null when silent
  heaterA: number | null
  inverterA: number | null
}

export type Live = Currents & {
  online: true
  soc: number
  packV: number
  packA: number
  limits: OrionLimits | null
  shore: boolean
  // MPPTs 1–4: current from each one allocated to this side, null for the rest
  mpptA: (number | null)[]
  // How many MPPTs are allocated to this side, reporting or not
  mppts: number
}

type Stamped<T> = T & { at: number }

export type Raw = {
  side: BusName
  // Which side each MPPT feeds, from the gateway; DEFAULT_ALLOCATION until it says
  allocation: Bank[] | null
  pack: Stamped<OrionPack> | null
  limits: Stamped<OrionLimits> | null
  solar: Map<number, Stamped<{ a: number }>>
  motor: Stamped<{ a: number }> | null
  charger: Stamped<ElconStatus> | null
  house: Stamped<{ a: number }> | null
  heater: Stamped<{ a: number }> | null
  inverter: Stamped<{ a: number }> | null
}

export const emptyRaw = (side: BusName): Raw => ({
  side,
  allocation: null,
  pack: null,
  limits: null,
  solar: new Map(),
  motor: null,
  charger: null,
  house: null,
  heater: null,
  inverter: null,
})

const fresh = <T extends { at: number }>(x: T | null | undefined, now: number, ms: number) =>
  x && now - x.at < ms ? x : null

// Whether an MPPT (by source address) feeds this side
const mine = (raw: Raw, source: number) => (raw.allocation ?? DEFAULT_ALLOCATION)[MPPT_SOURCE_LIST.indexOf(source)] === raw.side

const solarSum = (raw: Raw, now: number) => {
  const live = [...raw.solar].filter(([src, s]) => mine(raw, src) && fresh(s, now, DEVICE_STALE_MS)).map(([, s]) => s)
  return live.length ? live.reduce((sum, s) => sum + s.a, 0) : null
}

function sampleHouse(raw: Raw, at: number) {
  const pack = fresh(raw.pack, at, BMS_STALE_MS)
  if (!pack) return
  const solar = solarSum(raw, at) ?? 0
  const charger = fresh(raw.charger, at, CHARGER_STALE_MS)?.a ?? 0
  const propulsion = fresh(raw.motor, at, DEVICE_STALE_MS)?.a ?? 0
  raw.house = { a: Math.max(0, solar + charger + pack.packA - propulsion), at }
}

export function ingest(raw: Raw, f: Omit<Frame, 't'>, at: number) {
  if (!f.ext && f.id === ORION_PACK) {
    const p = decodeOrionPack(f.data)
    if (p) raw.pack = { ...p, at }
  } else if (!f.ext && f.id === ORION_LIMITS) {
    const l = decodeOrionLimits(f.data)
    if (l) raw.limits = { ...l, at }
  } else if (!f.ext && f.id === MOTOR_STATUS) {
    const m = decodeMotorStatus(f.data)
    if (m) raw.motor = { ...m, at }
  } else if (f.ext && f.id === ELCON_STATUS) {
    const c = decodeElconStatus(f.data)
    if (!c) return
    raw.charger = { ...c, at }
    sampleHouse(raw, at)
  } else if (f.ext && n2kPgn(f.id) === PGN_BATTERY_STATUS && MPPT_SOURCES.has(n2kSource(f.id))) {
    const b = decodeBatteryStatus(f.data)
    if (b?.a == null) return
    const src = n2kSource(f.id)
    raw.solar.set(src, { a: b.a, at })
    if (mine(raw, src) && !fresh(raw.charger, at, CHARGER_STALE_MS)) sampleHouse(raw, at)
  } else if (f.ext && n2kPgn(f.id) === PGN_BATTERY_STATUS && n2kSource(f.id) === HEATER_SOURCES[raw.side]) {
    const b = decodeBatteryStatus(f.data)
    if (b?.a != null) raw.heater = { a: b.a, at }
  } else if (f.ext && n2kPgn(f.id) === PGN_BATTERY_STATUS && n2kSource(f.id) === INVERTER_SOURCES[raw.side]) {
    const b = decodeBatteryStatus(f.data)
    if (b?.a != null) raw.inverter = { a: b.a, at }
  } else if (!f.ext && f.id === MPPT_ALLOCATION) {
    raw.allocation = decodeAllocation(f.data)
  }
}

export function read(raw: Raw, now: number): Live | { online: false } {
  const pack = fresh(raw.pack, now, BMS_STALE_MS)
  if (!pack) return { online: false }
  const propulsionA = fresh(raw.motor, now, DEVICE_STALE_MS)?.a ?? null
  const charger = fresh(raw.charger, now, CHARGER_STALE_MS)
  const chargerA = charger ? charger.a : null
  const reported = solarSum(raw, now)
  const solarA = reported == null ? null : reported < SOLAR_IDLE_A ? 0 : reported
  const house = fresh(raw.house, now, DEVICE_STALE_MS)
  const houseA =
    (solarA != null || chargerA != null) && house
      ? house.a
      : Math.max(0, (solarA ?? 0) + (chargerA ?? 0) + pack.packA - (propulsionA ?? 0))
  return {
    online: true,
    soc: pack.soc,
    packV: pack.packV,
    packA: pack.packA,
    limits: fresh(raw.limits, now, BMS_STALE_MS),
    solarA,
    chargerA,
    propulsionA,
    houseA,
    heaterA: fresh(raw.heater, now, DEVICE_STALE_MS)?.a ?? null,
    inverterA: fresh(raw.inverter, now, DEVICE_STALE_MS)?.a ?? null,
    shore: !!charger && !(charger.flags & ELCON_FLAGS.inputVoltage),
    mpptA: MPPT_SOURCE_LIST.map((s) => (mine(raw, s) ? (fresh(raw.solar.get(s), now, DEVICE_STALE_MS)?.a ?? null) : null)),
    mppts: MPPT_SOURCE_LIST.filter((s) => mine(raw, s)).length,
  }
}
