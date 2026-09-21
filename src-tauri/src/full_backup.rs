//! The backup file you save and restore yourself: a complete copy of the
//! database, so it holds everything — companies, opportunities, meetings,
//! projects, commitments, notes, files lists, settings — including tables
//! added in later versions, with nothing to keep in step by hand.
//!
//! Restoring copies the file into the open database (SQLite's backup API),
//! after a snapshot of what was there. A copy from an older version is then
//! brought up to date by the normal migrations; a copy from a newer version,
//! a damaged file or something that isn't a MENA One database is refused and
//! nothing changes. Backups in the older JSON format still restore through
//! `import_backup_json`.

use crate::db::DbState;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// What a restored backup holds, for the confirmation message.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FullBackupSummary {
    pub schema_version: i64,
    pub companies: i64,
    pub contacts: i64,
    pub opportunities: i64,
    pub proposals: i64,
    pub agreements: i64,
    pub projects: i64,
    pub meetings: i64,
    pub tasks: i64,
    pub notes: i64,
    pub commitments: i64,
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap_or(0)
}

pub fn summarize(conn: &Connection) -> FullBackupSummary {
    FullBackupSummary {
        schema_version: crate::db::schema_version(conn).unwrap_or(0),
        companies: count(conn, "companies"),
        contacts: count(conn, "contacts"),
        opportunities: count(conn, "opportunities"),
        proposals: count(conn, "proposals"),
        agreements: count(conn, "agreements"),
        projects: count(conn, "projects"),
        meetings: count(conn, "meetings"),
        tasks: count(conn, "todos"),
        notes: count(conn, "notes"),
        commitments: count(conn, "commitments"),
    }
}

/// Writes a complete, consistent copy of the database to `dest`.
pub fn export_full_backup_core(conn: &Connection, dest: &Path) -> rusqlite::Result<()> {
    crate::backups::snapshot(conn, dest)
}

/// Checks a backup file before anything is changed: it opens, is intact, is
/// a MENA One database, and isn't from a newer version than this one.
pub fn check_full_backup(path: &Path) -> Result<FullBackupSummary, String> {
    let src = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "This file can't be opened as a MENA One backup.".to_string())?;
    let ok: String = src.query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "This file isn't a MENA One backup.".to_string())?;
    if ok != "ok" {
        return Err("This backup file is damaged, so nothing was restored.".into());
    }
    let has = |t: &str| -> bool {
        src.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)", [t], |r| r.get(0)).unwrap_or(false)
    };
    if !(has("app_meta") && has("proposals") && has("todos")) {
        return Err("This file isn't a MENA One backup.".into());
    }
    let summary = summarize(&src);
    let latest = crate::db::latest_schema_version();
    if summary.schema_version > latest {
        return Err(format!(
            "This backup was made by a newer version of MENA One (data version {}, this app reads up to {latest}). Update the app first.",
            summary.schema_version
        ));
    }
    Ok(summary)
}

/// Replaces everything in the open database with the backup at `src_path`,
/// then brings it up to this version. Call only after `check_full_backup`
/// and a snapshot of the current data.
pub fn restore_full_backup_core(conn: &mut Connection, src_path: &Path) -> Result<FullBackupSummary, String> {
    check_full_backup(src_path)?;
    let src = Connection::open_with_flags(src_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    {
        let backup = rusqlite::backup::Backup::new(&src, conn).map_err(err)?;
        backup.run_to_completion(256, std::time::Duration::from_millis(0), None).map_err(err)?;
    }
    drop(src);
    crate::db::bring_up_to_date(conn).map_err(err)?;
    Ok(summarize(conn))
}

// ── Commands ────────────────────────────────────────────────────────────────

/// "Back up all data…": asks where to save, then writes the full copy there.
#[tauri::command]
pub async fn export_full_backup(app: AppHandle, state: State<'_, DbState>, default_name: String) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let file_name = Path::new(&default_name).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "MENA One backup.sqlite3".into());
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_file_name(&file_name).add_filter("MENA One backup", &["sqlite3"]).save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.map_err(err)?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(err)?;
    // Written beside the target and renamed over it only when complete, so a
    // failed save never loses the backup that was there.
    let conn = state.0.lock().map_err(err)?;
    export_full_backup_core(&conn, &path).map_err(err)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Reads what a backup file holds without changing anything (for the "Restore?" question).
#[tauri::command]
pub fn inspect_full_backup(app: AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<FullBackupSummary> {
    let path = incoming_file(&app, &request)?;
    let result = check_full_backup(&path);
    let _ = std::fs::remove_file(&path);
    result
}

/// Restores `src`; if that fails part-way, puts back `snapshot` (the data as
/// it was just before) the same way. The error says which happened, and names
/// the snapshot file when even putting it back failed.
pub fn restore_with_recovery(conn: &mut Connection, src: &Path, snapshot: &Path) -> Result<FullBackupSummary, String> {
    match restore_full_backup_core(conn, src) {
        Ok(summary) => Ok(summary),
        Err(e) => match restore_full_backup_core(conn, snapshot) {
            Ok(_) => Err(format!("Couldn't restore that backup ({e}). Your data has been put back exactly as it was before.")),
            Err(e2) => Err(format!(
                "Couldn't restore that backup ({e}), and putting your data back also failed ({e2}). Your data from just before is saved in {} — don't delete it; restore it from Settings → Data Backup.",
                snapshot.display()
            )),
        },
    }
}

/// Restores a full backup sent as the file's bytes.
#[tauri::command]
pub fn restore_full_backup(app: AppHandle, state: State<DbState>, request: tauri::ipc::Request<'_>) -> CmdResult<FullBackupSummary> {
    let path = incoming_file(&app, &request)?;
    let result = (|| {
        check_full_backup(&path)?;
        let mut conn = state.0.lock().map_err(err)?;
        let snapshot = crate::backups::snapshot_before_change(&app, &conn, "restore")?;
        restore_with_recovery(&mut conn, &path, &snapshot)
    })();
    let _ = std::fs::remove_file(&path);
    result
}

/// The file's bytes, written next to the other backups so SQLite can open it.
fn incoming_file(app: &AppHandle, request: &tauri::ipc::Request<'_>) -> CmdResult<std::path::PathBuf> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No backup file was received.".into());
    };
    let dir = crate::backups::backups_dir(&app.path().app_data_dir().map_err(err)?);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!("incoming-{}.partial", std::process::id()));
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(path)
}
