//! The gateway's stream (GATEWAY.md), mirroring ui/shared/gateway.ts: which
//! of the router's buses concern each side, the MPPT allocation frame, and the
//! cannelloni packets the router sends over UDP.

/// Port or starboard: one battery bank and its devices.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SideName {
    #[default]
    Port,
    Stbd,
}

/// Router buses (CAN1–6), plus 255 for frames the gateway makes up. The charger
/// buses are assumed (each on its side's BMS bus).
pub const BMS_BUS: [u8; 2] = [3, 2];
pub const MOTOR_BUS: [u8; 2] = [4, 5];
pub const CHARGER_BUS: [u8; 2] = [3, 2];
pub const NMEA_BUS: u8 = 6;
pub const SELF_BUS: u8 = 255;

/// Whether frames on `bus` concern `side`.
pub fn concerns(side: SideName, bus: u8) -> bool {
    let i = side as usize;
    [BMS_BUS[i], MOTOR_BUS[i], CHARGER_BUS[i], NMEA_BUS, SELF_BUS].contains(&bus)
}

/// One byte per MPPT 1–4: 0 none, 1 port, 2 starboard. How it's decided is
/// TBD; until the gateway sends one, assume 2/2.
pub const MPPT_ALLOCATION: u32 = 0x7f0;
pub type Allocation = [Option<SideName>; 4];
pub const DEFAULT_ALLOCATION: Allocation = [
    Some(SideName::Port),
    Some(SideName::Port),
    Some(SideName::Stbd),
    Some(SideName::Stbd),
];

pub fn decode_allocation(d: &[u8]) -> Allocation {
    std::array::from_fn(|i| match d.get(i) {
        Some(1) => Some(SideName::Port),
        Some(2) => Some(SideName::Stbd),
        _ => None,
    })
}

pub const UDP_PORT_BASE: u16 = 20000;
const CNL_VERSION: u8 = 2;
const CNL_HEADER: usize = 5;
const EFF: u32 = 0x8000_0000;
const RTR: u32 = 0x4000_0000;
const ERR: u32 = 0x2000_0000;
const CANFD: u8 = 0x80;

/// Hands each data frame in a cannelloni packet to `on_frame(id, extended,
/// data)`, skipping remote and error frames. False if it isn't a packet.
pub fn decode_cannelloni(buf: &[u8], mut on_frame: impl FnMut(u32, bool, &[u8])) -> bool {
    if buf.len() < CNL_HEADER || buf[0] != CNL_VERSION || buf[1] != 0 {
        return false;
    }
    let count = u16::from_be_bytes([buf[3], buf[4]]);
    let mut at = CNL_HEADER;
    for _ in 0..count {
        if buf.len() - at < 5 {
            break;
        }
        let id = u32::from_be_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]]);
        let fd = buf[at + 4] & CANFD != 0;
        let len = usize::from(buf[at + 4] & !CANFD);
        at += 5 + usize::from(fd);
        if id & RTR != 0 {
            continue; // remote frames carry no data
        }
        if len > 64 || buf.len() - at < len {
            break;
        }
        if id & ERR == 0 {
            let ext = id & EFF != 0;
            on_frame(id & if ext { 0x1fff_ffff } else { 0x7ff }, ext, &buf[at..at + len]);
        }
        at += len;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_cannelloni_packets() {
        // Two frames: standard 0x6B0 with 2 bytes, extended 0x18FF50E5 with 1
        let buf = [
            2, 0, 7, 0, 2, //
            0x00, 0x00, 0x06, 0xB0, 2, 0xAA, 0xBB, //
            0x98, 0xFF, 0x50, 0xE5, 1, 0xCC,
        ];
        let mut got = vec![];
        assert!(decode_cannelloni(&buf, |id, ext, d| got.push((id, ext, d.to_vec()))));
        assert_eq!(
            got,
            [
                (0x6B0, false, vec![0xAA, 0xBB]),
                (0x18FF50E5, true, vec![0xCC])
            ]
        );
        assert!(!decode_cannelloni(&[1, 0, 0, 0, 0], |_, _, _| {}));
    }

    #[test]
    fn routes_buses_and_reads_allocations() {
        assert!(concerns(SideName::Port, 3) && concerns(SideName::Port, 6));
        assert!(!concerns(SideName::Port, 2) && !concerns(SideName::Stbd, 4));
        assert_eq!(
            decode_allocation(&[2, 1, 0]),
            [Some(SideName::Stbd), Some(SideName::Port), None, None]
        );
    }
}
