import type { Smoothing } from './settings'
import type { Currents, SideReading } from './useSide'

export const SCALE_MAX_A = 400
export const CAPACITY_AH = 280

export type PowerView =
  | { online: false }
  | {
      online: true
      soc: number
      shore: boolean
      solarA: number
      inA: number
      outA: number
      propulsionA: number
      netA: number
      eta: string | null
    }

const pad2 = (n: number) => String(n).padStart(2, '0')

// Under 1 h to the minute ("0:42"), 1–7 h to 15 min ("2:15"), then whole hours ("9h")
function hm(hours: number) {
  if (hours < 7) {
    const step = hours >= 1 ? 15 : 1
    const total = Math.round((hours * 60) / step) * step
    if (total < 420) return `${Math.floor(total / 60)}:${pad2(total % 60)}`
  }
  const h = Math.round(hours)
  return h >= 100 ? '99h+' : `${h}h`
}

export function eta(soc: number, netA: number, capacityAh = CAPACITY_AH) {
  if (netA > 0 && soc >= 99.5) return 'full'
  if (Math.abs(netA) < 1) return null
  return netA < 0
    ? `${hm(((soc / 100) * capacityAh) / -netA)} to empty`
    : `${hm((((100 - soc) / 100) * capacityAh) / netA)} to full`
}

function pendingEta(soc: number, netA: number) {
  if (netA > 0 && soc >= 99.5) return 'full'
  if (netA === 0) return null
  return `-- to ${netA > 0 ? 'full' : 'empty'}`
}

export function powerView(r: SideReading, smoothing: Smoothing): PowerView {
  if (!r.online) return { online: false }
  const c: Currents = smoothing === 'smooth' ? r.smooth : r
  const solar = Math.max(0, c.solarA ?? 0)
  const supplied = solar + Math.max(0, c.chargerA ?? 0)
  const propulsion = Math.max(0, c.propulsionA ?? 0)
  const load = propulsion + Math.max(0, c.houseA)
  const inA = Math.round(supplied)
  const outA = Math.round(load)
  return {
    online: true,
    soc: r.soc,
    shore: r.shore,
    solarA: Math.round(solar),
    inA,
    outA,
    propulsionA: Math.round(propulsion),
    netA: inA - outA,
    eta: r.etaNetA == null ? pendingEta(r.soc, inA - outA) : eta(r.soc, r.etaNetA),
  }
}
