//! Keeping the data safe and tidy (owner, 30-Sep-2026, "hygiene"):
//!
//! - The database runs in WAL mode (set once, it persists) with synchronous=NORMAL.
//! - At launch, in the background: `PRAGMA quick_check`, the result kept in
//!   `app_meta.integrity_last` for Settings and My Day.
//! - Each daily snapshot is also copied to OneDrive (`MENA One/Backups/menabig-YYYY-MM-DD.sqlite3`),
//!   checked with `integrity_check` on the copy, the last 14 kept. The live file is never copied.
//! - Install backups older than 30 days (`menabig.sqlite3.pre-*` in the app folder) move to the
//!   archive on the DevSSD when it is mounted; otherwise they stay until it is.
//!
//! Nothing here blocks startup or stops the app: failures are recorded for Settings.

use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const ONEDRIVE_KEEP: usize = 14;
pub const INSTALL_BACKUP_DAYS: u64 = 30;
const ONEDRIVE_PREFIX: &str = "menabig-";
const INSTALL_BACKUP_PREFIX: &str = "menabig.sqlite3.pre-";
/// Where install backups are archived (owner, 22-Sep-2026: archives go on the DevSSD).
pub const ARCHIVE_VOLUME: &str = "/Volumes/DevSSD";
pub const ARCHIVE_DB_DIR: &str = "/Volumes/DevSSD/MENA One Archive/DB backups";

type Io<T> = Result<T, String>;

/// A full UTC timestamp: these records are shown with a time.
fn now_iso() -> String {
    crate::commands::timestamp_utc(SystemTime::now())
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn get_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", params![key], |r| r.get(0)).ok()
}

// ── WAL ──

/// WAL (kept by the file once set) and synchronous=NORMAL (per connection).
pub fn use_wal(conn: &Connection) -> rusqlite::Result<String> {
    let mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")?;
    Ok(mode)
}

// ── Integrity ──

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityResult {
    pub at: String,
    pub ok: bool,
    /// The first problem SQLite reported, when not ok.
    pub detail: Option<String>,
}

/// `PRAGMA quick_check`, stored in `app_meta.integrity_last`.
pub fn run_quick_check(conn: &Connection) -> rusqlite::Result<IntegrityResult> {
    let rows: Vec<String> = conn.prepare("PRAGMA quick_check")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let ok = rows.len() == 1 && rows[0] == "ok";
    let result = IntegrityResult { at: now_iso(), ok, detail: if ok { None } else { rows.first().cloned() } };
    set_meta(conn, "integrity_last", &serde_json::to_string(&result).unwrap_or_default())?;
    Ok(result)
}

/// `PRAGMA integrity_check` on a file opened read-only (a copy, not the live database).
pub fn file_is_intact(path: &Path) -> bool {
    let Ok(c) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) else { return false };
    c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).map(|s| s == "ok").unwrap_or(false)
}

// ── OneDrive copy of the daily snapshot ──

/// `<OneDrive root>/MENA One/Backups`: the business OneDrive when there is one
/// (its folder name carries the tenant), else the first OneDrive folder.
pub fn onedrive_backup_dir(roots: &[PathBuf]) -> Option<PathBuf> {
    let business = roots.iter().find(|p| p.file_name().map(|n| n.to_string_lossy().contains("MENABusinessInvestmentGroup")).unwrap_or(false));
    business.or_else(|| roots.first()).map(|r| r.join("MENA One").join("Backups"))
}

