import { Fragment, useState, type ReactNode } from 'react'
import { BUS_LABEL, type BusName, type BusStatus, type SimParams, type SimPatch, type SimTruth } from '../../shared/bus'
import { GATEWAY_BUSES, busName } from '../../shared/gateway'
import { VESSEL } from '../../shared/vessel'
import { send } from '../bus'

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const value = draft ?? props.value
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDraft(v)
          props.onChange(v)
        }}
        onPointerUp={() => setDraft(null)}
        onBlur={() => setDraft(null)}
      />
      <output>
        {value.toFixed(props.step && props.step < 1 ? 1 : 0)} {props.unit}
      </output>
    </label>
  )
}

export const patchSim = (side: BusName, patch: SimPatch) => send({ type: 'sim', bus: side, patch })

export function Check({
  side,
  sim,
  k,
  label,
}: {
  side: BusName
  sim: SimTruth
  k: keyof Pick<SimParams, 'bms' | 'mppt' | 'charger' | 'shore'>
  label: string
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={sim[k]} onChange={(e) => patchSim(side, { [k]: e.target.checked })} />
      {label}
    </label>
  )
}

// One CAN bus's devices; the harness wires it to that bus's gateway row
export function BusBox({
  bus,
  title,
  fps,
  assumed,
  children,
}: {
  bus: number
  title: string
  fps: Record<number, number>
  assumed?: boolean
  children?: ReactNode
}) {
  return (
    <section className="box bus-box" data-wire={bus}>
      <header>
        <h2>{title}</h2>
        <span className="sub">
          {busName(bus)}
          {assumed ? ' (assumed)' : ''} · {fps[bus] ?? 0} fr/s
        </span>
      </header>
      {children}
    </section>
  )
}

function derating(sim: SimTruth) {
  const pct = (f: number) => `${Math.round(f * 100)}%`
  const parts = [
    sim.cclTempFactor < 1 && `CCL ${pct(sim.cclTempFactor)}`,
    sim.dclTempFactor < 1 && `DCL ${pct(sim.dclTempFactor)}`,
  ].filter(Boolean)
  return parts.length ? <div className="derate">temp derate: {parts.join(' · ')}</div> : null
}

function ChargerControls({ side, sim }: { side: BusName; sim: SimTruth }) {
  return (
    <>
      <div className="toggles">
        <Check side={side} sim={sim} k="charger" label="Elcon on bus" />
        <Check side={side} sim={sim} k="shore" label="Shore AC connected" />
      </div>
      <dl className="truth">
        <dt>charging</dt>
        <dd>
          {sim.chargerActualA.toFixed(0)} A{sim.shore ? '' : ' (no shore power)'}
        </dd>
      </dl>
    </>
  )
}

// The base load isn't on any bus; the display sees it only in the BMS's pack current
function BmsControls({ side, sim }: { side: BusName; sim: SimTruth }) {
  const patch = (p: SimPatch) => patchSim(side, p)
  return (
    <>
      <div className="toggles">
        <Check side={side} sim={sim} k="bms" label="Orion BMS on bus" />
      </div>
      <Slider label="SOC" value={sim.soc} min={0} max={100} step={0.5} unit="%" onChange={(v) => patch({ soc: v })} />
      <Slider label="Temp" value={sim.tempC} min={-25} max={65} unit="°C" onChange={(v) => patch({ tempC: v })} />
      <Slider label="Base load" value={sim.houseA} min={0} max={VESSEL.houseMaxA} unit="A" onChange={(v) => patch({ houseA: v })} />
      <dl className="truth">
        <dt>pack</dt>
        <dd>
          {sim.packV.toFixed(1)} V · {sim.packA >= 0 ? '+' : ''}
          {sim.packA.toFixed(1)} A
        </dd>
        <dt>temps</dt>
        <dd>
          {sim.tLo.toFixed(0)}–{sim.tHi.toFixed(0)} °C
        </dd>
        <dt>limits</dt>
        <dd>
          CCL {sim.ccl.toFixed(0)} · DCL {sim.dcl.toFixed(0)} A
          {derating(sim)}
        </dd>
      </dl>
    </>
  )
}

