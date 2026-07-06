//! Click-through management for the pets overlay.
//!
//! The overlay window covers the whole work area but must only swallow mouse
//! input where something interactive is drawn (a pet, the skill wheel, chat…).
//! WebView2/Tauri has no per-pixel input forwarding, so the frontend reports
//! interactive rectangles and a Rust thread polls the global cursor at ~60 Hz,
//! flipping `set_ignore_cursor_events` when the cursor enters/leaves them.
//!
//! Invariants that keep the desktop safe:
//! - Interactivity is ALWAYS region-scoped. Nothing (not even an open chat
//!   panel) may make the whole overlay opaque to input — a bug here freezes
//!   the user's entire desktop, because the overlay is topmost + fullscreen.
//! - All commands are `async` so they run off the main thread and can never
//!   stall the event loop (a stalled loop = DWM "ghost window" = the whole
//!   screen appears frozen and blurred).

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CursorPayload {
    x: f64,
    y: f64,
    over_interactive: bool,
}

#[derive(Default)]
pub struct OverlayState {
    regions: Mutex<Vec<Rect>>,
    /// Whether the overlay currently accepts mouse input.
    interactive: AtomicBool,
    /// Whether a text input (chat, composer) currently holds keyboard focus.
    /// Affects focusability only — NEVER whole-window mouse interactivity.
    focus_held: AtomicBool,
    poll_started: AtomicBool,
}

#[tauri::command]
pub async fn update_hit_regions(
    state: State<'_, OverlayState>,
    regions: Vec<Rect>,
) -> Result<(), String> {
    *state.regions.lock().map_err(|e| e.to_string())? = regions;
    Ok(())
}

#[tauri::command]
pub async fn set_overlay_focusable(
    app: AppHandle,
    state: State<'_, OverlayState>,
    focusable: bool,
) -> Result<(), String> {
    state.focus_held.store(focusable, Ordering::Relaxed);
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.set_focusable(focusable).map_err(|e| e.to_string())?;
        if focusable {
            let _ = overlay.set_focus();
        }
    }
    Ok(())
}

#[derive(Serialize, Clone)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub async fn get_cursor_pos(app: AppHandle) -> Result<Point, String> {
    let pos = app.cursor_position().map_err(|e| e.to_string())?;
    Ok(Point { x: pos.x, y: pos.y })
}

/// Diagnostics: what the native side currently believes.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OverlayDebug {
    pub regions: Vec<Rect>,
    pub interactive: bool,
    pub focus_held: bool,
}

#[tauri::command]
pub async fn debug_overlay_state(
    state: State<'_, OverlayState>,
) -> Result<OverlayDebug, String> {
    Ok(OverlayDebug {
        regions: state.regions.lock().map_err(|e| e.to_string())?.clone(),
        interactive: state.interactive.load(Ordering::Relaxed),
        focus_held: state.focus_held.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub async fn overlay_ready(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
    if state.poll_started.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let handle = app.clone();
    std::thread::spawn(move || cursor_poll_loop(handle));
    Ok(())
}

/// Toggle click-through by flipping ONLY `WS_EX_TRANSPARENT`.
///
/// tao's `set_ignore_cursor_events(false)` also strips `WS_EX_LAYERED`, and
/// toggling the layered style on a live transparent WebView2 surface glitches
/// its composition — the whole screen appears frosted/white and, since the
/// fullscreen overlay is no longer click-through, the desktop stops taking
/// clicks. Keeping `WS_EX_LAYERED` permanently avoids the recomposition.
#[cfg(windows)]
fn set_click_through(hwnd: isize, ignore: bool) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    unsafe {
        let hwnd = HWND(hwnd as *mut _);
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        ex |= WS_EX_LAYERED.0 as isize;
        if ignore {
            ex |= WS_EX_TRANSPARENT.0 as isize;
        } else {
            ex &= !(WS_EX_TRANSPARENT.0 as isize);
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex) != 0 || GetWindowLongPtrW(hwnd, GWL_EXSTYLE) == ex
    }
}

fn cursor_poll_loop(app: AppHandle) {
    let mut tick: u64 = 0;
    let mut last_emitted = (f64::MIN, f64::MIN);

    #[cfg(windows)]
    let overlay_hwnd: Option<isize> = app
        .get_webview_window("overlay")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize);

    loop {
        std::thread::sleep(std::time::Duration::from_millis(16));
        tick = tick.wrapping_add(1);

        let state = app.state::<OverlayState>();
        let Ok(pos) = app.cursor_position() else {
            continue;
        };

        // Never .unwrap() in this loop: a single panic here would permanently
        // freeze click-through toggling for the rest of the session.
        let inside = match state.regions.lock() {
            Ok(regions) => regions.iter().any(|r| r.contains(pos.x, pos.y)),
            Err(_) => continue,
        };
        let current = state.interactive.load(Ordering::Relaxed);

        if inside != current {
            #[cfg(windows)]
            {
                if let Some(hwnd) = overlay_hwnd {
                    if set_click_through(hwnd, !inside) {
                        state.interactive.store(inside, Ordering::Relaxed);
                    }
                }
            }
            #[cfg(not(windows))]
            {
                if let Some(overlay) = app.get_webview_window("overlay") {
                    if overlay.set_ignore_cursor_events(!inside).is_ok() {
                        state.interactive.store(inside, Ordering::Relaxed);
                    }
                }
            }
        }

        // ~30 Hz cursor stream for follow/watch behaviors, only on movement.
        if tick % 2 == 0 && (pos.x, pos.y) != last_emitted {
            last_emitted = (pos.x, pos.y);
            let _ = app.emit_to(
                "overlay",
                "cursor-pos",
                CursorPayload {
                    x: pos.x,
                    y: pos.y,
                    over_interactive: inside,
                },
            );
        }
    }
}
