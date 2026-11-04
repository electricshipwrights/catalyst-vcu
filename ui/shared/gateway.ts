// The gateway's stream (GATEWAY.md): raw CAN frames from its buses, in UDP
// packets. GATEWAY_BUSES and the MPPT assumptions in protocol.ts are the
// parts to update as the wiring is confirmed.
import { BUSES, type BusName } from './bus'
import type { Frame } from './can'

export const GATEWAY_BUSES = {
  firmware: 1, // reserved for loading gateway firmware
  bms: { port: 3, stbd: 2 },
  motor: { port: 4, stbd: 5 },
  charger: { port: 3, stbd: 2 }, // assumed: on its side's BMS bus, since the Orion BMS drives the Elcon
  nmea: 6, // NMEA 2000, all four MPPTs
  self: 255, // frames the gateway makes up, such as the MPPT allocation
}

// Every bus in use, in order: the router's CAN1–6 plus any assumed ones
export const BUS_LIST = [...new Set([1, 2, 3, 4, 5, 6, ...BUSES.map((s) => GATEWAY_BUSES.charger[s]), GATEWAY_BUSES.self])].sort((a, b) => a - b)

export const busName = (n: number) => (n === GATEWAY_BUSES.self ? 'bench' : n >= 1 && n <= 6 ? `CAN${n}` : `bus ${n}`)

const SIDE: Record<BusName, string> = { port: 'port', stbd: 'stbd' }

// What's on a bus, from GATEWAY_BUSES
export function busRoles(n: number) {
  const g = GATEWAY_BUSES
  const roles = BUSES.flatMap((s) => [
    g.bms[s] === n && `${SIDE[s]} BMS`,
    g.motor[s] === n && `${SIDE[s]} motor`,
    g.charger[s] === n && `${SIDE[s]} charger?`,
  ])
  roles.push(n === g.firmware && 'firmware', n === g.nmea && 'NMEA 2000 · MPPTs', n === g.self && 'MPPT allocation (stand-in)')
  return roles.filter(Boolean).join(' · ')
}

// The gateway buses whose frames concern one side
export const sideBuses = (side: BusName) =>
  new Set([GATEWAY_BUSES.bms[side], GATEWAY_BUSES.motor[side], GATEWAY_BUSES.charger[side], GATEWAY_BUSES.nmea, GATEWAY_BUSES.self])

// MPPT allocation: one byte per MPPT 1–4 (0 none, 1 port, 2 starboard).
// How it's decided is TBD; until the gateway sends one, assume 2/2.
export type Bank = BusName | 'none'
export const MPPT_ALLOCATION = 0x7f0
export const DEFAULT_ALLOCATION: Bank[] = ['port', 'port', 'stbd', 'stbd']
const BANKS: Bank[] = ['none', 'port', 'stbd']

export const encodeAllocation = (sides: Bank[]) => Uint8Array.from(sides, (s) => BANKS.indexOf(s))
export const decodeAllocation = (d: Uint8Array): Bank[] => [...d.slice(0, 4)].map((b) => BANKS[b] ?? 'none')

export type GatewayFrame = Omit<Frame, 't'> & { bus: number }

// The router sends each bus's frames as UDP broadcasts to port 20000 + bus, in
// the cannelloni format (frame version 2): a 5-byte header (version, op code,
// seq, count as u16), then per frame the SocketCAN can_id (u32, flags in the
// top bits), a length byte (0x80 set for CAN FD, then a flags byte) and data.
export const UDP_PORT_BASE = 20000
const CNL_VERSION = 2
const CNL_HEADER = 5
const CNL_MAX = 1472
const EFF = 0x80000000
const RTR = 0x40000000
const ERR = 0x20000000
const CANFD = 0x80

// One bus's frames as cannelloni packets
export function encodeCannelloni(seq: number, frames: Omit<GatewayFrame, 'bus'>[]) {
  const packets: Uint8Array[] = []
  let buf: number[] = []
  let count = 0
  const finish = () => {
    if (!count) return
    packets.push(Uint8Array.from([CNL_VERSION, 0, seq++ & 0xff, count >> 8, count & 0xff, ...buf]))
    buf = []
    count = 0
  }
  for (const f of frames) {
    const id = (f.ext ? (f.id | EFF) >>> 0 : f.id) >>> 0
    const bytes = [id >>> 24, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff, f.data.length, ...f.data]
    if (CNL_HEADER + buf.length + bytes.length > CNL_MAX) finish()
    buf.push(...bytes)
    count++
  }
  finish()
  return packets
}

export function decodeCannelloni(bus: number, buf: Uint8Array): GatewayFrame[] | null {
  if (buf.length < CNL_HEADER || buf[0] !== CNL_VERSION || buf[1] !== 0) return null
  const count = (buf[3] << 8) | buf[4]
  const frames: GatewayFrame[] = []
  let at = CNL_HEADER
  for (let i = 0; i < count; i++) {
    if (buf.length - at < 5) return frames
    const id = ((buf[at] << 24) | (buf[at + 1] << 16) | (buf[at + 2] << 8) | buf[at + 3]) >>> 0
    const fd = !!(buf[at + 4] & CANFD)
    const len = buf[at + 4] & ~CANFD
    at += 5 + (fd ? 1 : 0)
    if (id & RTR) continue // remote frames carry no data
    if (len > 64 || buf.length - at < len) return frames
    if (!(id & ERR)) frames.push({ bus, ext: !!(id & EFF), id: id & (id & EFF ? 0x1fffffff : 0x7ff), data: buf.slice(at, at + len) })
    at += len
  }
  return frames
}
