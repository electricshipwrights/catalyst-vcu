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

/// A side for screenshots. `mppt`: amps per MPPT 1–4, −1 for those on the
/// other side; `charger`: −1 without shore power; `house`: base, heater, inverter.
fn sample(soc: i32, mppt: [f32; 4], charger: i32, house: [i32; 3], propulsion: i32, eta: &str) -> SideView {
    let solar = mppt.iter().filter(|a| **a > 0.0).sum::<f32>().round() as i32;
    let in_a = solar + charger.max(0);
    let out_a = propulsion + house.iter().sum::<i32>();
    SideView {
        online: true,
        soc,
        shore: charger >= 0,
        solar_a: solar,
        mppt_a: Rc::new(slint::VecModel::from(mppt.to_vec())).into(),
        charger_a: charger,
        in_a,
        out_a,
        base_a: house[0],
        heater_a: house[1],
        inverter_a: house[2],
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

    // Underway with the 2/2 split: port heating and cooking, starboard on its
    // base load; then the same at the dock on shore power
    let port = sample(64, [26.0, 26.0, -1.0, -1.0], -1, [6, 12, 25], 70, "10h");
    let stbd = sample(71, [-1.0, -1.0, 29.0, 29.0], 78, [15, 0, 0], 0, "5:45");
    ui.set_scale_max(100);
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
                ..sample(9, [-1.0; 4], -1, [4, 0, 0], 0, "")
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
