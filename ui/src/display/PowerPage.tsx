import type { BusName } from '../../shared/bus'
import { SCALE_MAX_A, powerView, type PowerView } from './power'
import { useSmoothing } from './settings'
import { useSide } from './useSide'

const TRACK_W = 128
const TRACK_X: Record<BusName, number> = { port: 10, stbd: 182 }
const SOLAR_Y = 98
const LOAD_Y = 124

type SegKind = 'solar' | 'propulsion' | 'house'
type Seg = { from: number; to: number; kind: SegKind }

const px = (a: number) => (Math.min(Math.max(a, 0), SCALE_MAX_A) / SCALE_MAX_A) * TRACK_W

function solarSegs(v: PowerView): Seg[] {
  if (!v.online) return []
  return [{ from: 0, to: v.solarA, kind: 'solar' }]
}

function loadSegs(v: PowerView): Seg[] {
  if (!v.online) return []
  return [
    { from: 0, to: v.propulsionA, kind: 'propulsion' },
    { from: v.propulsionA, to: v.outA, kind: 'house' },
  ]
}

function Track({ side, top, segs }: { side: BusName; top: number; segs: Seg[] }) {
  return (
    <div className={`track track-${side}`} style={{ top, left: TRACK_X[side], width: TRACK_W }}>
      {segs.map((s) => {
        const offset = px(s.from)
        const width = px(s.to) - offset
        if (width <= 0) return null
        return (
          <div
            key={s.kind}
            className={`seg seg-${s.kind}`}
            style={side === 'port' ? { right: offset, width } : { left: offset, width }}
          />
        )
      })}
    </div>
  )
}

function Ticks({ side }: { side: BusName }) {
  const x = TRACK_X[side]
  const labels = side === 'port' ? [400, 200, 0] : [0, 200, 400]
  return (
    <>
      {labels.map((a, i) => (
        <span
          key={a}
          className="tick"
          style={{ left: x + (TRACK_W * i) / 2, transform: `translateX(${-50 * i}%)` }}
        >
          {a}
        </span>
      ))}
    </>
  )
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

function ShoreIcon() {
  return (
    <svg className="shore-icon" width="9" height="11" viewBox="0 0 9 11" aria-label="shore power">
      <path d="M2 0 H3.2 V3 H5.8 V0 H7 V3 H9 V5.5 C9 7.2 7.8 8.4 6.2 8.6 V11 H2.8 V8.6 C1.2 8.4 0 7.2 0 5.5 V3 H2 Z" />
    </svg>
  )
}

function FlowIcon({ charging }: { charging: boolean }) {
  return charging ? (
    <svg className="flow-icon charging" width="9" height="13" viewBox="0 0 9 13" aria-label="charging">
      <path d="M5.5 0 L0 7.5 H4 L3 13 L9 5 H5 Z" />
    </svg>
  ) : (
    <svg className="flow-icon" width="10" height="12" viewBox="0 0 10 12" aria-label="discharging">
      <path d="M3.5 0 H6.5 V6.5 H10 L5 12 L0 6.5 H3.5 Z" />
    </svg>
  )
}

function Footer({ side, v }: { side: BusName; v: PowerView }) {
  if (!v.online) {
    return (
      <div className={`footer footer-${side} offline`}>
        <div className="net">NO DATA</div>
        <div className="detail">BMS silent</div>
      </div>
    )
  }
  return (
    <div className={`footer footer-${side}`}>
      <div className="net">
        {v.netA !== 0 && <FlowIcon charging={v.netA > 0} />}
        {signed(v.netA)} A
      </div>
      <div className="detail">
        {[`${v.inA} in`, `${v.outA} out`, v.eta].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

function SideHead({ side, v }: { side: BusName; v: PowerView }) {
  return (
    <>
      <div className={`side-label side-${side}`}>
        {side === 'stbd' && v.online && v.shore && <ShoreIcon />}
        {side === 'port' ? 'PORT' : 'STBD'}
        {side === 'port' && v.online && v.shore && <ShoreIcon />}
      </div>
      <div className={`soc side-${side} ${v.online ? '' : 'offline'}`}>
        {v.online ? Math.round(v.soc) : '--'}
        <span className="pct">%</span>
      </div>
    </>
  )
}

export function PowerPage() {
  const smoothing = useSmoothing()
  const port = powerView(useSide('port'), smoothing)
  const stbd = powerView(useSide('stbd'), smoothing)
  return (
    <div className="page power">
      <SideHead side="port" v={port} />
      <SideHead side="stbd" v={stbd} />
      <div className="soc-caption">SOC</div>

      <Track side="port" top={SOLAR_Y} segs={solarSegs(port)} />
      <Track side="stbd" top={SOLAR_Y} segs={solarSegs(stbd)} />
      <div className="row-label" style={{ top: SOLAR_Y }}>SOLAR</div>

      <Track side="port" top={LOAD_Y} segs={loadSegs(port)} />
      <Track side="stbd" top={LOAD_Y} segs={loadSegs(stbd)} />
      <div className="row-label" style={{ top: LOAD_Y }}>LOAD</div>

      <div className="ticks">
        <Ticks side="port" />
        <Ticks side="stbd" />
      </div>

      <div className="rule" />
      <Footer side="port" v={port} />
      <Footer side="stbd" v={stbd} />
    </div>
  )
}
