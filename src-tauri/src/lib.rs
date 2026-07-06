mod capture;
mod mic_permission;
mod overlay;
mod win_info;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_autostart::MacosLauncher;

#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

fn primary_work_area(app: &AppHandle) -> Result<WorkArea, String> {
    let scale = app
        .get_webview_window("overlay")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
        };
        let mut rect = RECT::default();
        unsafe {
            SystemParametersInfoW(
                SPI_GETWORKAREA,
                0,
                Some(&mut rect as *mut _ as *mut _),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
            .map_err(|e| e.to_string())?;
        }
        // 2px shorter than the real work area: a window covering the entire
        // monitor is treated as a fullscreen app by the shell, which suppresses
        // the auto-hide taskbar's edge-hover reveal. The uncovered strip is
        // invisible and pets stand ~1px above the true bottom.
        return Ok(WorkArea {
            x: rect.left,
            y: rect.top,
            w: (rect.right - rect.left).max(0) as u32,
            h: ((rect.bottom - rect.top).max(0) as u32).saturating_sub(2),
            scale,
        });
    }

    #[cfg(not(windows))]
    {
        let monitor = app
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("no primary monitor")?;
        // Actual work area (NSScreen.visibleFrame / _NET_WORKAREA), not the
        // full monitor bounds, so the overlay never covers the dock/panel.
        // Same 2px height shave as the Windows branch (see comment above).
        let wa = monitor.work_area();
        Ok(WorkArea {
            x: wa.position.x,
            y: wa.position.y,
            w: wa.size.width,
            h: wa.size.height.saturating_sub(2),
            scale,
        })
    }
}

#[tauri::command]
async fn get_work_area(app: AppHandle) -> Result<WorkArea, String> {
    primary_work_area(&app)
}

#[tauri::command]
async fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// Off-screen test harness: `DESKTOP_PET_SANDBOX=1` moves the overlay far off
/// the virtual desktop and hides the dashboard, so automated CDP tests can
/// drive the full app without touching the user's visible desktop.
fn sandbox_mode() -> bool {
    std::env::var("DESKTOP_PET_SANDBOX").is_ok_and(|v| v == "1")
}

/// Reads the v1 Electron install's electron-store config so the first run of
/// v2 can import the API key, character ids and spawn flags.
#[tauri::command]
async fn read_legacy_config() -> Option<serde_json::Value> {
    read_legacy_config_impl()
}

fn read_legacy_config_impl() -> Option<serde_json::Value> {
    let base = if cfg!(windows) {
        std::env::var("APPDATA").ok().map(std::path::PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .ok()
            .map(|h| std::path::PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var("HOME")
            .ok()
            .map(|h| std::path::PathBuf::from(h).join(".config"))
    }?;
    let path = base.join("convai-desktop-pet").join("config.json");
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Position the overlay to exactly cover the primary monitor's work area
/// (leaves the taskbar clickable) and make it click-through until the cursor
/// poller decides otherwise.
fn setup_overlay(app: &AppHandle) -> tauri::Result<()> {
    let sandbox = sandbox_mode();
    if let Some(overlay) = app.get_webview_window("overlay") {
        if let Ok(area) = primary_work_area(app) {
            let x = if sandbox { area.x - 30000 } else { area.x };
            let _ = overlay.set_position(PhysicalPosition::new(x, area.y));
            let _ = overlay.set_size(PhysicalSize::new(area.w, area.h));
        }
        let _ = overlay.set_focusable(false);
        let _ = overlay.set_ignore_cursor_events(true);
        let _ = overlay.show();
        let _ = overlay.set_always_on_top(!sandbox);
    }
    if sandbox {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
    }
    Ok(())
}

/// Re-applies overlay geometry after the work area changed (resolution, DPI,
/// or taskbar move — detected by the cursor poll loop) and tells the overlay
/// webview about the fresh work area. Mirrors setup_overlay's positioning,
/// including the sandbox off-screen offset.
fn resync_overlay(app: &AppHandle, area: WorkArea) {
    let sandbox = sandbox_mode();
    if let Some(overlay) = app.get_webview_window("overlay") {
        let x = if sandbox { area.x - 30000 } else { area.x };
        let _ = overlay.set_position(PhysicalPosition::new(x, area.y));
        let _ = overlay.set_size(PhysicalSize::new(area.w, area.h));
    }
    let _ = app.emit_to("overlay", "work-area-changed", area);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "Open Dashboard").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).item(&open).separator().item(&quit).build()?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Convai Desktop Pets")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(overlay::OverlayState::default())
        .invoke_handler(tauri::generate_handler![
            overlay::update_hit_regions,
            overlay::set_overlay_focusable,
            overlay::set_cursor_stream,
            overlay::overlay_ready,
            overlay::get_cursor_pos,
            overlay::debug_overlay_state,
            win_info::list_windows,
            capture::capture_screen,
            get_work_area,
            show_main_window,
            read_legacy_config,
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            setup_overlay(app.handle())?;
            for label in ["main", "overlay"] {
                if let Some(win) = app.get_webview_window(label) {
                    mic_permission::auto_grant_mic(&win);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the dashboard hides it; the app lives in the tray.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
