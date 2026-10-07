#!/usr/bin/env python3
"""Copy a file to the board over the serial console (gzip + base64, checked by md5).
usage: upload.py LOCAL REMOTE"""

import sys

from board import Console

local, remote = sys.argv[1], sys.argv[2]
data = open(local, "rb").read()
console = Console()
seconds = console.upload(data, remote)
console.close()
print(f"sent {len(data)} bytes in {seconds:.1f}s, md5 OK" if seconds else "already on the board, md5 OK")
