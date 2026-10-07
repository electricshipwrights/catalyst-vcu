import { THEMES, setTheme, useTheme } from './settings'

// Settings view (button C): theme choice, saved like the bench's theme toggle
export function SettingsPage() {
  const theme = useTheme()
  return (
    <div className="page settings">
      <div className="settings-label">THEME</div>
      <div className="theme-options">
        {THEMES.map((t) => (
          <button key={t} className={t === theme ? 'on' : ''} onClick={() => setTheme(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
