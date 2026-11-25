// The range view's projection: each side's SOC from now at a planned speed,
// with and without forecast solar, until the first side reaches the reserve.
// Pure functions of their inputs (no clock), so the Rust port can match.

import { ARRAY_MAX_A, DAY_MS, HOUR_MS, clearSkyA, dayOfYear, sunShift, type Daylight } from '../../shared/sun'
import { CAPACITY_AH, RESERVE_PCT, hm } from './power'

// Propulsion power for both motors (kW) by speed (kn): the builder's published
// estimate (README, Range and speed). The Oct 6 log agrees at ~1,000 rpm (≈ 7.5 kn):
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
export const CRUISE_KN = 7
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
  return Math.min(SPEED_MAX_KN, Math.max(SPEED_MIN_KN, Math.round(knAt(propulsionA) * 10) / 10))
}

// The curve run backwards: the speed for a propulsion current per side
function knAt(propulsionA: number) {
  const [lowKn, lowA] = SPEED_CURVE[0]
  const [topKn, topA] = SPEED_CURVE[SPEED_CURVE.length - 1]
  if (propulsionA <= lowA) return lowKn * Math.cbrt(propulsionA / lowA)
  if (propulsionA >= topA) return topKn * Math.cbrt(propulsionA / topA)
  const i = SPEED_CURVE.findIndex(([, a]) => a > propulsionA)
  const [k0, a0] = SPEED_CURVE[i - 1]
  const [k1, a1] = SPEED_CURVE[i]
  return k0 + ((k1 - k0) * (propulsionA - a0)) / (a1 - a0)
}

// The stepper's next speed up (dir 1) or down (−1), on its 0.5 kn grid: 6.3
// goes to 6.5 or 6.0
export function stepSpeed(kn: number, dir: 1 | -1) {
  const n = kn / SPEED_STEP_KN
  const next = dir > 0 ? Math.floor(n + 1e-9) + 1 : Math.ceil(n - 1e-9) - 1
  return Math.min(SPEED_MAX_KN, Math.max(SPEED_MIN_KN, next * SPEED_STEP_KN))
}

// A typical day's solar for the whole array (kWh), from the README's weekly
// figures: about 19 at midsummer (135 a week) and 5 at midwinter (35 a week),
// in between along a cosine through the year
const SUMMER_DAY_KWH = 135 / 7
const WINTER_DAY_KWH = 35 / 7
const MIDSUMMER_DAY = 172

export function typicalDayKwh(ms: number) {
  const summer = (1 + Math.cos((2 * Math.PI * (dayOfYear(ms) - MIDSUMMER_DAY)) / 365)) / 2
  return WINTER_DAY_KWH + (SUMMER_DAY_KWH - WINTER_DAY_KWH) * summer
}

// The clear-sky curve over the 24 hours around a time (kWh at 51.2 V)
export function clearSkyDayKwh(ms: number) {
  let ah = 0
  for (let t = ms - 12 * HOUR_MS; t < ms + 12 * HOUR_MS; t += STEP_MS) ah += (clearSkyA(t) * STEP_MS) / HOUR_MS
  return (ah * 51.2) / 1000
}

// The sky that makes the clear-sky curve a typical day for the date: about
// 0.28 at midsummer and 0.39 at midwinter
export const typicalSky = (ms: number) => Math.min(1, typicalDayKwh(ms) / clearSkyDayKwh(ms))

// How today's sun compares with a clear sky, from the array's current now.
// With the sun too low to tell, a typical day for the date.
export function skyFactor(ms: number, arrayA: number) {
  const clear = clearSkyA(ms)
  return clear < 20 ? typicalSky(ms) : Math.min(1, Math.max(0.05, arrayA / clear))
}

export type RangeSide = {
  soc: number
  houseA: number
  // MPPTs allocated to this side, 0–4: its share of the array
  mppts: number
}

export type RangePoint = { at: number; withSolar: number; batteryOnly: number; solarA: number }

export type Projection = {
  // Every 5 minutes from now to the window's end: the boat's usable energy as
  // an SOC (the reserve plus the sides' average above it) with and without
  // solar, and the forecast for the whole array
  points: RangePoint[]
  // When the last side reaches the reserve (null: not within 3 days)
  emptyAt: number | null
  emptyBatteryOnlyAt: number | null
  rangeNm: number
}

// One motor at its full 15 kW, at 51.2 V
const MOTOR_MAX_A = 15_000 / 51.2

// One projection, with solar or without: each side's SOC, whether it's out
// (reached the reserve), the distance so far, and when the last side went out
type Run = { solar: boolean; socs: number[]; out: boolean[]; nm: number; emptyAt: number | null }

