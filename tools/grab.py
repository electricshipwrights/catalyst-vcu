#!/usr/bin/env python3
"""Save what the board's LCD shows as a PNG. The display is rotated 180° by
default (board mounted with the buttons above the screen), so the capture is
turned back upright; --raw keeps the framebuffer as stored.
usage: grab.py [--raw] OUT.png"""

import sys

from board import Console, write_png

args = sys.argv[1:]
raw = "--raw" in args
out = [a for a in args if a != "--raw"][0]
console = Console()
rows = console.grab()
console.close()
if not raw:
    rows = [row[::-1] for row in rows[::-1]]
write_png(out, rows)
print("saved", out)
