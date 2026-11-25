//! Port of ui/src/display/range.ts: the range view's projection, each side's
//! SOC from now at a planned speed, with and without forecast solar, until the
//! last side reaches the reserve. Times are ms since the epoch, with the local
//! time's offset (minutes east of UTC) passed in. `tests/range.rs` checks it
//! against the prototype.

use crate::js_round;
use crate::power::{CAPACITY_AH, RESERVE_PCT, hm};
use crate::sun::{ARRAY_MAX_A, DAY_MS, HOUR_MS, clear_sky_a, day_of_year};

/// Propulsion power for both motors (kW) by speed (kn): the builder's
/// published estimate (README, Range and speed). Beyond either end it carries
/// on as a cube.
const POWER_CURVE: [(f64, f64); 6] = [
    (5.0, 2.0),
    (6.0, 4.5),
    (7.0, 8.0),
    (8.0, 13.0),
    (9.0, 20.0),
    (10.0, 30.0),
];
pub const SPEED_MIN_KN: f64 = 1.0;
/// The boat's top speed: both motors at their full 15 kW.
pub const SPEED_MAX_KN: f64 = 10.0;
/// The stepper's step; speeds from the current are to 0.1 kn.
pub const SPEED_STEP_KN: f64 = 0.5;
/// The usual cruise, when the boat isn't moving now: under `UNDERWAY_A` per
/// side (about 2.3 kn) it's moored or drifting.
pub const CRUISE_KN: f64 = 7.0;
const UNDERWAY_A: f64 = 2.0;

/// Per side (A), at the pack's 51.2 V nominal.
fn speed_curve() -> [(f64, f64); 6] {
    POWER_CURVE.map(|(kn, kw)| (kn, (kw * 1000.0) / 2.0 / 51.2))
}

pub fn propulsion_at(kn: f64) -> f64 {
    let curve = speed_curve();
    let (low_kn, low_a) = curve[0];
    let (top_kn, top_a) = curve[curve.len() - 1];
    if kn <= low_kn {
        return low_a * (kn / low_kn).powf(3.0);
    }
    if kn >= top_kn {
        return top_a * (kn / top_kn).powf(3.0);
    }
    let i = curve.iter().position(|&(k, _)| k > kn).unwrap();
    let ((k0, a0), (k1, a1)) = (curve[i - 1], curve[i]);
    a0 + ((a1 - a0) * (kn - k0)) / (k1 - k0)
}

/// The speed a propulsion current implies (the curve run backwards), to 0.1
/// kn, or cruise when the boat isn't underway (moored, drifting).
pub fn speed_for(propulsion_a: f64) -> f64 {
    if propulsion_a < UNDERWAY_A {
        return CRUISE_KN;
    }
    (js_round(kn_at(propulsion_a) * 10.0) / 10.0).clamp(SPEED_MIN_KN, SPEED_MAX_KN)
}

/// The curve run backwards: the speed for a propulsion current per side.
fn kn_at(propulsion_a: f64) -> f64 {
    let curve = speed_curve();
    let (low_kn, low_a) = curve[0];
    let (top_kn, top_a) = curve[curve.len() - 1];
    if propulsion_a <= low_a {
        return low_kn * (propulsion_a / low_a).cbrt();
    }
    if propulsion_a >= top_a {
        return top_kn * (propulsion_a / top_a).cbrt();
    }
    let i = curve.iter().position(|&(_, a)| a > propulsion_a).unwrap();
    let ((k0, a0), (k1, a1)) = (curve[i - 1], curve[i]);
    k0 + ((k1 - k0) * (propulsion_a - a0)) / (a1 - a0)
}

/// The stepper's next speed up (`dir` 1) or down (−1), on its 0.5 kn grid:
/// 6.3 goes to 6.5 or 6.0.
pub fn step_speed(kn: f64, dir: i32) -> f64 {
    let n = kn / SPEED_STEP_KN;
    let next = if dir > 0 {
        (n + 1e-9).floor() + 1.0
    } else {
        (n - 1e-9).ceil() - 1.0
    };
    (next * SPEED_STEP_KN).clamp(SPEED_MIN_KN, SPEED_MAX_KN)
}