// The boat's usable energy as an SOC: the reserve plus the sides' average above it
const usable = (r: Run) => RESERVE_PCT + r.socs.reduce((sum, soc) => sum + Math.max(0, soc - RESERVE_PCT), 0) / r.socs.length

const STEP_MS = 5 * 60_000
const HORIZON_MS = 72 * 3_600_000

// Sides from now at `kn`, with the sky as it is now (`sky`), until `end`.
// Each side's battery drives only its own motor, so when one reaches the
// reserve it drops out (its house load with it) and the other motor carries
// on alone: it takes the boat's whole propulsion power, or its own 15 kW at
// most, and the speed drops to what that gives. Shore charging is left out:
// this is for planning time underway. The sun is taken `sunShiftMs` later
// (whole days), for the bench's daylight setting.
export function project(sides: RangeSide[], kn: number, sky: number, now: number, end: number, sunShiftMs = 0): Projection {
  const propulsion = propulsionAt(kn)
  const start = (solar: boolean): Run => {
    const out = sides.map((s) => s.soc <= RESERVE_PCT)
    return { solar, socs: sides.map((s) => s.soc), out, nm: 0, emptyAt: out.every(Boolean) ? now : null }
  }
  const runs = [start(true), start(false)]
  const [withSolar, batteryOnly] = runs
  const points: RangePoint[] = []
  const hours = STEP_MS / HOUR_MS

  for (let at = now; at <= Math.max(end, now + HORIZON_MS); at += STEP_MS) {
    const arrayA = clearSkyA(at + sunShiftMs) * sky
    if (at <= end) points.push({ at, withSolar: usable(withSolar), batteryOnly: usable(batteryOnly), solarA: arrayA })
    if (runs.every((r) => r.emptyAt != null) && at > end) break
    for (const r of runs) {
      if (r.emptyAt != null) continue
      // With a side out, one motor does the work of two
      const alone = r.out.some(Boolean)
      const motorA = alone ? Math.min(MOTOR_MAX_A, 2 * propulsion) : propulsion
      sides.forEach((s, i) => {
        if (r.out[i]) return
        const solarA = r.solar ? (arrayA * s.mppts) / 4 : 0
        r.socs[i] = Math.min(100, Math.max(0, r.socs[i] - ((motorA + s.houseA - solarA) * hours * 100) / CAPACITY_AH))
        if (r.socs[i] <= RESERVE_PCT) r.out[i] = true
      })
      if (at < end) r.nm += (alone ? knAt(motorA / 2) : kn) * (Math.min(STEP_MS, end - at) / HOUR_MS)
      if (r.out.every(Boolean)) r.emptyAt = at + STEP_MS
    }
  }
  return { points, emptyAt: withSolar.emptyAt, emptyBatteryOnlyAt: batteryOnly.emptyAt, rangeNm: withSolar.nm }
}

// Today runs to local midnight, but at least 8 hours, so in the evening it
// carries on into the night; 24 hours from now
export const WINDOWS = ['today', '24 hours'] as const
export type RangeWindow = (typeof WINDOWS)[number]
const TODAY_MIN_MS = 8 * HOUR_MS

export function windowEnd(now: number, w: RangeWindow, offsetMin: number) {
  if (w === '24 hours') return now + DAY_MS
  const off = offsetMin * 60_000
  return Math.max(now + TODAY_MIN_MS, (Math.floor((now + off) / DAY_MS) + 1) * DAY_MS - off)
}

// Local midnights after now and before the window's end, for lines on the chart
export function midnights(now: number, end: number, offsetMin: number) {
  const off = offsetMin * 60_000
  const at: number[] = []
  for (let local = (Math.floor((now + off) / DAY_MS) + 1) * DAY_MS; local - off < end; local += DAY_MS) at.push(local - off)
  return at
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

// A local time as its day (since the epoch) and "18:30"
function clock(at: number, offsetMin: number) {
  const local = at + offsetMin * 60_000
  const day = Math.floor(local / DAY_MS)
  const minutes = Math.floor((local - day * DAY_MS) / 60_000)
  return { day, time: `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}` }
}

const weekday = (day: number) => WEEKDAYS[((day % 7) + 7) % 7]

// When something happens: "now", "18:30" today, "THU 04:00" on a later day,
// "3 days+" beyond the projection
export function whenText(at: number | null, now: number, offsetMin: number) {
  if (at == null) return '3 days+'
  if (at <= now) return 'now'
  const { day, time } = clock(at, offsetMin)
  return day === clock(now, offsetMin).day ? time : `${weekday(day)} ${time}`
}

// How long until then, like the power view's ETA but always in hours: "2:15h",
// "13h"; "now" once it's passed, "3 days+" beyond the projection
export function inText(at: number | null, now: number) {
  if (at == null) return '3 days+'
  if (at <= now) return 'now'
  const t = hm((at - now) / HOUR_MS)
  return t.endsWith('h') ? t : `${t}h`
}

// The day and time, even today: "MON 18:30" (null once it's passed or beyond
// the projection)
export function atText(at: number | null, now: number, offsetMin: number) {
  if (at == null || at <= now) return null
  const { day, time } = clock(at, offsetMin)
  return `${weekday(day)} ${time}`
}

// One side as the range view needs it
export type RangeInput = {
  soc: number
  houseA: number
  propulsionA: number
  solarA: number
  mppts: number
  // On shore power, and what its charger gives (0 when silent)
  shore: boolean
  chargerA: number
}

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
  // How long until the last side reaches the reserve, with the sun and
  // without, and the day and time it does
  reserveIn: string
  reserveAt: string | null
  noSunIn: string
  noSunAt: string | null
  ticks: Tick[]
  midnights: number[]
  // On shore power: when the charging sides are full, and the range leaving
  // then (null beyond 3 days); null when no side is charging
  dock: { full: string; nm: number | null } | null
}

