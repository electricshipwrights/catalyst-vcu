// The range view's projection: each side's SOC from now at a planned speed,
// with and without forecast solar, until the first side reaches the reserve.
// Pure functions of their inputs (no clock), so the Rust port can match.

import { CAPACITY_AH, RESERVE_PCT } from './power'

// Propulsion power for both motors (kW) by speed (kn): the README's weekly
// range table, a rough estimate. The Oct 6 log agrees at ~1,000 rpm (≈ 7.5 kn):
// ~10.4 kW against 10.5. Beyond either end it carries on as a cube.
const POWER_CURVE: [number, number][] = [
  [5, 2],
  [6, 4.5],
  [7, 8],
  [8, 13],
  [9, 20],
  [10, 30],
]
// Per side (A), at the pack's 51.2 V nominal
const SPEED_CURVE = POWER_CURVE.map(([kn, kw]): [number, number] => [kn, (kw * 1000) / 2 / 51.2])
export const SPEED_MIN_KN = 1
// The boat's top speed: both motors at their full 15 kW
export const SPEED_MAX_KN = 10
// The stepper's step; speeds from the current are to 0.1 kn
export const SPEED_STEP_KN = 0.5
// The usual cruise, when the boat isn't moving now: under UNDERWAY_A per side
// (about 2.3 kn) it's moored or drifting
export const CRUISE_KN = 6
const UNDERWAY_A = 2

export function propulsionAt(kn: number) {
  const [lowKn, lowA] = SPEED_CURVE[0]
  const [topKn, topA] = SPEED_CURVE[SPEED_CURVE.length - 1]
  if (kn <= lowKn) return lowA * (kn / lowKn) ** 3
  if (kn >= topKn) return topA * (kn / topKn) ** 3
  const i = SPEED_CURVE.findIndex(([k]) => k > kn)
  const [k0, a0] = SPEED_CURVE[i - 1]
  const [k1, a1] = SPEED_CURVE[i]
  return a0 + ((a1 - a0) * (kn - k0)) / (k1 - k0)
}

// The speed a propulsion current implies (the curve run backwards), to 0.1 kn,
// or cruise when the boat isn't underway (moored, drifting)
export function speedFor(propulsionA: number) {
  if (propulsionA < UNDERWAY_A) return CRUISE_KN
  const [lowKn, lowA] = SPEED_CURVE[0]
  const [topKn, topA] = SPEED_CURVE[SPEED_CURVE.length - 1]
  let kn: number
  if (propulsionA <= lowA) {
    kn = lowKn * Math.cbrt(propulsionA / lowA)
  } else if (propulsionA >= topA) {
    kn = topKn * Math.cbrt(propulsionA / topA)
  } else {
    const i = SPEED_CURVE.findIndex(([, a]) => a > propulsionA)
    const [k0, a0] = SPEED_CURVE[i - 1]
    const [k1, a1] = SPEED_CURVE[i]
    kn = k0 + ((k1 - k0) * (propulsionA - a0)) / (a1 - a0)
  }
  return Math.min(SPEED_MAX_KN, Math.max(SPEED_MIN_KN, Math.round(kn * 10) / 10))
}

// The stepper's next speed up (dir 1) or down (−1), on its 0.5 kn grid: 6.3
// goes to 6.5 or 6.0
export function stepSpeed(kn: number, dir: 1 | -1) {
  const n = kn / SPEED_STEP_KN
  const next = dir > 0 ? Math.floor(n + 1e-9) + 1 : Math.ceil(n - 1e-9) - 1
  return Math.min(SPEED_MAX_KN, Math.max(SPEED_MIN_KN, next * SPEED_STEP_KN))
}

// Where the sun is: fixed until the display knows the boat's position.
// A placeholder; to revisit with a GPS (NMEA 2000 PGN 129025) or a setting.
export const LOCATION = { lat: 48.5, lon: -123 }
// All four MPPTs at full sun (7 kW at 51.2 V), and the sun height that gives it
export const ARRAY_MAX_A = 137
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

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// Local time is the clock plus an offset (minutes east of UTC) that the
// display passes in, so this stays a pure function of its inputs
export const localOffsetMin = (ms: number) => -new Date(ms).getTimezoneOffset()

// Today runs to local midnight; 24 hours from now
export const WINDOWS = ['today', '24 hours'] as const
export type RangeWindow = (typeof WINDOWS)[number]

export function windowEnd(now: number, w: RangeWindow, offsetMin: number) {
  if (w === '24 hours') return now + DAY_MS
  const off = offsetMin * 60_000
  return (Math.floor((now + off) / DAY_MS) + 1) * DAY_MS - off
}

// 1 Jan 1970 was a Thursday
const WEEKDAYS = ['THU', 'FRI', 'SAT', 'SUN', 'MON', 'TUE', 'WED']
const pad2 = (n: number) => String(n).padStart(2, '0')

export type Tick = { at: number; label: string }

