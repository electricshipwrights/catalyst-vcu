//! The VCU display: the Slint UI in ui/ driven by vcu-core. Each target supplies
//! frames and settings: `src/main.rs` + `src/device/` for the CoreMP135, and
//! the `vcu-web` crate for the browser.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use slint::{ComponentHandle, Timer, TimerMode};
use vcu_core::range::{RangeInput, RangeView, RangeWindow, chart_paths, range_view, step_speed, to_fixed1};
use vcu_core::{AutoScale, BoatClock, Eta, PowerView, Reading, Side, SideName, Smoothing, power_view};

slint::include_modules!();

pub use {slint, vcu_core};

pub const WIDTH: u32 = 320;
pub const HEIGHT: u32 = 240;

/// Port and starboard, each fed the frames that concern it, and the boat's
/// clock from NMEA 2000 (any bus).
pub struct Sides {
    pub port: Side,
    pub stbd: Side,
    pub clock: BoatClock,
}

impl Default for Sides {
    fn default() -> Self {
        Self {
            port: Side::new(SideName::Port),
            stbd: Side::new(SideName::Stbd),
            clock: BoatClock::default(),
        }
    }
}

impl Sides {
    /// A frame from gateway bus `bus`, to each side it concerns.
    pub fn ingest(&mut self, bus: u8, id: u32, ext: bool, data: &[u8], at: f64) {
        use vcu_core::gateway::concerns;
        self.clock.ingest(id, ext, data, at);
        if concerns(SideName::Port, bus) {
            self.port.ingest(id, ext, data, at);
        }
        if concerns(SideName::Stbd, bus) {
            self.stbd.ingest(id, ext, data, at);
        }
    }
}

/// Settings the readings depend on; theme and input live in the UI's globals.
#[derive(Default)]
pub struct Settings {
    pub smoothing: Cell<Smoothing>,
}

/// The display's own clock, for the range view when no NMEA 2000 time is on
/// the bus: ms since the epoch, and the local time's offset in minutes east of UTC.
pub type WallClock = fn() -> (f64, f64);

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

/// One side as the range view needs it: the smoothed currents, like the power
/// view's bars.
fn range_input(r: &Reading) -> RangeInput {
    let c = r.smooth;
    RangeInput {
        soc: r.live.soc,
        house_a: c.house_a.max(0.0),
        propulsion_a: c.propulsion_a.unwrap_or(0.0).max(0.0),
        solar_a: c.solar_a.unwrap_or(0.0).max(0.0),
        mppts: r.live.mppts as f64,
        shore: r.live.shore,
        charger_a: c.charger_a.unwrap_or(0.0).max(0.0),
    }
}

/// The range view's chart, in range.slint.
const CHART_W: f64 = 276.0;
const CHART_H: f64 = 88.0;

/// JavaScript's `Math.round`, for the whole miles.
fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}

pub fn range_data(v: Option<&RangeView>, window: RangeWindow, now: f64) -> RangeData {
    let Some(v) = v else {
        return RangeData::default();
    };
    // "2:15h" is drawn as "2:15" and a small h
    let hours = |t: &str| match t.strip_suffix('h') {
        Some(n) => (n.to_string().into(), true),
        None => (t.to_string().into(), false),
    };
    let (reserve_in, reserve_unit) = hours(&v.reserve_in);
    let (no_sun_in, no_sun_unit) = hours(&v.no_sun_in);
    let x = |at: f64| (((at - now) / (v.end - now)) * CHART_W) as f32;
    let paths = chart_paths(v, now, CHART_W, CHART_H);
    let dock = v.dock.as_ref();
    RangeData {
        online: true,
        kn: to_fixed1(v.kn).into(),
        basis: v.basis.label().into(),
        window: i32::from(window == RangeWindow::Day),
        nm: format!("{}{}", round(v.projection.range_nm), if v.beyond { "+" } else { "" }).into(),
        reserve_in,
        reserve_unit,
        reserve_at: v.reserve_at.clone().unwrap_or_default().into(),
        no_sun_in,
        no_sun_unit,
        no_sun_at: v.no_sun_at.clone().unwrap_or_default().into(),
        dock: dock.is_some(),
        dock_prefix: if dock.is_some_and(|d| d.full == "now") { "full" } else { "full at" }.into(),
        dock_full: dock.map(|d| d.full.clone()).unwrap_or_default().into(),
        dock_nm: dock
            .and_then(|d| d.nm)
            .map(|nm| format!("{} nm", round(nm)))
            .unwrap_or_default()
            .into(),
        with_solar: paths.with_solar.into(),
        battery_only: paths.battery_only.into(),
        solar: paths.solar.into(),
        ticks: Rc::new(slint::VecModel::from(
            v.ticks
                .iter()
                .map(|t| RangeTick {
                    x: x(t.at),
                    label: t.label.clone().into(),
                })
                .collect::<Vec<_>>(),
        ))
        .into(),
        midnights: Rc::new(slint::VecModel::from(
            v.midnights.iter().map(|&m| x(m)).collect::<Vec<_>>(),
        ))
        .into(),
    }
}