function MotorControls({ side, sim }: { side: BusName; sim: SimTruth }) {
  return (
    <>
      <Slider label="Propulsion" value={sim.propulsionA} min={0} max={350} unit="A" onChange={(v) => patchSim(side, { propulsionA: v })} />
      <dl className="truth">
        <dt>drawing</dt>
        <dd>
          {sim.propulsionActualA.toFixed(0)} A{sim.propulsionActualA < sim.propulsionA - 1 ? ' (limited by DCL)' : ''}
        </dd>
      </dl>
    </>
  )
}

function ReplayControls({ side, status, logs }: { side: BusName; status: BusStatus; logs: string[] }) {
  const r = status.replay
  if (!r) return <p className="quiet">{status.detail}</p>
  const file = logs.find((l) => l.endsWith(r.file)) ?? logs[0]
  return (
    <div className="replay">
      <div className="replay-file" title={r.file}>{r.file}</div>
      <progress value={r.position} max={r.duration || 1} />
      <div className="presets">
        {[1, 5, 20].map((speed) => (
          <button
            key={speed}
            aria-pressed={r.speed === speed}
            onClick={() => file && send({ type: 'source', bus: side, source: 'replay', file, speed })}
          >
            {speed}×
          </button>
        ))}
      </div>
      {status.detail && <p className="quiet">{status.detail}</p>}
    </div>
  )
}

// A side's source (sim, replay or off), then a box for each of its buses in
// gateway order, so the wires to the gateway don't cross. Any shared bus
// boxes (children) go last, and must come after this side's buses.
export function SideColumn({
  side,
  status,
  fps,
  logs,
  children,
}: {
  side: BusName
  status?: BusStatus
  fps: Record<number, number>
  logs: string[]
  children?: ReactNode
}) {
  const source = status?.source ?? 'off'
  const sim = status && source === 'sim' ? status.sim : null
  const pick = (k: 'sim' | 'replay' | 'off') =>
    k === 'replay'
      ? logs[0] && send({ type: 'source', bus: side, source: 'replay', file: logs[0], speed: 1 })
      : send({ type: 'source', bus: side, source: k })
  const devices = [
    { bus: GATEWAY_BUSES.bms[side], title: 'BMS', body: sim && <BmsControls side={side} sim={sim} /> },
    { bus: GATEWAY_BUSES.charger[side], title: 'CHARGER', assumed: true, body: sim && <ChargerControls side={side} sim={sim} /> },
    { bus: GATEWAY_BUSES.motor[side], title: 'MOTOR', body: sim && <MotorControls side={side} sim={sim} /> },
  ]
  // One box per bus, with a heading per device when a bus has several
  const buses = [...new Set(devices.map((d) => d.bus))]
    .sort((a, b) => a - b)
    .map((bus) => {
      const on = devices.filter((d) => d.bus === bus)
      return { bus, on, assumed: on.every((d) => d.assumed) }
    })

  return (
    <div className="side-col">
      <section className={`box box-${side}`}>
        <header>
          <h2>{BUS_LABEL[side]}</h2>
          <span className="sub">{status ? `${status.fps} fr/s` : 'bus server offline'}</span>
        </header>
        <div className="seg-control">
          {(['sim', 'replay', 'off'] as const).map((k) => (
            <button key={k} aria-pressed={source === k} disabled={!status || (k === 'replay' && !logs.length)} onClick={() => pick(k)}>
              {k}
            </button>
          ))}
          {source === 'candump' && <button aria-pressed>candump</button>}
        </div>
        {status && source === 'replay' && <ReplayControls side={side} status={status} logs={logs} />}
        {status && source === 'candump' && <p className="quiet">{status.detail}</p>}
        {source === 'off' && <p className="quiet">Cables unplugged. Display should show NO DATA within 2 s.</p>}
      </section>
      {buses.map(({ bus, on, assumed }) => (
        <BusBox key={bus} bus={bus} title={on.map((d) => d.title).join(' · ')} fps={fps} assumed={assumed}>
          {on.map((d) =>
            on.length > 1 && sim ? (
              <div key={d.title} className="device">
                <h3>
                  {d.title}
                </h3>
                {d.body}
              </div>
            ) : (
              <Fragment key={d.title}>{d.body}</Fragment>
            ),
          )}
        </BusBox>
      ))}
      {children}
    </div>
  )
}