/// A typical day's solar for the whole array (kWh), from the README's weekly
/// figures: about 19 at midsummer (135 a week) and 5 at midwinter (35 a week),
/// in between along a cosine through the year.
const SUMMER_DAY_KWH: f64 = 135.0 / 7.0;
const WINTER_DAY_KWH: f64 = 35.0 / 7.0;
const MIDSUMMER_DAY: f64 = 172.0;

pub fn typical_day_kwh(ms: f64) -> f64 {
    let summer =
        (1.0 + ((2.0 * std::f64::consts::PI * (day_of_year(ms) - MIDSUMMER_DAY)) / 365.0).cos())
            / 2.0;
    WINTER_DAY_KWH + (SUMMER_DAY_KWH - WINTER_DAY_KWH) * summer
}

/// The clear-sky curve over the 24 hours around a time (kWh at 51.2 V).
pub fn clear_sky_day_kwh(ms: f64) -> f64 {
    let mut ah = 0.0;
    let mut t = ms - 12.0 * HOUR_MS;
    while t < ms + 12.0 * HOUR_MS {
        ah += (clear_sky_a(t) * STEP_MS) / HOUR_MS;
        t += STEP_MS;
    }
    (ah * 51.2) / 1000.0
}

/// The sky that makes the clear-sky curve a typical day for the date: about
/// 0.28 at midsummer and 0.39 at midwinter.
pub fn typical_sky(ms: f64) -> f64 {
    (typical_day_kwh(ms) / clear_sky_day_kwh(ms)).min(1.0)
}

