//! The VCU display in the browser. It runs the device's pipeline (Slint's
//! software renderer into an RGB565 buffer) and copies each frame onto a
//! 320×240 canvas, so the page shows the LCD's exact pixels. The page hands
//! it the gateway stream (`push_packet`): each bus's cannelloni packets, as
//! the router sends over UDP, from the bus server or the page's own sims
//! (ui/src/bus.ts). It follows the bench's `vcu.theme`, `vcu.input` and
//! `vcu.smoothing` settings in localStorage. Its clock is NMEA 2000 time from
//! the stream when there is one, which the bench's sim sends with its time of
//! day and season.
//!
//! Built by `pnpm build:wasm` in ui/; see ui/src/slint/SlintDisplay.tsx.

#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use vcu_display::slint::platform::software_renderer::{
    MinimalSoftwareWindow, RepaintBufferType, Rgb565Pixel,
};
use vcu_display::slint::platform::{Platform, PointerEventButton, WindowAdapter, WindowEvent};
use vcu_display::slint::{self, ComponentHandle, LogicalPosition, PhysicalSize, Timer, TimerMode};
use vcu_display::vcu_core::gateway::decode_cannelloni;
use vcu_display::{
    Display, HEIGHT, Palette, Prefs, Settings, Sides, WIDTH, drive, input_name, parse_input,
    parse_smoothing, parse_theme, theme_name,
};
use wasm_bindgen::prelude::*;
use wasm_bindgen::{Clamped, JsCast};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, ImageData, PointerEvent};

fn window() -> web_sys::Window {
    web_sys::window().expect("no window")
}

fn now_ms() -> f64 {
    window().performance().expect("no performance").now()
}

/// The browser's time of day, for the range view when the stream has none.
fn wall() -> (f64, f64) {
    let date = js_sys::Date::new_0();
    (date.get_time(), -date.get_timezone_offset())
}

/// Follows the bench's settings, which it writes to localStorage.
fn watch_settings(ui: &Display, settings: Rc<Settings>) -> Timer {
    let weak = ui.as_weak();
    let apply = move || {
        let (Some(ui), Ok(Some(storage))) = (weak.upgrade(), window().local_storage()) else {
            return;
        };
        if let Some(t) = storage
            .get_item("vcu.theme")
            .ok()
            .flatten()
            .and_then(|v| parse_theme(&v))
        {
            ui.global::<Palette>().set_theme(t);
        }
        if let Some(s) = storage
            .get_item("vcu.input")
            .ok()
            .flatten()
            .and_then(|v| parse_input(&v))
        {
            ui.global::<Prefs>().set_input(s);
        }
        if let Some(s) = storage
            .get_item("vcu.smoothing")
            .ok()
            .flatten()
            .and_then(|v| parse_smoothing(&v))
        {
            settings.smoothing.set(s);
        }

    };
    apply();
    let timer = Timer::default();
    timer.start(TimerMode::Repeated, Duration::from_millis(250), apply);
    timer
}

/// Saves a setting picked on the settings view where the bench keeps it, and
/// tells the React side (which only hears other tabs' storage events by itself).
fn save_setting(key: &str, value: &str) {
    let window = window();
    let Ok(Some(storage)) = window.local_storage() else {
        return;
    };
    let _ = storage.set_item(key, value);
    let init = web_sys::StorageEventInit::new();
    init.set_key(Some(key));
    if let Ok(event) = web_sys::StorageEvent::new_with_event_init_dict("storage", &init) {
        let _ = window.dispatch_event(&event);
    }
}

thread_local! {
    static UI: RefCell<Option<slint::Weak<Display>>> = const { RefCell::new(None) };
    static SIDES: Rc<RefCell<Sides>> = Rc::default();
}

/// A cannelloni packet from gateway bus `bus`, from the page.
#[wasm_bindgen]
pub fn push_packet(bus: u8, packet: &[u8]) {
    let now = now_ms();
    SIDES.with(|sides| {
        let mut sides = sides.borrow_mut();
        decode_cannelloni(packet, |id, ext, data| sides.ingest(bus, id, ext, data, now));
    });
}

/// The device's A, B or C button (0–2), from the bench.
#[wasm_bindgen]
pub fn press_button(button: u32) {
    UI.with(|ui| {
        if let Some(ui) = ui.borrow().as_ref().and_then(|w| w.upgrade()) {
            ui.invoke_select(button as i32);
        }
    });
}

struct WebPlatform {
    window: Rc<MinimalSoftwareWindow>,
}

impl Platform for WebPlatform {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> {
        Ok(self.window.clone())
    }

    fn duration_since_start(&self) -> Duration {
        Duration::from_secs_f64(now_ms() / 1000.0)
    }
}

