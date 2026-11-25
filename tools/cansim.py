#!/usr/bin/env python3
"""Simulated CAN traffic on the board, so the display shows live data without
batteries. Puts both CAN controllers in loopback and loops a scenario with
canplayer: port on can0, starboard on can1.

usage: cansim.py start [demo|parity] | stop | status

  demo    (default) steps through the bench's presets, then night (no sun),
          30 s each with short ramps between: cruise, full throttle, moored,
          shore power, night. Each step has its own season and time of day,
          sent as NMEA 2000 System Time, so the range view moves with it.
          Loops every 2.5 min; starboard runs two steps out of phase (the
          clock follows port's step).
          Both sides are always online.
  parity  the test scenario (app/core/tests/fixtures/parity.json), which goes
          offline and quiet on purpose to exercise edge cases. Starboard runs
          20 s behind.
"""

import datetime
import json
import math
import pathlib
import struct
import sys

from board import Console

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "app/core/tests/fixtures/parity.json"
BITRATE = 250000

# Frame formats, as in ui/shared/protocol.ts
ORION_PACK, ORION_LIMITS, MOTOR_STATUS, ELCON_STATUS = 0x6B0, 0x6B1, 0x700, 0x18FF50E5
PGN_BATTERY_STATUS = 127508
# System Time from a stand-in GPS: the display's clock while it's on the bus
PGN_SYSTEM_TIME, TIME_SOURCE = 126992, 0x10
DAY_MS = 86_400_000
# MPPT 1–2 feed port and 3–4 starboard (the display's default allocation)
MPPT_SOURCES = {"can0": (0x22, 0x23), "can1": (0x24, 0x25)}
MPPT_ALLOCATION = 0x7F0
# Port's and starboard's NMEA 2000 sources, for mirroring port's frames onto can1:
# MPPTs, then the inverter and heater (ui/shared/protocol.ts)
MIRROR = {0x22: 0x24, 0x23: 0x25, 0x30: 0x31, 0x32: 0x33}
MIRROR |= {v: k for k, v in MIRROR.items()}
RELAYS = 0xC04B


def orion(can_id, payload):
    payload = payload[:7]
    return payload + bytes([(can_id + 8 + sum(payload)) & 0xFF])


def clamp_int(v, lo, hi):
    return max(lo, min(hi, round(v)))


def pack_status(amps, volts, soc):
    return orion(ORION_PACK, struct.pack(">hHBH", clamp_int(amps * 10, -32768, 32767), clamp_int(volts * 10, 0, 0xFFFF),
                                          clamp_int(soc * 2, 0, 200), RELAYS))


def pack_limits():
    return orion(ORION_LIMITS, struct.pack(">HHbbB", 494, 182, 24, 22, 0))


def motor_status(amps):
    return struct.pack(">h", clamp_int(amps * 10, -32768, 32767)) + bytes(6)


def battery_status(amps, sid):
    return struct.pack("<BHhHB", 0, 5210, clamp_int(amps * 10, -32768, 32765), 0xFFFF, sid & 0xFF)


def elcon_status(amps, volts):
    return struct.pack(">HHB", clamp_int(volts * 10, 0, 0xFFFF), clamp_int(amps * 10, 0, 0xFFFF), 0) + bytes(3)


def system_time(ms, sid):
    """Days since 1970, then the time of day in 0.0001 s (source 0: GPS)."""
    days = ms // DAY_MS
    return struct.pack("<BBHI", sid & 0xFF, 0xF0, days, round((ms - days * DAY_MS) * 10))


def n2k_id(source, pgn=PGN_BATTERY_STATUS):
    return (6 << 26) | (pgn << 8) | source

# Demo: (solar, propulsion, house, charger) per step: the bench's presets, then night
STEPS = [
    (55, 78, 10, 0),    # cruise: 7 knots, about 78 A propulsion per side
    (55, 320, 10, 0),   # full throttle
    (45, 0, 10, 0),     # moored
    (0, 0, 10, 70),     # shore power (the charger tops out at 80 A)
    (0, 0, 10, 0),      # night
]



def utc_ms(*when):
    return int(datetime.datetime(*when, tzinfo=datetime.timezone.utc).timestamp() * 1000)


# Each step's season and local time (Pacific) as it starts, as UTC; the clock
# runs on through the step
STEP_CLOCK = [
    utc_ms(2026, 6, 21, 22),  # cruise: midsummer, 15:00 PDT
    utc_ms(2026, 6, 21, 18),  # full throttle: midsummer, 11:00 PDT
    utc_ms(2026, 3, 20, 20),  # moored: equinox, 13:00 PDT
    utc_ms(2026, 12, 22, 1),  # shore power: midwinter, 17:00 PST (after sunset)
    utc_ms(2026, 6, 22, 6),  # night: midsummer, 23:00 PDT
]
STEP_S, RAMP_S = 30, 3
LOOP_S = STEP_S * len(STEPS)


