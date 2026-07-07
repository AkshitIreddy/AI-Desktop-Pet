//! Custom sprite-set import.
//!
//! Copies a user-picked folder of shimeji-convention PNGs into
//! `$APPDATA/sprites/<name>/` and derives an `AnimationConfig` (the exact
//! shape of `AnimationConfig` in src/shared/types.ts — snake_case fields, NOT
//! camelCase) from the file names:
//!
//! - `walk<N>.png`  → walk_max_frame  = max N (required, >= 1)
//! - `climb<N>.png` → climb_max_frames (missing → walk frame copied as climb1)
//! - `fall<N>.png`  → fall_max_frames  (missing → walk frame copied as fall1)
//! - `drag<N>.png`  → drag_max_frames  (missing → walk frame copied as drag1)
//! - `id<K>_<N>.png` → idle_actions.idle_action_<K>    { max_frames: max N }
//! - `sp<K>_<N>.png` → special_actions.special_action_<K> { max_frames: max N }

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Mirrors `SpriteAction` in src/shared/types.ts (snake_case on the wire).
#[derive(Serialize, Clone)]
pub struct SpriteAction {
    pub max_frames: u32,
    #[serde(rename = "loop")]
    pub loop_anim: bool,
    pub loop_times: u32,
    pub description: String,
}

/// Mirrors `AnimationConfig` in src/shared/types.ts (snake_case on the wire).
#[derive(Serialize, Clone)]
pub struct AnimationConfig {
    pub walk_max_frame: u32,
    pub drag_max_frames: u32,
    pub fall_max_frames: u32,
    pub climb_max_frames: u32,
    pub special_actions: BTreeMap<String, SpriteAction>,
    pub idle_actions: BTreeMap<String, SpriteAction>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Absolute path of the stored sprite folder.
    pub dir: String,
    pub animation: AnimationConfig,
}

#[tauri::command]
pub async fn import_sprite_set(
    app: AppHandle,
    source_dir: String,
    name: String,
) -> Result<ImportResult, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || import_impl(&source_dir, &name, &app_data))
        .await
        .map_err(|e| e.to_string())?
}

fn sanitize_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_' || *c == '-')
        .collect()
}

/// `walk3.png` → Some(3) for prefix "walk". Case-insensitive, PNG only.
fn frame_number(stem: &str, prefix: &str) -> Option<u32> {
    stem.strip_prefix(prefix)?.parse::<u32>().ok()
}

/// `id2_5` → Some((2, 5)) for prefix "id".
fn action_frame(stem: &str, prefix: &str) -> Option<(u32, u32)> {
    let rest = stem.strip_prefix(prefix)?;
    let (k, n) = rest.split_once('_')?;
    Some((k.parse::<u32>().ok()?, n.parse::<u32>().ok()?))
}

fn import_impl(source_dir: &str, name: &str, app_data: &Path) -> Result<ImportResult, String> {
    let clean = sanitize_name(name);
    if clean.is_empty() {
        return Err("Name must contain letters or numbers.".into());
    }

    let source = PathBuf::from(source_dir);
    if !source.is_dir() {
        return Err(format!("Not a folder: {source_dir}"));
    }

    let dest = app_data.join("sprites").join(&clean);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut walk_max = 0u32;
    let mut climb_max = 0u32;
    let mut fall_max = 0u32;
    let mut drag_max = 0u32;
    let mut min_walk: Option<u32> = None;
    let mut idle: BTreeMap<u32, u32> = BTreeMap::new(); // K → max N
    let mut special: BTreeMap<u32, u32> = BTreeMap::new();

    let entries = std::fs::read_dir(&source).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|f| f.to_str()) else {
            continue;
        };
        let lower = file_name.to_lowercase();
        let Some(stem) = lower.strip_suffix(".png") else {
            continue;
        };

        // Copy under the lowercased name so lookups are case-stable.
        std::fs::copy(&path, dest.join(&lower))
            .map_err(|e| format!("Failed to copy {file_name}: {e}"))?;

        if let Some(n) = frame_number(stem, "walk") {
            walk_max = walk_max.max(n);
            min_walk = Some(min_walk.map_or(n, |m| m.min(n)));
        } else if let Some(n) = frame_number(stem, "climb") {
            climb_max = climb_max.max(n);
        } else if let Some(n) = frame_number(stem, "fall") {
            fall_max = fall_max.max(n);
        } else if let Some(n) = frame_number(stem, "drag") {
            drag_max = drag_max.max(n);
        } else if let Some((k, n)) = action_frame(stem, "id") {
            let e = idle.entry(k).or_insert(0);
            *e = (*e).max(n);
        } else if let Some((k, n)) = action_frame(stem, "sp") {
            let e = special.entry(k).or_insert(0);
            *e = (*e).max(n);
        }
    }

    if walk_max == 0 {
        return Err("No walk1.png found — sprite sets need at least walking frames".into());
    }

    // Missing climb/fall/drag: reuse the first walk frame so every animation
    // category has at least one frame (the engine assumes counts >= 1).
    let walk_src = dest.join(format!("walk{}.png", min_walk.unwrap_or(1)));
    for (max, file) in [
        (&mut climb_max, "climb1.png"),
        (&mut fall_max, "fall1.png"),
        (&mut drag_max, "drag1.png"),
    ] {
        if *max == 0 {
            std::fs::copy(&walk_src, dest.join(file))
                .map_err(|e| format!("Failed to create fallback {file}: {e}"))?;
            *max = 1;
        }
    }

    let idle_actions = idle
        .into_iter()
        .filter(|(_, n)| *n >= 1)
        .map(|(k, n)| {
            (
                format!("idle_action_{k}"),
                SpriteAction {
                    max_frames: n,
                    loop_anim: true,
                    loop_times: 10,
                    description: "custom".into(),
                },
            )
        })
        .collect();

    let special_actions = special
        .into_iter()
        .filter(|(_, n)| *n >= 1)
        .map(|(k, n)| {
            (
                format!("special_action_{k}"),
                SpriteAction {
                    max_frames: n,
                    loop_anim: true,
                    loop_times: 5,
                    description: "custom".into(),
                },
            )
        })
        .collect();

    Ok(ImportResult {
        dir: dest.to_string_lossy().into_owned(),
        animation: AnimationConfig {
            walk_max_frame: walk_max,
            drag_max_frames: drag_max,
            fall_max_frames: fall_max,
            climb_max_frames: climb_max,
            special_actions,
            idle_actions,
        },
    })
}
