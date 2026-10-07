import { VESSEL } from '../../shared/vessel'

// The vessel's fixed specs (ui/shared/vessel.ts), the same for both sides
export function Specs() {
  return (
    <section className="specs-panel">
      <h2>Vessel, per side</h2>
      <dl className="truth">
        <dt>battery</dt>
        <dd>
          {VESSEL.capacityAh} Ah · {VESSEL.bankKwhTotal / 2} kWh · {VESSEL.modules} modules · {VESSEL.nominalV} V
        </dd>
        <dt>reserve</dt>
        <dd>
          {VESSEL.reservePct}% ({VESSEL.usableKwhTotal} of {VESSEL.bankKwhTotal} kWh usable)
        </dd>
        <dt>solar max</dt>
        <dd>
          up to {VESSEL.solarMaxA} A ({VESSEL.mpptsTotal} MPPTs, {VESSEL.solarKwTotal} kW) · ≈ {VESSEL.solarPerMpptA} A per MPPT
        </dd>
        <dt>charger max</dt>
        <dd>
          {VESSEL.chargerMaxA} A ({VESSEL.chargerMaxA120V} A on 120 V shore)
        </dd>
        <dt>motor max</dt>
        <dd>
          ≈{VESSEL.motorMaxA} A · {VESSEL.motorKw} kW
        </dd>
        <dt>summer range</dt>
        <dd>
          {VESSEL.rangeNm.map(([kn, nm]) => `${nm} nm at ${kn} kn`).join(' · ')}
        </dd>
        <dt>summer week</dt>
        <dd>
          {VESSEL.summerWeekKwhTotal} kWh with solar (≈ {Math.round((VESSEL.summerWeekKwhTotal - VESSEL.usableKwhTotal) / 7)} kWh/day), both
          sides
        </dd>
        <dt>cruise</dt>
        <dd>6 kn ≈ {VESSEL.cruiseA} A propulsion</dd>
        <dt>house max</dt>
        <dd>{VESSEL.houseMaxA} A</dd>
        <dt>BMS limits</dt>
        <dd>
          vary with SOC and temp; Oct 6: DCL {VESSEL.bmsDclA} · CCL {VESSEL.bmsCclA} A
        </dd>
      </dl>
    </section>
  )
}
