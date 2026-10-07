//! Non-blocking SocketCAN reader with per-bus stats and the Orion pack decode.

use std::os::fd::{AsRawFd, RawFd};
use std::time::{Duration, Instant};

use socketcan::{CanSocket, EmbeddedFrame, Frame, Socket};

use crate::BusInfo;
use crate::protocol::{ORION_PACK, Pack, decode_orion_pack};

pub struct Bus {
    name: &'static str,
    socket: Option<CanSocket>,
    error: Option<String>,
    count: u32,
    fps: u32,
    window: Instant,
    last: String,
    pack: Option<(Pack, Instant)>,
}

impl Bus {
    pub fn open(name: &'static str) -> Self {
        let (socket, error) =
            match CanSocket::open(name).and_then(|s| s.set_nonblocking(true).map(|_| s)) {
                Ok(s) => (Some(s), None),
                Err(e) => (None, Some(e.to_string())),
            };
        if let Some(e) = &error {
            eprintln!("{name}: {e}");
        }
        Self {
            name,
            socket,
            error,
            count: 0,
            fps: 0,
            window: Instant::now(),
            last: String::new(),
            pack: None,
        }
    }

    pub fn fd(&self) -> Option<RawFd> {
        self.socket.as_ref().map(|s| s.as_raw_fd())
    }

    pub fn poll(&mut self) {
        let Some(socket) = &self.socket else { return };
        loop {
            match socket.read_frame() {
                Ok(f) if f.is_error_frame() => {
                    self.error = Some(format!("error frame {:08X}", f.raw_id()))
                }
                Ok(f) => {
                    self.count += 1;
                    let id = if f.is_extended() {
                        format!("{:08X}", f.raw_id())
                    } else {
                        format!("{:03X}", f.raw_id())
                    };
                    let data: Vec<String> = f.data().iter().map(|b| format!("{b:02X}")).collect();
                    self.last = format!("{id}  {}", data.join(" "));
                    if !f.is_extended()
                        && f.raw_id() == ORION_PACK
                        && let Some(p) = decode_orion_pack(f.data())
                    {
                        self.pack = Some((p, Instant::now()));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => {
                    self.error = Some(e.to_string());
                    break;
                }
            }
        }
        if self.window.elapsed() >= Duration::from_secs(1) {
            self.fps = self.count;
            self.count = 0;
            self.window = Instant::now();
        }
    }

    pub fn info(&self) -> BusInfo {
        let operstate = std::fs::read_to_string(format!("/sys/class/net/{}/operstate", self.name));
        let state = match (&self.socket, operstate) {
            (None, _) => "missing".to_string(),
            (Some(_), Ok(s)) if s.trim() == "up" || s.trim() == "unknown" && self.fps > 0 => {
                "up".to_string()
            }
            (Some(_), Ok(s)) => s.trim().to_string(),
            (Some(_), Err(_)) => "?".to_string(),
        };
        let pack = self
            .pack
            .as_ref()
            .filter(|(_, at)| at.elapsed() < Duration::from_secs(2));
        BusInfo {
            name: self.name.into(),
            state: state.into(),
            fps: self.fps as i32,
            last: self.last.clone().into(),
            has_pack: pack.is_some(),
            soc: pack.map_or(0.0, |(p, _)| p.soc),
            volts: pack.map_or(0.0, |(p, _)| p.volts),
            amps: pack.map_or(0.0, |(p, _)| p.amps),
        }
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
}
