import type { Frame } from '../../shared/can'
import {
  ELCON_FLAGS,
  ELCON_STATUS,
  MOTOR_STATUS,
  MPPT_SOURCES,
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
  houseA: number
}

export type Live = Currents & {
  online: true
  soc: number
  packV: number
  packA: number
  limits: OrionLimits | null
  shore: boolean
}

type Stamped<T> = T & { at: number }

export type Raw = {
  pack: Stamped<OrionPack> | null
  limits: Stamped<OrionLimits> | null
  solar: Map<number, Stamped<{ a: number }>>
  motor: Stamped<{ a: number }> | null
  charger: Stamped<ElconStatus> | null
  house: Stamped<{ a: number }> | null
}

export const emptyRaw = (): Raw => ({ pack: null, limits: null, solar: new Map(), motor: null, charger: null, house: null })

const fresh = <T extends { at: number }>(x: T | null | undefined, now: number, ms: number) =>
  x && now - x.at < ms ? x : null

const solarSum = (raw: Raw, now: number) => {
  const live = [...raw.solar.values()].filter((s) => fresh(s, now, DEVICE_STALE_MS))
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

export function ingest(raw: Raw, f: Frame, at: number) {
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
    raw.solar.set(n2kSource(f.id), { a: b.a, at })
    if (!fresh(raw.charger, at, CHARGER_STALE_MS)) sampleHouse(raw, at)
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
    shore: !!charger && !(charger.flags & ELCON_FLAGS.inputVoltage),
  }
}
