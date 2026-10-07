import { toHex, type WireFrame } from '../shared/can'
import type { SimParams, SimPatch, SimTruth } from '../shared/bus'
import {
  MOTOR_STATUS,
  ORION_CELL,
  ORION_CELL_IDS,
  ORION_LIMITS,
  ORION_PACK,
  ORION_RELAYS_DEFAULT,
  ELCON_COMMAND,
  ELCON_FLAGS,
  ELCON_STATUS,
  PGN_BATTERY_STATUS,
  SIM_MPPT_SOURCE,
  encodeBatteryStatus,
  encodeElconCommand,
  encodeElconStatus,
  encodeMotorStatus,
  encodeOrionCell,
  encodeOrionLimits,
  encodeOrionPack,
  n2kId,
} from '../shared/protocol'
import { VESSEL } from '../shared/vessel'

const OCV_LFP: [number, number][] = [
  [0, 2.5], [5, 3.0], [10, 3.2], [20, 3.25], [30, 3.27], [40, 3.28], [50, 3.29],
  [60, 3.3], [70, 3.31], [80, 3.32], [90, 3.34], [95, 3.36], [100, 3.45],
]
const R_CELL = 0.00045
const CCL_MAX = 182
const DCL_MAX = 494
const CHARGER_POWER_W = 6600 * 0.95
const CHARGE_V_MAX = 16 * 3.55

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const ramp = (v: number, from: number, to: number) => clamp((v - from) / (to - from), 0, 1)
const noise = (amp: number) => (Math.random() - 0.5) * 2 * amp

function ocv(soc: number) {
  for (let i = 1; i < OCV_LFP.length; i++) {
    const [s1, v1] = OCV_LFP[i]
    if (soc <= s1) {
      const [s0, v0] = OCV_LFP[i - 1]
      return v0 + ((v1 - v0) * (soc - s0)) / (s1 - s0)
    }
  }
  return OCV_LFP[OCV_LFP.length - 1][1]
}

export class BatterySim {
  params: SimParams
  soc: number
  private solar: number
  private propulsion: number
  private house: number
  private charger = 0
  private packA = 0
  private offsets = ORION_CELL_IDS.map(() => noise(0.006))
  private timers: ReturnType<typeof setInterval>[] = []
  speed = 1
  private last = performance.now()
  private sid = 0
  private cell = 0

  constructor(params: SimParams, soc: number) {
    this.params = params
    this.soc = soc
    this.solar = params.solarA
    this.propulsion = params.propulsionA
    this.house = params.houseA
    this.packA = this.propulsionActual + this.house - this.solarActual
  }

  get chargerOn() {
    return this.params.shore && this.params.charger && this.params.bms && this.ccl > 0
  }

  get chargerTarget() {
    return this.chargerOn ? Math.min(VESSEL.chargerMaxA, CHARGER_POWER_W / this.packV, this.ccl) : 0
  }

  patch({ soc, ...rest }: SimPatch) {
    if (soc != null) this.soc = clamp(soc, 0, 100)
    this.params = { ...this.params, ...rest }
  }

  get tLo() {
    return this.params.tempC
  }

  get tHi() {
    return this.params.tempC + 1 + Math.abs(this.packA) / 150
  }

  get cclTempFactor() {
    return Math.min(ramp(this.tLo, 0, 10), 1 - ramp(this.tHi, 45, 55))
  }

  get dclTempFactor() {
    return Math.min(ramp(this.tLo, -20, 0), 1 - ramp(this.tHi, 50, 60))
  }

  get ccl() {
    return CCL_MAX * (1 - ramp(this.soc, 95, 100)) * this.cclTempFactor
  }

  get dcl() {
    return DCL_MAX * ramp(this.soc, 0, 10) * this.dclTempFactor
  }

  get propulsionActual() {
    return clamp(this.propulsion, 0, Math.max(0, this.dcl + this.solar + this.charger - this.house))
  }

