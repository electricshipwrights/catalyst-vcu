import { BUSES, type BusName, type BusStatus, type SimPatch } from '../../shared/bus'
import { VESSEL } from '../../shared/vessel'
import { send, useServerStatus } from '../bus'

const both = (patch: SimPatch): Record<BusName, SimPatch> => ({ port: patch, stbd: patch })

const PRESETS: { label: string; sides: Record<BusName, SimPatch> }[] = [
  {
    label: 'Wireframe',
    sides: {
      port: { solarA: 52, propulsionA: 70, houseA: 3, shore: false, soc: 64 },
      stbd: { solarA: 58, propulsionA: 65, houseA: 15, shore: false, soc: 71 },
    },
  },
  { label: 'Cruise', sides: both({ solarA: 55, propulsionA: VESSEL.cruiseA, houseA: 10, shore: false }) },
  { label: 'Full throttle', sides: both({ solarA: 55, propulsionA: 320, houseA: 10, shore: false }) },
  { label: 'Moored, sun', sides: both({ solarA: 60, propulsionA: 0, houseA: 10, shore: false }) },
  { label: 'Night', sides: both({ solarA: 0, propulsionA: 0, houseA: 10, shore: false }) },
  { label: 'Shore power', sides: both({ solarA: 0, propulsionA: 0, houseA: 10, shore: true }) },
]

function matches(sides: Record<BusName, SimPatch>, buses: BusStatus[] | undefined) {
  if (!buses) return false
  return BUSES.every((bus) => {
    const sim = buses.find((b) => b.bus === bus)?.sim
    if (!sim) return false
    return Object.entries(sides[bus]).every(
      ([k, v]) => k === 'soc' || Math.abs(Number(sim[k as keyof typeof sim]) - Number(v)) < 0.5,
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
          aria-pressed={matches(p.sides, buses)}
          onClick={() => BUSES.forEach((bus) => send({ type: 'sim', bus, patch: p.sides[bus] }))}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
