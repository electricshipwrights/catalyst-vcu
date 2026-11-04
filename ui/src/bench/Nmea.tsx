import { BUSES, BUS_LABEL, type BusName, type BusStatus } from '../../shared/bus'
import { GATEWAY_BUSES, type Bank } from '../../shared/gateway'
import { VESSEL } from '../../shared/vessel'
import { send } from '../bus'
import { BusBox, Check, Slider, patchSim } from './Side'

// Which side MPPT 1–4 feed, labeled as port/starboard counts
const SPLITS: { label: string; sides: Bank[] }[] = [
  { label: '4/0', sides: ['port', 'port', 'port', 'port'] },
  { label: '3/1', sides: ['port', 'port', 'port', 'stbd'] },
  { label: '2/2', sides: ['port', 'port', 'stbd', 'stbd'] },
  { label: '1/3', sides: ['port', 'stbd', 'stbd', 'stbd'] },
  { label: '0/4', sides: ['stbd', 'stbd', 'stbd', 'stbd'] },
]

const mpptsOf = (sides: Bank[], side: BusName) => sides.flatMap((s, i) => (s === side ? [i] : [])).join()

// NMEA 2000, shared by both sides: the four MPPTs (the sun on each one's
// panels, and which side it feeds), the allocation stand-in (which is TBD),
// and each side's heater and inverter (assumed to be here)
export function NmeaBox({ buses, fps }: { buses?: BusStatus[]; fps: Record<number, number> }) {
  const sims = BUSES.flatMap((side) => {
    const s = buses?.find((b) => b.bus === side)
    return s ? [{ side, sim: s.sim, live: s.source === 'sim' }] : []
  })
  const owner = (i: number) => sims.find((s) => s.sim.mppts.includes(i))
  const panelA = sims[0]?.sim.panelA
  return (
    <BusBox bus={GATEWAY_BUSES.nmea} title="NMEA 2000" fps={fps}>
      <div className="presets split">
        <span>MPPTs port/stbd</span>
        {SPLITS.map((s) => (
          <button
            key={s.label}
            disabled={!sims.length}
            aria-pressed={sims.length > 0 && sims.every(({ side, sim }) => sim.mppts.join() === mpptsOf(s.sides, side))}
            onClick={() => send({ type: 'allocation', sides: s.sides })}
          >
            {s.label}
          </button>
        ))}
      </div>
      {panelA?.map((a, i) => (
        <Slider
          key={i}
          label={`MPPT ${i + 1} sun`}
          value={a}
          min={0}
          max={VESSEL.solarPerMpptA}
          unit="A"
          onChange={(v) => send({ type: 'panels', a: panelA.map((p, j) => (j === i ? v : p)) })}
        />
      ))}
      <div className="toggles">
        {sims
          .filter((s) => s.live)
          .map(({ side, sim }) => (
            <Check key={side} side={side} sim={sim} k="mppt" label={`${side} MPPTs on bus`} />
          ))}
      </div>
      {sims
        .filter((s) => s.live)
        .map(({ side, sim }) => (
          <div key={side} className="nmea-side">
            <Slider label={`${side} heater`} value={sim.heaterA} min={0} max={VESSEL.heaterMaxA} unit="A" onChange={(v) => patchSim(side, { heaterA: v })} />
            <Slider label={`${side} inverter`} value={sim.inverterA} min={0} max={VESSEL.inverterMaxA} unit="A" onChange={(v) => patchSim(side, { inverterA: v })} />
          </div>
        ))}
      <dl className="truth">
        {[0, 1, 2, 3].map((i) => {
          const o = owner(i)
          const on = o && o.live && o.sim.mppt
          return [
            <dt key={`t${i}`}>MPPT {i + 1}</dt>,
            <dd key={`d${i}`}>
              {o ? BUS_LABEL[o.side].toLowerCase() : 'unallocated'}
              {on ? ` · ${o.sim.mpptActualA[i].toFixed(0)} A` : ''}
            </dd>,
          ]
        })}
        {sims.some(
          ({ sim, live }) => live && sim.mppt && sim.solarActualA < sim.solarAvailableA - 1,
        ) && <dd className="derate span">curtailed by CCL</dd>}
      </dl>
    </BusBox>
  )
}
