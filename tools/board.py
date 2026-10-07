"""Talking to the CoreMP135 over its USB-C serial console (no network needed).

The console appears as /dev/cu.usbmodem* on a Mac or /dev/ttyACM* on Linux;
set PORT to pick another. Log in once per boot with `serial.py root root`.
"""

import base64
import glob
import gzip
import hashlib
import os
import re
import select
import struct
import termios
import time
import zlib


def find_port():
    ports = glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyACM*")
    port = os.environ.get("PORT") or (ports[0] if ports else None)
    if not port:
        raise SystemExit("board not found: is it plugged in over USB-C? (or set PORT)")
    return port


class Console:
    def __init__(self, port=None):
        self.fd = os.open(port or find_port(), os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        attrs = termios.tcgetattr(self.fd)
        attrs[0] = attrs[1] = attrs[3] = 0
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
        attrs[4] = attrs[5] = termios.B115200
        termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
        self.drain(0.3)

    def close(self):
        os.close(self.fd)

    def drain(self, quiet):
        """Reads until nothing has arrived for `quiet` seconds."""
        out, last = b"", time.time()
        while time.time() - last < quiet:
            if select.select([self.fd], [], [], 0.05)[0]:
                try:
                    chunk = os.read(self.fd, 65536)
                except BlockingIOError:
                    continue
                if chunk:
                    out, last = out + chunk, time.time()
        return out.decode(errors="replace")

    def write(self, data):
        while data:
            try:
                data = data[os.write(self.fd, data):]
            except BlockingIOError:
                select.select([], [self.fd], [], 0.1)

    def send(self, line, quiet=1.5):
        """Types a line at the console and returns what it printed."""
        self.write(line.encode() + b"\r")
        return self.drain(quiet)

    def run(self, command, quiet=1.5):
        """Runs a shell command and returns only its output."""
        text = self.send(f"echo @@BEGIN; {command}; echo @@END", quiet)
        match = re.search(r"\n@@BEGIN\r?\n(.*?)@@END", text, re.S)
        return match.group(1).strip() if match else text

    def md5(self, remote):
        out = self.run(f"md5sum {remote} 2>/dev/null")
        return out.split()[0] if out else None

    def upload(self, data, remote):
        """Copies bytes to the board (gzip + base64), checked by md5. Skips the copy
        when the board already has the same file. Returns seconds taken (0 if skipped)."""
        want = hashlib.md5(data).hexdigest()
        if self.md5(remote) == want:
            return 0.0
        start = time.time()
        lines = base64.encodebytes(gzip.compress(data, 9)).splitlines()
        self.write(f"stty -echo; base64 -d | gunzip > {remote}.part\r".encode())
        time.sleep(0.5)
        for i in range(0, len(lines), 32):
            self.write(b"\n".join(lines[i:i + 32]) + b"\n")
            self.drain(0.01)
        self.write(b"\x04")
        self.drain(1.0)
        self.send(f"stty echo; mv {remote}.part {remote}; chmod +x {remote}", 1.0)
        if self.md5(remote) != want:
            raise SystemExit(f"upload of {remote} failed: md5 mismatch")
        return time.time() - start

    def grab(self, width=320, height=240):
        """Reads the LCD framebuffer (/dev/fb1, RGB565) as rows of (r, g, b)."""
        size = width * height * 2
        text = self.send(f"echo BEGIN; head -c {size} /dev/fb1 | gzip -c | base64; echo END", 2.0)
        body = re.search(r"\nBEGIN\r?\n(.*?)\r?\nEND", text, re.S).group(1)
        raw = gzip.decompress(base64.b64decode(re.sub(r"\s", "", body)))
        rows = []
        for y in range(height):
            row = []
            for (p,) in struct.iter_unpack("<H", raw[y * width * 2:(y + 1) * width * 2]):
                r, g, b = (p >> 11) & 31, (p >> 5) & 63, p & 31
                row.append((r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2))
            rows.append(row)
        return rows


def write_png(path, rows):
    height, width = len(rows), len(rows[0])
    raw = b"".join(b"\0" + bytes(c for px in row for c in px) for row in rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
