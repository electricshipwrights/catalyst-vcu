// The range view's projection: each side's SOC from now at a planned speed,
// with and without forecast solar, until the first side reaches the reserve.
// Pure functions of their inputs (no clock), so the Rust port can match.

import { CAPACITY_AH, RESERVE_PCT } from './power'

// Propulsion per side (A) by speed (kn): the README's range table less a 10 A
// house load, and the Oct 6 trip's ~100 A at 7.5 kn. Roughly cubic; beyond
// the table it carries on as a cube.
const SPEED_CURVE: [number, number][] = [
  [0, 0],
  [4, 9],
  [5, 17],
  [6, 42],
  [7, 76],
  [7.5, 100],
]
export const SPEED_MIN_KN = 3
export const SPEED_MAX_KN = 8
export const SPEED_STEP_KN = 0.5
// The usual cruise, when the boat isn't moving now
export const CRUISE_KN = 6

export function propulsionAt(kn: number) {
  const top = SPEED_CURVE[SPEED_CURVE.length - 1]
  if (kn >= top[0]) return top[1] * (kn / top[0]) ** 3
  const i = SPEED_CURVE.findIndex(([k]) => k > kn)
  const [k0, a0] = SPEED_CURVE[i - 1]
  const [k1, a1] = SPEED_CURVE[i]
  return a0 + ((a1 - a0) * (kn - k0)) / (k1 - k0)
}

// The speed a propulsion current implies, to the stepper's 0.5 kn, or cruise
// when it's under the stepper's range (moored, drifting)
export function speedFor(propulsionA: number) {
  let kn = SPEED_MIN_KN
  while (kn < SPEED_MAX_KN && propulsionAt(kn + SPEED_STEP_KN / 2) < propulsionA) kn += SPEED_STEP_KN
  return propulsionA < propulsionAt(SPEED_MIN_KN) ? CRUISE_KN : kn
}

// Where the sun is: fixed until the display knows the boat's position.
// A placeholder; to revisit with a GPS (NMEA 2000 PGN 129025) or a setting.
export const LOCATION = { lat: 48.5, lon: -123 }
// All four MPPTs at full sun (7 kW at 51.2 V), and the sun height that gives it
const ARRAY_MAX_A = 137
const FULL_SUN_SIN = 0.9

// Sine of the sun's elevation at a time (ms since the epoch): a simple
// declination and hour-angle model, good to a few degrees
export function sunHeight(ms: number, lat = LOCATION.lat, lon = LOCATION.lon) {
  const d = new Date(ms)
  const day = (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000
  const rad = Math.PI / 180
  const decl = 23.44 * rad * Math.sin((2 * Math.PI * (284 + day)) / 365)
  const solarHours = (((ms / 3_600_000) % 24) + lon / 15 + 24) % 24
  const hourAngle = 15 * rad * (solarHours - 12)
  return Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle)
}

// The whole array's current under a clear sky
export const clearSkyA = (ms: number) => Math.min(ARRAY_MAX_A, (ARRAY_MAX_A * Math.max(0, sunHeight(ms))) / FULL_SUN_SIN)

// How today's sun compares with a clear sky, from the array's current now.
// With the sun too low to tell, a typical day.
const TYPICAL_SKY = 0.6
export function skyFactor(ms: number, arrayA: number) {
  const clear = clearSkyA(ms)
  return clear < 20 ? TYPICAL_SKY : Math.min(1, Math.max(0.05, arrayA / clear))
}

export type RangeSide = {
  soc: number
  houseA: number
  // MPPTs allocated to this side, 0–4: its share of the array
  mppts: number
}

export type RangePoint = { at: number; withSolar: number; batteryOnly: number; solarA: number }

export type Projection = {
  // Every 5 minutes from now to the window's end: the lower side's SOC with
  // and without solar, and the forecast for the whole array
  points: RangePoint[]
  // When the first side reaches the reserve (null: not within 3 days)
  emptyAt: number | null
  emptyBatteryOnlyAt: number | null
  rangeNm: number
}

const STEP_MS = 5 * 60_000
const HORIZON_MS = 72 * 3_600_000

// Sides from now at `kn`, with the sky as it is now (`sky`), until `end`.
// Shore charging is left out: this is for planning time underway.
export function project(sides: RangeSide[], kn: number, sky: number, now: number, end: number): Projection {
  const propulsion = propulsionAt(kn)
  const withSolar = sides.map((s) => s.soc)
  const batteryOnly = sides.map((s) => s.soc)
  const points: RangePoint[] = []
  let emptyAt: number | null = null
  let emptyBatteryOnlyAt: number | null = null
  const reserve = (socs: number[]) => Math.min(...socs) <= RESERVE_PCT
  if (reserve(withSolar)) emptyAt = now
  if (reserve(batteryOnly)) emptyBatteryOnlyAt = now

  for (let at = now; at <= Math.max(end, now + HORIZON_MS); at += STEP_MS) {
    const arrayA = clearSkyA(at) * sky
    if (at <= end) points.push({ at, withSolar: Math.min(...withSolar), batteryOnly: Math.min(...batteryOnly), solarA: arrayA })
    if (emptyAt != null && emptyBatteryOnlyAt != null && at > end) break
    const hours = STEP_MS / 3_600_000
    sides.forEach((s, i) => {
      const drawA = propulsion + s.houseA
      const solarA = (arrayA * s.mppts) / 4
      withSolar[i] = Math.min(100, Math.max(0, withSolar[i] - ((drawA - solarA) * hours * 100) / CAPACITY_AH))
      batteryOnly[i] = Math.max(0, batteryOnly[i] - (drawA * hours * 100) / CAPACITY_AH)
    })
    if (emptyAt == null && reserve(withSolar)) emptyAt = at + STEP_MS
    if (emptyBatteryOnlyAt == null && reserve(batteryOnly)) emptyBatteryOnlyAt = at + STEP_MS
  }
  const underway = Math.max(0, Math.min(emptyAt ?? end, end) - now)
  return { points, emptyAt, emptyBatteryOnlyAt, rangeNm: (kn * underway) / 3_600_000 }
}

// The window "today" and the longer ones end at local midnight
export const WINDOWS = ['today', 'tomorrow', '3 days'] as const
export type RangeWindow = (typeof WINDOWS)[number]

export function windowEnd(now: number, w: RangeWindow) {
  const d = new Date(now)
  d.setHours(24 * (w === 'today' ? 1 : w === 'tomorrow' ? 2 : 3), 0, 0, 0)
  return d.getTime()
}
