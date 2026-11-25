//! Port of ui/src/display/autoScale.ts: the load bar's full scale, shared by
//! both sides: the smallest scale that fits. It steps up as soon as a bar
//! nears its end (a brief hold skips single-frame spikes), and down once the
//! last 8 s of the bars have all fit within 90% of a smaller scale.

use std::collections::VecDeque;

pub const SCALE_STEPS_A: [f64; 5] = [50.0, 100.0, 200.0, 300.0, 400.0];
pub const SCALE_DEFAULT_A: f64 = 100.0;
const UP_AT: f64 = 0.96;
const UP_AFTER_MS: f64 = 300.0;
/// Of the smaller scale.
const DOWN_AT: f64 = 0.9;
const DOWN_AFTER_MS: f64 = 8000.0;

const TOP_A: f64 = SCALE_STEPS_A[SCALE_STEPS_A.len() - 1];

pub struct AutoScale {
    pub max_a: f64,
    over_since: Option<f64>,
    /// The last `DOWN_AFTER_MS` of the longest bar (when, amps), and since
    /// when it's had data.
    recent: VecDeque<(f64, f64)>,
    since: Option<f64>,
}

impl Default for AutoScale {
    fn default() -> Self {
        Self {
            max_a: SCALE_DEFAULT_A,
            over_since: None,
            recent: VecDeque::new(),
            since: None,
        }
    }
}

impl AutoScale {
    /// `need_a`: the longest bar in amps, or `None` with no data (the scale holds).
    pub fn push(&mut self, at: f64, need_a: Option<f64>) -> f64 {
        let Some(need) = need_a else {
            self.over_since = None;
            self.recent.clear();
            self.since = None;
            return self.max_a;
        };
        let since = *self.since.get_or_insert(at);
        self.recent.push_back((at, need));
        while self.recent.front().is_some_and(|&(t, _)| at - t > DOWN_AFTER_MS) {
            self.recent.pop_front();
        }

        if need > self.max_a * UP_AT && self.max_a < TOP_A {
            let over = *self.over_since.get_or_insert(at);
            if at - over >= UP_AFTER_MS {
                self.max_a = SCALE_STEPS_A
                    .into_iter()
                    .find(|s| need <= s * UP_AT)
                    .unwrap_or(TOP_A);
                self.over_since = None;
            }
            return self.max_a;
        }
        self.over_since = None;
        // Down to the smallest scale the whole window fits, once there's a full window
        if at - since >= DOWN_AFTER_MS {
            let peak = self.recent.iter().fold(f64::MIN, |m, &(_, a)| m.max(a));
            let fits = SCALE_STEPS_A
                .into_iter()
                .find(|s| peak <= s * DOWN_AT)
                .unwrap_or(TOP_A);
            if fits < self.max_a {
                self.max_a = fits;
            }
        }
        self.max_a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The longest bar at `a` amps for `secs`, at 10 Hz, from `t` ms; the scale after.
    fn hold(s: &mut AutoScale, t: &mut f64, a: f64, secs: f64) -> f64 {
        for _ in 0..(secs * 10.0).round() as usize {
            *t += 100.0;
            s.push(*t, Some(a));
        }
        s.max_a
    }

    #[test]
    fn fits_full_throttle_and_comes_back_to_cruise() {
        let (mut s, mut t) = (AutoScale::default(), 0.0);
        assert_eq!(hold(&mut s, &mut t, 88.0, 10.0), 100.0);
        // Full throttle with the house (330 A) needs 400
        assert_eq!(hold(&mut s, &mut t, 330.0, 1.0), 400.0);
        // Cruise (88 A) fits 100 at 90%, once the last 8 s have all fit
        assert_eq!(hold(&mut s, &mut t, 88.0, 7.9), 400.0);
        assert_eq!(hold(&mut s, &mut t, 88.0, 0.2), 100.0);
        // Moored (10 A) goes straight to 50
        hold(&mut s, &mut t, 330.0, 1.0);
        assert_eq!(hold(&mut s, &mut t, 10.0, 8.1), 50.0);
    }

    #[test]
    fn steps_down_as_far_as_the_window_allows() {
        let (mut s, mut t) = (AutoScale::default(), 0.0);
        hold(&mut s, &mut t, 250.0, 9.0);
        assert_eq!(s.max_a, 300.0);
        // 150 A for 4 s, then 60: 200 once the 250 is out of the window, then
        // 100 once the 150 is
        hold(&mut s, &mut t, 150.0, 4.0);
        assert_eq!(hold(&mut s, &mut t, 60.0, 4.1), 200.0);
        assert_eq!(hold(&mut s, &mut t, 60.0, 4.0), 100.0);
        // No data holds the scale, and needs a full window again
        s.push(t, None);
        assert_eq!(hold(&mut s, &mut t, 10.0, 7.9), 100.0);
        assert_eq!(hold(&mut s, &mut t, 10.0, 0.2), 50.0);
    }
}