// Along the time axis: every 3 h, with midnight as the weekday. None too
// near "now" at the left end.
export function timeTicks(now: number, end: number, offsetMin: number): Tick[] {
  const off = offsetMin * 60_000
  const span = end - now
  const step = 3 * HOUR_MS
  const ticks: Tick[] = []
  for (let local = (Math.floor((now + off) / step) + 1) * step; local < end + off; local += step) {
    if (local - off - now < span * 0.15) continue
    const day = Math.floor(local / DAY_MS)
    const hour = (local - day * DAY_MS) / HOUR_MS
    ticks.push({ at: local - off, label: hour === 0 ? WEEKDAYS[((day % 7) + 7) % 7] : pad2(hour) })
  }
  return ticks
}

// When something happens: "now", "18:30" today, "THU 04:00" on a later day,
// "3 days+" beyond the projection
export function whenText(at: number | null, now: number, offsetMin: number) {
  if (at == null) return '3 days+'
  if (at <= now) return 'now'
  const off = offsetMin * 60_000
  const local = at + off
  const day = Math.floor(local / DAY_MS)
  const minutes = Math.floor((local - day * DAY_MS) / 60_000)
  const time = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
  return day === Math.floor((now + off) / DAY_MS) ? time : `${WEEKDAYS[((day % 7) + 7) % 7]} ${time}`
}

// One side as the range view needs it
export type RangeInput = { soc: number; houseA: number; propulsionA: number; solarA: number; mppts: number }

// The speed planned for: the boat's now, cruise when it isn't underway, or
// one picked on the view
export type SpeedBasis = 'now' | 'cruise' | 'plan'

export type RangeView = {
  kn: number
  basis: SpeedBasis
  end: number
  projection: Projection
  // The window ends before the reserve, so the range is at least rangeNm
  beyond: boolean
  reserve: string
  noSun: string
  ticks: Tick[]
}

// The view for the online sides (null with none). planKn: a speed picked on
// the view, or null to follow the boat
export function rangeView(sides: RangeInput[], planKn: number | null, w: RangeWindow, now: number, offsetMin: number): RangeView | null {
  if (!sides.length) return null
  const propulsionA = sides.reduce((sum, s) => sum + s.propulsionA, 0) / sides.length
  const kn = planKn ?? speedFor(propulsionA)
  const basis: SpeedBasis = planKn != null ? 'plan' : propulsionA < UNDERWAY_A ? 'cruise' : 'now'
  // The whole array's current, from the MPPTs on the online sides
  const mppts = sides.reduce((sum, s) => sum + s.mppts, 0)
  const solarA = sides.reduce((sum, s) => sum + s.solarA, 0)
  const sky = mppts > 0 ? skyFactor(now, (solarA * 4) / mppts) : TYPICAL_SKY
  const end = windowEnd(now, w, offsetMin)
  const projection = project(
    sides.map((s) => ({ soc: s.soc, houseA: s.houseA, mppts: s.mppts })),
    kn,
    sky,
    now,
    end,
  )
  return {
    kn,
    basis,
    end,
    projection,
    beyond: projection.emptyAt == null || projection.emptyAt > end,
    reserve: whenText(projection.emptyAt, now, offsetMin),
    noSun: whenText(projection.emptyBatteryOnlyAt, now, offsetMin),
    ticks: timeTicks(now, end, offsetMin),
  }
}

// The chart's lines as SVG path commands in a w×h box: now to the window's
// end across, SOC (0–100%) up the side, and the array's forecast as a band
// along the bottom, SOLAR_BAND of the height at full sun. Each SOC line ends
// where it reaches the reserve. At most CHART_POINTS points, about one per 2 px.
const SOLAR_BAND = 0.3
const CHART_POINTS = 140

export const socY = (soc: number, h: number) => h - (soc / 100) * h

export function chartPaths(v: RangeView, now: number, w: number, h: number) {
  const all = v.projection.points
  const stride = Math.max(1, Math.ceil(all.length / CHART_POINTS))
  const pts = all.filter((_, i) => i % stride === 0 || i === all.length - 1)
  const x = (at: number) => (((at - now) / (v.end - now)) * w).toFixed(1)
  const line = (soc: (p: RangePoint) => number) => {
    const end = pts.findIndex((p) => soc(p) <= RESERVE_PCT)
    return pts
      .slice(0, end < 0 ? pts.length : end + 1)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.at)} ${socY(soc(p), h).toFixed(1)}`)
      .join(' ')
  }
  const sunY = (a: number) => (h - (a / ARRAY_MAX_A) * h * SOLAR_BAND).toFixed(1)
  const last = x(pts[pts.length - 1].at)
  return {
    withSolar: line((p) => p.withSolar),
    batteryOnly: line((p) => p.batteryOnly),
    solar: `M0 ${h} ${pts.map((p) => `L${x(p.at)} ${sunY(p.solarA)}`).join(' ')} L${last} ${h} Z`,
  }
}
