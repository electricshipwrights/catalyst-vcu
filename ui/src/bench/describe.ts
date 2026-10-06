import type { Frame } from '../../shared/can'
import {
  ELCON_COMMAND,
  ELCON_STATUS,
  MOTOR_STATUS,
  ORION_CELL,
  ORION_LIMITS,
  ORION_PACK,
  PGN_BATTERY_STATUS,
  decodeBatteryStatus,
  decodeElconCommand,
  decodeElconStatus,
  decodeMotorStatus,
  decodeOrionCell,
  decodeOrionLimits,
  decodeOrionPack,
  n2kPgn,
  n2kSource,
} from '../../shared/protocol'

const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`

export function describe(f: Frame): { name: string; value: string } {
  if (f.ext && f.id === ELCON_COMMAND) {
    const c = decodeElconCommand(f.data)
    return { name: 'Orion → Elcon cmd', value: c ? `${c.maxV.toFixed(1)} V ${c.maxA.toFixed(1)} A ${c.stop ? 'stop' : 'charge'}` : 'bad' }
  }
  if (f.ext && f.id === ELCON_STATUS) {
    const s = decodeElconStatus(f.data)
    return { name: 'Elcon status', value: s ? `${s.v.toFixed(1)} V ${s.a.toFixed(1)} A flags 0x${s.flags.toString(16)}` : 'bad' }
  }
  if (f.ext) {
    const pgn = n2kPgn(f.id)
    const name = `N2K ${pgn} src ${hex2(n2kSource(f.id))}`
    if (pgn === PGN_BATTERY_STATUS) {
      const b = decodeBatteryStatus(f.data)
      return { name: `${name} batt status`, value: b ? `${b.v.toFixed(2)} V ${b.a?.toFixed(1) ?? 'n/a'} A` : 'bad' }
    }
    return { name, value: '' }
  }
  if (f.id === ORION_PACK) {
    const p = decodeOrionPack(f.data)
    return { name: 'Orion pack', value: p ? `${p.packA.toFixed(1)} A ${p.packV.toFixed(1)} V ${p.soc}%` : 'bad checksum' }
  }
  if (f.id === ORION_LIMITS) {
    const l = decodeOrionLimits(f.data)
    return { name: 'Orion limits', value: l ? `DCL ${l.dcl} CCL ${l.ccl} ${l.tLo}–${l.tHi}°C` : 'bad checksum' }
  }
  if (f.id === ORION_CELL) {
    const c = decodeOrionCell(f.data)
    return { name: 'Orion cell', value: c ? `#${hex2(c.cell)} ${c.v.toFixed(4)} V` : 'bad checksum' }
  }
  if (f.id === MOTOR_STATUS) {
    const m = decodeMotorStatus(f.data)
    return { name: 'Motor (placeholder)', value: m ? `${m.a.toFixed(1)} A` : 'bad' }
  }
  return { name: '?', value: '' }
}
