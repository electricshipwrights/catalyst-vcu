//! Decoders for the frames the display uses, mirroring ui/shared/protocol.ts.

pub const ORION_PACK: u32 = 0x6b0;
pub const ORION_LIMITS: u32 = 0x6b1;
pub const PGN_BATTERY_STATUS: u32 = 127508;
pub const MPPT_SOURCES: [u8; 4] = [0x22, 0x23, 0x24, 0x25];
/// Placeholder until the real motor controller's frame is known.
pub const MOTOR_STATUS: u32 = 0x700;
pub const ELCON_STATUS: u32 = 0x18ff50e5;
pub const ELCON_FLAG_INPUT_VOLTAGE: u8 = 4;

fn u16be(d: &[u8], i: usize) -> f64 {
    f64::from(u16::from_be_bytes([d[i], d[i + 1]]))
}
fn s16be(d: &[u8], i: usize) -> f64 {
    f64::from(i16::from_be_bytes([d[i], d[i + 1]]))
}
fn u16le(d: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([d[i], d[i + 1]])
}

fn orion_valid(id: u32, d: &[u8]) -> bool {
    d.len() == 8 && u32::from(d[7]) == d[..7].iter().fold(id + 8, |s, &b| s + u32::from(b)) & 0xff
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrionPack {
    /// Positive = discharge.
    pub pack_a: f64,
    pub pack_v: f64,
    pub soc: f64,
    pub relays: u16,
}

pub fn decode_orion_pack(d: &[u8]) -> Option<OrionPack> {
    orion_valid(ORION_PACK, d).then(|| OrionPack {
        pack_a: s16be(d, 0) / 10.0,
        pack_v: u16be(d, 2) / 10.0,
        soc: f64::from(d[4]) / 2.0,
        relays: u16::from_be_bytes([d[5], d[6]]),
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrionLimits {
    pub dcl: f64,
    pub ccl: f64,
    pub t_hi: f64,
    pub t_lo: f64,
}

pub fn decode_orion_limits(d: &[u8]) -> Option<OrionLimits> {
    orion_valid(ORION_LIMITS, d).then(|| OrionLimits {
        dcl: u16be(d, 0),
        ccl: u16be(d, 2),
        t_hi: f64::from(d[4] as i8),
        t_lo: f64::from(d[5] as i8),
    })
}

pub fn n2k_pgn(id: u32) -> u32 {
    let pgn = (id >> 8) & 0x3ffff;
    if (pgn >> 8) & 0xff < 240 {
        pgn & 0x3ff00
    } else {
        pgn
    }
}

pub fn n2k_source(id: u32) -> u8 {
    (id & 0xff) as u8
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BatteryStatus {
    pub instance: u8,
    pub v: f64,
    pub a: Option<f64>,
    pub temp_c: Option<f64>,
    pub sid: u8,
}

pub fn decode_battery_status(d: &[u8]) -> Option<BatteryStatus> {
    if d.len() != 8 {
        return None;
    }
    let a = u16le(d, 3) as i16;
    let t = u16le(d, 5);
    Some(BatteryStatus {
        instance: d[0],
        v: f64::from(u16le(d, 1)) / 100.0,
        a: (a != 0x7fff).then(|| f64::from(a) / 10.0),
        temp_c: (t != 0xffff).then(|| f64::from(t) / 100.0 - 273.15),
        sid: d[7],
    })
}

pub fn decode_motor_status(d: &[u8]) -> Option<f64> {
    (d.len() >= 2).then(|| s16be(d, 0) / 10.0)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ElconStatus {
    pub v: f64,
    pub a: f64,
    pub flags: u8,
}

pub fn decode_elcon_status(d: &[u8]) -> Option<ElconStatus> {
    (d.len() == 8).then(|| ElconStatus {
        v: u16be(d, 0) / 10.0,
        a: u16be(d, 2) / 10.0,
        flags: d[4],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_logged_orion_frames() {
        // t6B080542020CACC04BC4089A and t6B1801EE00B61212008208D1 from 2026-07-10-16-02-18.txt
        let p = decode_orion_pack(&[0x05, 0x42, 0x02, 0x0C, 0xAC, 0xC0, 0x4B, 0xC4]).unwrap();
        assert_eq!(
            (p.pack_a, p.pack_v, p.soc, p.relays),
            (134.6, 52.4, 86.0, 0xc04b)
        );
        let l = decode_orion_limits(&[0x01, 0xEE, 0x00, 0xB6, 0x12, 0x12, 0x00, 0x82]).unwrap();
        assert_eq!((l.dcl, l.ccl, l.t_hi, l.t_lo), (494.0, 182.0, 18.0, 18.0));
    }

    #[test]
    fn rejects_bad_checksums_and_lengths() {
        assert!(decode_orion_pack(&[0x05, 0x42, 0x02, 0x0C, 0xAC, 0xC0, 0x4B, 0xC5]).is_none());
        assert!(decode_orion_pack(&[0x05, 0x42]).is_none());
        assert!(decode_battery_status(&[0; 7]).is_none());
    }

    #[test]
    fn splits_n2k_ids() {
        let id = (6 << 26) | (PGN_BATTERY_STATUS << 8) | 0x22;
        assert_eq!((n2k_pgn(id), n2k_source(id)), (PGN_BATTERY_STATUS, 0x22));
        // PDU1 (destination-addressed) PGNs drop the destination byte
        assert_eq!(n2k_pgn((3 << 26) | (0xEA12 << 8) | 0x05), 0xEA00);
    }

    #[test]
    fn decodes_n2k_battery_status_with_missing_fields() {
        let s = decode_battery_status(&[1, 0x5A, 0x14, 0xFF, 0x7F, 0xFF, 0xFF, 9]).unwrap();
        assert_eq!(
            (s.instance, s.v, s.a, s.temp_c, s.sid),
            (1, 52.1, None, None, 9)
        );
    }
}
