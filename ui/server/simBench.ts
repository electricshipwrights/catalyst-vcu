// The simulated boat, shared by the bus server (index.ts) and the page itself
// when there's no server (src/localBus.ts, for a static host). Browser-safe:
// no Node modules here or in what it imports.
import { BUSES, SHORE_INLETS, SIM_SPEEDS, type BusName, type ClientMsg, type SimParams } from '../shared/bus'
import type { Bank } from '../shared/gateway'
import { DAYLIGHTS, DAY_MS } from '../shared/sun'
import { VESSEL } from '../shared/vessel'
import type { Gateway } from './gateway'
import { BatterySim } from './sim'

const BASE: SimParams = {
  skyPct: [75, 75, 85, 85],
  propulsionA: 0,
  houseA: 0,
  heaterA: 0,
  inverterA: 0,
  mppts: [],
  tempC: 24,
  capacityAh: VESSEL.capacityAh,
  bms: true,
  mppt: true,
  charger: true,
  shore: false,
}

const INITIAL: Record<BusName, { params: SimParams; soc: number }> = {
  port: { params: { ...BASE, propulsionA: 70, houseA: 3, mppts: [0, 1] }, soc: 64 },
  stbd: { params: { ...BASE, propulsionA: 65, houseA: 15, mppts: [2, 3] }, soc: 71 },
}

export type Sims = Record<BusName, BatterySim>

export const makeSims = (): Sims =>
  Object.fromEntries(BUSES.map((b) => [b, new BatterySim(b, INITIAL[b].params, INITIAL[b].soc)])) as Sims

// Which side each MPPT is on, from the sims (the gateway's own frame)
export const allocationOf = (sims: Sims): Bank[] =>
  [0, 1, 2, 3].map((i) => BUSES.find((b) => sims[b].params.mppts.includes(i)) ?? 'none')

// Applies a client message that only concerns the sims; false for the rest
export function applySimMsg(sims: Sims, gateway: Gateway, msg: ClientMsg) {
  switch (msg.type) {
    case 'allocation':
      BUSES.forEach((b) => sims[b].patch({ mppts: msg.sides.flatMap((s, i) => (s === b ? [i] : [])) }))
      gateway.allocation(allocationOf(sims))
      return true
    case 'sky':
      if (msg.pct.length === 4) BUSES.forEach((b) => sims[b].patch({ skyPct: msg.pct.map((p) => Math.min(100, Math.max(0, Number(p) || 0))) }))
      return true
    case 'daylight':
      if (DAYLIGHTS.includes(msg.daylight)) BUSES.forEach((b) => (sims[b].daylight = msg.daylight))
      return true
    case 'clock':
      // Within two days either way
      if (Number.isFinite(msg.shiftMs)) BUSES.forEach((b) => (sims[b].clockShiftMs = Math.max(-2 * DAY_MS, Math.min(2 * DAY_MS, msg.shiftMs))))
      return true
    case 'inlet':
      if (SHORE_INLETS.includes(msg.inlet)) BUSES.forEach((b) => (sims[b].inlet = msg.inlet))
      return true
    case 'speed':
      if (SIM_SPEEDS.includes(msg.speed)) BUSES.forEach((b) => (sims[b].speed = msg.speed))
      return true
    case 'sim':
      sims[msg.bus]?.patch(msg.patch)
      return true
    default:
      return false
  }
}

// Frames in a cannelloni packet, from its header
export const packetFrames = (packet: Uint8Array) => (packet[3] << 8) | packet[4]
