//! Primary-monitor screen capture for the Convai vision pipeline.
//! Returns a downscaled JPEG so the webview can stamp it onto a canvas and
//! publish it as a LiveKit vision source — no getDisplayMedia picker needed.

use base64::Engine;
use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub base64_jpeg: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn capture_screen(max_dim: u32, quality: u8) -> Result<CaptureResult, String> {
    tauri::async_runtime::spawn_blocking(move || capture_impl(max_dim, quality))
        .await
        .map_err(|e| e.to_string())?
}

fn capture_impl(max_dim: u32, quality: u8) -> Result<CaptureResult, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or("no monitor found")?;

    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = (image.width(), image.height());

    let max_dim = max_dim.clamp(320, 3840);
    let (tw, th) = if w.max(h) > max_dim {
        let scale = max_dim as f64 / w.max(h) as f64;
        (
            ((w as f64 * scale) as u32).max(1),
            ((h as f64 * scale) as u32).max(1),
        )
    } else {
        (w, h)
    };

    let resized = if (tw, th) != (w, h) {
        image::imageops::resize(&image, tw, th, image::imageops::FilterType::Triangle)
    } else {
        image
    };

    let rgb = image::DynamicImage::ImageRgba8(resized).to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, quality.clamp(30, 95))
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;

    Ok(CaptureResult {
        base64_jpeg: base64::engine::general_purpose::STANDARD.encode(&jpeg),
        width: tw,
        height: th,
    })
}
