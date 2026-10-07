import { useState } from 'react'
import { BUS_IFACE, BUS_LABEL, type BusName, type BusStatus, type SimParams, type SimPatch } from '../../shared/bus'
import { VESSEL } from '../../shared/vessel'
import { send } from '../bus'
import { Traffic } from './Traffic'

function Slider(props: {
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

function derating(sim: BusStatus['sim']) {
  const pct = (f: number) => `${Math.round(f * 100)}%`
  const parts = [
    sim.cclTempFactor < 1 && `CCL ${pct(sim.cclTempFactor)}`,
    sim.dclTempFactor < 1 && `DCL ${pct(sim.dclTempFactor)}`,
  ].filter(Boolean)
  return parts.length ? <div className="derate">temp derate: {parts.join(' · ')}</div> : null
}

function SimControls({ bus, sim }: { bus: BusName; sim: BusStatus['sim'] }) {
  const patch = (p: SimPatch) => send({ type: 'sim', bus, patch: p })
  const toggle = (k: keyof Pick<SimParams, 'bms' | 'mppt' | 'motor' | 'charger' | 'shore'>, label: string) => (
    <label className="check">
      <input type="checkbox" checked={sim[k]} onChange={(e) => patch({ [k]: e.target.checked })} />
      {label}
    </label>
  )
  return (
    <>
      <Slider label="Solar (MPPT)" value={sim.solarA} min={0} max={VESSEL.solarMaxA} unit="A" onChange={(v) => patch({ solarA: v })} />
      <Slider label="Propulsion" value={sim.propulsionA} min={0} max={350} unit="A" onChange={(v) => patch({ propulsionA: v })} />
      <Slider label="House" value={sim.houseA} min={0} max={VESSEL.houseMaxA} unit="A" onChange={(v) => patch({ houseA: v })} />
      <Slider label="SOC" value={sim.soc} min={0} max={100} step={0.5} unit="%" onChange={(v) => patch({ soc: v })} />
      <Slider label="Temp" value={sim.tempC} min={-25} max={65} unit="°C" onChange={(v) => patch({ tempC: v })} />
      <div className="toggles">
        <span>on bus:</span>
        {toggle('bms', 'Orion BMS')}
        {toggle('mppt', 'Victron MPPT')}
        {toggle('motor', 'Motor ctrl')}
        {toggle('charger', 'Elcon charger')}
      </div>
      <div className="toggles">
        <span>shore:</span>
        {toggle('shore', 'AC connected')}
      </div>
      <dl className="truth">
        <dt>pack</dt>
        <dd>
          {sim.packV.toFixed(1)} V · {sim.packA >= 0 ? '+' : ''}
          {sim.packA.toFixed(1)} A
        </dd>
        <dt>solar</dt>
        <dd>
          {sim.solarActualA.toFixed(0)} A{sim.solarActualA < sim.solarA - 1 ? ' (curtailed by CCL)' : ''}
        </dd>
        <dt>propulsion</dt>
        <dd>
          {sim.propulsionActualA.toFixed(0)} A{sim.propulsionActualA < sim.propulsionA - 1 ? ' (limited by DCL)' : ''}
        </dd>
        <dt>charger</dt>
        <dd>
          {sim.chargerActualA.toFixed(0)} A{sim.shore ? '' : ' (no shore power)'}
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

function ReplayControls({ bus, status, logs }: { bus: BusName; status: BusStatus; logs: string[] }) {
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
            onClick={() => file && send({ type: 'source', bus, source: 'replay', file, speed })}
          >
            {speed}×
          </button>
        ))}
      </div>
      {status.detail && <p className="quiet">{status.detail}</p>}
    </div>
  )
}

export function BatteryBox({ bus, status, logs }: { bus: BusName; status?: BusStatus; logs: string[] }) {
  const source = status?.source ?? 'off'
  const pick = (k: 'sim' | 'replay' | 'off') =>
    k === 'replay'
      ? logs[0] && send({ type: 'source', bus, source: 'replay', file: logs[0], speed: 1 })
      : send({ type: 'source', bus, source: k })

  return (
    <section className={`box box-${bus}`}>
      <header>
        <h2>{BUS_LABEL[bus]}</h2>
        <span className="sub">
          {BUS_IFACE[bus]} · {status ? `${status.fps} fr/s` : 'bus server offline'}
        </span>
      </header>
      <div className="seg-control">
        {(['sim', 'replay', 'off'] as const).map((k) => (
          <button key={k} aria-pressed={source === k} disabled={!status || (k === 'replay' && !logs.length)} onClick={() => pick(k)}>
            {k}
          </button>
        ))}
        {source === 'candump' && <button aria-pressed>candump</button>}
      </div>
      {status && source === 'sim' && <SimControls bus={bus} sim={status.sim} />}
      {status && source === 'replay' && <ReplayControls bus={bus} status={status} logs={logs} />}
      {status && source === 'candump' && <p className="quiet">{status.detail}</p>}
      {source === 'off' && <p className="quiet">Cable unplugged. Display should show NO DATA within 2 s.</p>}
      <Traffic bus={bus} />
    </section>
  )
}
