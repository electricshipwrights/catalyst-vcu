//! Single-touch input straight from evdev (FT6336U on the CoreMP135).
//!
//! Orientation can be fixed without rebuilding:
//!   VCU_TOUCH=/dev/input/eventN   pick the device instead of auto-detecting
//!   VCU_TOUCH_SWAP_XY=1, VCU_TOUCH_INVERT_X=1, VCU_TOUCH_INVERT_Y=1

use std::fs::File;
use std::io::Read;
use std::os::fd::{AsRawFd, RawFd};

use slint::LogicalPosition;
use slint::platform::{PointerEventButton, WindowEvent};

const EV_SYN: u16 = 0;
const EV_KEY: u16 = 1;
const EV_ABS: u16 = 3;
const SYN_REPORT: u16 = 0;
const BTN_TOUCH: u16 = 0x14a;
const ABS_X: u16 = 0x00;
const ABS_Y: u16 = 0x01;
const ABS_MT_SLOT: u16 = 0x2f;
const ABS_MT_POSITION_X: u16 = 0x35;
const ABS_MT_POSITION_Y: u16 = 0x36;
const ABS_MT_TRACKING_ID: u16 = 0x39;
const INPUT_PROP_DIRECT: usize = 1;

// The kernel's input_event is { ulong sec, ulong usec, u16 type, u16 code, i32 value }.
// Parsed by hand: libc's struct uses musl's 64-bit time_t on 32-bit ARM, which doesn't match.
const TIME_BYTES: usize = 2 * size_of::<usize>();
const EVENT_BYTES: usize = TIME_BYTES + 8;

pub struct Touch {
    file: File,
    pub path: String,
    range_x: (i32, i32),
    range_y: (i32, i32),
    screen: (f32, f32),
    swap_xy: bool,
    invert_x: bool,
    invert_y: bool,
    slot: i32,
    raw: (i32, i32),
    down: bool,
    was_down: bool,
    last_sent: Option<(i32, i32)>,
}

fn flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v == "1")
}

/// Bit `bit` of a sysfs capability mask ("hex words, most significant first").
fn has_bit(mask: &str, bit: usize) -> bool {
    let words: Vec<&str> = mask.split_whitespace().rev().collect();
    let per_word = usize::BITS as usize;
    words
        .get(bit / per_word)
        .and_then(|w| usize::from_str_radix(w, 16).ok())
        .is_some_and(|w| w >> (bit % per_word) & 1 == 1)
}

fn find_device() -> Option<String> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir("/sys/class/input").ok()?.flatten() {
        let name = entry.file_name().into_string().ok()?;
        if !name.starts_with("event") {
            continue;
        }
        let dev = entry.path().join("device");
        let read = |f: &str| std::fs::read_to_string(dev.join(f)).unwrap_or_default();
        let abs = read("capabilities/abs");
        if !(has_bit(&abs, ABS_X as usize) || has_bit(&abs, ABS_MT_POSITION_X as usize)) {
            continue;
        }
        let direct = has_bit(&read("properties"), INPUT_PROP_DIRECT);
        found.push((direct, format!("/dev/input/{name}")));
    }
    found.sort_by_key(|(direct, _)| !direct);
    found.into_iter().next().map(|(_, path)| path)
}

fn abs_range(fd: RawFd, axis: u16) -> Option<(i32, i32)> {
    // EVIOCGABS(axis) = _IOR('E', 0x40 + axis, struct input_absinfo [6 x i32])
    let request = (2u32 << 30) | (24 << 16) | (u32::from(b'E') << 8) | (0x40 + u32::from(axis));
    let mut info = [0i32; 6];
    let ok = unsafe { libc::ioctl(fd, request as _, info.as_mut_ptr()) } == 0;
    (ok && info[2] > info[1]).then_some((info[1], info[2]))
}

