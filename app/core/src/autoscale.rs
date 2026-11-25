//! Port of ui/src/display/autoScale.ts: the load bar's full scale, shared by
//! both sides. It steps up as soon as a bar nears its end (a brief hold skips
//! single-frame spikes) and back down only once well clear for a while, so it
//! changes rarely.

pub const SCALE_STEPS_A: [f64; 4] = [50.0, 100.0, 200.0, 300.0];
pub const SCALE_DEFAULT_A: f64 = 100.0;
const UP_AT: f64 = 0.96;
const UP_AFTER_MS: f64 = 300.0;
/// Of the next step down.
const DOWN_AT: f64 = 0.4;
const DOWN_AFTER_MS: f64 = 8000.0;

pub struct AutoScale {
    pub max_a: f64,
    over_since: Option<f64>,
    under_since: Option<f64>,
}

impl Default for AutoScale {
    fn default() -> Self {
        Self {
            max_a: SCALE_DEFAULT_A,
            over_since: None,
            under_since: None,
        }
    }
}

impl AutoScale {
    /// `need_a`: the longest bar in amps, or `None` with no data (the scale holds).
    pub fn push(&mut self, at: f64, need_a: Option<f64>) -> f64 {
        let i = SCALE_STEPS_A.iter().position(|&s| s == self.max_a).unwrap_or(1);
        let top = SCALE_STEPS_A[SCALE_STEPS_A.len() - 1];
        let lower = i.checked_sub(1).map(|j| SCALE_STEPS_A[j]);
        match need_a {
            Some(need) if need > self.max_a * UP_AT && i < SCALE_STEPS_A.len() - 1 => {
                self.under_since = None;
                let since = *self.over_since.get_or_insert(at);
                if at - since >= UP_AFTER_MS {
                    self.max_a = SCALE_STEPS_A
                        .into_iter()
                        .find(|s| need <= s * UP_AT)
                        .unwrap_or(top);
                    self.over_since = None;
                }
            }
            Some(need) if lower.is_some_and(|l| need < l * DOWN_AT) => {
                self.over_since = None;
                let since = *self.under_since.get_or_insert(at);
                if at - since >= DOWN_AFTER_MS {
                    self.max_a = lower.unwrap();
                    self.under_since = None;
                }
            }
            _ => {
                self.over_since = None;
                self.under_since = None;
            }
        }
        self.max_a
    }
}