/// How today's sun compares with a clear sky, from the array's current now.
/// With the sun too low to tell, a typical day for the date.
pub fn sky_factor(ms: f64, array_a: f64) -> f64 {
    let clear = clear_sky_a(ms);
    if clear < 20.0 {
        typical_sky(ms)
    } else {
        (array_a / clear).clamp(0.05, 1.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RangeSide {
    pub soc: f64,
    pub house_a: f64,
    /// MPPTs allocated to this side, 0–4: its share of the array.
    pub mppts: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RangePoint {
    pub at: f64,
    pub with_solar: f64,
    pub battery_only: f64,
    pub solar_a: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Projection {
    /// Every 5 minutes from now to the window's end: the boat's usable energy
    /// as an SOC (the reserve plus the sides' average above it) with and
    /// without solar, and the forecast for the whole array.
    pub points: Vec<RangePoint>,
    /// When the last side reaches the reserve (`None`: not within 3 days).
    pub empty_at: Option<f64>,
    pub empty_battery_only_at: Option<f64>,
    pub range_nm: f64,
}

/// One motor at its full 15 kW, at 51.2 V.
const MOTOR_MAX_A: f64 = 15_000.0 / 51.2;

/// One projection, with solar or without: each side's SOC, whether it's out
/// (reached the reserve), the distance so far, and when the last side went out.
struct Run {
    solar: bool,
    socs: Vec<f64>,
    out: Vec<bool>,
    nm: f64,
    empty_at: Option<f64>,
}

impl Run {
    /// The boat's usable energy as an SOC: the reserve plus the sides' average above it.
    fn usable(&self) -> f64 {
        RESERVE_PCT
            + self
                .socs
                .iter()
                .fold(0.0, |sum, soc| sum + (soc - RESERVE_PCT).max(0.0))
                / self.socs.len() as f64
    }
}

const STEP_MS: f64 = 5.0 * 60_000.0;
const HORIZON_MS: f64 = 72.0 * 3_600_000.0;

/// Sides from now at `kn`, with the sky as it is now (`sky`), until `end`.
/// Each side's battery drives only its own motor, so when one reaches the
/// reserve it drops out (its house load with it) and the other motor carries
/// on alone: it takes the boat's whole propulsion power, or its own 15 kW at
/// most, and the speed drops to what that gives. Shore charging is left out:
/// this is for planning time underway.
pub fn project(sides: &[RangeSide], kn: f64, sky: f64, now: f64, end: f64) -> Projection {
    let propulsion = propulsion_at(kn);
    let start = |solar: bool| {
        let out: Vec<bool> = sides.iter().map(|s| s.soc <= RESERVE_PCT).collect();
        let empty_at = out.iter().all(|&o| o).then_some(now);
        Run {
            solar,
            socs: sides.iter().map(|s| s.soc).collect(),
            out,
            nm: 0.0,
            empty_at,
        }
    };
    let mut runs = [start(true), start(false)];
    let mut points = Vec::new();
    let hours = STEP_MS / HOUR_MS;

    let mut at = now;
    while at <= end.max(now + HORIZON_MS) {
        let array_a = clear_sky_a(at) * sky;
        if at <= end {
            points.push(RangePoint {
                at,
                with_solar: runs[0].usable(),
                battery_only: runs[1].usable(),
                solar_a: array_a,
            });
        }
        if runs.iter().all(|r| r.empty_at.is_some()) && at > end {
            break;
        }
        for r in runs.iter_mut() {
            if r.empty_at.is_some() {
                continue;
            }
            // With a side out, one motor does the work of two
            let alone = r.out.iter().any(|&o| o);
            let motor_a = if alone {
                MOTOR_MAX_A.min(2.0 * propulsion)
            } else {
                propulsion
            };
            for (i, s) in sides.iter().enumerate() {
                if r.out[i] {
                    continue;
                }
                let solar_a = if r.solar {
                    (array_a * s.mppts) / 4.0
                } else {
                    0.0
                };
                r.socs[i] = (r.socs[i]
                    - ((motor_a + s.house_a - solar_a) * hours * 100.0) / CAPACITY_AH)
                    .clamp(0.0, 100.0);
                if r.socs[i] <= RESERVE_PCT {
                    r.out[i] = true;
                }
            }
            if at < end {
                let speed = if alone { kn_at(motor_a / 2.0) } else { kn };
                r.nm += speed * (STEP_MS.min(end - at) / HOUR_MS);
            }
            if r.out.iter().all(|&o| o) {
                r.empty_at = Some(at + STEP_MS);
            }
        }
        at += STEP_MS;
    }
    let [with_solar, battery_only] = runs;
    Projection {
        points,
        empty_at: with_solar.empty_at,
        empty_battery_only_at: battery_only.empty_at,
        range_nm: with_solar.nm,
    }
}

/// Today runs to local midnight, but at least 8 hours, so in the evening it
/// carries on into the night; or 24 hours from now.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RangeWindow {
    #[default]
    Today,
    Day,
}

const TODAY_MIN_MS: f64 = 8.0 * HOUR_MS;

pub fn window_end(now: f64, w: RangeWindow, offset_min: f64) -> f64 {
    if w == RangeWindow::Day {
        return now + DAY_MS;
    }
    let off = offset_min * 60_000.0;
    (now + TODAY_MIN_MS).max((((now + off) / DAY_MS).floor() + 1.0) * DAY_MS - off)
}

/// Local midnights after now and before the window's end, for lines on the chart.
pub fn midnights(now: f64, end: f64, offset_min: f64) -> Vec<f64> {
    let off = offset_min * 60_000.0;
    let mut at = Vec::new();
    let mut local = (((now + off) / DAY_MS).floor() + 1.0) * DAY_MS;
    while local - off < end {
        at.push(local - off);
        local += DAY_MS;
    }
    at
}

/// 1 Jan 1970 was a Thursday.
const WEEKDAYS: [&str; 7] = ["THU", "FRI", "SAT", "SUN", "MON", "TUE", "WED"];

fn weekday(day: f64) -> &'static str {
    WEEKDAYS[(day as i64).rem_euclid(7) as usize]
}

#[derive(Clone, Debug, PartialEq)]
pub struct Tick {
    pub at: f64,
    pub label: String,
}

/// Along the time axis: every 3 h, with midnight as the weekday. None too
/// near "now" at the left end.
pub fn time_ticks(now: f64, end: f64, offset_min: f64) -> Vec<Tick> {
    let off = offset_min * 60_000.0;
    let span = end - now;
    let step = 3.0 * HOUR_MS;
    let mut ticks = Vec::new();
    let mut local = (((now + off) / step).floor() + 1.0) * step;
    while local < end + off {
        if local - off - now >= span * 0.15 {
            let day = (local / DAY_MS).floor();
            let hour = (local - day * DAY_MS) / HOUR_MS;
            ticks.push(Tick {
                at: local - off,
                label: if hour == 0.0 {
                    weekday(day).into()
                } else {
                    format!("{:02}", hour as i64)
                },
            });
        }
        local += step;
    }
    ticks
}

/// A local time as its day (since the epoch) and "18:30".
fn clock(at: f64, offset_min: f64) -> (f64, String) {
    let local = at + offset_min * 60_000.0;
    let day = (local / DAY_MS).floor();
    let minutes = ((local - day * DAY_MS) / 60_000.0).floor() as i64;
    (day, format!("{:02}:{:02}", minutes / 60, minutes % 60))
}

/// When something happens: "now", "18:30" today, "THU 04:00" on a later day,
/// "3 days+" beyond the projection.
pub fn when_text(at: Option<f64>, now: f64, offset_min: f64) -> String {
    let Some(at) = at else {
        return "3 days+".into();
    };
    if at <= now {
        return "now".into();
    }
    let (day, time) = clock(at, offset_min);
    if day == clock(now, offset_min).0 {
        time
    } else {
        format!("{} {time}", weekday(day))
    }
}

/// How long until then, like the power view's ETA but always in hours:
/// "2:15h", "13h"; "now" once it's passed, "3 days+" beyond the projection.
pub fn in_text(at: Option<f64>, now: f64) -> String {
    let Some(at) = at else {
        return "3 days+".into();
    };
    if at <= now {
        return "now".into();
    }
    let t = hm((at - now) / HOUR_MS);
    if t.ends_with('h') { t } else { format!("{t}h") }
}

/// The day and time, even today: "MON 18:30" (`None` once it's passed or
/// beyond the projection).
pub fn at_text(at: Option<f64>, now: f64, offset_min: f64) -> Option<String> {
    let at = at.filter(|&at| at > now)?;
    let (day, time) = clock(at, offset_min);
    Some(format!("{} {time}", weekday(day)))
}

/// One side as the range view needs it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RangeInput {
    pub soc: f64,
    pub house_a: f64,
    pub propulsion_a: f64,
    pub solar_a: f64,
    pub mppts: f64,
    /// On shore power, and what its charger gives (0 when silent).
    pub shore: bool,
    pub charger_a: f64,
}

/// The speed planned for: the boat's now, cruise when it isn't underway, or
/// one picked on the view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpeedBasis {
    Now,
    Cruise,
    Plan,
}

impl SpeedBasis {
    pub fn label(self) -> &'static str {
        match self {
            SpeedBasis::Now => "NOW",
            SpeedBasis::Cruise => "CRUISE",
            SpeedBasis::Plan => "PLAN",
        }
    }
}

