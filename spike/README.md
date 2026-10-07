# CoreMP135 board check

A throwaway Slint app that proves the display stack works on the device before the real rewrite. It runs with no browser and no Node:

- **Display:** Slint's software renderer draws straight into the LCD framebuffer (`/dev/fb1`, RGB565). Only the regions that changed are repainted.
- **Touch:** read straight from evdev and passed to Slint as pointer events. Taps and `SwipeGestureHandler` both work.
- **CAN:** `can0` and `can1` are read through SocketCAN. Orion `0x6B0` frames are decoded the same way as `ui/shared/protocol.ts`.
- **UI checks:** text with letter-spacing, `Path` icons, and the three themes.

The build is a single static ARM binary of about 1.3 MB, so nothing needs to be installed on the board. Fonts are pre-rendered into it at build time.

## Results on the board (2026-10-06)

| Check | Result |
|---|---|
| Image | Buildroot 2022.11, kernel 5.15.24 (not Debian) |
| Display | `fb1` is `fb_ili9341`, 320×240 RGB565. `fb0` is HDMI (`stmdrmfb`, 1280×720). Slint's built-in linuxkms backend would pick `fb0`, which is why this app uses its own platform |
| Rendering | 1–1.2 ms per repaint; the board stays about 90% idle |
| Touch | `event0` (`EP0110M09`). It reports screen coordinates but advertises portrait ranges; the app detects and corrects this, so no environment variables are needed |
| Taps, swipes, theme changes | Work |
| CAN | `can0`/`can1` at 250 kbit/s. An Orion frame sent through loopback decoded to 86% · 52.4 V · 134.6 A. The app survives the interface going down and up |
| Conflicts | The vendor UI `/usr/local/m5stack/dist/core135_start_ui` holds `fb1` and `event0`. Pause it while testing: `kill -STOP <pid>`, and `kill -CONT <pid>` to resume |
| Clock | Reads Jan 1 at boot (not set). The real app needs a time source: an RTC, NTP, or the time from the boat's NMEA 2000 network |

## Build

```
rustup target add armv7-unknown-linux-musleabihf   # once
cargo build --release --target armv7-unknown-linux-musleabihf
```

On a Mac, `cargo run -- --screenshot out` renders `out-{dark,light,night}.png` through the same software renderer.

## Deploy over USB-C (no network needed)

On the Mac, the board's USB-C port appears as a serial console (`/dev/cu.usbmodem*`, login `root`/`root`). The helper scripts find it automatically, or you can set `PORT`.

```
../tools/serial.py root root                      # log in (once per boot)
../tools/upload.py target/armv7-unknown-linux-musleabihf/release/vcu-spike /tmp/vcu-spike
../tools/serial.py 'kill -STOP $(pidof core135_start_ui); /tmp/vcu-spike > /tmp/spike.log 2>&1 &'
../tools/grab.py --raw screen.png                 # read the LCD back as a PNG (this app isn't rotated)
```

The upload takes about 25 s and is verified with md5.

With Ethernet connected, use `./deploy.sh root@<board-ip>` instead (newer images need root SSH enabled via `core-config`).

`probe.sh` prints the framebuffers, input devices, CAN state, and anything holding the LCD open:

```
ssh root@<ip> sh < probe.sh
```

## CAN without a battery

```
ip link set can0 down
ip link set can0 type can bitrate 250000 loopback on
ip link set can0 up
cansend can0 6B0#0542020CACC04BC4    # 86% · 52.4 V · 134.6 A
# afterwards: same commands with "loopback off"
```

## Environment variables

| Variable | Default | Use |
|---|---|---|
| `VCU_FB` | `/dev/fb1` | Framebuffer device |
| `VCU_TOUCH` | auto-detected | Touchscreen evdev device |
| `VCU_TOUCH_SWAP_XY`, `VCU_TOUCH_INVERT_X`, `VCU_TOUCH_INVERT_Y` | off | Touch orientation, for other panels |

## Licensing

GPL-3.0, as Slint requires for open-source embedded use. The fonts are Barlow Semi Condensed under the SIL Open Font License; see `fonts/OFL.txt`.
