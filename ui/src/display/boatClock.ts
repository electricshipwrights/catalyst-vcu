// The boat's clock from NMEA 2000 System Time (PGN 126992): a GPS or
// chartplotter's UTC time, which the range view uses over the browser's own
// clock while it's fresh. The bench's sim sends one with its time of day and
// season. Ported to app/core/src/clock.rs.
import { PGN_SYSTEM_TIME, decodeSystemTime, n2kPgn } from '../../shared/protocol'
import { onGatewayFrames } from '../bus'

// Unheard for this long, the display goes back to its own clock
const STALE_MS = 5000

let last: { ms: number; at: number } | null = null

onGatewayFrames((frames) => {
  for (const f of frames) {
    if (!f.ext || n2kPgn(f.id) !== PGN_SYSTEM_TIME) continue
    const ms = decodeSystemTime(f.data)
    if (ms != null) last = { ms, at: performance.now() }
  }
})

// UTC ms now: the boat's time while it's on the bus, or the browser's
export function boatNow() {
  const now = performance.now()
  return last && now - last.at < STALE_MS ? last.ms + (now - last.at) : Date.now()
}