/// What the range view was asked for, and what it's drawn from.
#[derive(Default)]
struct RangeState {
    /// A speed picked on the view; `None` follows the boat.
    plan_kn: Option<f64>,
    window: RangeWindow,
    inputs: Vec<RangeInput>,
    /// The boat's NMEA 2000 time less the frames' clock, while it's fresh.
    clock_offset: Option<f64>,
    /// The speed shown, for the stepper.
    kn: Option<f64>,
}

/// Keeps the display's readings running; drop it to stop them.
pub struct Driver {
    _timer: Timer,
}

/// Pushes readings to the UI at 10 Hz. `now_ms` is a monotonic clock in
/// milliseconds, the same one frames are stamped with; `wall` is the display's
/// own time of day, for the range view when the boat's isn't on the bus.
pub fn drive(
    ui: &Display,
    sides: Rc<RefCell<Sides>>,
    settings: Rc<Settings>,
    now_ms: fn() -> f64,
    wall: WallClock,
) -> Driver {
    let range = Rc::new(RefCell::new(RangeState::default()));
    let update_range: Rc<dyn Fn()> = {
        let (weak, range) = (ui.as_weak(), range.clone());
        Rc::new(move || {
            let Some(ui) = weak.upgrade() else { return };
            let (system, offset_min) = wall();
            let mut r = range.borrow_mut();
            let now = r.clock_offset.map_or(system, |o| now_ms() + o);
            let v = range_view(&r.inputs, r.plan_kn, r.window, now, offset_min);
            r.kn = v.as_ref().map(|v| v.kn);
            ui.set_range(range_data(v.as_ref(), r.window, now));
        })
    };
    ui.on_step_speed({
        let (range, update) = (range.clone(), update_range.clone());
        move |dir| {
            {
                let mut r = range.borrow_mut();
                r.plan_kn = r.kn.map(|kn| step_speed(kn, dir));
            }
            update();
        }
    });
    ui.on_follow_boat({
        let (range, update) = (range.clone(), update_range.clone());
        move || {
            range.borrow_mut().plan_kn = None;
            update();
        }
    });
    ui.on_window_selected({
        let (range, update) = (range.clone(), update_range.clone());
        move |w| {
            range.borrow_mut().window = if w == 1 { RangeWindow::Day } else { RangeWindow::Today };
            update();
        }
    });

    let readings = Timer::default();
    let weak = ui.as_weak();
    let mut scale = AutoScale::default();
    readings.start(TimerMode::Repeated, Duration::from_millis(100), move || {
        let Some(ui) = weak.upgrade() else { return };
        let now = now_ms();
        let mut sides = sides.borrow_mut();
        let s = settings.smoothing.get();
        let (port_reading, stbd_reading) = (sides.port.tick(now), sides.stbd.tick(now));
        let port = power_view(port_reading.as_ref(), s);
        let stbd = power_view(stbd_reading.as_ref(), s);
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

        // The range view, kept current so it opens ready; leaving it forgets
        // the speed and window picked there, like the prototype
        {
            let mut r = range.borrow_mut();
            if ui.get_page() != 1 {
                (r.plan_kn, r.window) = (None, RangeWindow::Today);
            }
            r.inputs = [&port_reading, &stbd_reading]
                .into_iter()
                .flatten()
                .map(range_input)
                .collect();
            r.clock_offset = sides.clock.now(now).map(|ms| ms - now);
        }
        update_range();
    });
    Driver { _timer: readings }
}
