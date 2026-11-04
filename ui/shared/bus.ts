import type { WireFrame } from './can'
import type { Bank } from './gateway'

export type BusName = 'port' | 'stbd'
export const BUSES: BusName[] = ['port', 'stbd']
export const BUS_IFACE: Record<BusName, string> = { port: 'can0', stbd: 'can1' }
export const BUS_LABEL: Record<BusName, string> = { port: 'PORT', stbd: 'STARBOARD' }

export type SourceKind = 'sim' | 'replay' | 'candump' | 'off'

export type SimParams = {
  // What each MPPT 1–4's panels could give now (A); the same in both sims
  panelA: number[]
  propulsionA: number
  houseA: number // base load, not on any bus
  heaterA: number // on CAN6 (assumed)
  inverterA: number // on CAN6 (assumed)
  // The MPPTs allocated to this side, 0–3 for MPPT 1–4
  mppts: number[]
  tempC: number
  capacityAh: number
  bms: boolean
  mppt: boolean
  charger: boolean
  shore: boolean
}

export type SimPatch = Partial<SimParams> & { soc?: number }

export type SimTruth = SimParams & {
  soc: number
  packV: number
  packA: number
  solarAvailableA: number // before CCL curtailment
  solarActualA: number
  mpptActualA: number[] // per MPPT 1–4; 0 for those on the other side
  propulsionActualA: number
  chargerActualA: number
  ccl: number
  dcl: number
  tLo: number
  tHi: number
  cclTempFactor: number
  dclTempFactor: number
}

export type ReplayStatus = { file: string; speed: number; position: number; duration: number }

export type BusStatus = {
  bus: BusName
  source: SourceKind
  fps: number
  sim: SimTruth
  detail?: string
  replay?: ReplayStatus
}

export const SIM_SPEEDS = [1, 10, 60]

// sim: the bus server stands in for the router; router: the real one, over UDP
export type GatewaySource = 'sim' | 'router'
export type GatewayStatus = {
  source: GatewaySource
  fps: Record<number, number> // frames per second, per gateway bus
  router: string | null // the router's address, once heard
  udpOut: string | null // where simulated packets are also sent as UDP
}

export type ServerStatus = { type: 'status'; buses: BusStatus[]; gateway: GatewayStatus; logs: string[]; speed: number }

export type ServerMsg = { type: 'frames'; bus: BusName; frames: WireFrame[] } | ServerStatus

export type ClientMsg =
  | { type: 'source'; bus: BusName; source: 'sim' | 'off' }
  | { type: 'source'; bus: BusName; source: 'replay'; file: string; speed: number }
  | { type: 'sim'; bus: BusName; patch: SimPatch }
  | { type: 'tx'; bus: BusName; frames: WireFrame[] }
  | { type: 'speed'; speed: number }
  | { type: 'allocation'; sides: Bank[] }
  | { type: 'panels'; a: number[] }
  | { type: 'gateway'; source: GatewaySource }
