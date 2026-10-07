//! Slint platform for the software renderer: one fixed-size window that the
//! caller renders into its own buffer. Used on the device and for screenshots.

use std::error::Error;
use std::rc::Rc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use slint::platform::software_renderer::{MinimalSoftwareWindow, RepaintBufferType, Rgb565Pixel};
use slint::platform::{Platform, WindowAdapter};
use slint::{ComponentHandle, PhysicalSize};
use vcu_display::{Display, HEIGHT, Palette, SideView, WIDTH};

static START: OnceLock<Instant> = OnceLock::new();

// Only the device loop uses this, not screenshots.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
/// Milliseconds since start; frames and ticks are stamped with this.
pub fn now_ms() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

/// Slint's errors only implement `std::error::Error` with its `std` feature, which we leave off.
pub fn slint_error(e: slint::PlatformError) -> Box<dyn Error> {
    e.to_string().into()
}

struct SoftwarePlatform {
    window: Rc<MinimalSoftwareWindow>,
}

impl Platform for SoftwarePlatform {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> {
        Ok(self.window.clone())
    }

    fn duration_since_start(&self) -> Duration {
        START.get_or_init(Instant::now).elapsed()
    }
}

pub fn install() -> Result<Rc<MinimalSoftwareWindow>, Box<dyn Error>> {
    let window = MinimalSoftwareWindow::new(RepaintBufferType::ReusedBuffer);
    slint::platform::set_platform(Box::new(SoftwarePlatform {
        window: window.clone(),
    }))
    .map_err(|e| format!("set_platform: {e:?}"))?;
    Ok(window)
}

fn sample(soc: i32, solar: i32, propulsion: i32, house: i32, eta: &str, shore: bool) -> SideView {
    let (in_a, out_a) = (solar, propulsion + house);
    SideView {
        online: true,
        soc,
        shore,
        solar_a: solar,
        in_a,
        out_a,
        propulsion_a: propulsion,
        net_a: in_a - out_a,
        eta_kind: 3,
        eta_time: eta.into(),
        eta_to_full: in_a > out_a,
    }
}

/// Renders sample states to `<base>-<name>.png` through the same software
/// renderer the device uses.
pub fn screenshot(
    window: &MinimalSoftwareWindow,
    ui: &Display,
    base: &str,
) -> Result<(), Box<dyn Error>> {
    window.set_size(PhysicalSize::new(WIDTH, HEIGHT));
    ui.show().map_err(slint_error)?;
    let mut buffer = vec![Rgb565Pixel(0); (WIDTH * HEIGHT) as usize];

    // The bench simulator's starting values (ui/server/index.ts)
    let port = sample(64, 142, 170, 32, "2:59", false);
    let stbd = sample(71, 168, 125, 13, "2:46", true);
    let shots = [
        ("dark", 0, port.clone(), stbd.clone()),
        ("light", 1, port.clone(), stbd.clone()),
        ("night", 2, port, stbd),
        (
            "offline",
            0,
            SideView::default(),
            SideView {
                eta_kind: 2,
                ..sample(9, 0, 0, 4, "", false)
            },
        ),
    ];
    for (name, theme, port, stbd) in shots {
        ui.global::<Palette>().set_theme(theme);
        ui.set_port(port);
        ui.set_stbd(stbd);
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
