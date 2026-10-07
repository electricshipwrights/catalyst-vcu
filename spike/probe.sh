#!/bin/sh
# Hardware facts the spike depends on. Run on the board:
#   ssh root@board sh < probe.sh      (or paste into the serial console)
echo "== kernel"
uname -a
head -2 /etc/os-release

echo "== framebuffers"
for f in /sys/class/graphics/fb*; do
  echo "$(basename "$f"): $(cat "$f/name") $(cat "$f/virtual_size") $(cat "$f/bits_per_pixel")bpp"
done
echo "== processes holding a framebuffer"
for p in /proc/[0-9]*; do
  ls -l "$p/fd" 2>/dev/null | grep -q '/dev/fb' && echo "$(basename "$p") $(cat "$p/comm")"
done

echo "== input devices"
for e in /sys/class/input/event*; do
  echo "$(basename "$e"): $(cat "$e/device/name")  abs=$(cat "$e/device/capabilities/abs") props=$(cat "$e/device/properties")"
done

echo "== can"
for i in can0 can1; do ip -details -statistics link show "$i" 2>&1; done
command -v cansend >/dev/null && echo "can-utils: installed" || echo "can-utils: missing"
