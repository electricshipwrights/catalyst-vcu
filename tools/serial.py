#!/usr/bin/env python3
"""Send lines to the board's serial console and print what comes back.
usage: serial.py [--quiet SECONDS] [line ...]   (no lines: just send Enter)"""

import sys

from board import Console

args = sys.argv[1:]
quiet = 1.5
if args[:1] == ["--quiet"]:
    quiet, args = float(args[1]), args[2:]

console = Console()
for line in args or [""]:
    sys.stdout.write(console.send(line, quiet))
    sys.stdout.flush()
console.close()
