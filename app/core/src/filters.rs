//! Ports of ui/src/display/stepFilter.ts and etaHold.ts.

use crate::js_sign;

const SLOW_TAU_S: f64 = 5.0;
const FAST_TAU_S: f64 = 0.25;
const STEP_MIN_A: f64 = 5.0;
const STEP_FRACTION: f64 = 0.05;
const STEP_HOLD_MS: f64 = 300.0;
const SETTLE_MIN_A: f64 = 0.3;
const SETTLE_FRACTION: f64 = 0.005;

/// Slow exponential smoothing that switches to a fast time constant while the
/// input has stepped away from the output for longer than `STEP_HOLD_MS`.
#[derive(Default)]
pub struct StepFilter {
    y: Option<f64>,
    at: f64,
    outside_since: Option<f64>,
    fast: bool,
}

impl StepFilter {
    pub fn push(&mut self, at: f64, x: Option<f64>) -> Option<f64> {
        let (Some(x), Some(y)) = (x, self.y) else {
            self.y = x;
            self.at = at;
            self.outside_since = None;
            self.fast = false;
            return x;
        };
        let dt = (at - self.at) / 1000.0;
        self.at = at;
        let err = (x - y).abs();
        if err <= STEP_MIN_A.max(y.abs() * STEP_FRACTION) {
            self.outside_since = None;
        } else if self.outside_since.is_none() {
            self.outside_since = Some(at);
        }
        if self
            .outside_since
            .is_some_and(|since| at - since >= STEP_HOLD_MS)
        {
            self.fast = true;
        } else if err <= SETTLE_MIN_A.max(y.abs() * SETTLE_FRACTION) {
            self.fast = false;
        }
        let tau = if self.fast { FAST_TAU_S } else { SLOW_TAU_S };
        let y = y + (x - y) * (1.0 - (-dt / tau).exp());
        self.y = Some(y);
        Some(y)
    }

    pub fn clear(&mut self) {
        self.y = None;
        self.outside_since = None;
        self.fast = false;
    }
}

const SETTLE_MS: f64 = 1000.0;
const BAND_MIN_A: f64 = 0.75;
const BAND_FRACTION: f64 = 0.1;

/// Holds the net current used for time-to-empty/full steady: after a change
/// it averages for `SETTLE_MS`, then holds that value until the next change.
#[derive(Default)]
pub struct EtaHold {
    reference: Option<f64>,
    changed_at: f64,
    sum: f64,
    count: u32,
    settled: bool,
    held: Option<f64>,
}

impl EtaHold {
    pub fn push(&mut self, at: f64, net_a: f64) -> Option<f64> {
        let moved = self
            .reference
            .is_none_or(|r| (net_a - r).abs() > BAND_MIN_A.max(r.abs() * BAND_FRACTION));
        if moved {
            self.reference = Some(net_a);
            self.changed_at = at;
            self.sum = 0.0;
            self.count = 0;
            self.settled = false;
        }
        if !self.settled {
            self.sum += net_a;
            self.count += 1;
            if at - self.changed_at >= SETTLE_MS {
                self.held = Some(self.sum / f64::from(self.count));
                self.settled = true;
            } else if self.held.is_some_and(|h| js_sign(h) != js_sign(net_a)) {
                self.held = None;
            }
        }
        self.held
    }

    pub fn clear(&mut self) {
        self.reference = None;
        self.held = None;
        self.settled = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_filter_tracks_steps_quickly_and_noise_slowly() {
        let mut f = StepFilter::default();
        assert_eq!(f.push(0.0, Some(10.0)), Some(10.0));
        // A 2 A wiggle stays inside the step band and moves slowly
        let y = f.push(100.0, Some(12.0)).unwrap();
        assert!((y - 10.0 - 2.0 * (1.0 - (-0.1f64 / 5.0).exp())).abs() < 1e-12);
        // A 100 A step goes fast once it has held for 300 ms
        let mut at = 100.0;
        let mut y = 0.0;
        for _ in 0..10 {
            at += 100.0;
            y = f.push(at, Some(110.0)).unwrap();
        }
        assert!(y > 100.0, "{y}");
        assert_eq!(f.push(at + 100.0, None), None);
    }

    #[test]
    fn eta_hold_settles_after_a_second_and_drops_on_sign_change() {
        let mut h = EtaHold::default();
        for i in 0..10 {
            assert_eq!(h.push(f64::from(i) * 100.0, -20.0), None);
        }
        assert_eq!(h.push(1000.0, -20.0), Some(-20.0));
        // Small changes keep the held value
        assert_eq!(h.push(1100.0, -20.5), Some(-20.0));
        // A big change that flips sign drops it until the new value settles
        assert_eq!(h.push(1200.0, 15.0), None);
        assert_eq!(h.push(2200.0, 15.0), Some(15.0));
    }
}
