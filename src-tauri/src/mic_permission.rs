//! Auto-grant WebView2 microphone permission requests (Windows).
//!
//! wry 0.55 exposes no permission-handler API yet, so we attach a raw
//! `PermissionRequested` handler on `ICoreWebView2` via `with_webview`.
//! Only the microphone is granted — vision uses native capture + canvas
//! publishing, so no camera/screen permission ever reaches the webview.
//!
//! Note: Windows privacy settings still gate this (Settings → Privacy &
//! security → Microphone → "Let desktop apps access your microphone").

#[cfg(windows)]
pub fn auto_grant_mic(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
            if let Some(args) = args {
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn auto_grant_mic(_window: &tauri::WebviewWindow) {}
