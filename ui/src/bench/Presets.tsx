import { BUSES, type BusName, type BusStatus, type SimPatch } from '../../shared/bus'
import { send, useServerStatus } from '../bus'

const both = (patch: SimPatch): Record<BusName, SimPatch> => ({ port: patch, stbd: patch })

const PRESETS: { label: string; sides: Record<BusName, SimPatch> }[] = [
  {
    label: 'Wireframe',
    sides: {
      port: { solarA: 142, propulsionA: 170, houseA: 32, shore: false, soc: 64 },
      stbd: { solarA: 168, propulsionA: 125, houseA: 13, shore: false, soc: 71 },
    },
  },
  { label: 'Cruise', sides: both({ solarA: 140, propulsionA: 170, houseA: 30, shore: false }) },
  { label: 'Full throttle', sides: both({ solarA: 150, propulsionA: 380, houseA: 25, shore: false }) },
  { label: 'Moored, sun', sides: both({ solarA: 170, propulsionA: 0, houseA: 12, shore: false }) },
  { label: 'Night', sides: both({ solarA: 0, propulsionA: 0, houseA: 15, shore: false }) },
  { label: 'Shore power', sides: both({ solarA: 0, propulsionA: 0, houseA: 15, shore: true }) },
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
