//! Port of ui/src/display/power.ts: the numbers the power page draws.

use crate::js_round;
use crate::side::Reading;

/// Input per source: solar per MPPT, each about 34 A at full sun (1,750 W at 51.2 V).
pub const SOLAR_SLOT_A: f64 = 35.0;
/// Input per source: shore charging, up to the Elcon's 80 A.
pub const SHORE_SLOT_A: f64 = 80.0;
/// Per side: 110 kWh total, so 55 kWh at 51.2 V nominal (the Orion BMS log implies ~1,105 Ah).
pub const CAPACITY_AH: f64 = 1100.0;
/// About 100 of the 110 kWh is usable, so "empty" is 9% SOC.
pub const RESERVE_PCT: f64 = 9.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Smoothing {
    #[default]
    Smooth,
    Instant,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Eta {
    /// Not shown: net current is under 1 A.
    None,
    Full,
    /// Discharging with only the reserve left.
    Reserve,
    /// Net current just changed and hasn't settled yet.
    Pending {
        to_full: bool,
    },
    Time {
        hm: String,
        to_full: bool,
    },
}

impl Eta {
    /// The prototype's text, e.g. "2:30 to empty" or "-- to full".
    pub fn text(&self) -> Option<String> {
        let to = |full: bool| if full { "full" } else { "empty" };
        match self {
            Eta::None => None,
            Eta::Full => Some("full".into()),
            Eta::Reserve => Some("reserve".into()),
            Eta::Pending { to_full } => Some(format!("-- to {}", to(*to_full))),
            Eta::Time { hm, to_full } => Some(format!("{hm} to {}", to(*to_full))),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PowerView {
    pub soc: f64,
    pub shore: bool,
    pub solar_a: i32,
    /// Per MPPT 1–4; `None` when it isn't allocated to this side.
    pub mppt_a: [Option<f64>; 4],
    /// Shore charging; `None` when the charger is silent (no shore power).
    pub charger_a: Option<i32>,
    pub in_a: i32,
    pub out_a: i32,
    /// The house load from the inside out (base + heater + inverter), then the motor.
    pub base_a: i32,
    pub heater_a: i32,
    pub inverter_a: i32,
    pub propulsion_a: i32,
    pub net_a: i32,
    pub eta: Eta,
}

/// Under 1 h to the minute ("0:42"), 1–7 h to 15 min ("2:15"), then whole hours ("9h").
pub(crate) fn hm(hours: f64) -> String {
    if hours < 7.0 {
        let step = if hours >= 1.0 { 15.0 } else { 1.0 };
        let total = js_round(hours * 60.0 / step) * step;
        if total < 420.0 {
            return format!("{}:{:02}", (total / 60.0).floor(), total % 60.0);
        }
    }
    let h = js_round(hours);
    if h >= 100.0 {
        "99h+".into()
    } else {
        format!("{h}h")
    }
}

/// Time to full, or to empty counting down to the reserve (`Eta::Reserve` once in it).
pub fn eta(soc: f64, net_a: f64, capacity_ah: f64) -> Eta {
    if net_a > 0.0 && soc >= 99.5 {
        return Eta::Full;
    }
    if net_a.abs() < 1.0 {
        return Eta::None;
    }
    if net_a > 0.0 {
        return Eta::Time {
            hm: hm((100.0 - soc) / 100.0 * capacity_ah / net_a),
            to_full: true,
        };
    }
    let usable = soc - RESERVE_PCT;
    if usable <= 0.0 {
        return Eta::Reserve;
    }
    Eta::Time {
        hm: hm(usable / 100.0 * capacity_ah / -net_a),
        to_full: false,
    }
}

fn pending_eta(soc: f64, net_a: i32) -> Eta {
    match net_a {
        n if n > 0 && soc >= 99.5 => Eta::Full,
        0 => Eta::None,
        n => Eta::Pending { to_full: n > 0 },
    }
}

/// `None` (offline) in, `None` out.
pub fn power_view(reading: Option<&Reading>, smoothing: Smoothing) -> Option<PowerView> {
    let r = reading?;
    let c = match smoothing {
        Smoothing::Smooth => r.smooth,
        Smoothing::Instant => r.live.currents,
    };
    let solar = c.solar_a.unwrap_or(0.0).max(0.0);
    let supplied = solar + c.charger_a.unwrap_or(0.0).max(0.0);
    let propulsion = c.propulsion_a.unwrap_or(0.0).max(0.0);
    let house = c.house_a.max(0.0);
    let load = propulsion + house;
    let in_a = js_round(supplied) as i32;
    let out_a = js_round(load) as i32;
    // The heater and inverter are part of the derived house load, so they can't exceed it
    let heater_a = js_round(c.heater_a.unwrap_or(0.0).max(0.0).min(house));
    let inverter_a = js_round(c.inverter_a.unwrap_or(0.0).max(0.0).min(house - heater_a));
    let propulsion_a = js_round(propulsion) as i32;
    let soc = r.live.soc;
    Some(PowerView {
        soc,
        shore: r.live.shore,
        solar_a: js_round(solar) as i32,
        mppt_a: r.live.mppt_a.map(|a| a.map(|a| a.max(0.0))),
        charger_a: c.charger_a.map(|a| js_round(a.max(0.0)) as i32),
        in_a,
        out_a,
        base_a: (out_a - propulsion_a - heater_a as i32 - inverter_a as i32).max(0),
        heater_a: heater_a as i32,
        inverter_a: inverter_a as i32,
        propulsion_a,
        net_a: in_a - out_a,
        eta: match r.eta_net_a {
            None => pending_eta(soc, in_a - out_a),
            Some(net) => eta(soc, net, CAPACITY_AH),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_time_like_the_prototype() {
        // Under an hour: nearest minute
        assert_eq!(hm(0.5), "0:30");
        assert_eq!(hm(0.991), "0:59");
        assert_eq!(hm(0.995), "1:00");
        // 1 to 7 hours: nearest 15 minutes
        assert_eq!(hm(1.1), "1:00");
        assert_eq!(hm(1.13), "1:15");
        assert_eq!(hm(2.99), "3:00");
        assert_eq!(hm(4.5), "4:30");
        assert_eq!(hm(6.8), "6:45");
        // Rounds up to 7 hours: whole hours from there
        assert_eq!(hm(6.9), "7h");
        assert_eq!(hm(7.0), "7h");
        assert_eq!(hm(7.49), "7h");
        assert_eq!(hm(7.5), "8h");
        assert_eq!(hm(12.1), "12h");
        assert_eq!(hm(99.4), "99h");
        assert_eq!(hm(99.5), "99h+");
        assert_eq!(hm(150.0), "99h+");
        // Empty is the 9% reserve: 41% of 280 Ah at 140 A is 0.82 h
        assert_eq!(eta(50.0, -140.0, 280.0).text().unwrap(), "0:49 to empty");
        assert_eq!(eta(9.5, -60.0, 1100.0).text().unwrap(), "0:06 to empty");
        assert_eq!(eta(9.0, -60.0, 1100.0), Eta::Reserve);
        assert_eq!(eta(5.0, 60.0, 1100.0).text().unwrap(), "17h to full");
        assert_eq!(eta(99.6, 5.0, 280.0), Eta::Full);
        assert_eq!(eta(60.0, 0.5, 280.0), Eta::None);
        assert_eq!(pending_eta(60.0, -3).text().unwrap(), "-- to empty");
    }
}
