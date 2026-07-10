//! Windows per-app GPU preference (the "Graphics settings" page, i.e.
//! `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`).
//!
//! WebView2 has no API to pick a GPU (WebView2Feedback #5072): the pets are
//! rendered by msedgewebview2.exe's GPU process, so a preference on the host
//! exe alone changes nothing. The only mechanism that works today is the
//! per-executable registry entry Windows itself writes from Graphics settings
//! — so we write it for BOTH our exe and the WebView2 runtime exe. The latter
//! is shared by every WebView2 app on the machine (the Settings UI says so).
//!
//! The runtime's exe path changes on every WebView2 runtime update (the
//! version is part of the directory), which would silently orphan the entry —
//! the dashboard re-applies the stored preference on each launch to heal it.
//! Takes effect the next time the app (and its GPU process) starts.

/// `pref`: "default" (remove our entries), "power-saving" (GpuPreference=1)
/// or "high-performance" (GpuPreference=2).
#[tauri::command]
pub async fn set_gpu_preference(pref: String) -> Result<(), String> {
    let value = match pref.as_str() {
        "default" => None,
        "power-saving" => Some("GpuPreference=1;"),
        "high-performance" => Some("GpuPreference=2;"),
        other => return Err(format!("unknown gpu preference: {other}")),
    };

    #[cfg(windows)]
    {
        let mut targets = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            targets.push(exe);
        }
        if let Some(wv) = webview2_runtime_exe() {
            targets.push(wv);
        }
        if targets.is_empty() {
            return Err("could not resolve any executable path".into());
        }
        for path in targets {
            write_pref(&path, value)?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        // GPU preference is a Windows concept; macOS/Linux ignore the setting.
        let _ = value;
        Ok(())
    }
}

#[cfg(windows)]
fn write_pref(path: &std::path::Path, value: Option<&str>) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Software\\Microsoft\\DirectX\\UserGpuPreferences")
        .map_err(|e| e.to_string())?;
    let name = path.to_string_lossy().to_string();
    match value {
        Some(v) => key.set_value(&name, &v).map_err(|e| e.to_string()),
        None => match key.delete_value(&name) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

/// Full path of the running WebView2 runtime exe. Our webviews are already
/// live when this command can be invoked, so the GPU/browser processes exist;
/// any msedgewebview2.exe instance resolves to the shared runtime install.
#[cfg(windows)]
fn webview2_runtime_exe() -> Option<std::path::PathBuf> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut found = None;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
                if name.eq_ignore_ascii_case("msedgewebview2.exe") {
                    if let Ok(proc) =
                        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID)
                    {
                        let mut buf = [0u16; 1024];
                        let mut len = buf.len() as u32;
                        let ok = QueryFullProcessImageNameW(
                            proc,
                            PROCESS_NAME_WIN32,
                            windows::core::PWSTR(buf.as_mut_ptr()),
                            &mut len,
                        )
                        .is_ok();
                        let _ = CloseHandle(proc);
                        if ok && len > 0 {
                            found = Some(std::path::PathBuf::from(String::from_utf16_lossy(
                                &buf[..len as usize],
                            )));
                            break;
                        }
                    }
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        found
    }
}
