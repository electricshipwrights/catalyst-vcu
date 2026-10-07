//! The event loop on the CoreMP135.
//!
//! Environment:
//!   VCU_FB             framebuffer (default /dev/fb1, the LCD; fb0 is HDMI)
//!   VCU_PORT_CAN       port bus (default can0)
//!   VCU_STBD_CAN       starboard bus (default can1)
//!   VCU_SETTINGS       settings file (default /etc/vcu/display.conf), lines like
//!                      `theme=night` and `smoothing=instant`, re-read when changed
//!   VCU_ROTATE         180 (default: the board is mounted upside down, so the
//!                      A/B/C buttons are above the screen) or 0
//!   VCU_TOUCH*         see touch.rs

mod can;
mod fb;
mod touch;

use std::cell::{Cell, RefCell};
use std::error::Error;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

use slint::platform::software_renderer::{MinimalSoftwareWindow, Rgb565Pixel};
use slint::{ComponentHandle, PhysicalSize, Timer, TimerMode};
use vcu_display::vcu_core::Smoothing;
use vcu_display::{Display, Palette, Sides, drive, parse_smoothing, parse_theme, theme_name};

use crate::platform::{now_ms, slint_error};

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    STOP.store(true, Ordering::Relaxed);
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.into())
}

fn settings_path() -> String {
    env_or("VCU_SETTINGS", "/etc/vcu/display.conf")
}

/// Sets `key=value` in the settings file, keeping its other lines.
fn save_setting(key: &str, value: &str) {
    let path = settings_path();
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = text
        .lines()
        .filter(|l| l.split_once('=').map(|(k, _)| k) != Some(key))
        .map(str::to_string)
        .collect();
    lines.push(format!("{key}={value}"));
    let saved = std::path::Path::new(&path)
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| std::fs::write(&path, lines.join("\n") + "\n"));
    match saved {
        Ok(()) => eprintln!("settings: saved {key}={value} to {path}"),
        Err(e) => eprintln!("settings: can't save {path}: {e}"),
    }
}

/// Applies the settings file whenever its modification time changes.
fn watch_settings(ui: &Display, smoothing: Rc<Cell<Smoothing>>) -> Timer {
    let path = settings_path();
    let seen: Cell<Option<SystemTime>> = Cell::new(None);
    let weak = ui.as_weak();
    let apply = move || {
        let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        if modified == seen.get() {
            return;
        }
        seen.set(modified);
        let (Some(ui), Ok(text)) = (weak.upgrade(), std::fs::read_to_string(&path)) else {
            return;
        };
        for line in text.lines() {
            match line.split_once('=') {
                Some(("theme", v)) => match parse_theme(v) {
                    Some(t) => ui.global::<Palette>().set_theme(t),
                    None => eprintln!("{path}: unknown theme {v:?}"),
                },
                Some(("smoothing", v)) => match parse_smoothing(v) {
                    Some(s) => smoothing.set(s),
                    None => eprintln!("{path}: unknown smoothing {v:?}"),
                },
                _ => {}
            }
        }
        eprintln!("settings: applied {path}");
    };
    apply();
    let timer = Timer::default();
    timer.start(TimerMode::Repeated, Duration::from_secs(1), apply);
    timer
}

pub fn run(window: &Rc<MinimalSoftwareWindow>, ui: &Display) -> Result<(), Box<dyn Error>> {
    unsafe {
        libc::signal(
            libc::SIGINT,
            on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
        );
        libc::signal(
            libc::SIGTERM,
            on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
        );
    }

    let rotated = env_or("VCU_ROTATE", "180") != "0";
    let fb_path = env_or("VCU_FB", "/dev/fb1");
    let mut fb = fb::Framebuffer::open(&fb_path)?;
    eprintln!(
        "display: {}{}",
        fb.describe(),
        if rotated { ", rotated 180°" } else { "" }
    );
    for user in fb::other_users(&fb_path) {
        eprintln!("warning: {user} also has {fb_path} open and may draw over the display");
    }
    let (width, height) = fb.size();
    window.set_size(PhysicalSize::new(width as u32, height as u32));
    let _graphics = fb::GraphicsMode::enter();

    let mut touch = touch::Touch::open(width, height, rotated)
        .inspect(|t| eprintln!("touch: {}", t.describe()))
        .inspect_err(|e| eprintln!("touch: {e}"))
        .ok();

    let sides = Rc::new(RefCell::new(Sides::default()));
    let smoothing = Rc::new(Cell::new(Smoothing::default()));
    let _settings = watch_settings(ui, smoothing.clone());
    ui.on_theme_selected(|theme| save_setting("theme", theme_name(theme)));
    let _driver = drive(ui, sides.clone(), smoothing, now_ms);
    let mut port = can::Bus::open(env_or("VCU_PORT_CAN", "can0"));
    let mut stbd = can::Bus::open(env_or("VCU_STBD_CAN", "can1"));
    ui.show().map_err(slint_error)?;

    let mut back = vec![Rgb565Pixel(0); width * height];
    while !STOP.load(Ordering::Relaxed) {
        slint::platform::update_timers_and_animations();

        if let Some(t) = touch.as_mut() {
            for input in t.poll() {
                match input {
                    touch::Input::Pointer(event) => {
                        window
                            .dispatch_event_with_result(event)
                            .map_err(slint_error)?;
                    }
                    touch::Input::Button(i) => ui.invoke_select(i as i32),
                }
            }
        }
        {
            let mut sides = sides.borrow_mut();
            port.poll(|id, ext, data| sides.port.ingest(id, ext, data, now_ms()));
            stbd.poll(|id, ext, data| sides.stbd.ingest(id, ext, data, now_ms()));
        }

        window.draw_if_needed(|renderer| {
            let region = renderer.render(&mut back, width);
            fb.flush(&back, &region, rotated);
        });

        // Sleep until input arrives or a timer is due (the 10 Hz reading timer
        // bounds this to 100 ms).
        let timeout = if window.has_active_animations() {
            Duration::from_millis(16)
        } else {
            slint::platform::duration_until_next_timer_update().unwrap_or(Duration::from_secs(1))
        };
        let mut fds: Vec<libc::pollfd> = [touch.as_ref().map(|t| t.fd()), port.fd(), stbd.fd()]
            .into_iter()
            .flatten()
            .map(|fd| libc::pollfd {
                fd,
                events: libc::POLLIN,
                revents: 0,
            })
            .collect();
        unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as _, timeout.as_millis() as _) };
    }
    eprintln!("exiting");
    Ok(())
}
