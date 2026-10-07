//! Non-blocking SocketCAN reader. A missing or failed interface is retried, so
//! the display can start before the buses are up.

use std::os::fd::{AsRawFd, RawFd};
use std::time::{Duration, Instant};

use socketcan::{CanFrame, CanSocket, EmbeddedFrame, Frame, Socket};

const RETRY: Duration = Duration::from_secs(5);

pub struct Bus {
    iface: String,
    socket: Option<CanSocket>,
    retry_at: Instant,
    error: Option<String>,
}

impl Bus {
    pub fn open(iface: String) -> Self {
        let mut bus = Self {
            iface,
            socket: None,
            retry_at: Instant::now(),
            error: None,
        };
        bus.connect();
        bus
    }

    fn connect(&mut self) {
        match CanSocket::open(&self.iface).and_then(|s| s.set_nonblocking(true).map(|_| s)) {
            Ok(s) => {
                self.socket = Some(s);
                self.report(None);
            }
            Err(e) => {
                self.retry_at = Instant::now() + RETRY;
                self.report(Some(e.to_string()));
            }
        }
    }

    /// Logs each change of error state once.
    fn report(&mut self, error: Option<String>) {
        if error == self.error {
            return;
        }
        match &error {
            Some(e) => eprintln!("{}: {e}", self.iface),
            None => eprintln!("{}: open", self.iface),
        }
        self.error = error;
    }

    pub fn fd(&self) -> Option<RawFd> {
        self.socket.as_ref().map(|s| s.as_raw_fd())
    }

    /// Hands every pending data frame to `on_frame(id, extended, data)`.
    pub fn poll(&mut self, mut on_frame: impl FnMut(u32, bool, &[u8])) {
        let Some(socket) = &self.socket else {
            if Instant::now() >= self.retry_at {
                self.connect();
            }
            return;
        };
        loop {
            match socket.read_frame() {
                Ok(CanFrame::Data(f)) => on_frame(f.raw_id(), f.is_extended(), f.data()),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => {
                    // ENETDOWN is reported once when the link goes down; the socket
                    // keeps working when it comes back. Anything else, reopen.
                    if e.raw_os_error() != Some(libc::ENETDOWN) {
                        self.socket = None;
                        self.retry_at = Instant::now() + RETRY;
                    }
                    self.report(Some(e.to_string()));
                    break;
                }
            }
        }
    }
}
