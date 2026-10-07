// The device's A, B and C buttons below the screen. The bench's buttons call
// pressButton; both the React and Slint displays listen with onButton.

export const BUTTONS = ['A', 'B', 'C'] as const

const EVENT = 'vcu-button'

export function pressButton(index: number) {
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: index }))
}

export function onButton(listener: (index: number) => void) {
  const handler = (e: Event) => listener((e as CustomEvent<number>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
