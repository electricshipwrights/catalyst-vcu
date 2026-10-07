//! The event loop on the device: touch and CAN in, partial repaints out to fbdev.

use std::error::Error;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use slint::platform::software_renderer::{MinimalSoftwareWindow, Rgb565Pixel};
use slint::{ComponentHandle, PhysicalSize};

use crate::can::Bus;
use crate::fb::{self, Framebuffer, GraphicsMode};
use crate::touch::Touch;
use crate::{Spike, slint_error};

const UI_REFRESH: Duration = Duration::from_millis(250);

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    STOP.store(true, Ordering::Relaxed);
}

pub fn run(window: &Rc<MinimalSoftwareWindow>, ui: &Spike) -> Result<(), Box<dyn Error>> {
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

    let fb_path = std::env::var("VCU_FB").unwrap_or_else(|_| "/dev/fb1".into());
    let mut fb = Framebuffer::open(&fb_path)?;
    eprintln!("display: {}", fb.describe());
    for user in fb::other_users(&fb_path) {
        eprintln!("warning: {user} also has {fb_path} open and may draw over this app");
    }
    let (width, height) = fb.size();
    window.set_size(PhysicalSize::new(width as u32, height as u32));
    let _graphics = GraphicsMode::enter();

    let mut touch = match Touch::open(width, height) {
        Ok(t) => {
            eprintln!("touch: {}", t.describe());
            Some(t)
        }
        Err(e) => {
            eprintln!("touch: {e}");
            None
        }
    };
    let mut buses = [Bus::open("can0"), Bus::open("can1")];
    let mut reported_errors: [Option<String>; 2] = [None, None];

    ui.set_display_info(fb.describe().into());
    ui.show().map_err(slint_error)?;

    let mut back = vec![Rgb565Pixel(0); width * height];
    let mut last_ui = Instant::now() - UI_REFRESH;
    let (mut frames, mut draw_time) = (0u32, Duration::ZERO);

    while !STOP.load(Ordering::Relaxed) {
        slint::platform::update_timers_and_animations();

        if let Some(t) = touch.as_mut() {
            for event in t.poll() {
                window
                    .dispatch_event_with_result(event)
                    .map_err(slint_error)?;
            }
        }
        for (bus, reported) in buses.iter_mut().zip(&mut reported_errors) {
            bus.poll();
            if bus.error() != reported.as_deref() {
                *reported = bus.error().map(str::to_string);
                if let Some(e) = reported {
                    eprintln!("can: {e}");
                }
            }
        }

        if last_ui.elapsed() >= UI_REFRESH {
            let secs = last_ui.elapsed().as_secs_f32();
            last_ui = Instant::now();
            ui.set_clock(crate::clock().into());
            ui.set_can0(buses[0].info());
            ui.set_can1(buses[1].info());
            if let Some(t) = &touch {
                let (x, y) = t.raw();
                ui.set_raw_touch(format!("{x}, {y}").into());
            }
            let avg_ms = if frames > 0 {
                draw_time.as_secs_f32() * 1000.0 / frames as f32
            } else {
                0.0
            };
            ui.set_stats(format!("draw {avg_ms:.1} ms · {:.0} fps", frames as f32 / secs).into());
            frames = 0;
            draw_time = Duration::ZERO;
        }

        window.draw_if_needed(|renderer| {
            let start = Instant::now();
            let region = renderer.render(&mut back, width);
            fb.flush(&back, &region);
            draw_time += start.elapsed();
            frames += 1;
        });

        let mut timeout = UI_REFRESH.saturating_sub(last_ui.elapsed());
        if window.has_active_animations() {
            timeout = timeout.min(Duration::from_millis(16));
        } else if let Some(next) = slint::platform::duration_until_next_timer_update() {
            timeout = timeout.min(next);
        }
        let mut fds: Vec<libc::pollfd> = touch
            .as_ref()
            .map(|t| t.fd())
            .into_iter()
            .chain(buses.iter().filter_map(|b| b.fd()))
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
