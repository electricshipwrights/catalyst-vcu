//! Display logic for the VCU, ported from the React prototype (ui/src/display,
//! ui/shared/protocol.ts). Times are milliseconds as `f64`, like
//! `performance.now()`, so the same code runs on the device and in WASM.
//! `tests/parity.rs` checks it against the prototype frame for frame.

pub mod autoscale;
pub mod filters;
pub mod gateway;
pub mod power;
pub mod protocol;
pub mod side;

pub use autoscale::AutoScale;
pub use gateway::SideName;
pub use power::{Eta, PowerView, Smoothing, power_view};
pub use side::{Currents, Live, Reading, Side};

/// JavaScript's `Math.round`: halves round up (-2.5 → -2), unlike `f64::round`.
pub(crate) fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// JavaScript's `Math.sign`: zero for zero, unlike `f64::signum`.
pub(crate) fn js_sign(x: f64) -> i8 {
    if x > 0.0 {
        1
    } else if x < 0.0 {
        -1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_like_javascript() {
        assert_eq!(
            [
                js_round(-2.5),
                js_round(2.5),
                js_round(-2.6),
                js_round(0.49)
            ],
            [-2.0, 3.0, -3.0, 0.0]
        );
        assert_eq!(
            [js_sign(0.0), js_sign(-0.0), js_sign(3.0), js_sign(-1e-9)],
            [0, 0, 1, -1]
        );
    }
}