/// Copies today's daily snapshot to the OneDrive folder unless it is already
/// there: to a partial name, checked, then renamed. Keeps the newest `keep`.
/// Returns the copy's path when a new one was made.
pub fn copy_snapshot_to_onedrive(snapshot: &Path, dir: &Path, date: &str, keep: usize) -> Io<Option<PathBuf>> {
    let dest = dir.join(format!("{ONEDRIVE_PREFIX}{date}.sqlite3"));
    if dest.exists() {
        prune_onedrive(dir, keep);
        return Ok(None);
    }
    if !snapshot.exists() {
        return Err(format!("today's snapshot is missing ({})", snapshot.display()));
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let tmp = dir.join(format!("{ONEDRIVE_PREFIX}{date}.partial"));
    let _ = std::fs::remove_file(&tmp);
    std::fs::copy(snapshot, &tmp).map_err(|e| format!("copy failed: {e}"))?;
    if !file_is_intact(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err("the copy failed its integrity check".into());
    }
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("couldn't finish the copy: {e}")
    })?;
    prune_onedrive(dir, keep);
    Ok(Some(dest))
}

fn onedrive_copies(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with(ONEDRIVE_PREFIX) && n.ends_with(".sqlite3") && n.len() == ONEDRIVE_PREFIX.len() + 10 + 8)
        .collect();
    // Names embed YYYY-MM-DD, so lexical order is chronological.
    names.sort();
    names
}

/// Keeps the newest `keep` copies; only files this module names are touched.
pub fn prune_onedrive(dir: &Path, keep: usize) {
    let names = onedrive_copies(dir);
    let excess = names.len().saturating_sub(keep);
    for name in &names[..excess] {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

/// Today's snapshot (backups/daily-<date>.sqlite3) to OneDrive, with its outcome
/// in app_meta: `backup_onedrive_last` (time of the last good copy) and
/// `backup_onedrive_error` (empty when the last attempt worked).
pub fn sync_daily_to_onedrive(conn: &Connection, backups_dir: &Path, roots: &[PathBuf]) {
    let Ok(date) = conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get::<_, String>(0)) else { return };
    let outcome = match onedrive_backup_dir(roots) {
        None => Err("OneDrive isn't set up on this Mac".to_string()),
        Some(dir) => copy_snapshot_to_onedrive(&backups_dir.join(format!("daily-{date}.sqlite3")), &dir, &date, ONEDRIVE_KEEP),
    };
    match outcome {
        Ok(Some(_)) => {
            let _ = set_meta(conn, "backup_onedrive_last", &now_iso());
            let _ = set_meta(conn, "backup_onedrive_error", "");
        }
        Ok(None) => {
            let _ = set_meta(conn, "backup_onedrive_error", "");
        }
        Err(e) => {
            eprintln!("[backups] OneDrive copy failed: {e}");
            let _ = set_meta(conn, "backup_onedrive_error", &e);
        }
    }
}

// ── Install backups: older ones to the archive ──

#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TidyResult {
    pub moved: usize,
    pub kept: usize,
    /// None when the archive drive isn't mounted (nothing moved).
    pub archived_to: Option<String>,
    pub at: String,
}

/// Moves `menabig.sqlite3.pre-*` files older than `days` from `app_dir` into
/// `archive_dir` when `archive_volume` is mounted: copied, compared byte for
/// byte, then removed from the app folder. Without the volume nothing moves.
pub fn archive_old_install_backups(app_dir: &Path, archive_volume: &Path, archive_dir: &Path, days: u64, now: SystemTime) -> TidyResult {
    let mut result = TidyResult { at: crate::commands::timestamp_utc(now), ..Default::default() };
    let Ok(entries) = std::fs::read_dir(app_dir) else { return result };
    let cutoff = now.checked_sub(Duration::from_secs(days * 24 * 60 * 60)).unwrap_or(SystemTime::UNIX_EPOCH);
    let mounted = archive_volume.is_dir();
    for e in entries.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with(INSTALL_BACKUP_PREFIX) || !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let old = e.metadata().and_then(|m| m.modified()).map(|t| t < cutoff).unwrap_or(false);
        if !old || !mounted {
            result.kept += 1;
            continue;
        }
        if move_file(&e.path(), &archive_dir.join(&name)).is_ok() {
            result.moved += 1;
        } else {
            result.kept += 1;
        }
    }
    if mounted {
        result.archived_to = Some(archive_dir.display().to_string());
    }
    result
}

