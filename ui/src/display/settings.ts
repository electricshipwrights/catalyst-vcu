import { useSyncExternalStore } from 'react'
import { DAYLIGHTS, TIMES_OF_DAY, clockShift, localOffsetMin, type TimeOfDay } from '../../shared/sun'

function createSetting<T extends string>(key: string, values: readonly T[], fallback: T) {
  const listeners = new Set<() => void>()
  const load = (): T => {
    try {
      const v = localStorage.getItem(key) as T | null
      return v && values.includes(v) ? v : fallback
    } catch {
      return fallback
    }
  }
  let value = load()
  const notify = () => listeners.forEach((l) => l())
  addEventListener('storage', (e) => {
    if (e.key !== key) return
    value = load()
    notify()
  })
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }
  return {
    set(v: T) {
      value = v
      try {
        localStorage.setItem(key, v)
      } catch {}
      notify()
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}

export const SMOOTHINGS = ['smooth', 'instant'] as const
export type Smoothing = (typeof SMOOTHINGS)[number]
const smoothing = createSetting('vcu.smoothing', SMOOTHINGS, 'smooth')
export const useSmoothing = smoothing.use
export const setSmoothing = smoothing.set

export const THEMES = ['dark', 'light', 'night'] as const
export type Theme = (typeof THEMES)[number]
const theme = createSetting('vcu.theme', THEMES, 'dark')
export const useTheme = theme.use
export const setTheme = theme.set

export const RENDERERS = ['react', 'slint'] as const
export type Renderer = (typeof RENDERERS)[number]
const renderer = createSetting('vcu.renderer', RENDERERS, 'react')
export const useRenderer = renderer.use
export const setRenderer = renderer.set

// The bench's daylight setting (shared/sun.ts), which also drives the sim's sun
const daylight = createSetting('vcu.daylight', DAYLIGHTS, 'now')
export const useDaylight = daylight.use
export const setDaylight = daylight.set

// The bench's time of day (shared/sun.ts): picking one moves the clock to that
// time today, and it runs on from there. The shift is saved beside it, so the
// sim, both displays and other tabs keep one clock.
const timeOfDay = createSetting('vcu.timeOfDay', TIMES_OF_DAY, 'now')
export const useTimeOfDay = timeOfDay.use

const savedShift = () => {
  try {
    return Number(localStorage.getItem('vcu.clockShift')) || 0
  } catch {
    return 0
  }
}

export function setTimeOfDay(t: TimeOfDay) {
  const now = Date.now()
  try {
    localStorage.setItem('vcu.clockShift', String(clockShift(now, t, localOffsetMin(now))))
  } catch {}
  timeOfDay.set(t)
}

// Milliseconds to add to Date.now() for the bench's clock
export const useClockShift = () => (useTimeOfDay() === 'now' ? 0 : savedShift())

// The input row: per source gives shore and each MPPT a slot on its own
// scale; combined is one bar on the load scale, so input and load compare
export const INPUT_VIEWS = ['per source', 'combined'] as const
export type InputView = (typeof INPUT_VIEWS)[number]
const inputView = createSetting('vcu.input', INPUT_VIEWS, 'combined')
export const useInputView = inputView.use
export const setInputView = inputView.set
