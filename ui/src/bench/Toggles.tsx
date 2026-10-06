import { SIM_SPEEDS } from '../../shared/bus'
import { send, useServerStatus } from '../bus'
import { THEMES, setSmoothing, setTheme, useSmoothing, useTheme, type Smoothing } from '../display/settings'

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

export function ThemeToggle() {
  return (
    <ToggleRow label="theme" options={THEMES.map((t) => ({ value: t, label: t }))} value={useTheme()} onChange={setTheme} />
  )
}
