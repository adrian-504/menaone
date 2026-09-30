//! My Day's photograph band (brand slice, Settings → Appearance): your own
//! photos, copied into `<app_data_dir>/band-photos/` so the band never depends
//! on a file you later move. Chosen photos are kept (never deleted here); the
//! page picks one per day.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "heic", "webp"];
/// Larger photos are refused: the band is 180 px tall.
const MAX_BYTES: u64 = 15 * 1024 * 1024;

fn photos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("band-photos");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_image(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

/// Copies a photo into `dir` under a free name; returns the new file's name.
pub fn add_photo(src: &Path, dir: &Path) -> Result<String, String> {
    if !src.is_file() || !is_image(src) {
        return Err("Choose a JPEG, PNG, HEIC or WebP photo.".to_string());
    }
    let size = fs::metadata(src).map_err(|e| e.to_string())?.len();
    if size > MAX_BYTES {
        return Err("That photo is over 15 MB; choose a smaller one.".to_string());
    }
    let name = src.file_name().and_then(|n| n.to_str()).ok_or("That file has no name.")?;
    let dest = crate::localfiles::free_name(dir, name);
    fs::copy(src, &dest).map_err(|e| format!("Couldn't copy the photo: {e}"))?;
    log::info!("appearance: band photo added ({} bytes)", size);
    Ok(dest.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string())
}

/// The photos in `dir`, by name.
pub fn list_photos(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(dir)
        .map(|it| it.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file() && is_image(p)).filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from)).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// A photo as a data: URL (the page's CSP allows data: images, not file paths).
pub fn photo_data_url(dir: &Path, name: &str) -> Result<String, String> {
    let safe = Path::new(name).file_name().ok_or("No such photo.")?;
    let path = dir.join(safe);
    if !is_image(&path) {
        return Err("No such photo.".to_string());
    }
    let bytes = fs::read(&path).map_err(|_| "That photo is no longer there.".to_string())?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("jpeg").to_ascii_lowercase();
    let mime = match ext.as_str() { "png" => "image/png", "webp" => "image/webp", "heic" => "image/heic", _ => "image/jpeg" };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn band_photos_add(app: AppHandle, paths: Vec<String>) -> Result<Vec<String>, String> {
    let dir = photos_dir(&app)?;
    paths.iter().map(|p| add_photo(Path::new(p), &dir)).collect()
}

#[tauri::command]
pub fn band_photos_list(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(list_photos(&photos_dir(&app)?))
}

#[tauri::command]
pub fn band_photo_data(app: AppHandle, name: String) -> Result<String, String> {
    photo_data_url(&photos_dir(&app)?, &name)
}