def demo_values(t):
    """Currents at t seconds: each step holds, then ramps into the next."""
    i = int(t // STEP_S) % len(STEPS)
    into = t % STEP_S
    now, nxt = STEPS[i], STEPS[(i + 1) % len(STEPS)]
    k = max(0.0, (into - (STEP_S - RAMP_S)) / RAMP_S)
    solar, prop, house, charger = (a + (b - a) * k for a, b in zip(now, nxt))
    wiggle = math.sin(t * 1.3)
    return solar + (3 * wiggle if solar else 0), prop + (2 * wiggle if prop else 0), house, charger, i


def demo():
    lines = []
    for iface, offset_s, base_soc in (("can0", 0, 62), ("can1", 2 * STEP_S, 74)):
        for tick in range(LOOP_S * 10):  # 10 Hz
            t = tick / 10
            solar, prop, house, charger, step = demo_values((t + offset_s) % LOOP_S)
            soc = base_soc + 4 * math.sin(2 * math.pi * t / LOOP_S)  # seamless over the loop
            pack_a = prop + house - solar - charger
            frames = [(ORION_PACK, False, pack_status(pack_a, 52 + soc / 50, soc)), (MOTOR_STATUS, False, motor_status(prop))]
            if tick % 10 == 0:
                frames.append((ORION_LIMITS, False, pack_limits()))
                for source in MPPT_SOURCES[iface]:  # the side's two MPPTs share its solar
                    frames.append((n2k_id(source), True, battery_status(solar / 2, tick // 10)))
                if STEPS[step][3]:  # charger only reports on shore power
                    frames.append((ELCON_STATUS, True, elcon_status(charger, 54.2)))
                if iface == "can0":  # one clock for the boat, from port's step
                    ms = STEP_CLOCK[step] + int((t % STEP_S) * 1000)
                    frames.append((n2k_id(TIME_SOURCE, PGN_SYSTEM_TIME), True, system_time(ms, tick // 10)))
            for n, (can_id, ext, data) in enumerate(frames):
                ts = t + n * 0.002
                hex_id = f"{can_id:08X}" if ext else f"{can_id:03X}"
                lines.append((ts, f"({ts:.6f}) {iface} {hex_id}#{data.hex().upper()}"))
    lines.sort()
    return lines


def mirror(can_id, ext, data):
    """Port's frame as starboard's: its NMEA 2000 sources, and allocations with
    port and starboard swapped."""
    if ext and (can_id >> 8) & 0x3FFFF == PGN_BATTERY_STATUS and can_id & 0xFF in MIRROR:
        return can_id & ~0xFF | MIRROR[can_id & 0xFF], data
    if not ext and can_id == MPPT_ALLOCATION:
        return can_id, bytes({1: 2, 2: 1}.get(b, b) for b in bytes.fromhex(data)).hex().upper()
    return can_id, data


def parity():
    """The fixture's (port's) frames on can0, and mirrored onto can1 20 s behind."""
    lines = []
    for at, port_id, ext, port_data in json.loads(FIXTURE.read_text())["frames"]:
        for iface, delay in (("can0", 0), ("can1", 20000)):
            can_id, data = (port_id, port_data) if iface == "can0" else mirror(port_id, ext, port_data)
            hex_id = f"{can_id:08X}" if ext else f"{can_id:03X}"
            t = (at + delay) / 1000
            lines.append((t, f"({t:.6f}) {iface} {hex_id}#{data}"))
    lines.sort()
    return lines


SCENARIOS = {"demo": demo, "parity": parity}


def set_loopback(console, on):
    state = "on" if on else "off"
    console.run(
        "for i in can0 can1; do ip link set $i down; "
        f"ip link set $i type can bitrate {BITRATE} loopback {state}; ip link set $i up; done"
    )


def status(console):
    player = console.run("pidof canplayer")
    playing = console.run("cat /tmp/vcu-cansim 2>/dev/null")
    loopback = console.run("ip -details link show can0 | grep -c LOOPBACK; ip -details link show can1 | grep -c LOOPBACK")
    display = console.run("pidof vcu-display")
    print(f"replay:   {'running ' + (playing or '') + ' (pid ' + player + ')' if player else 'stopped'}")
    print(f"loopback: can0 {'on' if loopback.split()[0] != '0' else 'off'}, can1 {'on' if loopback.split()[-1] != '0' else 'off'}")
    print(f"display:  {'running' if display else 'not running'}")


def main():
    args = sys.argv[1:] or ["status"]
    console = Console()
    try:
        if args[0] == "start":
            name = args[1] if len(args) > 1 else "demo"
            if name not in SCENARIOS:
                raise SystemExit(__doc__)
            log = ("\n".join(line for _, line in SCENARIOS[name]()) + "\n").encode()
            remote = f"/tmp/vcu-{name}.log"
            seconds = console.upload(log, remote)
            print(f"{name} scenario uploaded ({seconds:.0f}s)" if seconds else f"{name} scenario already on the board")
            console.run("kill $(pidof canplayer) 2>/dev/null")
            set_loopback(console, True)
            console.run(f"(canplayer -l i -I {remote} > /dev/null 2>&1 &); echo {name} > /tmp/vcu-cansim")
            status(console)
        elif args[0] == "stop":
            console.run("kill $(pidof canplayer) 2>/dev/null; rm -f /tmp/vcu-cansim")
            set_loopback(console, False)
            status(console)
        elif args[0] == "status":
            status(console)
        else:
            raise SystemExit(__doc__)
    finally:
        console.close()


if __name__ == "__main__":
    main()