/// Pointer input, mapped through the canvas's on-screen rectangle so CSS zoom
/// and transforms don't matter.
fn listen_for_pointer(
    canvas: &HtmlCanvasElement,
    window: Rc<MinimalSoftwareWindow>,
) -> Result<(), JsValue> {
    let target = canvas.clone();
    let handler = Closure::<dyn FnMut(PointerEvent)>::new(move |e: PointerEvent| {
        let rect = target.get_bounding_client_rect();
        let x = (f64::from(e.client_x()) - rect.left()) / rect.width() * f64::from(WIDTH);
        let y = (f64::from(e.client_y()) - rect.top()) / rect.height() * f64::from(HEIGHT);
        let position = LogicalPosition::new(x as f32, y as f32);
        let button = PointerEventButton::Left;
        let events = match e.type_().as_str() {
            "pointerdown" => {
                e.prevent_default();
                let _ = target.set_pointer_capture(e.pointer_id());
                // Touch has no hover, so move to the press point first (as on the device)
                vec![
                    WindowEvent::PointerMoved { position },
                    WindowEvent::PointerPressed { position, button },
                ]
            }
            "pointermove" => vec![WindowEvent::PointerMoved { position }],
            "pointerup" => vec![WindowEvent::PointerReleased { position, button }],
            "pointercancel" | "pointerleave" => vec![WindowEvent::PointerExited],
            _ => return,
        };
        for event in events {
            let _ = window.dispatch_event_with_result(event);
        }
    });
    for kind in [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "pointerleave",
    ] {
        canvas.add_event_listener_with_callback(kind, handler.as_ref().unchecked_ref())?;
    }
    handler.forget();
    Ok(())
}

type FrameCallback = Rc<RefCell<Option<Closure<dyn FnMut()>>>>;

fn request_animation_frame(f: &Closure<dyn FnMut()>) {
    let _ = window().request_animation_frame(f.as_ref().unchecked_ref());
}

/// Each animation frame: run Slint's timers, and when something changed,
/// render into RGB565 like the device and copy it onto the canvas.
fn run(window: Rc<MinimalSoftwareWindow>, context: CanvasRenderingContext2d) {
    let (w, h) = (WIDTH as usize, HEIGHT as usize);
    let mut pixels = vec![Rgb565Pixel(0); w * h];
    let mut rgba = vec![255u8; w * h * 4];
    let frame: FrameCallback = Rc::default();
    let next = frame.clone();
    *frame.borrow_mut() = Some(Closure::new(move || {
        slint::platform::update_timers_and_animations();
        window.draw_if_needed(|renderer| {
            renderer.render(&mut pixels, w);
            for (p, out) in pixels.iter().zip(rgba.as_chunks_mut::<4>().0) {
                let (r, g, b) = ((p.0 >> 11) & 31, (p.0 >> 5) & 63, p.0 & 31);
                out[0] = (r << 3 | r >> 2) as u8;
                out[1] = (g << 2 | g >> 4) as u8;
                out[2] = (b << 3 | b >> 2) as u8;
            }
            if let Ok(image) =
                ImageData::new_with_u8_clamped_array_and_sh(Clamped(&rgba), WIDTH, HEIGHT)
            {
                let _ = context.put_image_data(&image, 0.0, 0.0);
            }
        });
        request_animation_frame(next.borrow().as_ref().unwrap());
    }));
    request_animation_frame(frame.borrow().as_ref().unwrap());
}

/// Starts the display on `canvas`. Call once per page.
#[wasm_bindgen]
pub fn start(canvas: HtmlCanvasElement) -> Result<(), JsValue> {
    let err = |e: &dyn std::fmt::Display| JsValue::from_str(&e.to_string());
    let window = MinimalSoftwareWindow::new(RepaintBufferType::ReusedBuffer);
    slint::platform::set_platform(Box::new(WebPlatform {
        window: window.clone(),
    }))
    .map_err(|e| JsValue::from_str(&format!("set_platform: {e:?}")))?;
    window.set_size(PhysicalSize::new(WIDTH, HEIGHT));
    canvas.set_width(WIDTH);
    canvas.set_height(HEIGHT);
    let context = canvas
        .get_context("2d")?
        .ok_or("canvas has no 2d context")?
        .dyn_into::<CanvasRenderingContext2d>()?;

    let ui = Display::new().map_err(|e| err(&e))?;
    let sides = SIDES.with(Rc::clone);
    let settings = Rc::new(Settings::default());
    let watcher = watch_settings(&ui, settings.clone());
    ui.on_theme_selected(|theme| save_setting("vcu.theme", theme_name(theme)));
    ui.on_input_selected(|input| save_setting("vcu.input", input_name(input)));
    let driver = drive(&ui, sides, settings, now_ms, wall);
    ui.show().map_err(|e| err(&e))?;
    listen_for_pointer(&canvas, window.clone())?;
    UI.with(|u| *u.borrow_mut() = Some(ui.as_weak()));
    run(window, context);

    // The UI and its timers live for the rest of the page
    std::mem::forget((ui, watcher, driver));
    Ok(())
}
