# VCU display

The battery and power display for a twin-electric boat, built around an M5Stack CoreMP135 (a 320×240 touchscreen running Linux, with two CAN ports).

| Folder | What's in it |
|---|---|
| `ui/` | The bench: simulated port and starboard sides, a stand-in for the CAN gateway, and the React prototype of the display. See `ui/README.md`. |
| `app/` | The display in Rust and Slint: the same UI for the board and the browser. See `app/README.md`. |
| `pcan-can-eth-gateway-main/` | Firmware for the CAN gateway: bridges all six buses to Ethernet and logs them to SD. |
| `tools/` | Scripts for the board over its USB-C serial console: install, CAN simulation, screen capture. |
| `spike/` | The first hardware check on the board (display, touch, CAN). Kept for its notes. |

## Vessel electrical system

Per side unless noted. Amps are at the pack's 51.2 V nominal. The simulator uses these numbers from `ui/shared/vessel.ts`; the display has its own copies of the capacity and bar scales.

| | Hardware | Per side | Notes |
|---|---|---|---|
| Battery | 110 kWh total, 48 V system | 55 kWh, 16 modules in series, **1,100 Ah** | 55 kWh ÷ 51.2 V ≈ 1,075 Ah; the Orion BMS's SOC in the Oct 6 log implies ~1,105 Ah. The time estimates use 1,100 Ah. About 100 kWh is usable, so we assume a **9% reserve**. |
| BMS | Orion BMS 2, one per side | Discharge and charge limits vary with SOC and temperature | On Oct 6: discharge 492 A, charge up to 173 A. It reports pack current, voltage, SOC, limits, temperatures, and (when enabled) per-module voltages. |
| Solar | 7 kW canopy, 4 × Victron BlueSolar MPPT 250/100-Tr | 0–4 MPPTs, **up to ≈ 137 A** | The MPPTs are allocated between the banks dynamically, so a side can have all four or none. About 34 A each at full sun; each is rated 100 A, but the array limits them. They're on the NMEA 2000 bus (CAN6). |
| Shore charging | 2 × Elcon HK-J-H66-80, 6.6 kW (confirmed) | **80 A** max | About 64 A on 110–120 V shore power (3.3 kW). |
| Propulsion | 2 × Bellmarine DriveMaster 20W EVO, 15 kW each | **≈ 293 A** at full power | A bit more with motor losses. The Oct 6 trip held ~1,000 rpm at ~100 A per motor for about 40 minutes (about 7.5 knots) and peaked at 142 A port, 125 A starboard. |
| House | Includes 3 × Victron Orion 360 W DC-DC (to 12 V) | **32 A** max | The Oct 6 log shows about 2 A port and 15 A starboard. |
| Distribution | 3 × Victron Lynx Distributor | — | Fused busbars; no measurements. |

### Range and speed

Summer range, from the battery (about 100 kWh usable of 110 kWh) plus solar collected along the way (about 19 kWh a day), including house loads:

| Speed | Range | Time | Energy | Total power | Per side |
|---|---|---|---|---|---|
| 5 kn | 250 nm | 50 h | 100 + 40 kWh | 2.8 kW | ≈ 27 A |
| 6 kn (usual cruise) | 133 nm | 22 h | 100 + 18 kWh | 5.3 kW | ≈ 52 A |
| 7 kn | 88 nm | 12.6 h | 100 + 10 kWh | 8.8 kW | ≈ 86 A |

Power rises roughly with the cube of speed in this range. The bench's Cruise preset uses 6 knots: about 40 A propulsion plus a 10 A house load per side.

### Weekly range

How far a week's energy goes at each speed: a rough estimate, for propulsion only (no house loads). Summer is the 100 kWh battery plus ~135 kWh of solar. Winter is ~35 kWh of solar on its own (≈ 5 kWh a day).

| Speed | Propulsion, both motors | Per side | Summer (235 kWh) | Battery (100 kWh) | Winter solar (35 kWh) |
|---|---|---|---|---|---|
| 5 kn | 2 kW | ≈ 20 A | 588 nm | 250 nm | 88 nm |
| 6 kn | 4.5 kW | ≈ 44 A | 313 nm | 133 nm | 47 nm |
| 7 kn | 8 kW | ≈ 78 A | 206 nm | 88 nm | 31 nm |
| 8 kn | 13 kW | ≈ 127 A | 145 nm | 62 nm | 22 nm |
| 9 kn | 20 kW | ≈ 195 A | 106 nm | 45 nm | 16 nm |
| 10 kn | 30 kW | ≈ 293 A | 78 nm | 33 nm | 12 nm |

The Oct 6 log agrees at its one known point: about 10.4 kW for both motors at ~1,000 rpm (≈ 7.5 kn), against 10.5 kW from the table. The log has no speed data, so the rest is untested; logging GPS speed over ground would check it.

With summer solar, the boat has about **235 kWh per week**: the 100 kWh battery plus about 135 kWh of solar (≈ 19 kWh a day, roughly 2.7 full-sun hours of the 7 kW array). At 6 knots that's about 52 hours, or ~310 nm, of motoring a week.

The display's time to empty counts down to the 9% reserve, so "empty" means no usable energy left; below 9% it shows "reserve".

The **RANGE** view (button B; React prototype only so far, not yet in the Slint app) projects the lower side's SOC every 5 minutes at a speed, until the first side reaches the reserve. It projects twice: with the solar forecast and on battery alone. The speed follows the current draw through the weekly table's propulsion power, to 0.1 kn (6 knots when not underway), or you can pick one from 1 to 10 kn with − and +, in 0.5 kn steps. Tapping the speed goes back to following the boat. The window is today (to local midnight) or the next 24 hours. The range reads "133+ nm" when the window ends before the reserve. The solar forecast is a clear-sky sun model scaled by how the array is doing now, at a fixed position (48.5° N, 123° W). The math is in `ui/src/display/range.ts`.

## Planned

- **Range on the display:** for example "≈ 110 nm at this speed" next to time to empty, working out speed from the current draw with the curve above.
- **Boat position for the sun:** the range view's solar forecast uses a fixed position; read it from a GPS (NMEA 2000 PGN 129025) or a setting.
- **Modules view:** each side's 16 module voltages from the Orion BMS's cell broadcast, with the spread and any outlier.
- **Board on the gateway:** have the board app listen to the router's UDP instead of `can0`/`can1` (the decoder is in `app/core/src/gateway.rs`). `pnpm bus --udp` stands in for the router.

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
