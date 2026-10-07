//! Legacy fbdev output. The CoreMP135 LCD is an fbtft device (`/dev/fb1`,
//! RGB565); fbtft's deferred I/O pushes the pages we touch over SPI.

use std::error::Error;
use std::fs::OpenOptions;
use std::os::fd::AsRawFd;

use slint::platform::software_renderer::{PhysicalRegion, Rgb565Pixel};

#[derive(Clone, Copy, Debug)]
enum Format {
    Rgb565,
    Bgr565,
    Xrgb8888,
}

pub struct Framebuffer {
    map: memmap2::MmapMut,
    width: usize,
    height: usize,
    line_length: usize,
    format: Format,
    path: String,
}

impl Framebuffer {
    pub fn open(path: &str) -> Result<Self, Box<dyn Error>> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| format!("{path}: {e}"))?;
        let mut var: FbVarScreeninfo = unsafe { std::mem::zeroed() };
        let mut fix: FbFixScreeninfo = unsafe { std::mem::zeroed() };
        unsafe {
            if libc::ioctl(file.as_raw_fd(), FBIOGET_VSCREENINFO as _, &mut var) != 0
                || libc::ioctl(file.as_raw_fd(), FBIOGET_FSCREENINFO as _, &mut fix) != 0
            {
                return Err(format!(
                    "{path}: framebuffer ioctl failed: {}",
                    std::io::Error::last_os_error()
                )
                .into());
            }
        }
        let layout = (
            var.bits_per_pixel,
            var.red.offset,
            var.green.offset,
            var.blue.offset,
        );
        let format = match layout {
            (16, 11, 5, 0) => Format::Rgb565,
            (16, 0, 5, 11) => Format::Bgr565,
            (32, 16, 8, 0) => Format::Xrgb8888,
            _ => {
                return Err(format!(
                    "{path}: unsupported pixel layout {layout:?} (bpp, r, g, b offsets)"
                )
                .into());
            }
        };
        let line_length = fix.line_length as usize;
        let map = unsafe {
            memmap2::MmapOptions::new()
                .len(line_length * var.yres as usize)
                .map_mut(&file)?
        };
        Ok(Self {
            map,
            width: var.xres as usize,
            height: var.yres as usize,
            line_length,
            format,
            path: path.into(),
        })
    }

    pub fn size(&self) -> (usize, usize) {
        (self.width, self.height)
    }

    pub fn describe(&self) -> String {
        let name = self.path.trim_start_matches("/dev/");
        let format = format!("{:?}", self.format).to_lowercase();
        format!("{name} {}x{} {format}", self.width, self.height)
    }

    /// Copies the rectangles Slint just repainted from `back` into the framebuffer.
    pub fn flush(&mut self, back: &[Rgb565Pixel], region: &PhysicalRegion) {
        for (origin, size) in region.iter() {
            let (x0, y0) = (origin.x.max(0) as usize, origin.y.max(0) as usize);
            let x1 = (x0 + size.width as usize).min(self.width);
            let y1 = (y0 + size.height as usize).min(self.height);
            for y in y0..y1 {
                let src = &back[y * self.width + x0..y * self.width + x1];
                let row = &mut self.map[y * self.line_length..(y + 1) * self.line_length];
                match self.format {
                    Format::Rgb565 => {
                        for (i, p) in src.iter().enumerate() {
                            row[(x0 + i) * 2..(x0 + i) * 2 + 2].copy_from_slice(&p.0.to_ne_bytes());
                        }
                    }
                    Format::Bgr565 => {
                        for (i, p) in src.iter().enumerate() {
                            let v = (p.0 & 0x07e0) | (p.0 >> 11) | (p.0 << 11);
                            row[(x0 + i) * 2..(x0 + i) * 2 + 2].copy_from_slice(&v.to_ne_bytes());
                        }
                    }
                    Format::Xrgb8888 => {
                        for (i, p) in src.iter().enumerate() {
                            let (r, g, b) = ((p.0 >> 11) & 31, (p.0 >> 5) & 63, p.0 & 31);
                            let v = u32::from(r << 3 | r >> 2) << 16
                                | u32::from(g << 2 | g >> 4) << 8
                                | u32::from(b << 3 | b >> 2);
                            row[(x0 + i) * 4..(x0 + i) * 4 + 4].copy_from_slice(&v.to_ne_bytes());
                        }
                    }
                }
            }
        }
    }
}

