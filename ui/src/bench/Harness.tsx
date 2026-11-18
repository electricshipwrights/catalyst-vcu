import { useEffect, useState, type RefObject } from 'react'
import { BUSES, type BusName } from '../../shared/bus'
import { busName } from '../../shared/gateway'

const AMPLITUDE = 3
const PERIOD = 24
const INSET = 24
const TUCK = 8
const CORNER = 8 // how far above a box's bottom a wire leaves, when it leaves there
const LANE = 14 // the first lane's distance from the column
const LANE_GAP = 10

type Ref = RefObject<HTMLElement | null>
type Pt = [number, number]
type Box = { l: number; r: number; t: number; b: number }
type Leg = { bus: number; b: Box; y: number; bottom: boolean }
type Wire = { bus: number; pts: Pt[]; label: Pt; anchor: 'start' | 'end' }
type Geo = { w: number; h: number; wires: Wire[]; eth: Pt[] }

// A twisted pair along a path of straight segments
function twist(pts: Pt[], phase: number) {
  const segs = pts.slice(1).map((p, i) => {
    const [x0, y0] = pts[i]
    return { x0, y0, dx: p[0] - x0, dy: p[1] - y0, len: Math.hypot(p[0] - x0, p[1] - y0) || 1 }
  })
  const total = segs.reduce((sum, s) => sum + s.len, 0)
  const turns = Math.max(1, Math.round(total / PERIOD))
  const out: string[] = []
  let done = 0
  for (const s of segs) {
    const steps = Math.max(2, Math.round((s.len / PERIOD) * 12))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const off = Math.sin(((done + s.len * t) / total) * turns * 2 * Math.PI + phase) * AMPLITUDE
      out.push(`${(s.x0 + s.dx * t - (s.dy / s.len) * off).toFixed(1)},${(s.y0 + s.dy * t + (s.dx / s.len) * off).toFixed(1)}`)
    }
    done += s.len
  }
  return `M${out.join(' L')}`
}

// A wire from each bus box ([data-wire]) to that bus's row on the gateway
// panel; then Ethernet from the gateway to the display
export function Harness({ stage, display, gateway, fps }: { stage: Ref; display: Ref; gateway: Ref; fps: Record<number, number> }) {
  const [geo, setGeo] = useState<Geo | null>(null)

  useEffect(() => {
    const [st, disp, gw] = [stage.current, display.current, gateway.current]
    if (!st || !disp || !gw) return
    const boxes = [...st.querySelectorAll<HTMLElement>('[data-wire]')]
    const measure = () => {
      const s = st.getBoundingClientRect()
      const rel = (el: Element): Box => {
        const r = el.getBoundingClientRect()
        return { l: r.left - s.left, r: r.right - s.left, t: r.top - s.top, b: r.bottom - s.top }
      }
      const d = rel(disp)
      const g = rel(gw)
      const mid = (g.l + g.r) / 2
      const wires: Wire[] = []
      const legs: Record<BusName, Leg[]> = { port: [], stbd: [] }
      for (const el of boxes) {
        const bus = Number(el.dataset.wire)
        const b = rel(el)
        const row = gw.querySelector(`[data-bus="${bus}"]`)
        if (!row) continue
        const r = rel(row)
        legs[(b.l + b.r) / 2 < mid ? 'port' : 'stbd'].push({ bus, b, y: (r.t + r.b) / 2, bottom: el.dataset.wireAt === 'bottom' })
      }
      for (const side of BUSES) {
        const toward = side === 'port' ? 1 : -1
        const gx = side === 'port' ? g.l : g.r
        // Where a wire leaves its box: level with its row if the row is beside
        // the box, otherwise by the box's header, which names the bus, or at
        // its bottom corner if the box asks for that
        const exit = ({ b, y, bottom }: Leg) => {
          const top = Math.min(b.t + INSET, (b.t + b.b) / 2)
          return y >= top && y <= b.b - INSET ? y : bottom ? b.b - CORNER : top
        }
        // Wires that turn run down (or up) the gap beside the column. The
        // topmost going down, and the bottommost going up, takes the lane
        // nearest the gateway, so no wires cross.
        const lane = new Map<Leg, number>()
        const down = legs[side].filter((l) => l.y > exit(l)).sort((p, q) => p.y - q.y)
        const up = legs[side].filter((l) => l.y < exit(l)).sort((p, q) => q.y - p.y)
        for (const group of [down, up]) group.forEach((l, i) => lane.set(l, group.length - 1 - i))
        for (const l of legs[side]) {
          const inner = side === 'port' ? l.b.r : l.b.l // the edge facing the gateway
          const k = lane.get(l)
          const x = inner + toward * (LANE + (k ?? 0) * LANE_GAP)
          const pts: Pt[] =
            k === undefined
              ? [[inner - toward * TUCK, l.y], [gx, l.y]]
              : [[inner - toward * TUCK, exit(l)], [x, exit(l)], [x, l.y], [gx, l.y]]
          wires.push({ bus: l.bus, pts, label: [gx - toward * 8, l.y - 7], anchor: side === 'port' ? 'end' : 'start' })
        }
      }
      setGeo({ w: s.width, h: s.height, wires, eth: [[mid, g.t], [mid, d.b]] })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ;[st, disp, gw, ...boxes].forEach((e) => ro.observe(e))
    return () => ro.disconnect()
  }, [stage, display, gateway])

  if (!geo) return null
  const { eth } = geo

  return (
    <svg className="harness" width={geo.w} height={geo.h}>
      {geo.wires.map((w) => (
        <g key={w.bus} className={fps[w.bus] ? 'live' : ''}>
          <path className="can-h" d={twist(w.pts, 0)} />
          <path className="can-l" d={twist(w.pts, Math.PI)} />
          <text x={w.label[0]} y={w.label[1]} textAnchor={w.anchor}>
            {busName(w.bus)}
          </text>
        </g>
      ))}
      <g className={Object.values(fps).some(Boolean) ? 'live eth' : 'eth'}>
        <path d={`M${eth[0].join(',')} L${eth[1].join(',')}`} />
        <text x={eth[0][0] + 10} y={(eth[0][1] + eth[1][1]) / 2 + 4}>
          Ethernet · UDP
        </text>
      </g>
    </svg>
  )
}
