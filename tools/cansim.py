#!/usr/bin/env python3
"""Simulated CAN traffic on the board, so the display shows live data without
batteries. Puts both CAN controllers in loopback and replays the parity
scenario (app/core/tests/fixtures/parity.json) on a loop with canplayer:
port on can0, starboard on can1 running 20 s behind.

usage: cansim.py start | stop | status
"""

import json
import pathlib
import sys

from board import Console

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "app/core/tests/fixtures/parity.json"
REMOTE = "/tmp/vcu-scenario.log"
BITRATE = 250000
STBD_DELAY_MS = 20000


def scenario():
    """The fixture's frames as a canplayer log, on both buses."""
    frames = json.loads(FIXTURE.read_text())["frames"]
    lines = []
    for at, can_id, ext, data in frames:
        hex_id = f"{can_id:08X}" if ext else f"{can_id:03X}"
        for iface, delay in (("can0", 0), ("can1", STBD_DELAY_MS)):
            t = (at + delay) / 1000
            lines.append((t, f"({t:.6f}) {iface} {hex_id}#{data}"))
    lines.sort()
    return ("\n".join(line for _, line in lines) + "\n").encode()


def set_loopback(console, on):
    state = "on" if on else "off"
    console.run(
        "for i in can0 can1; do ip link set $i down; "
        f"ip link set $i type can bitrate {BITRATE} loopback {state}; ip link set $i up; done"
    )


def status(console):
    player = console.run("pidof canplayer")
    loopback = console.run("ip -details link show can0 | grep -c LOOPBACK; ip -details link show can1 | grep -c LOOPBACK")
    display = console.run("pidof vcu-display")
    print(f"replay:   {'running (pid ' + player + ')' if player else 'stopped'}")
    print(f"loopback: can0 {'on' if loopback.split()[0] != '0' else 'off'}, can1 {'on' if loopback.split()[-1] != '0' else 'off'}")
    print(f"display:  {'running' if display else 'not running'}")


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    console = Console()
    try:
        if command == "start":
            seconds = console.upload(scenario(), REMOTE)
            print(f"scenario uploaded ({seconds:.0f}s)" if seconds else "scenario already on the board")
            console.run("kill $(pidof canplayer) 2>/dev/null")
            set_loopback(console, True)
            console.run(f"(canplayer -l i -I {REMOTE} > /dev/null 2>&1 &)")
            status(console)
        elif command == "stop":
            console.run("kill $(pidof canplayer) 2>/dev/null")
            set_loopback(console, False)
            status(console)
        elif command == "status":
            status(console)
        else:
            raise SystemExit(__doc__)
    finally:
        console.close()


if __name__ == "__main__":
    main()
