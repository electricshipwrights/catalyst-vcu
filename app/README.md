# VCU display (Slint)

One Slint UI that runs on the CoreMP135's LCD and in the browser. It's a port of the React prototype in `ui/src/display`. Both targets use the same software renderer and pre-rendered glyphs, and the browser copies the 16-bit frame onto a canvas, so the bench shows the LCD's exact pixels.

```
core/      vcu-core: CAN decoding and display logic, ported from the prototype's TypeScript
display/   vcu-display: the Slint UI (ui/*.slint) plus the device binary
  src/lib.rs        shared glue: 10 Hz readings → UI
  src/main.rs       device entry point; `--screenshot` on any host
  src/device/       CoreMP135: framebuffer, touch, SocketCAN, settings file
web/       vcu-web: WASM entry point: renders onto a canvas, fed by the bench's /bus WebSocket
```

## Web (day-to-day development)

You need Rust (`rustup`) with the `wasm32-unknown-unknown` target, plus `wasm-bindgen` 0.2.129, which must match `Cargo.lock`. The `pnpm` scripts find `cargo` in `~/.cargo/bin` themselves; to run `cargo` directly, add it to your shell with `. "$HOME/.cargo/env"`.

```
cd ui
pnpm build:wasm     # app/web → ui/src/slint/pkg
pnpm dev            # bench; Slint is the default renderer (toggle "renderer" for React)
```

- After changing `.slint` or Rust files, run `pnpm build:wasm` again. Vite reloads the page.
- `?display` shows the screen alone, using whichever renderer is selected.
- The bench's theme and smoothing toggles apply to both renderers, and its A/B/C buttons switch views in both.

## Device

Run these from `app/`, with the board plugged in over USB-C. The scripts find its serial console (`/dev/cu.usbmodem*`) themselves.

```
cargo build --release -p vcu-display --target armv7-unknown-linux-musleabihf
../tools/serial.py root root      # log in; once per boot
../tools/upload.py target/armv7-unknown-linux-musleabihf/release/vcu-display /tmp/vcu-display
../tools/serial.py 'kill -STOP $(pidof core135_start_ui); /tmp/vcu-display > /tmp/display.log 2>&1 &'
../tools/grab.py screen.png       # optional: save what the LCD shows as a PNG
```

To see live data without batteries, simulate the CAN buses:

```
../tools/cansim.py start          # loopback on both buses + looped scenario replay
../tools/cansim.py status
../tools/cansim.py stop           # stop the replay, buses back to normal
```

`cansim.py` replays the parity scenario (`core/tests/fixtures/parity.json`, about 3 minutes, looped), with port on `can0` and starboard on `can1` running 20 s behind. It covers discharging, solar, shore charging, a BMS dropout and devices going stale. It puts the CAN controllers in loopback mode, so disconnect real CAN wiring first or run `stop` before connecting it.

The build is a static ARM binary of about 1.9 MB, so nothing needs installing on the board. The upload takes about 25 s and is checked with md5. With Ethernet connected you can use `scp` and `ssh` instead.

- **Vendor UI:** `core135_start_ui` also draws on the LCD, so the run command pauses it with `kill -STOP`.
- **Stopping:** `../tools/serial.py 'kill $(pidof vcu-display); kill -CONT $(pidof core135_start_ui)'` stops the display and resumes the vendor UI. A reboot does the same.
- **Not installed:** nothing is set up to start at boot yet; `/tmp` is cleared on reboot.
- **Orientation:** the output is rotated 180° by default, for the board mounted with the A/B/C buttons above the screen. Touch is flipped to match, and the buttons are numbered left to right as you see them. `VCU_ROTATE=0` turns this off.
- **Buses:** `can0` is port and `can1` is starboard.
- **Settings:** theme and smoothing come from `/etc/vcu/display.conf` (`theme=night`, `smoothing=instant`), which is re-read when it changes.
- **More options:** the other environment variables are listed in `display/src/device/mod.rs`.

On any host, `cargo run -p vcu-display -- --screenshot out` renders `out-{dark,light,night,offline}.png` through the device's software renderer.

## Tests

```
cargo test -p vcu-core
```

`core/tests/parity.rs` replays a three-minute scenario generated from the prototype's TypeScript (`pnpm parity` in `ui/`). It checks every 10 Hz reading and power view against the TypeScript output. If you change the display logic in the prototype, regenerate the fixture and port the change.

## Gotchas

- **Device build:** leave Slint's `std` feature off. It pulls in fontconfig, which can't be linked for the static ARM build. The browser build turns `std` on, because Slint's core needs it on wasm32; the pre-rendered glyphs still take priority, so the output is the same.
- **Fonts:** only glyphs that appear in a `.slint` string literal (plus ASCII) are pre-rendered, so any other character has to appear in a literal somewhere.
- **Inter:** `display/fonts/Inter-*.ttf` (and the copies in `ui/src/display/fonts/inter/`) are static instances of Inter 4's variable font, with tabular digits made the default because Slint can't turn on the `tnum` feature. Regular, Medium, SemiBold and Bold are cut at optical size 14; "Inter Display" SemiBold at 32 is for the large SOC numbers. They were made with fonttools: `fonttools varLib.instancer Inter.ttf wght=600 opsz=14`, then `pyftfeatfreeze -f tnum` (from opentype-feature-freezer), with the family names set to "Inter" or "Inter Display".
- **Colors:** the LCD is 16-bit (RGB565), and so is the browser preview, so theme colors shift slightly; for example, `#131417` shows as `#101410`.
