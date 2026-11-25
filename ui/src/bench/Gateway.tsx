import { useState } from 'react'
import type { GatewayStatus } from '../../shared/bus'
import { BUS_LIST, GATEWAY_BUSES, busName, busRoles } from '../../shared/gateway'
import { send } from '../bus'
import { Traffic } from './Traffic'

// The PCAN router between the buses and the display (GATEWAY.md): its source,
// what's on each bus with its frame rate, and the frames on the one picked
export function GatewayPanel({ status }: { status?: GatewayStatus }) {
  const [shown, setShown] = useState<number>(GATEWAY_BUSES.bms.port)
  const source = status?.source ?? 'sim'
  const note = status?.local
    ? 'Simulated in this page; the router needs the bus server (pnpm dev)'
    : source === 'router'
      ? status?.router
        ? `Router at ${status.router}`
        : 'Listening for the router on UDP 20001–20006…'
      : status?.udpOut
        ? `Simulated; also sent as UDP to ${status.udpOut}`
        : 'Simulated from the two sides'
  return (
    <section className="box gateway">
      <header>
        <h2>GATEWAY</h2>
        <span className="sub">PCAN-Router Pro FD</span>
      </header>
      {/* The bus rows first, so the wires meet the panel near its top */}
      <ul className="gw-buses">
        {BUS_LIST.map((n) => (
          <li key={n} data-bus={n}>
            <button aria-pressed={shown === n} onClick={() => setShown(n)}>
              <span className="gw-name">{busName(n)}</span>
              <span className="gw-roles">{busRoles(n)}</span>
              <span className="gw-fps">{status?.fps[n] ?? 0} fr/s</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="seg-control">
        {(['sim', 'router'] as const).map((k) => (
          <button key={k} aria-pressed={source === k} disabled={!status || (status.local && k === 'router')} onClick={() => send({ type: 'gateway', source: k })}>
            {k === 'sim' ? 'simulated' : 'router'}
          </button>
        ))}
      </div>
      <p className="quiet">{note}</p>
      <Traffic bus={shown} />
    </section>
  )
}
