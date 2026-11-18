import type { Smoothing } from './settings'
import type { Currents, SideReading } from './useSide'

// Input per source: solar per MPPT, each about 34 A at full sun (1,750 W at 51.2 V)
export const SOLAR_SLOT_A = 35
// Input per source: shore charging, up to the Elcon's 80 A
export const SHORE_SLOT_A = 80
// Per side: 110 kWh total, so 55 kWh at 51.2 V nominal (the Orion BMS log implies ~1,105 Ah)
export const CAPACITY_AH = 1100
// About 100 of the 110 kWh is usable, so "empty" is 9% SOC
export const RESERVE_PCT = 9

export type PowerView =
  | { online: false }
  | {
      online: true
      soc: number
      shore: boolean
      solarA: number
      // Per MPPT 1–4; null when it isn't allocated to this side
      mpptA: (number | null)[]
      // Shore charging; null when the charger is silent (no shore power)
      chargerA: number | null
      inA: number
      outA: number
      // The house load from the inside out (base + heater + inverter), then the motor
      baseA: number
      heaterA: number
      inverterA: number
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

// Time to full, or to empty counting down to the reserve ("reserve" once in it)
export function eta(soc: number, netA: number, capacityAh = CAPACITY_AH) {
  if (netA > 0 && soc >= 99.5) return 'full'
  if (Math.abs(netA) < 1) return null
  if (netA > 0) return `${hm((((100 - soc) / 100) * capacityAh) / netA)} to full`
  const usable = soc - RESERVE_PCT
  return usable <= 0 ? 'reserve' : `${hm(((usable / 100) * capacityAh) / -netA)} to empty`
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
  const house = Math.max(0, c.houseA)
  const load = propulsion + house
  const inA = Math.round(supplied)
  const outA = Math.round(load)
  // The heater and inverter are part of the derived house load, so they can't exceed it
  const heaterA = Math.round(Math.min(house, Math.max(0, c.heaterA ?? 0)))
  const inverterA = Math.round(Math.min(house - heaterA, Math.max(0, c.inverterA ?? 0)))
  return {
    online: true,
    soc: r.soc,
    shore: r.shore,
    solarA: Math.round(solar),
    mpptA: r.mpptA.map((a) => (a == null ? null : Math.max(0, a))),
    chargerA: c.chargerA == null ? null : Math.round(Math.max(0, c.chargerA)),
    inA,
    outA,
    baseA: Math.max(0, outA - Math.round(propulsion) - heaterA - inverterA),
    heaterA,
    inverterA,
    propulsionA: Math.round(propulsion),
    netA: inA - outA,
    eta: r.etaNetA == null ? pendingEta(r.soc, inA - outA) : eta(r.soc, r.etaNetA),
  }
}
