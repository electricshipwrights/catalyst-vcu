import type { WireFrame } from './can'

export type BusName = 'port' | 'stbd'
export const BUSES: BusName[] = ['port', 'stbd']
export const BUS_IFACE: Record<BusName, string> = { port: 'can0', stbd: 'can1' }
export const BUS_LABEL: Record<BusName, string> = { port: 'PORT', stbd: 'STARBOARD' }

export type SourceKind = 'sim' | 'replay' | 'candump' | 'off'

export type SimParams = {
  solarA: number
  propulsionA: number
  houseA: number
  tempC: number
  capacityAh: number
  bms: boolean
  mppt: boolean
  motor: boolean
  charger: boolean
  shore: boolean
  chargerMaxA: number
}

export type SimPatch = Partial<SimParams> & { soc?: number }

export type SimTruth = SimParams & {
  soc: number
  packV: number
  packA: number
  solarActualA: number
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

export type ServerStatus = { type: 'status'; buses: BusStatus[]; logs: string[]; speed: number }

export type ServerMsg = { type: 'frames'; bus: BusName; frames: WireFrame[] } | ServerStatus

export type ClientMsg =
  | { type: 'source'; bus: BusName; source: 'sim' | 'off' }
  | { type: 'source'; bus: BusName; source: 'replay'; file: string; speed: number }
  | { type: 'sim'; bus: BusName; patch: SimPatch }
  | { type: 'tx'; bus: BusName; frames: WireFrame[] }
  | { type: 'speed'; speed: number }
