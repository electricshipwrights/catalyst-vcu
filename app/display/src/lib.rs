//! The VCU display: the Slint UI in ui/ driven by vcu-core. Each target supplies
//! frames and settings: `src/main.rs` + `src/device/` for the CoreMP135, and
//! the `vcu-web` crate for the browser.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use slint::{ComponentHandle, Timer, TimerMode};
use vcu_core::{AutoScale, Eta, PowerView, Side, SideName, Smoothing, power_view};

slint::include_modules!();

pub use {slint, vcu_core};

pub const WIDTH: u32 = 320;
pub const HEIGHT: u32 = 240;

/// Port and starboard, each fed the frames that concern it.
pub struct Sides {
    pub port: Side,
    pub stbd: Side,
}

impl Default for Sides {
    fn default() -> Self {
        Self {
            port: Side::new(SideName::Port),
            stbd: Side::new(SideName::Stbd),
        }
    }
}

impl Sides {
    /// A frame from gateway bus `bus`, to each side it concerns.
    pub fn ingest(&mut self, bus: u8, id: u32, ext: bool, data: &[u8], at: f64) {
        use vcu_core::gateway::concerns;
        if concerns(SideName::Port, bus) {
            self.port.ingest(id, ext, data, at);
        }
        if concerns(SideName::Stbd, bus) {
            self.stbd.ingest(id, ext, data, at);
        }
    }
}

/// Settings shared with the prototype: `vcu.smoothing`, `vcu.theme` and `vcu.input`.
pub fn parse_smoothing(s: &str) -> Option<Smoothing> {
    match s.trim() {
        "smooth" => Some(Smoothing::Smooth),
        "instant" => Some(Smoothing::Instant),
        _ => None,
    }
}

pub const THEMES: [&str; 3] = ["dark", "light", "night"];

pub fn parse_theme(s: &str) -> Option<i32> {
    THEMES.iter().position(|t| *t == s.trim()).map(|i| i as i32)
}

pub fn theme_name(theme: i32) -> &'static str {
    THEMES.get(theme as usize).copied().unwrap_or(THEMES[0])
}

/// The input row: per source gives shore and each MPPT a slot on its own
/// scale; combined is one bar on the load scale.
pub const INPUT_VIEWS: [&str; 2] = ["per source", "combined"];

pub fn parse_input(s: &str) -> Option<i32> {
    INPUT_VIEWS.iter().position(|t| *t == s.trim()).map(|i| i as i32)
}

pub fn input_name(input: i32) -> &'static str {
    INPUT_VIEWS.get(input as usize).copied().unwrap_or(INPUT_VIEWS[0])
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
        Eta::Reserve => (4, String::new(), false),
    };
    SideView {
        online: true,
        soc: v.soc.round() as i32,
        shore: v.shore,
        solar_a: v.solar_a,
        mppt_a: Rc::new(slint::VecModel::from(
            v.mppt_a.map(|a| a.map_or(-1.0, |a| a as f32)).to_vec(),
        ))
        .into(),
        charger_a: v.charger_a.unwrap_or(-1),
        in_a: v.in_a,
        out_a: v.out_a,
        base_a: v.base_a,
        heater_a: v.heater_a,
        inverter_a: v.inverter_a,
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
    let mut scale = AutoScale::default();
    readings.start(TimerMode::Repeated, Duration::from_millis(100), move || {
        let Some(ui) = weak.upgrade() else { return };
        let now = now_ms();
        let mut sides = sides.borrow_mut();
        let s = smoothing.get();
        let port = power_view(sides.port.tick(now).as_ref(), s);
        let stbd = power_view(sides.stbd.tick(now).as_ref(), s);
        // The load scale fits the longer load bar (and the input in combined view)
        let combined = ui.global::<Prefs>().get_input() == 1;
        let need = [&port, &stbd]
            .into_iter()
            .flatten()
            .map(|v| f64::from(if combined { v.out_a.max(v.in_a) } else { v.out_a }))
            .reduce(f64::max);
        ui.set_scale_max(scale.push(now, need) as i32);
        ui.set_port(side_view(port));
        ui.set_stbd(side_view(stbd));
    });
    Driver { _timer: readings }
}
