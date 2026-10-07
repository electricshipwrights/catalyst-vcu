//! Board check for the CoreMP135: renders a Slint UI with the software
//! renderer straight into the LCD framebuffer, feeds it touch from evdev, and
//! shows live frames from can0/can1.
//!
//! `vcu-spike --screenshot out` renders the same UI headlessly (any OS) into
//! out-dark.png, out-light.png and out-night.png.

use std::error::Error;
use std::rc::Rc;
use std::time::{Duration, Instant};

use slint::platform::software_renderer::{MinimalSoftwareWindow, RepaintBufferType, Rgb565Pixel};
use slint::platform::{Platform, PointerEventButton, WindowAdapter, WindowEvent};
use slint::{ComponentHandle, LogicalPosition, PhysicalSize};

#[cfg(target_os = "linux")]
mod board;
#[cfg(target_os = "linux")]
mod can;
#[cfg(target_os = "linux")]
mod fb;
mod protocol;
#[cfg(target_os = "linux")]
mod touch;

slint::include_modules!();

pub const WIDTH: u32 = 320;
pub const HEIGHT: u32 = 240;

struct SpikePlatform {
    window: Rc<MinimalSoftwareWindow>,
    start: Instant,
}

impl Platform for SpikePlatform {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> {
        Ok(self.window.clone())
    }

    fn duration_since_start(&self) -> Duration {
        self.start.elapsed()
    }
}

/// Slint's errors only implement `std::error::Error` with its `std` feature, which we leave off.
pub fn slint_error(e: slint::PlatformError) -> Box<dyn Error> {
    e.to_string().into()
}

/// Local wall-clock time as HH:MM:SS (musl reads TZ or /etc/localtime).
pub fn clock() -> String {
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let now = unsafe { libc::time(std::ptr::null_mut()) };
    unsafe { libc::localtime_r(&now, &mut tm) };
    format!("{:02}:{:02}:{:02}", tm.tm_hour, tm.tm_min, tm.tm_sec)
}

fn main() -> Result<(), Box<dyn Error>> {
    let window = MinimalSoftwareWindow::new(RepaintBufferType::ReusedBuffer);
    slint::platform::set_platform(Box::new(SpikePlatform {
        window: window.clone(),
        start: Instant::now(),
    }))
    .map_err(|e| format!("set_platform: {e:?}"))?;
    let ui = Spike::new().map_err(slint_error)?;

    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--screenshot") {
        let base = args.get(i + 1).ok_or("--screenshot needs an output name")?;
        return screenshot(&window, &ui, base);
    }

    #[cfg(target_os = "linux")]
    return board::run(&window, &ui);
    #[cfg(not(target_os = "linux"))]
    Err("the board loop only runs on Linux; use --screenshot <name>".into())
}

fn screenshot(
    window: &MinimalSoftwareWindow,
    ui: &Spike,
    base: &str,
) -> Result<(), Box<dyn Error>> {
    window.set_size(PhysicalSize::new(WIDTH, HEIGHT));
    ui.set_clock("10:42:07".into());
    ui.set_can0(BusInfo {
        name: "can0".into(),
        state: "up".into(),
        fps: 126,
        last: "6B0  05 42 02 0C AC C0 4B C4".into(),
        has_pack: true,
        soc: 64.0,
        volts: 52.4,
        amps: -134.6,
    });
    ui.set_can1(BusInfo {
        name: "can1".into(),
        state: "down".into(),
        ..Default::default()
    });
    ui.set_raw_touch("1450, 2010".into());
    ui.set_stats("draw 3.1 ms · 11 fps".into());
    ui.set_display_info("fb1 320x240 rgb565".into());
    ui.show().map_err(slint_error)?;

    for (kind, x, y) in [("down", 152.0, 88.0), ("up", 152.0, 88.0)] {
        let position = LogicalPosition::new(x, y);
        let button = PointerEventButton::Left;
        let event = match kind {
            "down" => WindowEvent::PointerPressed { position, button },
            _ => WindowEvent::PointerReleased { position, button },
        };
        window
            .dispatch_event_with_result(event)
            .map_err(slint_error)?;
    }

    let mut buffer = vec![Rgb565Pixel(0); (WIDTH * HEIGHT) as usize];
    for (theme, name) in ["dark", "light", "night"].iter().enumerate() {
        ui.global::<Palette>().set_theme(theme as i32);
        slint::platform::update_timers_and_animations();
        window.draw_if_needed(|renderer| {
            renderer.render(&mut buffer, WIDTH as usize);
        });
        let path = format!("{base}-{name}.png");
        write_png(&path, &buffer)?;
        println!("wrote {path}");
    }
    Ok(())
}

fn write_png(path: &str, pixels: &[Rgb565Pixel]) -> Result<(), Box<dyn Error>> {
    let mut encoder = png::Encoder::new(std::fs::File::create(path)?, WIDTH, HEIGHT);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let rgb: Vec<u8> = pixels
        .iter()
        .flat_map(|p| {
            let (r, g, b) = ((p.0 >> 11) & 31, (p.0 >> 5) & 63, p.0 & 31);
            [
                (r << 3 | r >> 2) as u8,
                (g << 2 | g >> 4) as u8,
                (b << 3 | b >> 2) as u8,
            ]
        })
        .collect();
    encoder.write_header()?.write_image_data(&rgb)?;
    Ok(())
}
