export const ORION_PACK = 0x6b0
export const ORION_LIMITS = 0x6b1
export const ORION_CELL = 0x036
export const ORION_CELL_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b]
export const ORION_RELAYS_DEFAULT = 0xc04b

export const PGN_BATTERY_STATUS = 127508
// MPPTs 1–4 by NMEA 2000 source address; each reports on the bus of the side it's allocated to
export const MPPT_SOURCE_LIST = [0x22, 0x23, 0x24, 0x25]
export const MPPT_SOURCES = new Set(MPPT_SOURCE_LIST)
// House loads that report on NMEA 2000 (CAN6), one of each per side, with the
// current each draws from the battery as PGN 127508's current. All assumed, to
// revisit: which devices, their PGN and addresses, and which side they're on.
export const INVERTER_SOURCES = { port: 0x30, stbd: 0x31 } as const
export const HEATER_SOURCES = { port: 0x32, stbd: 0x33 } as const

// NMEA 2000 System Time (CAN6): UTC date and time from a GPS or chartplotter,
// which the display's clock follows while it's on the bus. The bench's sim and
// the board demo send it from this address, standing in for a GPS.
export const PGN_SYSTEM_TIME = 126992
export const TIME_SOURCE = 0x10

export const MOTOR_STATUS = 0x700

const u16be = (d: Uint8Array, i: number) => (d[i] << 8) | d[i + 1]
const s16be = (d: Uint8Array, i: number) => (u16be(d, i) << 16) >> 16
const u16le = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8)
const s16le = (d: Uint8Array, i: number) => (u16le(d, i) << 16) >> 16
const u32le = (d: Uint8Array, i: number) => (u16le(d, i) | (u16le(d, i + 2) << 16)) >>> 0
const s8 = (b: number) => (b << 24) >> 24
const be = (v: number) => [(v >> 8) & 0xff, v & 0xff]
const le = (v: number) => [v & 0xff, (v >> 8) & 0xff]
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))

function orionChecksum(id: number, d: ArrayLike<number>) {
  let sum = id + 8
  for (let i = 0; i < 7; i++) sum += d[i]
  return sum & 0xff
}

function orionFrame(id: number, bytes: number[]) {
  const d = new Uint8Array(8)
  d.set(bytes.slice(0, 7))
  d[7] = orionChecksum(id, d)
  return d
}

const orionValid = (id: number, d: Uint8Array) => d.length === 8 && d[7] === orionChecksum(id, d)

export type OrionPack = { packA: number; packV: number; soc: number; relays: number }

export function encodeOrionPack(p: OrionPack) {
  return orionFrame(ORION_PACK, [
    ...be(clampInt(p.packA * 10, -32768, 32767) & 0xffff),
    ...be(clampInt(p.packV * 10, 0, 0xffff)),
    clampInt(p.soc * 2, 0, 200),
    ...be(p.relays),
  ])
}

export function decodeOrionPack(d: Uint8Array): OrionPack | null {
  if (!orionValid(ORION_PACK, d)) return null
  return { packA: s16be(d, 0) / 10, packV: u16be(d, 2) / 10, soc: d[4] / 2, relays: u16be(d, 5) }
}

export type OrionLimits = { dcl: number; ccl: number; tHi: number; tLo: number }

export function encodeOrionLimits(p: OrionLimits) {
  return orionFrame(ORION_LIMITS, [
    ...be(clampInt(p.dcl, 0, 0xffff)),
    ...be(clampInt(p.ccl, 0, 0xffff)),
    clampInt(p.tHi, -128, 127) & 0xff,
    clampInt(p.tLo, -128, 127) & 0xff,
    0,
  ])
}

export function decodeOrionLimits(d: Uint8Array): OrionLimits | null {
  if (!orionValid(ORION_LIMITS, d)) return null
  return { dcl: u16be(d, 0), ccl: u16be(d, 2), tHi: s8(d[4]), tLo: s8(d[5]) }
}

export type OrionCell = { cell: number; v: number; r: number; ocv: number }

export function encodeOrionCell(p: OrionCell) {
  return orionFrame(ORION_CELL, [
    p.cell,
    ...be(clampInt(p.v * 10000, 0, 0xffff)),
    ...be(clampInt(p.r * 100000, 0, 0xffff)),
    ...be(clampInt(p.ocv * 10000, 0, 0xffff)),
  ])
}

