import { useEffect, useRef, useState, type ComponentType } from 'react'
import { onButton } from './buttons'
import { PowerPage } from './PowerPage'
import { useTheme } from './settings'
import './display.css'

type Page = { title: string; Component: ComponentType }

const Stub = () => <div className="page stub">tbd</div>

// One view per hardware button: A, B, C
const PAGES: Page[] = [
  { title: 'POWER', Component: PowerPage },
  { title: 'VIEW 2', Component: Stub },
  { title: 'VIEW 3', Component: Stub },
]

export function Display() {
  const [index, setIndex] = useState(0)
  const swipeStart = useRef<number | null>(null)
  const theme = useTheme()
  const page = PAGES[index]

  const select = (i: number) => setIndex(Math.min(PAGES.length - 1, Math.max(0, i)))
  useEffect(() => onButton(select), [])

  return (
    <div
      className="lcd"
      data-theme={theme}
      onPointerDown={(e) => (swipeStart.current = e.clientX)}
      onPointerUp={(e) => {
        if (swipeStart.current == null) return
        const dx = e.clientX - swipeStart.current
        swipeStart.current = null
        if (Math.abs(dx) > 30) select(index + (dx < 0 ? 1 : -1))
      }}
    >
      {/* Each label sits under its button, at the center of its third */}
      <nav className="lcd-nav">
        {PAGES.map((p, i) => (
          <button key={p.title} className={i === index ? 'on' : ''} onClick={() => select(i)}>
            <span>{p.title}</span>
          </button>
        ))}
      </nav>
      <page.Component />
    </div>
  )
}
