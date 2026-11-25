// The sun model: how much the canopy's array could give under a clear sky at
// a time. The sim uses it for the MPPTs' output and the display for the range
// view's solar forecast.

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

// Where the sun is: fixed until the display knows the boat's position.
// A placeholder; to revisit with a GPS (NMEA 2000 PGN 129025) or a setting.
export const LOCATION = { lat: 48.5, lon: -123 }
// All four MPPTs at full sun (7 kW at 51.2 V), and the sun height that gives it
export const ARRAY_MAX_A = 137
const FULL_SUN_SIN = 0.9

// Sine of the sun's elevation at a time (ms since the epoch): a simple
// declination and hour-angle model, good to a few degrees
export function sunHeight(ms: number, lat = LOCATION.lat, lon = LOCATION.lon) {
  const day = dayOfYear(ms)
  const rad = Math.PI / 180
  const decl = 23.44 * rad * Math.sin((2 * Math.PI * (284 + day)) / 365)
  const solarHours = (((ms / HOUR_MS) % 24) + lon / 15 + 24) % 24
  const hourAngle = 15 * rad * (solarHours - 12)
  return Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle)
}

// Days since 31 Dec of the year before (UTC), with the fraction of the day
export function dayOfYear(ms: number) {
  return (ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 0)) / DAY_MS
}

// The whole array's current under a clear sky
export const clearSkyA = (ms: number) => Math.min(ARRAY_MAX_A, (ARRAY_MAX_A * Math.max(0, sunHeight(ms))) / FULL_SUN_SIN)

// Local time is the clock plus an offset (minutes east of UTC) that the
// display passes in, so this stays a pure function of its inputs
export const localOffsetMin = (ms: number) => -new Date(ms).getTimezoneOffset()

// The bench's daylight setting: the sun as today's, or as on a season's
// solstice or equinox, to see how daylight hours change the range
// Spring and fall are one: the equinoxes give the same daylight.
export const DAYLIGHTS = ['now', 'summer', 'spring/fall', 'winter'] as const
export type Daylight = (typeof DAYLIGHTS)[number]

// Each season's day, as [month (0–11), day]; the time of day stays the same
const DAYLIGHT_DATES: Record<Exclude<Daylight, 'now'>, [number, number]> = {
  summer: [5, 21],
  'spring/fall': [2, 20],
  winter: [11, 21],
}

// How far to move the sun model's clock: whole days, from today to the
// season's date this year
export function sunShift(now: number, daylight: Daylight, offsetMin: number) {
  if (daylight === 'now') return 0
  const local = now + offsetMin * 60_000
  const [month, day] = DAYLIGHT_DATES[daylight]
  const target = Date.UTC(new Date(local).getUTCFullYear(), month, day) / DAY_MS
  return (target - Math.floor(local / DAY_MS)) * DAY_MS
}
