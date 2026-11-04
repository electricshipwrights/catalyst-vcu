// The vessel's electrical system: one place for the numbers the simulator and
// the bench use. Per side unless noted. The display's own copies are
// CAPACITY_AH and the bar scales in src/display/power.ts (and app/core).

const NOMINAL_V = 51.2 // 16 modules × 3.2 V (LiFePO₄), a 48 V system

export const VESSEL = {
  bankKwhTotal: 110, // both sides
  nominalV: NOMINAL_V,
  modules: 16, // in series per side
  // 55 kWh per side ÷ 51.2 V ≈ 1,075 Ah; the Orion BMS's SOC in the Oct 6 log implies ~1,105 Ah
  capacityAh: 1100,
  // Solar: 7 kW canopy on 4 × Victron BlueSolar MPPT 250/100-Tr (rated 100 A each;
  // the array limits them). The MPPTs are allocated between the banks
  // dynamically, so a side can have all four or none.
  solarKwTotal: 7,
  mpptsTotal: 4,
  solarMaxA: Math.round(7000 / NOMINAL_V), // ≈ 137 A with all four MPPTs on one side
  solarPerMpptA: Math.round(1750 / NOMINAL_V), // ≈ 34 A each at full sun
  chargerMaxA: 80, // confirmed: Elcon HK-J-H66-80 (6.6 kW, 80 A max)
  chargerMaxA120V: Math.round(3300 / NOMINAL_V), // ≈ 64 A: 3.3 kW on 110–120 V shore power
  motorKw: 15, // Bellmarine DriveMaster 20W EVO
  motorMaxA: Math.round(15000 / NOMINAL_V), // ≈ 293 A, a bit more with motor losses
  // Summer range (battery plus solar along the way), as [knots, nautical miles].
  // With the 100 kWh battery and ~19 kWh/day of solar, total power is about
  // 2.8, 5.3 and 8.8 kW: per side ≈ 27, 52 and 86 A at 51.2 V.
  rangeNm: [
    [5, 250],
    [6, 133],
    [7, 88],
  ],
  usableKwhTotal: 100,
  reservePct: 9, // assumed: the ~10 kWh of the 110 kWh bank that isn't usable
  // Summer, with solar: about 235 kWh per week, the 100 kWh battery plus ~135 kWh
  // of solar (≈ 19 kWh/day). At the 6-knot cruise that's ~52 h, ~310 nm a week.
  summerWeekKwhTotal: 235,
  // Usual cruise is 6 knots: ≈ 52 A per side in total, so about 40 A of
  // propulsion with a 10 A house load. (The Oct 6 log's ~1,000 rpm at ~100 A
  // per motor was about 7.5 knots.)
  cruiseA: 40,
  houseMaxA: 32,
  // Assumed, to revisit: an electric heater and an inverter (cooking) per side
  heaterMaxA: 40,
  inverterMaxA: 60,
  // The BMS limits vary with SOC and temperature; these are from the Oct 6 log
  bmsDclA: 492,
  bmsCclA: 173,
} as const
