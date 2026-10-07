import { useSyncExternalStore } from 'react'

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
const renderer = createSetting('vcu.renderer', RENDERERS, 'slint')
export const useRenderer = renderer.use
export const setRenderer = renderer.set



// Bar scales: relative gives solar its own scale; absolute puts solar on the
// load scale so the two bars compare directly
export const SCALES = ['relative', 'absolute'] as const
export type Scale = (typeof SCALES)[number]
const scale = createSetting('vcu.scale', SCALES, 'relative')
export const useScale = scale.use
export const setScale = scale.set
