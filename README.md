# VCU display

The battery and power display for Catalyst/Solander 38, built around an M5Stack CoreMP135 (a 320×240 touchscreen running Linux, with two CAN ports).

| Folder | What's in it |
|---|---|
| `ui/` | The bench: simulated port and starboard sides, a stand-in for the CAN gateway, and the React prototype of the display. See [ui/README.md](ui/README.md). |
| `app/` | The display in Rust and Slint: the same UI for the board and the browser. See [app/README.md](app/README.md). |
| `pcan-can-eth-gateway-main/` | Firmware for the CAN gateway: bridges all six buses to Ethernet and logs them to SD. See [its README](pcan-can-eth-gateway-main/README.md), and [GATEWAY.md](GATEWAY.md) for how the display uses it. |
| `tools/` | Scripts for the board over its USB-C serial console: install, CAN simulation, screen capture. |
| `spike/` | The first hardware check on the board (display, touch, CAN). Kept for its notes. |

## Vessel electrical system

Per side unless noted. Amps are at the pack's 51.2 V nominal. The simulator uses these numbers from `ui/shared/vessel.ts`; the display has its own copies of the capacity and bar scales.

| | Hardware | Per side | Notes |
|---|---|---|---|
| Battery | 110 kWh total, 48 V system | 55 kWh, 16 modules in series, **1,100 Ah** | 55 kWh ÷ 51.2 V ≈ 1,075 Ah; the Orion BMS's SOC in the Oct 6 log implies ~1,105 Ah. The time estimates use 1,100 Ah. About 100 kWh is usable, so the reserve is **9%** (confirmed). |
| BMS | Orion BMS 2, one per side | Discharge and charge limits vary with SOC and temperature | On Oct 6: discharge 492 A, charge up to 173 A. It reports pack current, voltage, SOC, limits, temperatures, and (when enabled) per-module voltages. |
| Solar | 7 kW canopy, 4 × Victron BlueSolar MPPT 250/100-Tr | 0–4 MPPTs, **up to ≈ 137 A** | The MPPTs are allocated between the banks dynamically, so a side can have all four or none. About 34 A each at full sun; each is rated 100 A, but the array limits them. They're on the NMEA 2000 bus (CAN6). |
| Shore charging | 2 × Elcon HK-J-H66-80, 6.6 kW (confirmed) | **80 A** max | Assumed: both on the 50 A shore inlet at 80 A each, with the 30 A inlet (120 V, 3.6 kW) as a shared fallback, about 33 A each. |
| Propulsion | 2 × Bellmarine DriveMaster 20W EVO, 15 kW each | **≈ 293 A** at full power | A bit more with motor losses. The Oct 6 trip held ~1,000 rpm at ~100 A per motor for about 40 minutes (about 7.5 knots) and peaked at 142 A port, 125 A starboard. |
| House | Includes 3 × Victron Orion 360 W DC-DC (to 12 V) | **32 A** max | The Oct 6 log shows about 2 A port and 15 A starboard. |
| Distribution | 3 × Victron Lynx Distributor | — | Fused busbars; no measurements. |

### Range and speed

