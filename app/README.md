# VCU display (Slint)

One Slint UI that runs on the CoreMP135's LCD and in the browser. It's a port of the React prototype in `ui/src/display`. Both targets use the same software renderer and pre-rendered glyphs, and the browser copies the 16-bit frame onto a canvas, so the bench shows the LCD's exact pixels.

```
core/      vcu-core: CAN decoding and display logic, ported from the prototype's TypeScript
display/   vcu-display: the Slint UI (ui/*.slint) plus the device binary
  src/lib.rs        shared glue: 10 Hz readings → UI
  src/main.rs       device entry point; `--screenshot` on any host
  src/device/       CoreMP135: framebuffer, touch, SocketCAN, settings file
web/       vcu-web: WASM entry point: renders onto a canvas, fed the gateway stream by the bench page (`push_packet`)
```

## Web (day-to-day development)

You need Rust (`rustup`) with the `wasm32-unknown-unknown` target, plus `wasm-bindgen` 0.2.129, which must match `Cargo.lock`. The `pnpm` scripts find `cargo` in `~/.cargo/bin` themselves; to run `cargo` directly, add it to your shell with `. "$HOME/.cargo/env"`.

```
cd ui
pnpm build:wasm     # app/web → ui/src/slint/pkg
pnpm dev            # bench; React is the default renderer (toggle "renderer" for Slint)
```

- After changing `.slint` or Rust files, run `pnpm build:wasm` again. Vite reloads the page.
- `?display` shows the screen alone, using whichever renderer is selected.
- The bench's theme and currents (smoothing) toggles apply to both renderers, and its A/B/C buttons switch views in both. Its season and time of day reach both through the sim's NMEA 2000 System Time.

## Device

Run these from `app/`, with the board plugged in over USB-C. The scripts find its serial console (`/dev/cu.usbmodem*`) themselves.

```
../tools/serial.py root root      # log in; once per boot
../tools/install.py               # build, upload if changed, start now and at every boot
../tools/install.py --status      # what's installed and running
../tools/grab.py screen.png       # optional: save what the LCD shows as a PNG
```

`install.py` builds the static ARM binary (about 1.9 MB) and copies it to `/usr/local/bin/vcu-display`, which persists across reboots. It only uploads when the build has changed, which takes about 30 s. With Ethernet connected you could use `scp` and `ssh` instead.

- **Boot:** the board starts its UI from `/etc/rc.load`, which also loads the LCD driver, brings up `can0`/`can1` at 250 kbit/s and puts USB in device mode for the serial console. `install.py` keeps all of that and swaps only the line that starts the vendor UI. The original is kept in `/etc/rc.load.orig`, and `install.py --uninstall` puts it back and restores the vendor UI.
- **Log:** the display logs to `/var/log/vcu-display.log`.
- **Crashes:** nothing restarts the display if it exits; reboot or run `install.py` again.
- **Orientation:** the output is rotated 180° by default, for the board mounted with the A/B/C buttons above the screen. Touch is flipped to match, and the buttons are numbered left to right as you see them. `VCU_ROTATE=0` turns this off.
- **Buses:** `can0` is port and `can1` is starboard, each with all of that side's devices. This predates the gateway (`../GATEWAY.md`); the app will move to the router's UDP stream. MPPT 1–2 (sources 0x22–0x23) count for port and 3–4 for starboard unless an allocation frame says otherwise.
- **Settings:** theme and smoothing come from `/etc/vcu/display.conf` (`theme=night`, `input=combined`, `smoothing=instant`), which is re-read when it changes. Picking a theme or input view on the SETTINGS view (button C) saves it there, so it survives reboots.
- **Clock:** the RANGE view (button B) takes its times, window and sun from NMEA 2000 System Time (PGN 126992) when it's on either bus, as from a GPS or chartplotter (the demo sends it). Otherwise it uses the board's clock and time zone (TZ, or /etc/localtime), which reads Jan 1 at boot until it's set; see the board clock question in `../README.md`.
- **More options:** the other environment variables are listed in `display/src/device/mod.rs`.

To see live data without batteries, simulate the CAN buses:

```
../tools/cansim.py start          # loopback on both buses + looped demo
../tools/cansim.py start parity   # or the parity test scenario
../tools/cansim.py status
../tools/cansim.py stop           # stop the replay, buses back to normal
```

- **demo** (the default) steps through the bench's presets and then night (no sun), 30 s each with 3 s ramps between: cruise, full throttle, moored, shore power, night. Each step has its own season and time of day (midsummer 15:00, midsummer 11:00, the equinox at 13:00, midwinter 17:00, midsummer 23:00, Pacific time), sent as NMEA 2000 System Time on `can0`, so the range view's clock, chart and sun move with it. It loops every 2.5 minutes, with port on `can0` and starboard on `can1` two steps out of phase. Each side's solar comes from its own two MPPTs. Both sides are always online. It's generated in `cansim.py` itself.
- **parity** replays the test scenario (`core/tests/fixtures/parity.json`, 220 s), with starboard 20 s behind, its frames mirrored onto starboard's MPPT, heater and inverter addresses. It goes offline and quiet on purpose, to exercise the edge cases: a BMS dropout, devices going stale, near-zero currents. It ends with full throttle from 180 s. To change it, edit `ui/scripts/parity.ts` and run `pnpm parity` in `ui/`.

Either one puts the CAN controllers in loopback mode, so disconnect real CAN wiring first or run `stop` before connecting it. A reboot also ends the simulation, so run `start` again afterward.

On any host, `cargo run -p vcu-display -- --screenshot out` renders `out-{dark,light,night,offline,range,range-dock}.png` through the device's software renderer.

## Tests

```
cargo test -p vcu-core
```

`core/tests/parity.rs` replays a 220-second scenario generated from the prototype's TypeScript (`pnpm parity` in `ui/`). It checks every 10 Hz reading and power view against the TypeScript output. `core/tests/range.rs` does the same for the range view: 30 cases (times, offsets, windows, speeds, one side out, at the dock) from `core/tests/fixtures/range.json`, down to the chart's path commands. If you change the display logic in the prototype, run `pnpm parity` again and port the change.

## Gotchas

- **Device build:** leave Slint's `std` feature off. It pulls in fontconfig, which can't be linked for the static ARM build. The browser build turns `std` on, because Slint's core needs it on wasm32; the pre-rendered glyphs still take priority, so the output is the same.
- **Fonts:** only glyphs that appear in a `.slint` string literal (plus ASCII) are pre-rendered, so any other character has to appear in a literal somewhere.
- **Inter:** `display/fonts/Inter-*.ttf` (and the copies in `ui/src/display/fonts/inter/`) are static instances of Inter 4's variable font, with tabular digits made the default because Slint can't turn on the `tnum` feature. Regular, Medium, SemiBold and Bold are cut at optical size 14; "Inter Display" SemiBold at 32 is for the large SOC numbers. They were made with fonttools: `fonttools varLib.instancer Inter.ttf wght=600 opsz=14`, then `pyftfeatfreeze -f tnum` (from opentype-feature-freezer), with the family names set to "Inter" or "Inter Display".
- **Colors:** the LCD is 16-bit (RGB565), and so is the browser preview, so theme colors shift slightly; for example, `#131417` shows as `#101410`.
