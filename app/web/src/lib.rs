//! The VCU display in the browser. It runs the device's pipeline (Slint's
//! software renderer into an RGB565 buffer) and copies each frame onto a
//! 320×240 canvas, so the page shows the LCD's exact pixels. It reads the
//! gateway stream from the bench's `/bus` WebSocket (ui/server): binary
//! messages of a bus number then a cannelloni packet, as the router sends over
//! UDP. It follows the bench's `vcu.theme`, `vcu.input`, `vcu.smoothing` and
//! `vcu.daylight` settings in localStorage.
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
use vcu_display::vcu_core::sun::Daylight;
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

/// The time of day, for the range view.
fn wall() -> (f64, f64) {
    let date = js_sys::Date::new_0();
    (date.get_time(), -date.get_timezone_offset())
}

/// Opens the bus WebSocket and reconnects a second after it closes.
fn connect(sides: Rc<RefCell<Sides>>) {
    let location = window().location();
    let scheme = if location.protocol().as_deref() == Ok("https:") {
        "wss"
    } else {
        "ws"
    };
    let url = format!("{scheme}://{}/bus", location.host().unwrap_or_default());
    let retry = sides.clone();
    let reconnect = move || {
        let sides = retry.clone();
        Timer::single_shot(Duration::from_secs(1), move || connect(sides));
    };
    let Ok(ws) = web_sys::WebSocket::new(&url) else {
        reconnect();
        return;
    };
    ws.set_binary_type(web_sys::BinaryType::Arraybuffer);

    // Text messages are the bench's status; only the binary gateway stream matters here
    let on_message =
        Closure::<dyn FnMut(web_sys::MessageEvent)>::new(move |e: web_sys::MessageEvent| {
            let Ok(buf) = e.data().dyn_into::<js_sys::ArrayBuffer>() else {
                return;
            };
            let msg = js_sys::Uint8Array::new(&buf).to_vec();
            let Some((&bus, packet)) = msg.split_first() else {
                return;
            };
            let now = now_ms();
            let mut sides = sides.borrow_mut();
            decode_cannelloni(packet, |id, ext, data| sides.ingest(bus, id, ext, data, now));
        });
    ws.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    on_message.forget();

    let on_close = Closure::once_into_js(reconnect);
    ws.set_onclose(Some(on_close.unchecked_ref()));
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
        if let Some(d) = storage
            .get_item("vcu.daylight")
            .ok()
            .flatten()
            .and_then(|v| Daylight::parse(&v))
        {
            settings.daylight.set(d);
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
    let sides = Rc::new(RefCell::new(Sides::default()));
    let settings = Rc::new(Settings::default());
    let watcher = watch_settings(&ui, settings.clone());
    ui.on_theme_selected(|theme| save_setting("vcu.theme", theme_name(theme)));
    ui.on_input_selected(|input| save_setting("vcu.input", input_name(input)));
    let driver = drive(&ui, sides.clone(), settings, now_ms, wall);
    connect(sides);
    ui.show().map_err(|e| err(&e))?;
    listen_for_pointer(&canvas, window.clone())?;
    UI.with(|u| *u.borrow_mut() = Some(ui.as_weak()));
    run(window, context);

    // The UI and its timers live for the rest of the page
    std::mem::forget((ui, watcher, driver));
    Ok(())
}
