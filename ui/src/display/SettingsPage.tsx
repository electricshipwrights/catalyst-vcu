import { INPUT_VIEWS, THEMES, setInputView, setTheme, useInputView, useTheme } from './settings'

function Choice<T extends string>(props: {
  label: string
  values: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <div className="settings-label">{props.label}</div>
      <div className="options" style={{ gridTemplateColumns: `repeat(${props.values.length}, 1fr)` }}>
        {props.values.map((v) => (
          <button key={v} className={v === props.value ? 'on' : ''} onClick={() => props.onChange(v)}>
            {v.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}

// Settings view (button C), saved like the bench's toggles
export function SettingsPage() {
  return (
    <div className="page settings">
      <Choice label="THEME" values={THEMES} value={useTheme()} onChange={setTheme} />
      <Choice label="INPUT" values={INPUT_VIEWS} value={useInputView()} onChange={setInputView} />
    </div>
  )
}
