//! Microsoft Files — browses the user's OneDrive folders exactly as they're
//! already synced to disk under `~/Library/CloudStorage/OneDrive-*` (the
//! standard macOS OneDrive sync location, visible in Finder), rather than via
//! Microsoft Graph. This deliberately reads the local filesystem instead of
//! calling the Graph API: no additional OAuth consent is needed, "Open" is
//! always a real native-app handoff via LaunchServices (no webUrl ambiguity),
//! and whatever the user can already see in Finder is exactly what MENA One
//! can see here — read-only, never copied anywhere.

use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileItem {
    pub path: String,
    pub name: String,
    pub is_folder: bool,
    pub size: Option<i64>,
    pub modified_at: Option<String>,
    /// False only for a linked item resolved via `files_get_by_ids` whose
    /// path no longer stats successfully (moved/renamed/deleted) — always
    /// true for a live folder listing, since those paths just came from
    /// `read_dir`. Never assume a linked path stays valid (Section 19).
    pub exists: bool,
}

/// The folders OneDrive syncs to on this computer: `~/Library/CloudStorage/OneDrive-*`
/// on macOS; the `OneDriveCommercial` / `OneDrive` / `OneDriveConsumer` folders on Windows.
pub(crate) fn onedrive_dirs() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let Ok(home) = std::env::var("HOME") else { return vec![] };
        let base = PathBuf::from(home).join("Library/CloudStorage");
        let Ok(entries) = std::fs::read_dir(&base) else { return vec![] };
        entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("OneDrive"))
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.path())
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut dirs: Vec<PathBuf> = Vec::new();
        for var in ["OneDriveCommercial", "OneDrive", "OneDriveConsumer"] {
            if let Ok(p) = std::env::var(var) {
                let p = PathBuf::from(p);
                if p.is_dir() && !dirs.contains(&p) {
                    dirs.push(p);
                }
            }
        }
        dirs
    }
}

fn onedrive_display_name(dir: &Path) -> String {
    let raw = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    raw.strip_prefix("OneDrive-")
        .or_else(|| raw.strip_prefix("OneDrive - "))
        .unwrap_or(&raw)
        .to_string()
}

pub(crate) fn is_within_onedrive(path: &Path) -> bool {
    // "OneDrive/../../elsewhere" starts with the OneDrive folder component by
    // component, so `..` is refused outright, and an existing path is compared
    // after resolving links.
    if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return false;
    }
    let resolved = path.canonicalize().ok();
    onedrive_dirs().iter().any(|d| {
        let dirs = [Some(d.clone()), d.canonicalize().ok()];
        dirs.iter().flatten().any(|dir| resolved.as_deref().map_or(path.starts_with(dir), |r| r.starts_with(dir)))
    })
}

/// Every synced OneDrive account/tenant folder (there can be more than one —
/// e.g. a work account and a personal one) — each becomes a top-level root in
/// the Files tab. Anything under `~/Library/CloudStorage` that isn't a
/// OneDrive folder (iCloud Drive, Google Drive, Dropbox, etc.) is left alone;
/// this feature is scoped to OneDrive specifically, per the doc's own scope.
fn onedrive_roots() -> Result<Vec<LocalFileItem>, String> {
    let mut roots: Vec<LocalFileItem> = onedrive_dirs()
        .into_iter()
        .map(|dir| LocalFileItem {
            name: onedrive_display_name(&dir),
            path: dir.to_string_lossy().to_string(),
            is_folder: true,
            size: None,
            modified_at: None,
            exists: true,
        })
        .collect();
    roots.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(roots)
}

/// Refuses to browse/open anything outside a synced OneDrive root — the
/// frontend only ever passes back paths this module itself handed out, but
/// this is the actual enforcement boundary, not a formality.
fn validate_within_onedrive(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "This item could no longer be found — it may have been moved, renamed, or deleted.".to_string())?;
    if !is_within_onedrive(&canonical) {
        return Err("That location is outside your OneDrive folders.".to_string());
    }
    Ok(canonical)
}

fn system_time_to_iso(t: std::time::SystemTime) -> Option<String> {
    let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    let dt = chrono_like_iso(secs);
    Some(dt)
}

