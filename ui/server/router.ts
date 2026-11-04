// The real gateway on the network: the PCAN router broadcasts each bus's
// frames as cannelloni packets to UDP 20000 + bus (pcan-can-eth-gateway-main).
import dgram from 'node:dgram'
import { UDP_PORT_BASE } from '../shared/gateway'

export class RouterSource {
  from: string | null = null // the router's address, once heard
  private sockets: dgram.Socket[] = []

  start(onPacket: (bus: number, packet: Uint8Array) => void) {
    for (let bus = 1; bus <= 6; bus++) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      s.on('message', (msg, rinfo) => {
        this.from = rinfo.address
        onPacket(bus, msg)
      })
      s.on('error', (e) => console.error(`UDP ${UDP_PORT_BASE + bus}: ${e.message}`))
      s.bind(UDP_PORT_BASE + bus)
      this.sockets.push(s)
    }
  }

  stop() {
    this.sockets.forEach((s) => s.close())
    this.sockets = []
    this.from = null
  }
}

// Sends the simulated packets out as the router would, so the board can listen
export class UdpOut {
  private sock = dgram.createSocket('udp4')

  constructor(readonly address: string) {
    this.sock.bind(() => this.sock.setBroadcast(true))
  }

  send(bus: number, packet: Uint8Array) {
    this.sock.send(packet, UDP_PORT_BASE + bus, this.address)
  }
}