  get solarActual() {
    return Math.max(0, Math.min(this.solar, this.propulsionActual + this.house + this.ccl - this.charger))
  }

  cellV(i: number) {
    return ocv(this.soc) + this.offsets[i] - this.packA * R_CELL
  }

  get packV() {
    return ORION_CELL_IDS.reduce((sum, _, i) => sum + this.cellV(i), 0)
  }

  truth(): SimTruth {
    return {
      ...this.params,
      soc: this.soc,
      packV: this.packV,
      packA: this.packA,
      solarActualA: this.solarActual,
      propulsionActualA: this.propulsionActual,
      chargerActualA: this.charger,
      ccl: this.ccl,
      dcl: this.dcl,
      tLo: this.tLo,
      tHi: this.tHi,
      cclTempFactor: this.cclTempFactor,
      dclTempFactor: this.dclTempFactor,
    }
  }

  run(emit: (f: WireFrame) => void) {
    const send = (id: number, ext: boolean, data: Uint8Array) => emit({ id, ext, data: toHex(data), t: Date.now() })
    const every = (ms: number, fn: () => void) => this.timers.push(setInterval(fn, ms))

    every(8, () => {
      this.step()
      if (!this.params.bms) return
      send(ORION_PACK, false, encodeOrionPack({
        packA: this.packA + noise(0.4),
        packV: this.packV,
        soc: this.soc,
        relays: ORION_RELAYS_DEFAULT,
      }))
    })
    every(103, () => {
      if (!this.params.bms) return
      send(ORION_LIMITS, false, encodeOrionLimits({
        dcl: this.dcl,
        ccl: this.ccl,
        tHi: this.tHi,
        tLo: this.tLo,
      }))
    })
    every(994, () => {
      if (this.params.bms) {
        const i = this.cell++ % ORION_CELL_IDS.length
        send(ORION_CELL, false, encodeOrionCell({
          cell: ORION_CELL_IDS[i],
          v: this.cellV(i),
          r: R_CELL,
          ocv: ocv(this.soc) + this.offsets[i],
        }))
      }
      if (this.params.mppt) {
        send(n2kId(PGN_BATTERY_STATUS, SIM_MPPT_SOURCE), true, encodeBatteryStatus({
          instance: 0,
          v: this.packV,
          a: this.solarActual + noise(0.3),
          tempC: null,
          sid: this.sid++ % 253,
        }))
      }
    })
    every(1000, () => {
      if (this.params.bms) {
        send(ELCON_COMMAND, true, encodeElconCommand({ maxV: CHARGE_V_MAX, maxA: this.ccl, stop: this.ccl <= 0 }))
      }
      if (this.params.shore && this.params.charger) {
        const flags = (this.params.bms ? 0 : ELCON_FLAGS.commTimeout) | (this.chargerOn ? 0 : ELCON_FLAGS.stopped)
        send(ELCON_STATUS, true, encodeElconStatus({ v: this.packV, a: this.charger + (this.charger > 0 ? noise(0.2) : 0), flags }))
      }
    })
    every(50, () => {
      if (this.params.motor) send(MOTOR_STATUS, false, encodeMotorStatus({ a: this.propulsionActual + noise(0.5) }))
    })
  }

  stop() {
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  private step() {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000) * this.speed
    this.last = now
    const k = (tau: number) => 1 - Math.exp(-dt / tau)
    this.solar += (this.params.solarA - this.solar) * k(0.4)
    this.propulsion += (this.params.propulsionA - this.propulsion) * k(0.6)
    this.house += (this.params.houseA - this.house) * k(0.3)
    this.charger = this.chargerOn ? this.charger + (this.chargerTarget - this.charger) * k(3) : 0
    this.packA = this.propulsionActual + this.house - this.solarActual - this.charger
    this.soc = clamp(this.soc - (this.packA * dt * 100) / 3600 / this.params.capacityAh, 0, 100)
  }
}