/// Minimal Unix-timestamp → `YYYY-MM-DDTHH:MM:SSZ` formatter, avoiding a new
/// `chrono`/`time` dependency for the one thing this module needs it for.
fn chrono_like_iso(unix_secs: i64) -> String {
    const DAYS_IN_MONTH: [i64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let days_total = unix_secs.div_euclid(86400);
    let secs_of_day = unix_secs.rem_euclid(86400);
    let (hour, minute, second) = (secs_of_day / 3600, (secs_of_day % 3600) / 60, secs_of_day % 60);

    let mut year = 1970i64;
    let mut days = days_total;
    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let year_len = if is_leap { 366 } else { 365 };
        if days < year_len { break; }
        days -= year_len;
        year += 1;
    }
    let is_leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let mut month = 0usize;
    for (i, &len) in DAYS_IN_MONTH.iter().enumerate() {
        let len = if i == 1 && is_leap { 29 } else { len };
        if days < len { month = i; break; }
        days -= len;
    }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month + 1, days + 1, hour, minute, second)
}

fn read_folder(dir: &Path) -> Result<Vec<LocalFileItem>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Could not read this folder: {e}"))?;
    let mut items: Vec<LocalFileItem> = entries
        .filter_map(|e| e.ok())
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.')) // hidden files, .DS_Store, OneDrive sentinels
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some(LocalFileItem {
                path: e.path().to_string_lossy().to_string(),
                name: e.file_name().to_string_lossy().to_string(),
                is_folder: meta.is_dir(),
                size: if meta.is_dir() { None } else { Some(meta.len() as i64) },
                modified_at: meta.modified().ok().and_then(system_time_to_iso),
                exists: true,
            })
        })
        .collect();
    items.sort_by(|a, b| b.is_folder.cmp(&a.is_folder).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(items)
}

#[tauri::command]
pub fn files_list_roots() -> Result<Vec<LocalFileItem>, String> {
    onedrive_roots()
}

#[tauri::command]
pub fn files_list_folder(path: String) -> Result<Vec<LocalFileItem>, String> {
    let dir = validate_within_onedrive(Path::new(&path))?;
    if !dir.is_dir() {
        return Err("This is no longer a folder — it may have been replaced or removed.".to_string());
    }
    read_folder(&dir)
}

/// Opens the file/folder with whatever application macOS already has
/// associated with it (Word for .docx, Excel for .xlsx, Preview for .pdf,
/// Finder for a folder, etc.) — the standard LaunchServices handoff, no
/// guessing required on MENA One's side.
#[tauri::command]
pub fn files_open(path: String) -> Result<(), String> {
    let target = validate_within_onedrive(Path::new(&path))?;
    tauri_plugin_opener::open_path(&target, None::<&str>).map_err(|e| format!("Could not open this item: {e}"))
}

/// Reveals the item in Finder instead of opening it — useful for a folder
/// the user wants to work with directly, or to confirm exactly where a file
/// lives before sharing it.
#[tauri::command]
pub fn files_reveal_in_finder(path: String) -> Result<(), String> {
    let target = validate_within_onedrive(Path::new(&path))?;
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|e| format!("Could not show this item in its folder: {e}"))
}

// ═══════════════ Linking (Company/Project folder matching) ═══════════════
// A `microsoft_files` row is only ever minted here, at the moment the user
// actually links something — never by browsing. Its own integer `id` is what
// entity_links uses on the 'msfile' side, since a Graph-free local path is a
// string, not a number.

/// Find-or-create the `microsoft_files` row for this path, returning its id
/// so the caller can then use the existing generic `setLinksFrom('msfile', id,
/// ...)` Work Graph command — this is the one new primitive linking actually
/// needs; the relationship itself reuses entity_links unchanged.
#[tauri::command]
pub fn files_get_or_create_msfile(state: State<DbState>, path: String, name: String, item_type: String) -> CmdResult<i64> {
    let conn = state.0.lock().map_err(err)?;
    if let Some(id) = conn
        .query_row("SELECT id FROM microsoft_files WHERE path = ?1", params![path], |r| r.get::<_, i64>(0))
        .optional()
        .map_err(err)?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO microsoft_files (path, name, item_type, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![path, name, item_type, crate::commands::now_iso()],
    ).map_err(err)?;
    Ok(conn.last_insert_rowid())
}