/// Across volumes: copy, compare, then remove the original. A copy that
/// doesn't match is removed and the original stays.
fn move_file(from: &Path, to: &Path) -> Io<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if to.exists() {
        // Already archived (e.g. by hand): only drop the local one if it is the same file.
        if same_bytes(from, to) {
            return std::fs::remove_file(from).map_err(|e| e.to_string());
        }
        return Err("a different file with that name is already archived".into());
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(|e| e.to_string())?;
    if !same_bytes(from, to) {
        let _ = std::fs::remove_file(to);
        return Err("the archived copy didn't match".into());
    }
    std::fs::remove_file(from).map_err(|e| e.to_string())
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

// ── At launch, in the background ──

/// Quick check, the OneDrive copy and tidying the install backups, one after
/// the other on a background thread: the app opens without waiting for them.
pub fn spawn_launch_checks(app: tauri::AppHandle, app_data_dir: PathBuf, backups_dir: PathBuf) {
    use tauri::Manager;
    std::thread::spawn(move || {
        let state = app.state::<crate::db::DbState>();
        if let Ok(conn) = state.0.lock() {
            if let Err(e) = run_quick_check(&conn) {
                eprintln!("[integrity] quick_check failed to run: {e}");
            }
            sync_daily_to_onedrive(&conn, &backups_dir, &crate::localfiles::onedrive_dirs());
        }
        let tidy = archive_old_install_backups(&app_data_dir, Path::new(ARCHIVE_VOLUME), Path::new(ARCHIVE_DB_DIR), INSTALL_BACKUP_DAYS, SystemTime::now());
        if let Ok(conn) = state.0.lock() {
            let prior: Option<TidyResult> = get_meta(&conn, "install_backups_tidy").and_then(|s| serde_json::from_str(&s).ok());
            // Keep the date of the last time something was actually archived.
            let record = if tidy.moved == 0 { TidyResult { at: prior.map(|p| p.at).unwrap_or_default(), ..tidy } } else { tidy };
            let _ = set_meta(&conn, "install_backups_tidy", &serde_json::to_string(&record).unwrap_or_default());
        };
    });
}

// ── For Settings → Data ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HousekeepingStatus {
    /// Seconds since the epoch of the newest daily snapshot.
    pub daily_last: Option<u64>,
    pub onedrive_last: Option<String>,
    pub onedrive_kept: usize,
    pub onedrive_error: Option<String>,
    pub integrity: Option<IntegrityResult>,
    pub install_backups: usize,
    pub install_backups_tidy: Option<TidyResult>,
}

pub fn status(conn: &Connection, app_data_dir: &Path, backups_dir: &Path, roots: &[PathBuf]) -> HousekeepingStatus {
    let daily_last = crate::backups::list_backups(backups_dir).into_iter().filter(|b| b.kind == "daily").map(|b| b.modified_at).max();
    let install_backups = std::fs::read_dir(app_data_dir)
        .map(|es| es.filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(INSTALL_BACKUP_PREFIX)).count())
        .unwrap_or(0);
    HousekeepingStatus {
        daily_last,
        onedrive_last: get_meta(conn, "backup_onedrive_last").filter(|s| !s.is_empty()),
        onedrive_kept: onedrive_backup_dir(roots).map(|d| onedrive_copies(&d).len()).unwrap_or(0),
        onedrive_error: get_meta(conn, "backup_onedrive_error").filter(|s| !s.is_empty()),
        integrity: get_meta(conn, "integrity_last").and_then(|s| serde_json::from_str(&s).ok()),
        install_backups,
        install_backups_tidy: get_meta(conn, "install_backups_tidy").and_then(|s| serde_json::from_str(&s).ok()),
    }
}

#[tauri::command]
pub fn housekeeping_status(app: tauri::AppHandle, state: tauri::State<crate::db::DbState>) -> Result<HousekeepingStatus, String> {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let backups_dir = crate::backups::backups_dir(&app_data_dir);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    Ok(status(&conn, &app_data_dir, &backups_dir, &crate::localfiles::onedrive_dirs()))
}
