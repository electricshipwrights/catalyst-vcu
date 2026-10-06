import { useEffect, useRef, useState, type ComponentType } from 'react'
import { PowerPage } from './PowerPage'
import { useTheme } from './settings'
import './display.css'

type Page = { title: string; Component: ComponentType }

const Stub = () => <div className="page stub">not designed yet</div>

const PAGES: Page[] = [
  { title: 'POWER', Component: PowerPage },
  { title: 'VIEW 2', Component: Stub },
  { title: 'VIEW 3', Component: Stub },
  { title: 'VIEW 4', Component: Stub },
]

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(t)
  }, [])
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function Display() {
  const [index, setIndex] = useState(0)
  const swipeStart = useRef<number | null>(null)
  const clock = useClock()
  const theme = useTheme()
  const page = PAGES[index]

  const go = (delta: number) => setIndex((i) => Math.min(PAGES.length - 1, Math.max(0, i + delta)))

  return (
    <div
      className="lcd"
      data-theme={theme}
      onPointerDown={(e) => (swipeStart.current = e.clientX)}
      onPointerUp={(e) => {
        if (swipeStart.current == null) return
        const dx = e.clientX - swipeStart.current
        swipeStart.current = null
        if (Math.abs(dx) > 30) go(dx < 0 ? 1 : -1)
      }}
    >
      <header className="lcd-header">
        <span className="title">{page.title}</span>
        <span className="clock">{clock}</span>
        <span className="dots">
          {PAGES.map((p, i) => (
            <button key={p.title} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} aria-label={p.title} />
          ))}
        </span>
      </header>
      <page.Component />
    </div>
  )
}
