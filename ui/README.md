# VCU display bench

A prototyping bench for the electric boat display: one 320×240 screen, port and starboard batteries simulated, and the gateway (a PCAN router, `../GATEWAY.md`) that puts their frames on CAN1–6 and sends them to the display.

```
pnpm install
pnpm dev          # bus server (ws://localhost:5190/bus) + Vite
```

Open the URL Vite prints. Add `?display` to get the screen alone at 1×, which is what a kiosk would load.

## How it fits together

```
 PORT: sim | replay |                              STBD: sim | replay |
       candump | off                                   candump | off
  BMS, charger ──CAN3──┐                       ┌──CAN2── BMS, charger
  motor        ──CAN4──┼─► gateway stand-in ◄──┴──CAN5── motor
  NMEA 2000    ──CAN6──┘   server/gateway.ts
  (MPPTs, both sides)
                                   │ cannelloni packets per bus (or the real
                                   ▼ router's, over UDP)
                  src/display  (routes by bus, decodes bytes → UI)
```

- **The display only sees raw CAN frames.** It never reads sim state. `src/display/useSide.ts` picks a side's frames by gateway bus; `shared/gateway.ts` holds the bus mapping and the packet codec.
- `shared/protocol.ts` encodes and decodes every message. The simulator, the display, and the bench traffic tables all use it.
- `src/display/power.ts` and `range.ts` hold the pure view math: in/out/net and time to empty or full, and the range view's projection.

## Slint renderer

The bench can show either this React display or the Slint port in `../app`, which is what runs on the device. The Slint view shows the LCD's exact pixels. It shows Slint by default; switch with **renderer** in the toolbar. To build the Slint version, run `pnpm build:wasm` (setup is in `../app/README.md`). `pnpm parity` regenerates the fixtures that keep the Rust logic in step with `src/display` (the power view's readings and the range view's cases).

## Static hosting

`pnpm build:static` builds the bench for a static host (Netlify, GitHub Pages) into `dist/`, with relative paths so it works under a subpath. With no bus server, the page runs both sims and the gateway stand-in itself (`src/localBus.ts`, sharing `server/simBench.ts` with the server), so each visitor gets their own boat. Replay, candump and the real router need `pnpm dev`. Run `pnpm build:wasm` first so the Slint renderer is included; a host's build image would need Rust and wasm-bindgen to build it there.

On GitHub, `../.github/workflows/pages.yml` does this on every push to `main`: it runs the Rust tests, builds the WASM and the bench, and publishes them to GitHub Pages (Settings → Pages → Source: GitHub Actions). To publish elsewhere by hand:

```
pnpm build:wasm && pnpm build:static
netlify deploy --dir=dist            # a draft URL; add --prod to publish
```

## Messages

| Device | Bus | ID | Content |
|---|---|---|---|
| Orion BMS 2 | CAN3, CAN2 | `0x6B0` @ 125 Hz | pack current (0.1 A, signed BE, + = discharge), voltage (0.1 V), SOC (0.5 %), relay flags, checksum |
| Orion BMS 2 | CAN3, CAN2 | `0x6B1` @ 10 Hz | DCL, CCL (A), high/low temp (°C), checksum |
| Orion BMS 2 | CAN3, CAN2 | `0x036` @ 1 Hz | cell broadcast: id, voltage, resistance, open-circuit voltage |
| Orion BMS 2 | CAN3, CAN2 | `0x1806E5F4` @ 1 Hz | Elcon command: max voltage and current (= CCL) |
| Elcon charger | CAN3, CAN2 (assumed) | `0x18FF50E5` @ 1 Hz | charging voltage, current and status flags; silent without shore power |
| Victron MPPT 1–4 | CAN6 | `0x19F21422`–`25` @ 1 Hz | NMEA 2000 PGN 127508 Battery Status (LE) from sources 0x22–0x25: charge current into the battery = **solar in** |
| Inverter, heater | CAN6 (assumed) | `0x19F21430`–`33` @ 1 Hz | **placeholder**: PGN 127508 from 0x30/0x31 (inverter, port/stbd) and 0x32/0x33 (heater), current = what each draws |
| Motor controller | CAN4, CAN5 | `0x700` @ 20 Hz | **placeholder**: DC current (0.1 A, signed BE) = propulsion. Swap in the real controller's frame |
| Bench | bench (255) | `0x7F0` @ 1 Hz | stand-in MPPT allocation: one byte per MPPT (0 none, 1 port, 2 starboard) |

Orion checksum: `(id + 8 + sum(bytes 0..6)) & 0xFF`. This was verified against all frames in `../2026-07-10-16-02-18.txt`.

Derived values: `load out = solar + charger + pack current`. House = load out − propulsion, sampled when one of the side's MPPTs reports so the two agree; base = house − heater − inverter. The load bar stacks base, heater (steady house) and inverter (intermittent house) from the inner end, with the motor outermost. Net = in − out.

## Sources

Pick a source per side from the bench UI, or set it at startup:

```
pnpm bus --stbd=replay:../2026-07-10-16-02-18.txt
pnpm bus --port=candump:can0 --stbd=candump:can1     # on the CoreMP135 / any SocketCAN host
```

The gateway panel switches between the simulation and the real router (it listens on UDP 20001–20006). To test the board without the router, send the simulated packets out as UDP too:

```
pnpm bus --gateway=router                            # start listening for the router
pnpm bus --udp                                       # also broadcast the sim as the router would
pnpm bus --udp=192.168.1.255                         # or to one subnet or address
```

Replay reads SLCAN logs (`t6B0805420…` with a trailing ms stamp) from `logs/` or the parent folder.
