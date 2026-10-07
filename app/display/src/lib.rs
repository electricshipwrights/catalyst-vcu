//! The VCU display: the Slint UI in ui/ driven by vcu-core. Each target supplies
//! frames and settings: `src/main.rs` + `src/device/` for the CoreMP135, and
//! the `vcu-web` crate for the browser.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use slint::{ComponentHandle, Timer, TimerMode};
use vcu_core::{Eta, PowerView, Side, Smoothing, power_view};

slint::include_modules!();

pub use {slint, vcu_core};

pub const WIDTH: u32 = 320;
pub const HEIGHT: u32 = 240;

/// The port and starboard buses (can0 and can1 on the device).
#[derive(Default)]
pub struct Sides {
    pub port: Side,
    pub stbd: Side,
}

/// Settings shared with the prototype: `vcu.smoothing` and `vcu.theme`.
pub fn parse_smoothing(s: &str) -> Option<Smoothing> {
    match s.trim() {
        "smooth" => Some(Smoothing::Smooth),
        "instant" => Some(Smoothing::Instant),
        _ => None,
    }
}

pub fn parse_theme(s: &str) -> Option<i32> {
    match s.trim() {
        "dark" => Some(0),
        "light" => Some(1),
        "night" => Some(2),
        _ => None,
    }
}

pub fn side_view(v: Option<PowerView>) -> SideView {
    let Some(v) = v else {
        return SideView::default();
    };
    let (eta_kind, eta_time, eta_to_full) = match v.eta {
        Eta::None => (0, String::new(), false),
        Eta::Full => (1, String::new(), true),
        Eta::Pending { to_full } => (2, String::new(), to_full),
        Eta::Time { hm, to_full } => (3, hm, to_full),
    };
    SideView {
        online: true,
        soc: v.soc.round() as i32,
        shore: v.shore,
        solar_a: v.solar_a,
        in_a: v.in_a,
        out_a: v.out_a,
        propulsion_a: v.propulsion_a,
        net_a: v.net_a,
        eta_kind,
        eta_time: eta_time.into(),
        eta_to_full,
    }
}

/// Keeps the display's readings running; drop it to stop them.
pub struct Driver {
    _timer: Timer,
}

/// Pushes readings to the UI at 10 Hz. `now_ms` is a monotonic clock in
/// milliseconds, the same one frames are stamped with.
pub fn drive(
    ui: &Display,
    sides: Rc<RefCell<Sides>>,
    smoothing: Rc<Cell<Smoothing>>,
    now_ms: fn() -> f64,
) -> Driver {
    let readings = Timer::default();
    let weak = ui.as_weak();
    readings.start(TimerMode::Repeated, Duration::from_millis(100), move || {
        let Some(ui) = weak.upgrade() else { return };
        let now = now_ms();
        let mut sides = sides.borrow_mut();
        let s = smoothing.get();
        ui.set_port(side_view(power_view(sides.port.tick(now).as_ref(), s)));
        ui.set_stbd(side_view(power_view(sides.stbd.tick(now).as_ref(), s)));
    });
    Driver { _timer: readings }
}
