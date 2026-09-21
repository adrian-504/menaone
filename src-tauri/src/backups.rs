//! Automatic local database snapshots under `<app_data_dir>/backups`.
//!
//! - A daily snapshot is taken at startup and re-checked every hour while the
//!   app stays open; the newest `DAILY_KEEP` are kept.
//! - Before pending schema migrations run, the database is snapshotted first
//!   (`pre-migration-v<from>-...`); those are never pruned automatically.
//!
//! Snapshots use `VACUUM INTO`, which writes a consistent copy even while the
//! database is in use. Only files this module names are ever pruned — other
//! files in the folder (e.g. older manual backups) are left alone.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

use crate::db::DbState;

const DAILY_PREFIX: &str = "daily-";
const PRE_MIGRATION_PREFIX: &str = "pre-migration-";
const MANUAL_PREFIX: &str = "manual-";
const BEFORE_CHANGE_PREFIX: &str = "before-";
pub const DAILY_KEEP: usize = 14;

type CmdResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBackup {
    pub file_name: String,
    pub size_bytes: u64,
    /// Seconds since the Unix epoch (file modification time).
    pub modified_at: u64,
    /// "daily" | "pre-migration" | "manual" | "other"
    pub kind: String,
}

pub fn backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("backups")
}

pub(crate) fn snapshot(conn: &Connection, dest: &Path) -> rusqlite::Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    }
    // Write to a temp name first so a crash mid-way never leaves a file that
    // looks like a finished backup.
    let tmp = dest.with_extension("partial");
    let _ = std::fs::remove_file(&tmp);
    if let Err(e) = conn.execute("VACUUM INTO ?1", params![tmp.to_string_lossy()]) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    // Renaming over an existing file replaces it in one step: a failure above
    // leaves the previous backup where it was.
    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        rusqlite::Error::ToSqlConversionFailure(Box::new(e))
    })?;
    Ok(())
}

fn local_date(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
}

/// Takes today's snapshot unless one already exists; returns its path when a
/// new one was written. Prunes daily snapshots beyond `keep`.
pub fn ensure_daily_backup(conn: &Connection, dir: &Path, keep: usize) -> rusqlite::Result<Option<PathBuf>> {
    let dest = dir.join(format!("{DAILY_PREFIX}{}.sqlite3", local_date(conn)?));
    let created = if dest.exists() {
        None
    } else {
        snapshot(conn, &dest)?;
        Some(dest)
    };
    prune_daily(dir, keep);
    Ok(created)
}

fn prune_daily(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut daily: Vec<String> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with(DAILY_PREFIX) && n.ends_with(".sqlite3"))
        .collect();
    // Names embed YYYY-MM-DD, so lexical order is chronological.
    daily.sort();
    let excess = daily.len().saturating_sub(keep);
    for name in &daily[..excess] {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

/// Snapshots an existing database before `init_connection` migrates it, when
/// its schema is behind this build. Opens its own short-lived connection so
/// nothing has touched the file yet.
pub fn backup_before_migrations(db_file: &Path, dir: &Path) -> rusqlite::Result<Option<PathBuf>> {
    if !db_file.exists() {
        return Ok(None);
    }
    let conn = Connection::open(db_file)?;
    let has_meta: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_meta')",
        [],
        |r| r.get(0),
    )?;
    if !has_meta {
        return Ok(None);
    }
    let from = crate::db::schema_version(&conn)?;
    if from >= crate::db::latest_schema_version() {
        return Ok(None);
    }
    let stamp: String = conn.query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')", [], |r| r.get(0))?;
    let dest = dir.join(format!("{PRE_MIGRATION_PREFIX}v{from}-{stamp}.sqlite3"));
    snapshot(&conn, &dest)?;
    Ok(Some(dest))
}

pub fn list_backups(dir: &Path) -> Vec<LocalBackup> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<LocalBackup> = entries
        .filter_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().into_string().ok()?;
            if !name.ends_with(".sqlite3") {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified_at = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
            let kind = if name.starts_with(DAILY_PREFIX) {
                "daily"
            } else if name.starts_with(PRE_MIGRATION_PREFIX) {
                "pre-migration"
            } else if name.starts_with(MANUAL_PREFIX) || name.starts_with(BEFORE_CHANGE_PREFIX) {
                "manual"
            } else {
                "other"
            };
            Some(LocalBackup { file_name: name, size_bytes: meta.len(), modified_at, kind: kind.into() })
        })
        .collect();
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    out
}

/// Hourly re-check so a Mac left running for days still gets a daily snapshot.
pub fn spawn_daily_backup_loop(app: AppHandle, dir: PathBuf) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(60 * 60));
        let state = app.state::<DbState>();
        let Ok(conn) = state.0.lock() else { continue };
        if let Err(e) = ensure_daily_backup(&conn, &dir, DAILY_KEEP) {
            eprintln!("[backups] daily snapshot failed: {e}");
        }
    });
}

fn dir_for(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(backups_dir(&app.path().app_data_dir().map_err(|e| e.to_string())?))
}

#[tauri::command]
pub fn list_local_backups(app: AppHandle) -> CmdResult<Vec<LocalBackup>> {
    Ok(list_backups(&dir_for(&app)?))
}

/// "Back up now": a timestamped snapshot kept alongside the daily ones (not
/// pruned, since the user asked for it explicitly).
#[tauri::command]
pub fn backup_database_now(app: AppHandle, state: State<DbState>) -> CmdResult<LocalBackup> {
    let dir = dir_for(&app)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let stamp: String = conn
        .query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{MANUAL_PREFIX}{stamp}.sqlite3"));
    snapshot(&conn, &dest).map_err(|e| e.to_string())?;
    drop(conn);
    list_backups(&dir)
        .into_iter()
        .find(|b| dest.file_name().is_some_and(|n| n.to_string_lossy() == b.file_name))
        .ok_or_else(|| "Backup was written but could not be read back".to_string())
}

/// Snapshot taken right before a change that replaces many records at once
/// (restoring a backup, importing, wiping). Callers refuse to go ahead when
/// this fails. `what` names the change in the file name, e.g. "restore".
pub fn snapshot_before_change(app: &AppHandle, conn: &Connection, what: &str) -> Result<PathBuf, String> {
    let dir = dir_for(app)?;
    let stamp: String = conn
        .query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{BEFORE_CHANGE_PREFIX}{what}-{stamp}.sqlite3"));
    snapshot(conn, &dest).map_err(|e| format!("Couldn't back up the database first, so nothing was changed: {e}"))?;
    Ok(dest)
}

/// Checks a snapshot can be opened and is intact.
pub fn verify_snapshot(path: &Path) -> rusqlite::Result<bool> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let result: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    Ok(result == "ok")
}

#[tauri::command]
pub fn reveal_backups_folder(app: AppHandle) -> CmdResult<()> {
    let dir = dir_for(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| e.to_string())
}