/// Other processes holding the framebuffer open (e.g. a vendor launcher) would
/// draw over us. Returns "pid (name)" for each.
pub fn other_users(path: &str) -> Vec<String> {
    let me = std::process::id().to_string();
    let Ok(procs) = std::fs::read_dir("/proc") else {
        return vec![];
    };
    procs
        .flatten()
        .filter_map(|p| {
            let pid = p.file_name().into_string().ok()?;
            if pid == me || !pid.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let uses = std::fs::read_dir(p.path().join("fd"))
                .ok()?
                .flatten()
                .any(|fd| std::fs::read_link(fd.path()).is_ok_and(|t| t.as_os_str() == path));
            let comm = std::fs::read_to_string(p.path().join("comm")).unwrap_or_default();
            uses.then(|| format!("{pid} ({})", comm.trim()))
        })
        .collect()
}

/// Puts the active VT in graphics mode so fbcon stops drawing (cursor, text)
/// over the LCD; restores text mode on drop.
pub struct GraphicsMode(Option<std::fs::File>);

const KDSETMODE: u32 = 0x4b3a;
const KD_TEXT: libc::c_int = 0;
const KD_GRAPHICS: libc::c_int = 1;

impl GraphicsMode {
    pub fn enter() -> Self {
        let tty = OpenOptions::new().write(true).open("/dev/tty0").ok();
        match &tty {
            Some(t) if unsafe { libc::ioctl(t.as_raw_fd(), KDSETMODE as _, KD_GRAPHICS) } == 0 => {}
            _ => eprintln!(
                "warning: could not put the console in graphics mode; fbcon may draw over the LCD"
            ),
        }
        Self(tty)
    }
}

impl Drop for GraphicsMode {
    fn drop(&mut self) {
        if let Some(t) = &self.0 {
            unsafe { libc::ioctl(t.as_raw_fd(), KDSETMODE as _, KD_TEXT) };
        }
    }
}

const FBIOGET_VSCREENINFO: u32 = 0x4600;
const FBIOGET_FSCREENINFO: u32 = 0x4602;

#[repr(C)]
struct FbBitfield {
    offset: u32,
    length: u32,
    msb_right: u32,
}

#[repr(C)]
struct FbVarScreeninfo {
    xres: u32,
    yres: u32,
    xres_virtual: u32,
    yres_virtual: u32,
    xoffset: u32,
    yoffset: u32,
    bits_per_pixel: u32,
    grayscale: u32,
    red: FbBitfield,
    green: FbBitfield,
    blue: FbBitfield,
    transp: FbBitfield,
    nonstd: u32,
    activate: u32,
    height: u32,
    width: u32,
    accel_flags: u32,
    pixclock: u32,
    left_margin: u32,
    right_margin: u32,
    upper_margin: u32,
    lower_margin: u32,
    hsync_len: u32,
    vsync_len: u32,
    sync: u32,
    vmode: u32,
    rotate: u32,
    colorspace: u32,
    reserved: [u32; 4],
}

#[repr(C)]
struct FbFixScreeninfo {
    id: [u8; 16],
    smem_start: libc::c_ulong,
    smem_len: u32,
    type_: u32,
    type_aux: u32,
    visual: u32,
    xpanstep: u16,
    ypanstep: u16,
    ywrapstep: u16,
    line_length: u32,
    mmio_start: libc::c_ulong,
    mmio_len: u32,
    accel: u32,
    capabilities: u16,
    reserved: [u16; 2],
}
