//! Port of ui/shared/sun.ts: how much the canopy's array could give under a
//! clear sky at a time, for the range view's solar forecast. (The bench's
//! season and time of day move the sim's clock, which the display gets as
//! NMEA 2000 time, so they aren't ported.)

use std::f64::consts::PI;

pub const HOUR_MS: f64 = 3_600_000.0;
pub const DAY_MS: f64 = 86_400_000.0;

/// Where the sun is: fixed until the display knows the boat's position.
/// A placeholder; to revisit with a GPS (NMEA 2000 PGN 129025) or a setting.
pub const LAT: f64 = 48.5;
pub const LON: f64 = -123.0;
/// All four MPPTs at full sun (7 kW at 51.2 V), and the sun height that gives it.
pub const ARRAY_MAX_A: f64 = 137.0;
const FULL_SUN_SIN: f64 = 0.9;

/// Sine of the sun's elevation at a time (ms since the epoch): a simple
/// declination and hour-angle model, good to a few degrees.
pub fn sun_height(ms: f64) -> f64 {
    let day = day_of_year(ms);
    let rad = PI / 180.0;
    let decl = 23.44 * rad * ((2.0 * PI * (284.0 + day)) / 365.0).sin();
    let solar_hours = (((ms / HOUR_MS) % 24.0) + LON / 15.0 + 24.0) % 24.0;
    let hour_angle = 15.0 * rad * (solar_hours - 12.0);
    (LAT * rad).sin() * decl.sin() + (LAT * rad).cos() * decl.cos() * hour_angle.cos()
}

/// Days since the epoch for a civil date (proleptic Gregorian); `month` is
/// 1–12, and `day` may be 0 for the day before the 1st, like `Date.UTC`.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The UTC year of a time.
fn year_of(ms: f64) -> i64 {
    let z = (ms / DAY_MS).floor() as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    yoe + era * 400 + i64::from(month <= 2)
}

/// `Date.UTC(year, month0, day)` in ms, with JavaScript's 0-based month.
fn utc_ms(year: i64, month0: i64, day: i64) -> f64 {
    days_from_civil(year, month0 + 1, day) as f64 * DAY_MS
}

/// Days since 31 Dec of the year before (UTC), with the fraction of the day.
pub fn day_of_year(ms: f64) -> f64 {
    (ms - utc_ms(year_of(ms), 0, 0)) / DAY_MS
}

/// The whole array's current under a clear sky.
pub fn clear_sky_a(ms: f64) -> f64 {
    ARRAY_MAX_A.min((ARRAY_MAX_A * sun_height(ms).max(0.0)) / FULL_SUN_SIN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_like_javascript() {
        // Date.UTC(2026, 0, 0) and Date.UTC(2024, 1, 29)
        assert_eq!(utc_ms(2026, 0, 0), 1_767_139_200_000.0);
        assert_eq!(utc_ms(2024, 1, 29), 1_709_164_800_000.0);
        assert_eq!(year_of(1_767_225_599_999.0), 2025);
        assert_eq!(year_of(1_767_225_600_000.0), 2026);
        assert_eq!(year_of(-1.0), 1969);
        // Noon UTC on 1 Feb 2026
        assert_eq!(day_of_year(1_769_947_200_000.0), 32.5);
    }
}
