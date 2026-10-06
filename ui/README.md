# VCU display bench

A prototyping bench for the electric boat display: one 320×240 screen, plus port and starboard batteries simulated on separate CAN buses.

```
pnpm install
pnpm dev          # bus server (ws://localhost:5190/bus) + Vite
```

Open the URL Vite prints. Add `?display` to get the screen alone at 1×, which is what a kiosk would load.

## How it fits together

```
 PORT box ──can0──┐                       ┌──can1── STBD box
 (sim | replay |  │   server/index.ts     │  (sim | replay |
  candump | off)  └─► bus server (ws) ◄───┘   candump | off)
                          │ raw frames only
                          ▼
                 src/display  (decodes bytes → UI)
```

- **The display only sees raw CAN frames.** It never reads sim state. Its decoding in `src/display/useSide.ts` is the same code that will run against the real buses.
- `shared/protocol.ts` encodes and decodes every message. The simulator, the display, and the bench traffic tables all use it.
- `src/display/power.ts` holds the pure view math: in/out/net and time to empty or full. Port it to C/LVGL if needed.

## Messages

| Device | ID | Content |
|---|---|---|
| Orion BMS 2 | `0x6B0` @ 125 Hz | pack current (0.1 A, signed BE, + = discharge), voltage (0.1 V), SOC (0.5 %), relay flags, checksum |
| Orion BMS 2 | `0x6B1` @ 10 Hz | DCL, CCL (A), high/low temp (°C), checksum |
| Orion BMS 2 | `0x036` @ 1 Hz | cell broadcast: id, voltage, resistance, open-circuit voltage |
| Victron MPPT | `0x19F214xx` | NMEA 2000 PGN 127508 Battery Status (LE): charge current into the battery = **solar in** |
| Motor controller | `0x700` | **placeholder**: DC current (0.1 A, signed BE) = propulsion. Swap in the real controller's frame |

Orion checksum: `(id + 8 + sum(bytes 0..6)) & 0xFF`. This was verified against all frames in `../2026-07-10-16-02-18.txt`.

Derived values: `load out = solar in + pack current`. House (gray bar) = load out − propulsion. Net = in − out.

## Sources

Pick a source per bus from the bench UI, or set it at startup:

```
pnpm bus --stbd=replay:../2026-07-10-16-02-18.txt
pnpm bus --port=candump:can0 --stbd=candump:can1     # on the CoreMP135 / any SocketCAN host
```

Replay reads SLCAN logs (`t6B0805420…` with a trailing ms stamp) from `logs/` or the parent folder.
