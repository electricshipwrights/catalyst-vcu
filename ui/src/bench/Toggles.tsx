import { useEffect } from 'react'
import { SHORE_INLETS, SIM_SPEEDS } from '../../shared/bus'
import { DAYLIGHTS, TIMES_OF_DAY, TIME_OF_DAY_HOUR } from '../../shared/sun'
import { send, useServerStatus } from '../bus'
import {
  RENDERERS,
  THEMES,
  setRenderer,
  setSmoothing,
  setDaylight,
  setTimeOfDay,
  setTheme,
  useRenderer,
  useSmoothing,
  useClockShift,
  useDaylight,
  useTimeOfDay,
  useTheme,
  type Smoothing,
} from '../display/settings'

function ToggleRow<T extends string | number>(props: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T | undefined
  onChange: (v: T) => void
}) {
  return (
    <div className="presets scenario">
      <span>{props.label}</span>
      {props.options.map((o) => (
        <button
          key={o.value}
          aria-pressed={props.value === o.value}
          disabled={props.value === undefined}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const SMOOTHING_OPTIONS: { value: Smoothing; label: string }[] = [
  { value: 'smooth', label: 'smoothed' },
  { value: 'instant', label: 'instant' },
]

export function SmoothingToggle() {
  return <ToggleRow label="currents" options={SMOOTHING_OPTIONS} value={useSmoothing()} onChange={setSmoothing} />
}

export function SpeedToggle() {
  return (
    <ToggleRow
      label="sim speed"
      options={SIM_SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
      value={useServerStatus()?.speed}
      onChange={(speed) => send({ type: 'speed', speed })}
    />
  )
}

// The season: today's sun, or a solstice's or equinox's. It moves the sim's
// clock, so its MPPTs and the NMEA 2000 time the displays follow. The sim is
// told whenever it changes or the bus server reconnects.
export function DaylightToggle() {
  const daylight = useDaylight()
  const connected = useServerStatus() != null
  useEffect(() => {
    if (connected) send({ type: 'daylight', daylight })
  }, [daylight, connected])
  return (
    <ToggleRow
      label="season"
      options={DAYLIGHTS.map((s) => ({ value: s, label: s }))}
      value={daylight}
      onChange={setDaylight}
    />
  )
}

// The clock as it is, or moved to the morning, afternoon or night today
// (labeled with their times), for the sim's sun and the NMEA 2000 time the
// displays follow; it runs on from there. The sim is told whenever it changes
// or the bus server reconnects.
export function TimeOfDayToggle() {
  const shiftMs = useClockShift()
  const connected = useServerStatus() != null
  useEffect(() => {
    if (connected) send({ type: 'clock', shiftMs })
  }, [shiftMs, connected])
  return (
    <ToggleRow
      label="time of day"
      options={TIMES_OF_DAY.map((t) => ({ value: t, label: t === 'now' ? 'now' : `${String(TIME_OF_DAY_HOUR[t]).padStart(2, '0')}:00` }))}
      value={useTimeOfDay()}
      onChange={setTimeOfDay}
    />
  )
}

// The dock's shore supply in the sim: both chargers at 80 A on the 50 A
// inlet, or sharing the 30 A one (about 33 A each)
export function InletToggle() {
  return (
    <ToggleRow
      label="shore inlet"
      options={SHORE_INLETS.map((a) => ({ value: a, label: `${a} A` }))}
      value={useServerStatus()?.inlet}
      onChange={(inlet) => send({ type: 'inlet', inlet })}
    />
  )
}

export function ThemeToggle() {
  return (
    <ToggleRow label="theme" options={THEMES.map((t) => ({ value: t, label: t }))} value={useTheme()} onChange={setTheme} />
  )
}

export function RendererToggle() {
  return (
    <ToggleRow
      label="renderer"
      options={RENDERERS.map((r) => ({ value: r, label: r }))}
      value={useRenderer()}
      onChange={setRenderer}
    />
  )
}


