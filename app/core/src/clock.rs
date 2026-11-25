//! The boat's clock from NMEA 2000 System Time (PGN 126992), mirroring
//! ui/src/display/boatClock.ts: a GPS or chartplotter's UTC time, which the
//! range view uses over the display's own clock while it's fresh.

use crate::protocol::{PGN_SYSTEM_TIME, decode_system_time, n2k_pgn};

/// Unheard for this long, the display goes back to its own clock.
const STALE_MS: f64 = 5000.0;

#[derive(Default)]
pub struct BoatClock {
    /// The last time heard (UTC ms), and when (the frames' clock).
    last: Option<(f64, f64)>,
}

impl BoatClock {
    /// Any frame; only System Time counts.
    pub fn ingest(&mut self, id: u32, ext: bool, data: &[u8], at: f64) {
        if ext && n2k_pgn(id) == PGN_SYSTEM_TIME {
            if let Some(ms) = decode_system_time(data) {
                self.last = Some((ms, at));
            }
        }
    }

    /// UTC ms at `now` (the frames' clock), while the time is fresh.
    pub fn now(&self, now: f64) -> Option<f64> {
        let (ms, at) = self.last.filter(|&(_, at)| now - at < STALE_MS)?;
        Some(ms + (now - at))
    }
}
