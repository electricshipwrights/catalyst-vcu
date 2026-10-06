import { useEffect, useState, type RefObject } from 'react'
import { BUSES, BUS_IFACE, type BusName } from '../../shared/bus'

const AMPLITUDE = 3
const PERIOD = 24
const WIRE_Y = 24
const TUCK = 8

type Ref = RefObject<HTMLElement | null>
type Span = { x0: number; x1: number; y: number }
type Geo = { w: number; h: number; wires: Record<BusName, Span> }

function twist({ x0, x1, y }: Span, phase: number) {
  const len = Math.abs(x1 - x0)
  const turns = Math.max(1, Math.round(len / PERIOD))
  const steps = turns * 12
  const pts = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    return `${x.toFixed(1)},${(y + Math.sin(t * turns * 2 * Math.PI + phase) * AMPLITUDE).toFixed(1)}`
  })
  return `M${pts.join(' L')}`
}

export function Harness({
  stage,
  display,
  boxes,
  live,
}: {
  stage: Ref
  display: Ref
  boxes: Record<BusName, Ref>
  live: Record<BusName, boolean>
}) {
  const [geo, setGeo] = useState<Geo | null>(null)

  useEffect(() => {
    const els = [stage.current, display.current, boxes.port.current, boxes.stbd.current]
    if (els.some((e) => !e)) return
    const measure = () => {
      const s = stage.current!.getBoundingClientRect()
      const rel = (el: HTMLElement) => {
        const r = el.getBoundingClientRect()
        return { l: r.left - s.left, r: r.right - s.left, t: r.top - s.top, b: r.bottom - s.top }
      }
      const d = rel(display.current!)
      const wire = (bus: BusName): Span => {
        const b = rel(boxes[bus].current!)
        const y = Math.min(b.t + WIRE_Y, d.b - WIRE_Y)
        return bus === 'port' ? { x0: b.r - TUCK, x1: d.l + TUCK, y } : { x0: b.l + TUCK, x1: d.r - TUCK, y }
      }
      setGeo({ w: s.width, h: s.height, wires: { port: wire('port'), stbd: wire('stbd') } })
    }
    measure()
    const ro = new ResizeObserver(measure)
    els.forEach((e) => ro.observe(e!))
    return () => ro.disconnect()
  }, [stage, display, boxes])

  if (!geo) return null

  return (
    <svg className="harness" width={geo.w} height={geo.h}>
      {BUSES.map((bus) => {
        const span = geo.wires[bus]
        return (
          <g key={bus} className={live[bus] ? 'live' : ''}>
            <path className="can-h" d={twist(span, 0)} />
            <path className="can-l" d={twist(span, Math.PI)} />
            <text x={(span.x0 + span.x1) / 2} y={span.y + 18} textAnchor="middle">
              {BUS_IFACE[bus]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