/// On shore power: when the charging sides are full, and the range leaving
/// then (`None` beyond 3 days).
#[derive(Clone, Debug, PartialEq)]
pub struct Dock {
    pub full: String,
    pub nm: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RangeView {
    pub kn: f64,
    pub basis: SpeedBasis,
    pub end: f64,
    pub projection: Projection,
    /// The window ends before the reserve, so the range is at least `range_nm`.
    pub beyond: bool,
    /// How long until the last side reaches the reserve, with the sun and
    /// without, and the day and time it does.
    pub reserve_in: String,
    pub reserve_at: Option<String>,
    pub no_sun_in: String,
    pub no_sun_at: Option<String>,
    pub ticks: Vec<Tick>,
    pub midnights: Vec<f64>,
    /// `None` when no side is charging.
    pub dock: Option<Dock>,
}

/// A charger counts from 1 A, and a side is full from 99.5%, like the power view's ETA.
const CHARGING_A: f64 = 1.0;
const FULL_PCT: f64 = 99.5;

/// At the dock, which means not moving: each side gains its charger and the
/// solar forecast less its house load, until every charging side is full. The
/// Orion's taper near full is left out, like the power view's time to full.
fn dock(sides: &[RangeInput], kn: f64, sky: f64, now: f64, offset_min: f64) -> Option<Dock> {
    let charging: Vec<bool> = sides
        .iter()
        .map(|s| s.shore && s.charger_a >= CHARGING_A)
        .collect();
    if !charging.iter().any(|&c| c) {
        return None;
    }
    let mut socs: Vec<f64> = sides.iter().map(|s| s.soc).collect();
    let mut full_at = None;
    let mut at = now;
    while at <= now + HORIZON_MS {
        if socs
            .iter()
            .zip(&charging)
            .all(|(&soc, &c)| !c || soc >= FULL_PCT)
        {
            full_at = Some(at);
            break;
        }
        let array_a = clear_sky_a(at) * sky;
        for (i, s) in sides.iter().enumerate() {
            let in_a = (if charging[i] { s.charger_a } else { 0.0 }) + (array_a * s.mppts) / 4.0;
            socs[i] = (socs[i]
                + ((in_a - s.house_a) * (STEP_MS / HOUR_MS) * 100.0) / CAPACITY_AH)
                .clamp(0.0, 100.0);
        }
        at += STEP_MS;
    }
    let Some(full_at) = full_at else {
        return Some(Dock {
            full: when_text(None, now, offset_min),
            nm: None,
        });
    };
    let leaving: Vec<RangeSide> = sides
        .iter()
        .zip(&socs)
        .map(|(s, &soc)| RangeSide {
            soc,
            house_a: s.house_a,
            mppts: s.mppts,
        })
        .collect();
    let nm = project(&leaving, kn, sky, full_at, full_at + HORIZON_MS).range_nm;
    Some(Dock {
        full: when_text(Some(full_at), now, offset_min),
        nm: Some(nm),
    })
}

/// The view for the online sides (`None` with none). `plan_kn`: a speed picked
/// on the view, or `None` to follow the boat. `now`: the boat's clock
/// (`BoatClock`), which the bench's sim moves for its time of day and season.
pub fn range_view(
    sides: &[RangeInput],
    plan_kn: Option<f64>,
    w: RangeWindow,
    now: f64,
    offset_min: f64,
) -> Option<RangeView> {
    if sides.is_empty() {
        return None;
    }
    let propulsion_a = sides.iter().fold(0.0, |sum, s| sum + s.propulsion_a) / sides.len() as f64;
    let kn = plan_kn.unwrap_or_else(|| speed_for(propulsion_a));
    let basis = match plan_kn {
        Some(_) => SpeedBasis::Plan,
        None if propulsion_a < UNDERWAY_A => SpeedBasis::Cruise,
        None => SpeedBasis::Now,
    };
    // The whole array's current, from the MPPTs on the online sides
    let mppts = sides.iter().fold(0.0, |sum, s| sum + s.mppts);
    let solar_a = sides.iter().fold(0.0, |sum, s| sum + s.solar_a);
    let sky = if mppts > 0.0 {
        sky_factor(now, (solar_a * 4.0) / mppts)
    } else {
        typical_sky(now)
    };
    let end = window_end(now, w, offset_min);
    let range_sides: Vec<RangeSide> = sides
        .iter()
        .map(|s| RangeSide {
            soc: s.soc,
            house_a: s.house_a,
            mppts: s.mppts,
        })
        .collect();
    let projection = project(&range_sides, kn, sky, now, end);
    Some(RangeView {
        kn,
        basis,
        end,
        beyond: projection.empty_at.is_none_or(|at| at > end),
        reserve_in: in_text(projection.empty_at, now),
        reserve_at: at_text(projection.empty_at, now, offset_min),
        no_sun_in: in_text(projection.empty_battery_only_at, now),
        no_sun_at: at_text(projection.empty_battery_only_at, now, offset_min),
        ticks: time_ticks(now, end, offset_min),
        midnights: midnights(now, end, offset_min),
        dock: dock(sides, kn, sky, now, offset_min),
        projection,
    })
}

/// JavaScript's `toFixed(1)`: exact ties round away from zero (0.25 → "0.3"),
/// where Rust's formatting rounds them to even.
pub fn to_fixed1(x: f64) -> String {
    let x = x + 0.0; // -0 → 0
    let quarters = x * 4.0;
    if quarters.fract() == 0.0 && (quarters as i64) % 2 != 0 {
        let tenths = (x.abs() * 10.0).ceil() as i64;
        let sign = if x < 0.0 { "-" } else { "" };
        return format!("{sign}{}.{}", tenths / 10, tenths % 10);
    }
    format!("{x:.1}")
}

/// The chart's lines as SVG path commands in a w×h box: now to the window's
/// end across, SOC (0–100%) up the side, and the array's forecast as a band
/// along the bottom, `SOLAR_BAND` of the height at full sun. Each SOC line
/// ends where it reaches the reserve. At most `CHART_POINTS` points, about one per 2 px.
const SOLAR_BAND: f64 = 0.3;
const CHART_POINTS: usize = 140;

pub fn soc_y(soc: f64, h: f64) -> f64 {
    h - (soc / 100.0) * h
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChartPaths {
    pub with_solar: String,
    pub battery_only: String,
    pub solar: String,
}

pub fn chart_paths(v: &RangeView, now: f64, w: f64, h: f64) -> ChartPaths {
    let all = &v.projection.points;
    let stride = all.len().div_ceil(CHART_POINTS).max(1);
    let pts: Vec<&RangePoint> = all
        .iter()
        .enumerate()
        .filter(|(i, _)| i % stride == 0 || *i == all.len() - 1)
        .map(|(_, p)| p)
        .collect();
    let x = |at: f64| to_fixed1(((at - now) / (v.end - now)) * w);
    let line = |soc: fn(&RangePoint) -> f64| {
        let end = pts.iter().position(|p| soc(p) <= RESERVE_PCT);
        pts[..end.map_or(pts.len(), |e| e + 1)]
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let cmd = if i == 0 { 'M' } else { 'L' };
                format!("{cmd}{} {}", x(p.at), to_fixed1(soc_y(soc(p), h)))
            })
            .collect::<Vec<_>>()
            .join(" ")
    };
    let sun_y = |a: f64| to_fixed1(h - (a / ARRAY_MAX_A) * h * SOLAR_BAND);
    let last = pts.last().map_or_else(|| "0.0".into(), |p| x(p.at));
    let band: Vec<String> = pts
        .iter()
        .map(|p| format!("L{} {}", x(p.at), sun_y(p.solar_a)))
        .collect();
    ChartPaths {
        with_solar: line(|p| p.with_solar),
        battery_only: line(|p| p.battery_only),
        solar: format!("M0 {h} {} L{last} {h} Z", band.join(" ")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixes_like_javascript() {
        assert_eq!(to_fixed1(0.25), "0.3");
        assert_eq!(to_fixed1(2.75), "2.8");
        assert_eq!(to_fixed1(-0.25), "-0.3");
        assert_eq!(to_fixed1(0.5), "0.5");
        assert_eq!(to_fixed1(1.05), "1.1");
        assert_eq!(to_fixed1(88.0), "88.0");
        assert_eq!(to_fixed1(-0.0), "0.0");
        assert_eq!(to_fixed1(-0.04), "-0.0");
    }

    #[test]
    fn steps_on_the_half_knot() {
        assert_eq!(step_speed(6.3, 1), 6.5);
        assert_eq!(step_speed(6.3, -1), 6.0);
        assert_eq!(step_speed(6.0, 1), 6.5);
        assert_eq!(step_speed(1.0, -1), 1.0);
        assert_eq!(step_speed(10.0, 1), 10.0);
    }
}
