# Gateway → display

The gateway is a PEAK PCAN-Router Pro FD running the firmware in [`pcan-can-eth-gateway-main/`](pcan-can-eth-gateway-main/README.md). It broadcasts every frame on CAN*n* as UDP to `255.255.255.255:20000+n` in the [cannelloni](https://github.com/mguentner/cannelloni) format, and logs all buses to its SD card. The display listens and decodes the frames itself.

## Buses

| Bus | Port | Bitrate | What's on it | Display side |
|---|---|---|---|---|
| CAN1 | 20001 | 500k + FD | Gateway firmware loading | — |
| CAN2 | 20002 | 500k + FD | Starboard Orion BMS | starboard |
| CAN3 | 20003 | 500k + FD | Port Orion BMS | port |
| CAN4 | 20004 | 250k | Port motor controller | port |
| CAN5 | 20005 | 250k | Starboard motor controller, helm | starboard |
| CAN6 | 20006 | 250k | NMEA 2000, all four MPPTs | by allocation |

The mapping lives in `ui/shared/gateway.ts` (`GATEWAY_BUSES`).

## Frames the display uses

| Bus | Frame | For | Stale after |
|---|---|---|---|
| 2, 3 | `0x6B0` Orion pack status | Current, voltage, SOC | 2 s → NO DATA |
| 2, 3 | `0x6B1` Orion limits | DCL, CCL, temperatures | 2 s |
| 4, 5 | `0x423` motor DC bus | Propulsion current | 5 s → load counted as house |
| 6 | PGN 127508 from sources 0x22–0x25 | Solar per MPPT 1–4 | 5 s → MPPT off |
| 6 | PGN 127508 from 0x30 / 0x31 (assumed) | Inverter current, port / starboard | 5 s → counted as base load |
| 6 | PGN 127508 from 0x32 / 0x33 (assumed) | Heater current, port / starboard | 5 s → counted as base load |
| 2, 3? | `0x18FF50E5` Elcon status | Charging current, shore power | 2 s → unplugged |

## Assumed for now

- **Chargers** on their side's BMS bus (CAN3 port, CAN2 starboard), since the Orion BMS normally drives the Elcon over CAN. Both Elcons use the same IDs, so they can't share one bus. The Elcon defaults to 250k and these buses run at 500k, so this needs confirming.
- **Motor current** is decoded from the placeholder `0x700` layout until `0x423`'s layout is known.
- **MPPT 1–4** are NMEA 2000 sources 0x22–0x25. Addresses can change after an address claim, so the NAME (PGN 60928) is the robust key.
- **Inverter and heater** (cooking and heating) report on CAN6, one of each per side, as PGN 127508 with the current they draw. The device, PGN, addresses and sides are all placeholders. The display shows them as parts of the house load; the rest is "base".
- **MPPT allocation** is TBD. The display assumes 2/2 (MPPT 1–2 port, 3–4 starboard) unless it receives `0x7F0` (one byte per MPPT: 0 none, 1 port, 2 starboard), which the bench sends on a made-up bus 255.

## Bench

The bus server stands in for the router: it puts each simulated side's frames on its gateway bus and sends cannelloni packets over the `/bus` WebSocket as binary messages (bus number, then the packet). Both displays (React, and Slint in the browser) and the bench's frame logs read these. `pnpm bus --gateway=router` listens to the real router instead, and `pnpm bus --udp` broadcasts the simulation as the router would (see `ui/README.md`).

## Open questions

- [ ] Which buses are the chargers on, and which side is which?
- [ ] Byte layouts of the motor controller's `0x423` (and `0x223` for RPM).
- [ ] Do the Victron MPPTs send PGN 127508 on CAN6? A short CAN6 capture would confirm.
- [ ] MPPT allocation: how it's decided, where the display learns it, and which unit is MPPT 1–4.
- [ ] Is negative motor current regen or sensor offset? Oct 6 dips to −6 A on both motors.
- [ ] Inverter and heater: which models, are they on CAN6 (or on any bus), and which PGN and side? A Victron inverter on VE.Can/NMEA 2000 usually reports DC current.