export function decodeOrionCell(d: Uint8Array): OrionCell | null {
  if (!orionValid(ORION_CELL, d)) return null
  return { cell: d[0], v: u16be(d, 1) / 10000, r: u16be(d, 3) / 100000, ocv: u16be(d, 5) / 10000 }
}

export const n2kId = (pgn: number, src: number, prio = 6) => ((prio & 7) << 26) | (pgn << 8) | (src & 0xff)

export function n2kPgn(id: number) {
  const pgn = (id >> 8) & 0x3ffff
  return ((pgn >> 8) & 0xff) < 240 ? pgn & 0x3ff00 : pgn
}

export const n2kSource = (id: number) => id & 0xff

export type BatteryStatus = { instance: number; v: number; a: number | null; tempC: number | null; sid: number }

export function encodeBatteryStatus(p: BatteryStatus) {
  const t = p.tempC == null ? 0xffff : clampInt((p.tempC + 273.15) * 100, 0, 0xfffd)
  const a = p.a == null ? 0x7fff : clampInt(p.a * 10, -32768, 32765) & 0xffff
  return Uint8Array.from([p.instance, ...le(clampInt(p.v * 100, 0, 0xfffd)), ...le(a), ...le(t), p.sid & 0xff])
}

export function decodeBatteryStatus(d: Uint8Array): BatteryStatus | null {
  if (d.length !== 8) return null
  const a = s16le(d, 3)
  const t = u16le(d, 5)
  return {
    instance: d[0],
    v: u16le(d, 1) / 100,
    a: a === 0x7fff ? null : a / 10,
    tempC: t === 0xffff ? null : t / 100 - 273.15,
    sid: d[7],
  }
}

const DAY_MS = 86_400_000

// sid, then the time source (0: GPS) under reserved bits, days since 1970,
// and the time of day in 0.0001 s; ms is UTC since the epoch
export type SystemTime = { sid: number; ms: number }

export function encodeSystemTime(p: SystemTime) {
  const days = Math.floor(p.ms / DAY_MS)
  const t = Math.round((p.ms - days * DAY_MS) * 10)
  return Uint8Array.from([p.sid & 0xff, 0xf0, ...le(days), ...le(t & 0xffff), ...le(t >>> 16)])
}

// UTC ms since the epoch, or null when the date or time isn't available
export function decodeSystemTime(d: Uint8Array): number | null {
  if (d.length !== 8) return null
  const days = u16le(d, 2)
  const t = u32le(d, 4)
  return days === 0xffff || t >= 0xfffffffe ? null : days * DAY_MS + t / 10
}

export type MotorStatus = { a: number }

export const encodeMotorStatus = (p: MotorStatus) =>
  Uint8Array.from([...be(clampInt(p.a * 10, -32768, 32767) & 0xffff), 0, 0, 0, 0, 0, 0])

export const decodeMotorStatus = (d: Uint8Array): MotorStatus | null =>
  d.length >= 2 ? { a: s16be(d, 0) / 10 } : null

export const ELCON_COMMAND = 0x1806e5f4
export const ELCON_STATUS = 0x18ff50e5
export const ELCON_FLAGS = { hardware: 1, overTemp: 2, inputVoltage: 4, stopped: 8, commTimeout: 16 }

export type ElconCommand = { maxV: number; maxA: number; stop: boolean }

export const encodeElconCommand = (p: ElconCommand) =>
  Uint8Array.from([...be(clampInt(p.maxV * 10, 0, 0xffff)), ...be(clampInt(p.maxA * 10, 0, 0xffff)), p.stop ? 1 : 0, 0, 0, 0])

export const decodeElconCommand = (d: Uint8Array): ElconCommand | null =>
  d.length === 8 ? { maxV: u16be(d, 0) / 10, maxA: u16be(d, 2) / 10, stop: d[4] !== 0 } : null

export type ElconStatus = { v: number; a: number; flags: number }

export const encodeElconStatus = (p: ElconStatus) =>
  Uint8Array.from([...be(clampInt(p.v * 10, 0, 0xffff)), ...be(clampInt(p.a * 10, 0, 0xffff)), p.flags & 0xff, 0, 0, 0])

export const decodeElconStatus = (d: Uint8Array): ElconStatus | null =>
  d.length === 8 ? { v: u16be(d, 0) / 10, a: u16be(d, 2) / 10, flags: d[4] } : null
