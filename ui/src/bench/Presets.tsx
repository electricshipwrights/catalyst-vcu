import { BUSES, type BusName, type BusStatus, type SimPatch } from '../../shared/bus'
import { VESSEL } from '../../shared/vessel'
import { send, useServerStatus } from '../bus'

const both = (patch: SimPatch): Record<BusName, SimPatch> => ({ port: patch, stbd: patch })
const NO_HEAT_OR_COOKING = { heaterA: 0, inverterA: 0 }

const sky = (pct: number) => [pct, pct, pct, pct]

// skyPct: each MPPT 1–4's sky (% of clear), shared by both sides; what that
// gives depends on the time of day and the daylight setting
const PRESETS: { label: string; skyPct: number[]; sides: Record<BusName, SimPatch> }[] = [
  {
    label: 'Wireframe',
    skyPct: [75, 75, 85, 85],
    sides: {
      port: { propulsionA: 70, houseA: 3, ...NO_HEAT_OR_COOKING, shore: false, soc: 64 },
      stbd: { propulsionA: 65, houseA: 15, ...NO_HEAT_OR_COOKING, shore: false, soc: 71 },
    },
  },
  { label: 'Cruise', skyPct: sky(80), sides: both({ propulsionA: VESSEL.cruiseA, houseA: 10, ...NO_HEAT_OR_COOKING, shore: false }) },
  { label: 'Full throttle', skyPct: sky(80), sides: both({ propulsionA: 320, houseA: 10, ...NO_HEAT_OR_COOKING, shore: false }) },
  { label: 'Moored', skyPct: sky(90), sides: both({ propulsionA: 0, houseA: 10, ...NO_HEAT_OR_COOKING, shore: false }) },
  { label: 'Shore power', skyPct: sky(0), sides: both({ propulsionA: 0, houseA: 10, ...NO_HEAT_OR_COOKING, shore: true }) },
]

const near = (a: unknown, b: unknown) => Math.abs(Number(a) - Number(b)) < 0.5

function matches(p: (typeof PRESETS)[number], buses: BusStatus[] | undefined) {
  if (!buses) return false
  return BUSES.every((bus) => {
    const sim = buses.find((b) => b.bus === bus)?.sim
    if (!sim) return false
    return (
      p.skyPct.every((pct, i) => near(sim.skyPct[i], pct)) &&
      Object.entries(p.sides[bus]).every(([k, v]) => k === 'soc' || near(sim[k as keyof typeof sim], v))
    )
  })
}

export function Presets() {
  const buses = useServerStatus()?.buses
  return (
    <div className="presets scenario">
      <span>scenario</span>
      {PRESETS.map((p) => (
        <button
          key={p.label}
          aria-pressed={matches(p, buses)}
          onClick={() => {
            send({ type: 'sky', pct: p.skyPct })
            BUSES.forEach((bus) => send({ type: 'sim', bus, patch: p.sides[bus] }))
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
