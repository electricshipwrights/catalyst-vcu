//! CAN decoding, mirroring ui/shared/protocol.ts.

// The board loop is Linux-only, so on other hosts only the tests use this.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

pub const ORION_PACK: u32 = 0x6b0;

pub struct Pack {
    pub soc: f32,
    pub volts: f32,
    pub amps: f32,
}

/// Same layout and checksum as `decodeOrionPack` in ui/shared/protocol.ts.
pub fn decode_orion_pack(d: &[u8]) -> Option<Pack> {
    let sum = d
        .iter()
        .take(7)
        .fold(ORION_PACK + 8, |s, &b| s + u32::from(b));
    if d.len() != 8 || d[7] != (sum & 0xff) as u8 {
        return None;
    }
    Some(Pack {
        amps: f32::from(i16::from_be_bytes([d[0], d[1]])) / 10.0,
        volts: f32::from(u16::from_be_bytes([d[2], d[3]])) / 10.0,
        soc: f32::from(d[4]) / 2.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_logged_frame() {
        // t6B080542020CACC04BC4089A from 2026-07-10-16-02-18.txt
        let p = decode_orion_pack(&[0x05, 0x42, 0x02, 0x0C, 0xAC, 0xC0, 0x4B, 0xC4]).unwrap();
        assert_eq!((p.amps, p.volts, p.soc), (134.6, 52.4, 86.0));
    }

    #[test]
    fn rejects_bad_checksum() {
        assert!(decode_orion_pack(&[0x05, 0x42, 0x02, 0x0C, 0xAC, 0xC0, 0x4B, 0xC5]).is_none());
    }
}
