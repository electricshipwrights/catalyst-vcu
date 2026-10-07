#!/bin/sh
# Build for the CoreMP135, copy to the board, and run it there.
#   ./deploy.sh root@192.168.1.50
# Extra arguments become environment for the run, e.g.
#   ./deploy.sh root@192.168.1.50 VCU_TOUCH_SWAP_XY=1 VCU_TOUCH_INVERT_X=1
set -eu
host=${1:?usage: ./deploy.sh user@board [VAR=value ...]}
shift
cd "$(dirname "$0")"
cargo build --release --target armv7-unknown-linux-musleabihf
scp target/armv7-unknown-linux-musleabihf/release/vcu-spike "$host:/tmp/vcu-spike"
ssh -t "$host" env "$@" /tmp/vcu-spike
