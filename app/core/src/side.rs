//! One battery side (one CAN bus): ports of ui/src/display/sideState.ts and the
//! 10 Hz loop in useSide.ts.

use crate::filters::{EtaHold, StepFilter};
use crate::protocol::*;

const BMS_STALE_MS: f64 = 2000.0;
const DEVICE_STALE_MS: f64 = 5000.0;
const CHARGER_STALE_MS: f64 = 2000.0;
const SOLAR_IDLE_A: f64 = 0.5;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Currents {
    pub solar_a: Option<f64>,
    pub charger_a: Option<f64>,
    pub propulsion_a: Option<f64>,
    pub house_a: f64,
}

/// A side with a live BMS.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Live {
    pub soc: f64,
    pub pack_v: f64,
    pub pack_a: f64,
    pub limits: Option<OrionLimits>,
    pub currents: Currents,
    pub shore: bool,
}

/// What the display draws each tick for a side that's online.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reading {
    pub live: Live,
    pub smooth: Currents,
    pub eta_net_a: Option<f64>,
}

#[derive(Clone, Copy)]
struct Stamped<T> {
    value: T,
    at: f64,
}

fn fresh<T: Copy>(x: &Option<Stamped<T>>, now: f64, ms: f64) -> Option<T> {
    x.as_ref().filter(|s| now - s.at < ms).map(|s| s.value)
}

/// Latest decoded frames, as `Raw` in sideState.ts.
#[derive(Default)]
struct Raw {
    pack: Option<Stamped<OrionPack>>,
    limits: Option<Stamped<OrionLimits>>,
    /// Per MPPT source address, in first-seen order like the prototype's Map.
    solar: Vec<(u8, Stamped<f64>)>,
    motor: Option<Stamped<f64>>,
    charger: Option<Stamped<ElconStatus>>,
    house: Option<Stamped<f64>>,
}

impl Raw {
    fn solar_sum(&self, now: f64) -> Option<f64> {
        let mut live = self
            .solar
            .iter()
            .filter(|(_, s)| now - s.at < DEVICE_STALE_MS)
            .peekable();
        live.peek()?;
        Some(live.fold(0.0, |sum, (_, s)| sum + s.value))
    }

    fn sample_house(&mut self, at: f64) {
        let Some(pack) = fresh(&self.pack, at, BMS_STALE_MS) else {
            return;
        };
        let solar = self.solar_sum(at).unwrap_or(0.0);
        let charger = fresh(&self.charger, at, CHARGER_STALE_MS).map_or(0.0, |c| c.a);
        let propulsion = fresh(&self.motor, at, DEVICE_STALE_MS).unwrap_or(0.0);
        self.house = Some(Stamped {
            value: (solar + charger + pack.pack_a - propulsion).max(0.0),
            at,
        });
    }

    fn ingest(&mut self, id: u32, ext: bool, data: &[u8], at: f64) {
        if !ext && id == ORION_PACK {
            if let Some(p) = decode_orion_pack(data) {
                self.pack = Some(Stamped { value: p, at });
            }
        } else if !ext && id == ORION_LIMITS {
            if let Some(l) = decode_orion_limits(data) {
                self.limits = Some(Stamped { value: l, at });
            }
        } else if !ext && id == MOTOR_STATUS {
            if let Some(a) = decode_motor_status(data) {
                self.motor = Some(Stamped { value: a, at });
            }
        } else if ext && id == ELCON_STATUS {
            let Some(c) = decode_elcon_status(data) else {
                return;
            };
            self.charger = Some(Stamped { value: c, at });
            self.sample_house(at);
        } else if ext && n2k_pgn(id) == PGN_BATTERY_STATUS && MPPT_SOURCES.contains(&n2k_source(id))
        {
            let Some(a) = decode_battery_status(data).and_then(|b| b.a) else {
                return;
            };
            let source = n2k_source(id);
            let stamped = Stamped { value: a, at };
            match self.solar.iter_mut().find(|(s, _)| *s == source) {
                Some(entry) => entry.1 = stamped,
                None => self.solar.push((source, stamped)),
            }
            if fresh(&self.charger, at, CHARGER_STALE_MS).is_none() {
                self.sample_house(at);
            }
        }
    }

    fn read(&self, now: f64) -> Option<Live> {
        let pack = fresh(&self.pack, now, BMS_STALE_MS)?;
        let propulsion_a = fresh(&self.motor, now, DEVICE_STALE_MS);
        let charger = fresh(&self.charger, now, CHARGER_STALE_MS);
        let charger_a = charger.map(|c| c.a);
        let solar_a = self
            .solar_sum(now)
            .map(|r| if r < SOLAR_IDLE_A { 0.0 } else { r });
        let house = fresh(&self.house, now, DEVICE_STALE_MS);
        let house_a = match house {
            Some(h) if solar_a.is_some() || charger_a.is_some() => h,
            _ => (solar_a.unwrap_or(0.0) + charger_a.unwrap_or(0.0) + pack.pack_a
                - propulsion_a.unwrap_or(0.0))
            .max(0.0),
        };
        Some(Live {
            soc: pack.soc,
            pack_v: pack.pack_v,
            pack_a: pack.pack_a,
            limits: fresh(&self.limits, now, BMS_STALE_MS),
            currents: Currents {
                solar_a,
                charger_a,
                propulsion_a,
                house_a,
            },
            shore: charger.is_some_and(|c| c.flags & ELCON_FLAG_INPUT_VOLTAGE == 0),
        })
    }
}

/// Decoded state for one bus. Feed it frames with `ingest`, and call `tick`
/// at 10 Hz (the smoothing time constants assume a steady tick).
#[derive(Default)]
pub struct Side {
    raw: Raw,
    solar: StepFilter,
    charger: StepFilter,
    propulsion: StepFilter,
    house: StepFilter,
    eta: EtaHold,
}

impl Side {
    pub fn ingest(&mut self, id: u32, ext: bool, data: &[u8], at: f64) {
        self.raw.ingest(id, ext, data, at);
    }

    /// `None` while the BMS is silent.
    pub fn tick(&mut self, now: f64) -> Option<Reading> {
        let Some(live) = self.raw.read(now) else {
            for f in [
                &mut self.solar,
                &mut self.charger,
                &mut self.propulsion,
                &mut self.house,
            ] {
                f.clear();
            }
            self.eta.clear();
            return None;
        };
        let c = live.currents;
        let smooth = Currents {
            solar_a: self.solar.push(now, c.solar_a),
            charger_a: self.charger.push(now, c.charger_a),
            propulsion_a: self.propulsion.push(now, c.propulsion_a),
            house_a: self.house.push(now, Some(c.house_a)).unwrap_or(c.house_a),
        };
        let smooth_net_a = smooth.solar_a.unwrap_or(0.0) + smooth.charger_a.unwrap_or(0.0)
            - smooth.propulsion_a.unwrap_or(0.0)
            - smooth.house_a;
        Some(Reading {
            live,
            smooth,
            eta_net_a: self.eta.push(now, smooth_net_a),
        })
    }
}