impl Touch {
    pub fn open(screen_w: usize, screen_h: usize) -> Result<Self, String> {
        let path = std::env::var("VCU_TOUCH")
            .ok()
            .or_else(find_device)
            .ok_or("no touchscreen found in /sys/class/input")?;
        let file = File::open(&path).map_err(|e| format!("{path}: {e}"))?;
        let fd = file.as_raw_fd();
        unsafe {
            libc::fcntl(
                fd,
                libc::F_SETFL,
                libc::fcntl(fd, libc::F_GETFL) | libc::O_NONBLOCK,
            )
        };
        let mut range_x = abs_range(fd, ABS_X)
            .or_else(|| abs_range(fd, ABS_MT_POSITION_X))
            .ok_or(format!("{path}: no X axis"))?;
        let mut range_y = abs_range(fd, ABS_Y)
            .or_else(|| abs_range(fd, ABS_MT_POSITION_Y))
            .ok_or(format!("{path}: no Y axis"))?;
        // The CoreMP135's touch driver advertises the panel's portrait ranges
        // (x 0..239, y 0..319) but reports landscape screen coordinates.
        let span = |(lo, hi): (i32, i32)| (hi - lo + 1) as usize;
        if screen_w != screen_h && span(range_x) == screen_h && span(range_y) == screen_w {
            std::mem::swap(&mut range_x, &mut range_y);
        }
        Ok(Self {
            file,
            path,
            range_x,
            range_y,
            screen: (screen_w as f32, screen_h as f32),
            swap_xy: flag("VCU_TOUCH_SWAP_XY"),
            invert_x: flag("VCU_TOUCH_INVERT_X"),
            invert_y: flag("VCU_TOUCH_INVERT_Y"),
            slot: 0,
            raw: (0, 0),
            down: false,
            was_down: false,
            last_sent: None,
        })
    }

    pub fn describe(&self) -> String {
        let (sx, sy) = (self.range_x, self.range_y);
        format!(
            "{} x {}..{} y {}..{} swap={} invert_x={} invert_y={}",
            self.path, sx.0, sx.1, sy.0, sy.1, self.swap_xy, self.invert_x, self.invert_y
        )
    }

    pub fn raw(&self) -> (i32, i32) {
        self.raw
    }

    fn position(&self) -> LogicalPosition {
        let norm =
            |v: i32, (lo, hi): (i32, i32)| ((v - lo) as f32 / (hi - lo) as f32).clamp(0.0, 1.0);
        let (mut nx, mut ny) = (
            norm(self.raw.0, self.range_x),
            norm(self.raw.1, self.range_y),
        );
        if self.swap_xy {
            std::mem::swap(&mut nx, &mut ny);
        }
        if self.invert_x {
            nx = 1.0 - nx;
        }
        if self.invert_y {
            ny = 1.0 - ny;
        }
        LogicalPosition::new(nx * (self.screen.0 - 1.0), ny * (self.screen.1 - 1.0))
    }

    /// Drains pending evdev events and returns the pointer events they produce.
    pub fn poll(&mut self) -> Vec<WindowEvent> {
        let mut out = Vec::new();
        let mut buf = [0u8; EVENT_BYTES * 32];
        while let Ok(n) = self.file.read(&mut buf) {
            if n == 0 {
                break;
            }
            for ev in buf[..n].as_chunks::<EVENT_BYTES>().0 {
                let ty = u16::from_ne_bytes([ev[TIME_BYTES], ev[TIME_BYTES + 1]]);
                let code = u16::from_ne_bytes([ev[TIME_BYTES + 2], ev[TIME_BYTES + 3]]);
                let value =
                    i32::from_ne_bytes(ev[TIME_BYTES + 4..TIME_BYTES + 8].try_into().unwrap());
                self.handle(ty, code, value, &mut out);
            }
        }
        out
    }

    fn handle(&mut self, ty: u16, code: u16, value: i32, out: &mut Vec<WindowEvent>) {
        match (ty, code) {
            (EV_KEY, BTN_TOUCH) => self.down = value != 0,
            (EV_ABS, ABS_X) => self.raw.0 = value,
            (EV_ABS, ABS_Y) => self.raw.1 = value,
            (EV_ABS, ABS_MT_SLOT) => self.slot = value,
            (EV_ABS, ABS_MT_POSITION_X) if self.slot == 0 => self.raw.0 = value,
            (EV_ABS, ABS_MT_POSITION_Y) if self.slot == 0 => self.raw.1 = value,
            (EV_ABS, ABS_MT_TRACKING_ID) if self.slot == 0 => self.down = value >= 0,
            (EV_SYN, SYN_REPORT) => {
                let position = self.position();
                let button = PointerEventButton::Left;
                match (self.was_down, self.down) {
                    (false, true) => {
                        // A touchscreen has no hover, so move the pointer to the press point
                        // first; otherwise TouchArea's mouse-x/y still hold the previous touch.
                        out.push(WindowEvent::PointerMoved { position });
                        out.push(WindowEvent::PointerPressed { position, button });
                    }
                    (true, false) => {
                        out.push(WindowEvent::PointerReleased { position, button });
                        out.push(WindowEvent::PointerExited);
                    }
                    (true, true) if self.last_sent != Some(self.raw) => {
                        out.push(WindowEvent::PointerMoved { position })
                    }
                    _ => {}
                }
                self.was_down = self.down;
                self.last_sent = Some(self.raw);
            }
            _ => {}
        }
    }

    pub fn fd(&self) -> RawFd {
        self.file.as_raw_fd()
    }
}