/// Resolves linked `microsoft_files` rows (from entity_links ids) back to
/// browsable items — re-stats the path live so a moved/renamed/deleted
/// folder shows up as unavailable rather than silently wrong (Section 19:
/// never assume the original path is still valid). A path that no longer
/// exists is still returned (so its Company/Project section can still show
/// its name), just with `size`/`modifiedAt` left empty.
#[tauri::command]
pub fn files_get_by_ids(state: State<DbState>, ids: Vec<i64>) -> CmdResult<Vec<LocalFileItem>> {
    if ids.is_empty() { return Ok(vec![]); }
    let conn = state.0.lock().map_err(err)?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT path, name, item_type FROM microsoft_files WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let params_dyn: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params_dyn.as_slice(), |r| {
            let path: String = r.get(0)?;
            let name: String = r.get(1)?;
            let item_type: String = r.get(2)?;
            Ok((path, name, item_type))
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (path, name, item_type) = row.map_err(err)?;
        let meta = std::fs::metadata(&path).ok();
        out.push(LocalFileItem {
            is_folder: meta.as_ref().map(|m| m.is_dir()).unwrap_or(item_type == "folder"),
            size: meta.as_ref().filter(|m| !m.is_dir()).map(|m| m.len() as i64),
            modified_at: meta.as_ref().and_then(|m| m.modified().ok()).and_then(system_time_to_iso),
            exists: meta.is_some(),
            path,
            name,
        });
    }
    Ok(out)
}

/// Thin wrapper around the same find-or-create-by-name the Opportunities
/// feature already uses — the folder-matching wizard needs a real
/// `companies.id` to link to, and a matched folder's company may not have a
/// row there yet (the free-text company list the wizard matches against is
/// broader than the numeric `companies` table so far).
#[tauri::command]
pub fn files_resolve_company_id(state: State<DbState>, name: String) -> CmdResult<i64> {
    let conn = state.0.lock().map_err(err)?;
    crate::opportunities::resolve_company(&conn, Some(&name))
        .map_err(err)?
        .ok_or_else(|| "Company name cannot be empty.".to_string())
}

// ═══════════════ Global Files area (Section 16 — kept lightweight) ═══════════════
// "Linked" is every msfile currently linked to a Company or Project, in one
// list — today that's scattered across each Company/Project's own Files
// section, this is just the same data joined in one query so it's findable
// without visiting every entity individually. "Recent" is files actually
// opened through MENA One, locally tracked (never claims to reflect
// Microsoft's own account-wide "recent" — see Section 22's precision note).

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFileEntry {
    pub path: String,
    pub name: String,
    pub is_folder: bool,
    pub exists: bool,
    pub linked_to_type: String, // "company" | "project"
    pub linked_to_name: String,
}

#[tauri::command]
pub fn files_list_linked(state: State<DbState>) -> CmdResult<Vec<LinkedFileEntry>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT mf.path, mf.name, mf.item_type, el.to_type, COALESCE(c.name, p.name, '—')
             FROM entity_links el
             JOIN microsoft_files mf ON mf.id = el.from_id AND el.from_type = 'msfile'
             LEFT JOIN companies c ON el.to_type = 'company' AND c.id = el.to_id
             LEFT JOIN projects p ON el.to_type = 'project' AND p.id = el.to_id
             WHERE el.to_type IN ('company', 'project')
             ORDER BY mf.name COLLATE NOCASE",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (path, name, item_type, linked_to_type, linked_to_name) = row.map_err(err)?;
        let meta = std::fs::metadata(&path).ok();
        out.push(LinkedFileEntry {
            is_folder: meta.as_ref().map(|m| m.is_dir()).unwrap_or(item_type == "folder"),
            exists: meta.is_some(),
            path,
            name,
            linked_to_type,
            linked_to_name,
        });
    }
    Ok(out)
}

/// Re-stats a list of paths the frontend already knows about (this session's
/// locally tracked "recently opened" list, stored in `app_meta` — not a
/// second database table for something this small) — deliberately more
/// lenient than `validate_within_onedrive`, which errors on a path that no
/// longer exists; a recent-but-now-missing file should still show up with
/// `exists: false`, not silently vanish from the list.
#[tauri::command]
pub fn files_stat_paths(paths: Vec<String>) -> CmdResult<Vec<LocalFileItem>> {
    let mut out = Vec::new();
    for p in paths {
        let path = Path::new(&p);
        if !is_within_onedrive(path) { continue; }
        let meta = std::fs::metadata(path).ok();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.clone());
        out.push(LocalFileItem {
            is_folder: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size: meta.as_ref().filter(|m| !m.is_dir()).map(|m| m.len() as i64),
            modified_at: meta.as_ref().and_then(|m| m.modified().ok()).and_then(system_time_to_iso),
            exists: meta.is_some(),
            path: p,
            name,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::is_within_onedrive;
    use std::path::Path;

    #[test]
    fn parent_segments_never_count_as_inside_onedrive() {
        for dir in super::onedrive_dirs() {
            assert!(!is_within_onedrive(&dir.join("..").join("..").join("tmp")));
        }
        assert!(!is_within_onedrive(Path::new("/tmp/../etc")));
        assert!(!is_within_onedrive(Path::new("/etc/passwd")));
    }
}
