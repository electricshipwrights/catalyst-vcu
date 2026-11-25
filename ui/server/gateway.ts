// Stands in for the gateway: puts each side's frames on the bus GATEWAY.md
// assigns them, adds the MPPT allocation, and packs each bus's frames into
// cannelloni packets as the PCAN router does.
import type { BusName } from '../shared/bus'
import { fromHex, type WireFrame } from '../shared/can'
import { GATEWAY_BUSES, MPPT_ALLOCATION, encodeAllocation, encodeCannelloni, type Bank, type GatewayFrame } from '../shared/gateway'
import { ELCON_COMMAND, ELCON_STATUS, MOTOR_STATUS, PGN_SYSTEM_TIME, TIME_SOURCE, encodeSystemTime, n2kId } from '../shared/protocol'

function busFor(side: BusName, f: WireFrame) {
  if (f.ext && (f.id === ELCON_STATUS || f.id === ELCON_COMMAND)) return GATEWAY_BUSES.charger[side]
  if (f.ext) return GATEWAY_BUSES.nmea
  if (f.id === MOTOR_STATUS) return GATEWAY_BUSES.motor[side]
  return GATEWAY_BUSES.bms[side]
}

export class Gateway {
  private pending: GatewayFrame[] = []
  private seq = new Map<number, number>() // per bus, like the router
  private sid = 0

  push(side: BusName, f: WireFrame) {
    this.pending.push({ bus: busFor(side, f), id: f.id, ext: f.ext, data: fromHex(f.data) })
  }

  allocation(sides: Bank[]) {
    this.pending.push({ bus: GATEWAY_BUSES.self, id: MPPT_ALLOCATION, ext: false, data: encodeAllocation(sides) })
  }

  // The sims' clock on NMEA 2000, as a GPS would send it
  time(ms: number) {
    const data = encodeSystemTime({ sid: this.sid++ % 253, ms })
    this.pending.push({ bus: GATEWAY_BUSES.nmea, id: n2kId(PGN_SYSTEM_TIME, TIME_SOURCE), ext: true, data })
  }

  // The packets for everything since the last call, per bus
  flush() {
    const out: { bus: number; packet: Uint8Array }[] = []
    for (const bus of new Set(this.pending.map((f) => f.bus))) {
      const seq = this.seq.get(bus) ?? 0
      const packets = encodeCannelloni(seq, this.pending.filter((f) => f.bus === bus))
      this.seq.set(bus, (seq + packets.length) & 0xff)
      out.push(...packets.map((packet) => ({ bus, packet })))
    }
    this.pending = []
    return out
  }
}
