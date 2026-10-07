#!/usr/bin/env python3
"""Install the display on the board so it starts at boot in place of the
vendor UI, and start it now.

usage: install.py               build, upload if changed, set up boot, restart
       install.py --status      what's installed and running
       install.py --uninstall   restore the vendor UI and its boot script

The board starts its UI from /etc/rc.load (via /etc/init.d/S90rc.load), which
also loads the LCD driver, brings up can0/can1 and puts USB in device mode for
this serial console. Installing keeps all of that and swaps only the line that
starts the vendor UI; the original is kept in /etc/rc.load.orig.
"""

import os
import pathlib
import subprocess
import sys

from board import Console

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = "armv7-unknown-linux-musleabihf"
LOCAL_BIN = ROOT / "app/target" / TARGET / "release/vcu-display"
BIN = "/usr/local/bin/vcu-display"
LOG = "/var/log/vcu-display.log"
VENDOR = "/usr/local/m5stack/dist/core135_start_ui"
RC = "/etc/rc.load"
RC_ORIG = "/etc/rc.load.orig"
START = f"{BIN} > {LOG} 2>&1 &"


def build():
    env = dict(os.environ, PATH=f"{pathlib.Path.home()}/.cargo/bin:{os.environ['PATH']}")
    cmd = ["cargo", "build", "--release", "-p", "vcu-display", "--target", TARGET]
    print("building:", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT / "app", env=env, check=True)


def boot_script(original):
    """The vendor's rc.load with its UI line swapped for the display."""
    lines = []
    for line in original.replace("\r", "").splitlines():
        if line.startswith(VENDOR):
            lines.append("# vcu-display replaces the vendor UI; the original is in " + RC_ORIG)
            lines.append(START)
        else:
            lines.append(line)
    return "\n".join(lines) + "\n"


def restart(console, program):
    console.run(f"kill $(pidof vcu-display) $(pidof core135_start_ui) 2>/dev/null; sleep 1; ({program} > {LOG} 2>&1 &)")


def status(console):
    local = LOCAL_BIN.read_bytes() if LOCAL_BIN.exists() else None
    import hashlib

    remote_md5 = console.md5(BIN)
    installed = "not installed" if not remote_md5 else "installed"
    if remote_md5 and local is not None:
        installed += ", matches local build" if hashlib.md5(local).hexdigest() == remote_md5 else ", differs from local build"
    boots = console.run(f"grep -c '^{BIN}' {RC}") not in ("", "0")
    print(f"binary:  {BIN} {installed}")
    print(f"boot:    {'starts vcu-display' if boots else 'starts the vendor UI'} ({RC})")
    print(f"running: {console.run('pidof vcu-display') and 'vcu-display' or ''} {console.run('pidof core135_start_ui') and 'vendor UI' or ''}".strip())


def install(console):
    build()
    console.run("mkdir -p /usr/local/bin")
    seconds = console.upload(LOCAL_BIN.read_bytes(), BIN)
    print(f"uploaded {BIN} ({seconds:.0f}s)" if seconds else f"{BIN} already up to date")
    console.run(f"[ -f {RC_ORIG} ] || cp -p {RC} {RC_ORIG}")
    original = console.run(f"cat {RC_ORIG}", 2)
    if VENDOR not in original:
        raise SystemExit(f"{RC_ORIG} doesn't start {VENDOR}; not touching the boot script")
    console.upload(boot_script(original).encode(), RC)
    console.run("sync")
    restart(console, BIN)
    status(console)


def uninstall(console):
    if console.md5(RC_ORIG):
        console.run(f"cp -p {RC_ORIG} {RC} && rm {RC_ORIG}")
    console.run(f"rm -f {BIN}; sync")
    restart(console, VENDOR)
    status(console)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    console = Console()
    try:
        {"": install, "--status": status, "--uninstall": uninstall}.get(arg, lambda _: sys.exit(__doc__))(console)
    finally:
        console.close()


if __name__ == "__main__":
    main()
