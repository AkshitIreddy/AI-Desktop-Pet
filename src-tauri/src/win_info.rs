//! Enumerates visible top-level windows of other applications so pets can
//! walk on them. Windows-only; other platforms return an empty list.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeWindow {
    pub id: isize,
    pub title: String,
    pub app: String,
    pub rect: WinRect,
    pub minimized: bool,
}

#[derive(Serialize, Clone, Copy, Debug, Default)]
pub struct WinRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[tauri::command]
pub async fn list_windows() -> Vec<NativeWindow> {
    #[cfg(windows)]
    {
        collect_windows()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
fn collect_windows() -> Vec<NativeWindow> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowLongW, GetWindowRect, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW,
    };

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let list = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        list.push(hwnd);
        BOOL(1)
    }

    let mut handles: Vec<HWND> = Vec::with_capacity(64);
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut handles as *mut _ as isize));
    }

    let own_pid = std::process::id();
    let mut out = Vec::new();

    for hwnd in handles {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                continue;
            }

            // Skip cloaked windows (suspended UWP apps, other virtual desktops).
            let mut cloaked: u32 = 0;
            let _ = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut _ as *mut _,
                std::mem::size_of::<u32>() as u32,
            );
            if cloaked != 0 {
                continue;
            }

            // Skip tool windows and no-activate overlays (includes our own overlay).
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            if ex_style & WS_EX_TOOLWINDOW.0 != 0 || ex_style & WS_EX_NOACTIVATE.0 != 0 {
                continue;
            }

            let mut title_buf = [0u16; 256];
            let title_len = GetWindowTextW(hwnd, &mut title_buf);
            if title_len == 0 {
                continue;
            }
            let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

            let mut class_buf = [0u16; 128];
            let class_len = GetClassNameW(hwnd, &mut class_buf);
            let class = String::from_utf16_lossy(&class_buf[..class_len.max(0) as usize]);
            if matches!(
                class.as_str(),
                "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
                    | "Windows.UI.Core.CoreWindow" | "XamlExplorerHostIslandWindow"
            ) {
                continue;
            }

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == own_pid {
                continue;
            }

            let minimized = IsIconic(hwnd).as_bool();
            if minimized {
                continue;
            }

            // Prefer the DWM extended frame bounds: excludes the invisible
            // resize borders that GetWindowRect includes on Win10/11.
            let mut rect = RECT::default();
            let got_dwm = DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut _ as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
            .is_ok();
            if !got_dwm && GetWindowRect(hwnd, &mut rect).is_err() {
                continue;
            }

            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            if w < 160 || h < 120 {
                continue;
            }

            out.push(NativeWindow {
                id: hwnd.0 as isize,
                title,
                app: process_name(pid).unwrap_or_default(),
                rect: WinRect {
                    x: rect.left,
                    y: rect.top,
                    w,
                    h,
                },
                minimized,
            });
        }
    }

    out
}

#[cfg(windows)]
fn process_name(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        result.ok()?;
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        full.rsplit(['\\', '/'])
            .next()
            .map(|s| s.trim_end_matches(".exe").to_string())
    }
}