The working assumption for speed is our estimate (the weekly range chart in the [Solander 38 FAQ](https://solander38.com/stories/frequently-asked-questions)). It covers the motors only, with no house loads. Summer is the 100 kWh battery plus ~135 kWh of solar. Winter is ~35 kWh of solar on its own (≈ 5 kWh a day). The battery column is the range on a full charge.

| Speed | Propulsion, both motors | Per side | Summer (235 kWh) | Battery (100 kWh) | Winter solar (35 kWh) |
|---|---|---|---|---|---|
| 5 kn | 2 kW | ≈ 20 A | 588 nm | 250 nm | 88 nm |
| 6 kn | 4.5 kW | ≈ 44 A | 313 nm | 133 nm | 47 nm |
| 7 kn | 8 kW | ≈ 78 A | 206 nm | 88 nm | 31 nm |
| 8 kn | 13 kW | ≈ 127 A | 145 nm | 62 nm | 22 nm |
| 9 kn | 20 kW | ≈ 195 A | 106 nm | 45 nm | 16 nm |
| 10 kn | 30 kW | ≈ 293 A | 78 nm | 33 nm | 12 nm |

Power rises roughly with the cube of speed. The usual cruise is 7 knots, about 78 A of propulsion per side; the bench's Cruise preset adds a 10 A house load. The Oct 6 log agrees at its one known point: about 10.4 kW for both motors at ~1,000 rpm (≈ 7.5 kn), against 10.5 kW from the table. The log has no speed data, so the rest is untested; logging GPS speed over ground would check it.

With summer solar, the boat has about **235 kWh per week**: the 100 kWh battery plus about 135 kWh of solar (≈ 19 kWh a day, roughly 2.7 full-sun hours of the 7 kW array). At 7 knots that's about 29 hours, or ~206 nm, of motoring a week.

The display's time to empty counts down to the 9% reserve, so "empty" means no usable energy left; below 9% it shows "reserve".

The **RANGE** view (button B) projects both sides' SOC every 5 minutes at a speed, until the last side reaches the reserve. It projects twice: with the solar forecast and on battery alone. Each battery drives only its own motor, so when one side reaches the reserve it drops out and the other motor carries on alone, at the boat's full propulsion power (up to its own 15 kW, about 8.3 kn). The chart shows the boat's usable energy as an SOC: the reserve plus the sides' average above it. The speed follows the current draw through the weekly table's propulsion power, to 0.1 kn (7 knots when not underway), or you can pick one from 1 to 10 kn with − and +, in 0.5 kn steps. Tapping the speed goes back to following the boat. The window is today (to local midnight, but at least 8 hours, so in the evening it runs into the night) or the next 24 hours, with a dashed line at local midnight. The range reads "88+ nm" when the window ends before the reserve. Beside it, RESERVE and W/O SUN give how long until the reserve is reached, with the sun and without ("2:15 h", "13 h": the power view's ETA format, always with the h), with the day and time under it ("MON 04:00"). It's always the range if you leave now; on shore power (which means the boat isn't moving) a line under it adds when the charging sides will be full and the range leaving then, e.g. "full at 14:20, then 126 nm". The solar forecast is a clear-sky sun model at a fixed position (48.5° N, 123° W), scaled by how the array is doing now. With the sun too low to tell, it's scaled to a typical day from the weekly figures above: about 19 kWh at midsummer and 5 at midwinter. The sun model is in `ui/shared/sun.ts`, and the rest is in `ui/src/display/range.ts`; the Slint app's ports are `app/core/src/sun.rs` and `range.rs`. On the board it needs the clock set and the time zone (TZ or /etc/localtime). On the bench, each MPPT's solar slider is a % of the model's clear sky at that moment (so it gives little in the evening and nothing at night), shown with the amps it gives, and the **daylight** setting (now, summer, spring/fall, winter) moves the sun for both the sim's MPPTs and the forecast.

## Planned

- **Modules view:** each side's 16 module voltages from the Orion BMS's cell broadcast, with the spread and any outlier.
- **Board on the gateway:** have the board app listen to the router's UDP instead of `can0`/`can1` (the decoder is in `app/core/src/gateway.rs`). `pnpm bus --udp` stands in for the router.

### Open questions

- **GPS on NMEA 2000?** One would give speed over ground (PGN 129026), position (129025) and time (126992). Those would replace the range view's speed estimate, its fixed sun position (48.5° N, 123° W, the southern Gulf Islands) and the board's missing clock.
- **One motor alone:** the range view assumes one motor needs the boat's whole propulsion power to hold a speed, on the same curve, ignoring the idle propeller's drag. A real single-motor speed would check it.
- **House loads when a side empties:** the range view assumes they stop with it. Is the 12 V house system fed from one side, both, or switchable?
- **MPPT allocation:** how the gateway will split the MPPTs between the sides. The range view holds the current split.
- **Shore supply:** the 3D model shows a 30 A and a 50 A inlet. We assume both chargers run from the 50 A inlet at their full 80 A each, with the 30 A one (120 V, 3.6 kW) as a fallback for docks without 50 A, shared between them (about 33 A each). The bench's **shore inlet** toggle picks between them in the sim; the display uses each charger's measured current either way. The chargers are assumed to be on their side's BMS bus (CAN3 port, CAN2 starboard).
- **Where charging stops:** does the Orion charge to 100%, or stop lower? Time to full assumes 100%.
- **House loads on shore power:** do the inverter and heater run from shore AC or from the batteries while plugged in?
- **Board clock:** the CoreMP135 has a BM8563 RTC, but the spike found it reading Jan 1 at boot. Check for a backup cell and `/dev/rtc0`; otherwise set the time from NTP over Ethernet or from NMEA 2000. The range view's times, window and sun depend on it.

### CAN buses

The gateway (which made the Oct 6 log) has one bus per device group:

| Bus | What's on it |
|---|---|
| CAN1 | Reserved for loading new gateway firmware |
| CAN2 | Starboard BMS (and charger, assumed) |
| CAN3 | Port BMS (and charger, assumed) |
| CAN4 | Port motor controller |
| CAN5 | Starboard motor controller, throttle/helm station |
| CAN6 | NMEA 2000, including all four MPPTs |

The CoreMP135 has only two CAN ports, so the display takes the gateway's raw CAN frames over Ethernet instead (a PCAN-Router Pro FD broadcasting cannelloni UDP; firmware in `pcan-can-eth-gateway-main/`). Both displays in the browser already work this way; the board app still reads `can0`/`can1`. See [GATEWAY.md](GATEWAY.md).
