//! The display on the CoreMP135: renders to the LCD framebuffer, takes touch
//! from evdev, and reads the port and starboard buses from can0 and can1.
//!
//! `vcu-display --screenshot out` renders sample states to PNGs on any host.

#[cfg(target_os = "linux")]
mod device;
#[cfg(not(target_arch = "wasm32"))]
mod platform;

#[cfg(target_arch = "wasm32")]
fn main() {}

#[cfg(not(target_arch = "wasm32"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let window = platform::install()?;
    let ui = vcu_display::Display::new().map_err(platform::slint_error)?;

    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--screenshot") {
        let base = args.get(i + 1).ok_or("--screenshot needs an output name")?;
        return platform::screenshot(&window, &ui, base);
    }

    #[cfg(target_os = "linux")]
    return device::run(&window, &ui);
    #[cfg(not(target_os = "linux"))]
    Err("the display only runs on Linux; use --screenshot <name>".into())
}
