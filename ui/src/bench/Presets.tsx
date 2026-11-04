import { BUSES, type BusName, type BusStatus, type SimPatch } from '../../shared/bus'
import { VESSEL } from '../../shared/vessel'
import { send, useServerStatus } from '../bus'

const both = (patch: SimPatch): Record<BusName, SimPatch> => ({ port: patch, stbd: patch })
const NO_HEAT_OR_COOKING = { heaterA: 0, inverterA: 0 }

const sun = (a: number) => [a, a, a, a]

// panelA: what each MPPT 1–4 could give, shared by both sides
const PRESETS: { label: string; panelA: number[]; sides: Record<BusName, SimPatch> }[] = [
  {
    label: 'Wireframe',
    panelA: [26, 26, 29, 29],
    sides: {
      port: { propulsionA: 70, houseA: 3, ...NO_HEAT_OR_COOKING, shore: false, soc: 64 },
      stbd: { propulsionA: 65, houseA: 15, ...NO_HEAT_OR_COOKING, shore: false, soc: 71 },
    },
  },
  { label: 'Cruise', panelA: sun(28), sides: both({ propulsionA: VESSEL.cruiseA, houseA: 10, ...NO_HEAT_OR_COOKING, shore: false }) },
  { label: 'Full throttle', panelA: sun(28), sides: both({ propulsionA: 320, houseA: 10, ...NO_HEAT_OR_COOKING, shore: false }) },
  { label: 'Moored, sun', panelA: sun(30), sides: both({ propulsionA: 0, houseA: 10, ...NO_HEAT_OR_COOKING, shore: false }) },
  { label: 'Night', panelA: sun(0), sides: both({ propulsionA: 0, houseA: 10, ...NO_HEAT_OR_COOKING, shore: false }) },
  { label: 'Shore power', panelA: sun(0), sides: both({ propulsionA: 0, houseA: 10, ...NO_HEAT_OR_COOKING, shore: true }) },
]

const near = (a: unknown, b: unknown) => Math.abs(Number(a) - Number(b)) < 0.5

function matches(p: (typeof PRESETS)[number], buses: BusStatus[] | undefined) {
  if (!buses) return false
  return BUSES.every((bus) => {
    const sim = buses.find((b) => b.bus === bus)?.sim
    if (!sim) return false
    return (
      p.panelA.every((a, i) => near(sim.panelA[i], a)) &&
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
            send({ type: 'panels', a: p.panelA })
            BUSES.forEach((bus) => send({ type: 'sim', bus, patch: p.sides[bus] }))
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