// A charger counts from 1 A, and a side is full from 99.5%, like the power view's ETA
const CHARGING_A = 1
const FULL_PCT = 99.5

// At the dock, which means not moving: each side gains its charger and the
// solar forecast less its house load, until every charging side is full. The
// Orion's taper near full is left out, like the power view's time to full.
function dock(sides: RangeInput[], kn: number, sky: number, now: number, sunShiftMs: number, offsetMin: number) {
  const charging = sides.map((s) => s.shore && s.chargerA >= CHARGING_A)
  if (!charging.some(Boolean)) return null
  const socs = sides.map((s) => s.soc)
  const full = () => socs.every((soc, i) => !charging[i] || soc >= FULL_PCT)
  let fullAt: number | null = null
  for (let at = now; at <= now + HORIZON_MS; at += STEP_MS) {
    if (full()) {
      fullAt = at
      break
    }
    const arrayA = clearSkyA(at + sunShiftMs) * sky
    sides.forEach((s, i) => {
      const inA = (charging[i] ? s.chargerA : 0) + (arrayA * s.mppts) / 4
      socs[i] = Math.min(100, Math.max(0, socs[i] + ((inA - s.houseA) * (STEP_MS / HOUR_MS) * 100) / CAPACITY_AH))
    })
  }
  if (fullAt == null) return { full: whenText(null, now, offsetMin), nm: null }
  const leaving = sides.map((s, i) => ({ soc: socs[i], houseA: s.houseA, mppts: s.mppts }))
  const nm = project(leaving, kn, sky, fullAt, fullAt + HORIZON_MS, sunShiftMs).rangeNm
  return { full: whenText(fullAt, now, offsetMin), nm }
}

// The view for the online sides (null with none). planKn: a speed picked on
// the view, or null to follow the boat. daylight: the bench's setting, which
// moves the sim's sun the same way, so the sky is still measured from the MPPTs.
export function rangeView(
  sides: RangeInput[],
  planKn: number | null,
  w: RangeWindow,
  now: number,
  offsetMin: number,
  daylight: Daylight = 'now',
): RangeView | null {
  if (!sides.length) return null
  const propulsionA = sides.reduce((sum, s) => sum + s.propulsionA, 0) / sides.length
  const kn = planKn ?? speedFor(propulsionA)
  const basis: SpeedBasis = planKn != null ? 'plan' : propulsionA < UNDERWAY_A ? 'cruise' : 'now'
  // The whole array's current, from the MPPTs on the online sides
  const mppts = sides.reduce((sum, s) => sum + s.mppts, 0)
  const solarA = sides.reduce((sum, s) => sum + s.solarA, 0)
  const shift = sunShift(now, daylight, offsetMin)
  const sky = mppts > 0 ? skyFactor(now + shift, (solarA * 4) / mppts) : typicalSky(now + shift)
  const end = windowEnd(now, w, offsetMin)
  const projection = project(
    sides.map((s) => ({ soc: s.soc, houseA: s.houseA, mppts: s.mppts })),
    kn,
    sky,
    now,
    end,
    shift,
  )
  return {
    kn,
    basis,
    end,
    projection,
    beyond: projection.emptyAt == null || projection.emptyAt > end,
    reserveIn: inText(projection.emptyAt, now),
    reserveAt: atText(projection.emptyAt, now, offsetMin),
    noSunIn: inText(projection.emptyBatteryOnlyAt, now),
    noSunAt: atText(projection.emptyBatteryOnlyAt, now, offsetMin),
    ticks: timeTicks(now, end, offsetMin),
    midnights: midnights(now, end, offsetMin),
    dock: dock(sides, kn, sky, now, shift, offsetMin),
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
