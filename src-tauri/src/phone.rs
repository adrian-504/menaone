//! Phone sync over OneDrive — the Mac side (docs/phone-sync.md).
//!
//! The Mac writes one `snapshot.json` the phone reads (built in the frontend,
//! src/lib/phoneSnapshot.ts, and written here atomically), and imports the
//! small capture files the phone drops into `inbox/`. Nothing is edited in two
//! places, so nothing conflicts. This is not the database on OneDrive that
//! docs/sync-architecture.md rules out: a derived JSON export plus an
//! append-only inbox.
//!
//! Import rules: each capture is applied once (`phone_imports.capture_id`),
//! each file in one transaction, through the same write paths the app's own
//! screens use (so the commitment ⇄ task triggers and the activity log fire).
//! A file that can't be read or applied moves to `inbox/failed/` with the
//! reason beside it.

use crate::commitments::{add_commitments_in, get_commitment, upsert_commitment_rows_in, NewCommitment};
use crate::db::DbState;
use crate::models::Todo;
use crate::opportunities::{match_company_name, CompanyMatch};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub const CAPTURE_FORMAT: &str = "mena-one-capture/1";
pub const ROOT_KEY: &str = "phone_root";
pub const FOLDER_NAME: &str = "MENA One Phone";
const TENANT_ROOT: &str = "OneDrive-MENABusinessInvestmentGroup";
pub const MAX_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;
/// A capture file younger than this may still be arriving through OneDrive.
pub const MIN_FILE_AGE: Duration = Duration::from_secs(2);
pub const IMPORTED_IDS_SHOWN: i64 = 200;
pub const EVENT_APPLIED: &str = "phone-captures-applied";

/// Migration 39: which captures have been applied (or failed), by capture id.
pub fn migrate_phone_imports(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS phone_imports (
            capture_id      TEXT PRIMARY KEY,
            kind            TEXT NOT NULL,
            applied_to_type TEXT,
            applied_to_id   INTEGER,
            imported_at     TEXT NOT NULL,
            error           TEXT
         );",
    )
}

// ── The folder ──────────────────────────────────────────────────────────────

/// `<the MENA BIG OneDrive>/MENA One Phone`, or the first OneDrive root when
/// that one isn't on this Mac. None when there is no OneDrive at all.
pub fn default_root() -> Option<PathBuf> {
    let mut dirs = crate::localfiles::onedrive_dirs();
    dirs.sort();
    let base = dirs.iter().find(|d| d.file_name().is_some_and(|n| n == TENANT_ROOT)).or_else(|| dirs.first())?;
    Some(base.join(FOLDER_NAME))
}

/// The folder in use: the one chosen in Settings, else the default.
pub fn configured_root(conn: &Connection) -> rusqlite::Result<Option<PathBuf>> {
    let chosen: Option<String> = conn
        .query_row("SELECT value FROM app_meta WHERE key = ?1", params![ROOT_KEY], |r| r.get(0))
        .optional()?;
    Ok(chosen.filter(|p| !p.trim().is_empty()).map(PathBuf::from).or_else(default_root))
}

/// A folder the phone folder may be: an existing folder inside a synced OneDrive root.
pub fn validate_root(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|_| "That folder could not be found.".to_string())?;
    if !canonical.is_dir() || !crate::localfiles::is_within_onedrive(&canonical) {
        return Err("Choose a folder inside OneDrive.".into());
    }
    Ok(canonical)
}

pub fn inbox_dir(root: &Path) -> PathBuf {
    root.join("inbox")
}
pub fn failed_dir(root: &Path) -> PathBuf {
    inbox_dir(root).join("failed")
}

/// `inbox/`, `inbox/done/`, `inbox/failed/` under the root.
pub fn ensure_layout(root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(inbox_dir(root).join("done"))?;
    std::fs::create_dir_all(failed_dir(root))
}

// ── The snapshot ────────────────────────────────────────────────────────────

/// Writes `snapshot.json` whole: to `snapshot.json.tmp` first, then renamed,
/// so the phone never reads half a file. Returns the bytes written.
pub fn write_snapshot(root: &Path, json: &str) -> Result<u64, String> {
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(format!(
            "The phone snapshot is {:.1} MB, over the {} MB limit — it was not written.",
            json.len() as f64 / 1_048_576.0,
            MAX_SNAPSHOT_BYTES / 1_048_576
        ));
    }
    ensure_layout(root).map_err(|e| format!("Could not create the phone folder: {e}"))?;
    let tmp = root.join("snapshot.json.tmp");
    let dest = root.join("snapshot.json");
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("Could not write the snapshot: {e}"))?;
        f.write_all(json.as_bytes()).map_err(|e| format!("Could not write the snapshot: {e}"))?;
        f.sync_all().map_err(|e| format!("Could not write the snapshot: {e}"))?;
    }
    std::fs::rename(&tmp, &dest).map_err(|e| format!("Could not replace the snapshot: {e}"))?;
    Ok(json.len() as u64)
}

// ── Captures ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub format: String,
    pub id: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub device: Option<String>,
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub contact_id: Option<i64>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub commitment_id: Option<i64>,
    #[serde(default)]
    pub todo_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Touched {
    pub kind: String,
    pub id: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ImportResult {
    pub imported: u32,
    pub failed: u32,
    pub touched: Vec<Touched>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FailedCapture {
    pub id: String,
    pub error: String,
}

fn touched(kind: &str, id: i64) -> Touched {
    Touched { kind: kind.into(), id }
}

/// A capture id is used as a file name: letters, digits and hyphens only.
fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn non_empty(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// What makes a capture unusable before anything is written.
fn check(c: &Capture) -> Result<(), String> {
    if c.format != CAPTURE_FORMAT {
        return Err(format!("Unknown format \"{}\" (expected {CAPTURE_FORMAT})", c.format));
    }
    if !safe_id(&c.id) {
        return Err("The capture id is not a UUID".into());
    }
    match c.kind.as_str() {
        "commitment" | "task" | "note" if non_empty(&c.text).is_none() => Err("The capture has no text".into()),
        "commitment" if !matches!(c.direction.as_deref(), Some("ours") | Some("theirs")) => Err("A promise needs a direction: ours or theirs".into()),
        "keep" if c.commitment_id.is_none() => Err("Keep needs a commitmentId".into()),
        "done" if c.todo_id.is_none() => Err("Done needs a todoId".into()),
        "commitment" | "task" | "note" | "keep" | "done" => Ok(()),
        other => Err(format!("Unknown kind \"{other}\"")),
    }
}

/// The company a capture names: its id when that company exists, else its
/// name matched the way saves match names (never creating one). None: unlinked.
fn capture_company(conn: &Connection, c: &Capture) -> rusqlite::Result<Option<(i64, String)>> {
    if let Some(id) = c.company_id {
        if let Some(name) = conn.query_row("SELECT name FROM companies WHERE id = ?1", params![id], |r| r.get::<_, String>(0)).optional()? {
            return Ok(Some((id, name)));
        }
    }
    if let Some(name) = non_empty(&c.company_name) {
        if let CompanyMatch::One(id) = match_company_name(conn, name)? {
            let current: String = conn.query_row("SELECT name FROM companies WHERE id = ?1", params![id], |r| r.get(0))?;
            return Ok(Some((id, current)));
        }
    }
    Ok(None)
}

fn exists(conn: &Connection, table: &str, id: i64) -> rusqlite::Result<bool> {
    conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1)"), params![id], |r| r.get(0))
}

fn today(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))
}

/// What a capture became: the record it was applied to and everything it changed.
struct Applied {
    to_type: &'static str,
    to_id: i64,
    touched: Vec<Touched>,
}

fn apply(conn: &Connection, c: &Capture) -> Result<Applied, String> {
    let text = non_empty(&c.text).unwrap_or_default().to_string();
    let due = non_empty(&c.due_date).map(str::to_string);
    match c.kind.as_str() {
        "commitment" => {
            let company = capture_company(conn, c).map_err(err)?;
            let contact = match c.contact_id {
                Some(id) if exists(conn, "contacts", id).map_err(err)? => Some(id),
                _ => None,
            };
            let added = add_commitments_in(conn, &[NewCommitment {
                direction: c.direction.clone().unwrap_or_default(),
                text,
                contact_id: contact,
                due_date: due,
                company_id: company.map(|(id, _)| id),
                source_type: "capture".into(),
                source_key: Some(format!("phone:{}", c.id)),
                ..Default::default()
            }])
            .map_err(err)?;
            let cm = added.commitments.first().ok_or("The promise could not be added")?;
            let mut t = vec![touched("commitment", cm.id)];
            t.extend(added.tasks.iter().map(|task| touched("task", task.id)));
            Ok(Applied { to_type: "commitment", to_id: cm.id, touched: t })
        }
        "task" => {
            let company = capture_company(conn, c).map_err(err)?;
            let id: i64 = conn.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM todos", [], |r| r.get(0)).map_err(err)?;
            // A company name that matches nothing stays with the task as text, unlinked.
            let unmatched = if company.is_none() { non_empty(&c.company_name) } else { None };
            let task = Todo {
                id,
                title: text,
                r#type: Some(if company.is_some() { "client" } else { "general" }.into()),
                client: company.as_ref().map(|(_, n)| n.clone()),
                company_id: company.as_ref().map(|(id, _)| *id),
                priority: Some("Medium".into()),
                due_date: due,
                status: Some("Pending".into()),
                description: unmatched.map(|n| format!("For {n} (added on the phone; not matched to a company).")),
                created_at: Some(today(conn).map_err(err)?),
                ..Default::default()
            };
            crate::commands::upsert_todo_rows_in(conn, std::slice::from_ref(&task)).map_err(err)?;
            Ok(Applied { to_type: "task", to_id: id, touched: vec![touched("task", id)] })
        }
        "note" => match capture_company(conn, c).map_err(err)? {
            Some((company_id, name)) => {
                conn.execute(
                    "INSERT INTO company_note_entries (company_id, company_name, body, is_legacy, created_at) VALUES (?1,?2,?3,0,?4)",
                    params![company_id, name, text, crate::commands::now_iso()],
                )
                .map_err(err)?;
                let id = conn.last_insert_rowid();
                Ok(Applied { to_type: "company_note", to_id: id, touched: vec![touched("company", company_id)] })
            }
            None => {
                let content = match non_empty(&c.company_name) {
                    Some(n) => format!("{n}: {text}"),
                    None => text,
                };
                conn.execute(
                    "INSERT INTO inbox_items (item_type, content, created_at, processed) VALUES ('note', ?1, ?2, 0)",
                    params![content, crate::commands::now_iso()],
                )
                .map_err(err)?;
                let id = conn.last_insert_rowid();
                Ok(Applied { to_type: "inbox_item", to_id: id, touched: vec![touched("inbox", id)] })
            }
        },
        "keep" => {
            let id = c.commitment_id.unwrap_or_default();
            let mut cm = get_commitment(conn, id).map_err(err)?.ok_or("That promise is no longer on the Mac")?;
            if cm.status == "dropped" {
                return Err("That promise was dropped on the Mac".into());
            }
            if cm.status != "kept" {
                cm.status = "kept".into();
                cm.closed_at = Some(crate::commands::now_iso());
                upsert_commitment_rows_in(conn, std::slice::from_ref(&cm)).map_err(err)?;
            }
            let mut t = vec![touched("commitment", id)];
            if let Some(todo) = cm.todo_id {
                t.push(touched("task", todo));
            }
            Ok(Applied { to_type: "commitment", to_id: id, touched: t })
        }
        "done" => {
            let id = c.todo_id.unwrap_or_default();
            let mut task = crate::commands::read_todos(conn).map_err(err)?.into_iter().find(|t| t.id == id).ok_or("That task is no longer on the Mac")?;
            if task.status.as_deref() != Some("Done") {
                task.status = Some("Done".into());
                task.completed_at = Some(today(conn).map_err(err)?);
                crate::commands::upsert_todo_rows_in(conn, std::slice::from_ref(&task)).map_err(err)?;
            }
            let mut t = vec![touched("task", id)];
            let kept: Vec<i64> = conn
                .prepare("SELECT id FROM commitments WHERE todo_id = ?1")
                .and_then(|mut s| s.query_map(params![id], |r| r.get(0))?.collect())
                .map_err(err)?;
            t.extend(kept.into_iter().map(|cid| touched("commitment", cid)));
            Ok(Applied { to_type: "task", to_id: id, touched: t })
        }
        other => Err(format!("Unknown kind \"{other}\"")),
    }
}

/// Applies one capture in its own transaction and records it.
fn apply_and_record(conn: &Connection, c: &Capture) -> Result<Applied, String> {
    conn.execute_batch("SAVEPOINT phone_capture").map_err(err)?;
    let result = apply(conn, c).and_then(|a| {
        conn.execute(
            "INSERT INTO phone_imports (capture_id, kind, applied_to_type, applied_to_id, imported_at, error)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)
             ON CONFLICT(capture_id) DO UPDATE SET kind = excluded.kind, applied_to_type = excluded.applied_to_type,
                applied_to_id = excluded.applied_to_id, imported_at = excluded.imported_at, error = NULL",
            params![c.id, c.kind, a.to_type, a.to_id, crate::commands::now_iso()],
        )
        .map_err(err)?;
        Ok(a)
    });
    match &result {
        Ok(_) => conn.execute_batch("RELEASE phone_capture").map_err(err)?,
        Err(_) => {
            let _ = conn.execute_batch("ROLLBACK TO phone_capture; RELEASE phone_capture");
        }
    }
    result
}

fn already_applied(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM phone_imports WHERE capture_id = ?1 AND error IS NULL)", params![id], |r| r.get(0))
}

fn record_failure(conn: &Connection, id: &str, kind: &str, error: &str) {
    let _ = conn.execute(
        "INSERT INTO phone_imports (capture_id, kind, imported_at, error) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(capture_id) DO UPDATE SET error = excluded.error, imported_at = excluded.imported_at
         WHERE phone_imports.error IS NOT NULL",
        params![id, if kind.is_empty() { "unknown" } else { kind }, crate::commands::now_iso(), error],
    );
}

fn move_into(file: &Path, dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let dest = dir.join(file.file_name().unwrap_or_default());
    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }
    std::fs::rename(file, &dest)?;
    Ok(dest)
}

fn done_dir(root: &Path, conn: &Connection) -> PathBuf {
    let month: String = conn.query_row("SELECT strftime('%Y-%m','now','localtime')", [], |r| r.get(0)).unwrap_or_else(|_| "unknown".into());
    inbox_dir(root).join("done").join(month)
}

fn fail_file(root: &Path, file: &Path, id: &str, error: &str) {
    let dir = failed_dir(root);
    let _ = move_into(file, &dir);
    let _ = std::fs::write(dir.join(format!("{id}.error.txt")), format!("{error}\n"));
}

/// Scans `inbox/` and applies each capture that is at least `min_age` old.
pub fn import_inbox_aged(conn: &Connection, root: &Path, min_age: Duration) -> Result<ImportResult, String> {
    ensure_layout(root).map_err(|e| format!("Could not open the phone inbox: {e}"))?;
    let mut files: Vec<PathBuf> = std::fs::read_dir(inbox_dir(root))
        .map_err(|e| format!("Could not read the phone inbox: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    let mut out = ImportResult::default();
    let now = SystemTime::now();
    for file in files {
        let young = std::fs::metadata(&file)
            .and_then(|m| m.modified())
            .map(|t| now.duration_since(t).unwrap_or_default() < min_age)
            .unwrap_or(false);
        if young {
            continue;
        }
        let stem = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let fallback_id = if safe_id(&stem) { stem.clone() } else { format!("file-{}", stem.chars().filter(|c| c.is_ascii_alphanumeric()).take(40).collect::<String>()) };
        let parsed = std::fs::read_to_string(&file)
            .map_err(|e| format!("Could not read the file: {e}"))
            .and_then(|s| serde_json::from_str::<Capture>(&s).map_err(|e| format!("Not a capture file: {e}")))
            .and_then(|c| check(&c).map(|_| c));
        let capture = match parsed {
            Ok(c) => c,
            Err(e) => {
                record_failure(conn, &fallback_id, "", &e);
                fail_file(root, &file, &fallback_id, &e);
                out.failed += 1;
                continue;
            }
        };
        if already_applied(conn, &capture.id).map_err(err)? {
            let _ = move_into(&file, &done_dir(root, conn));
            continue;
        }
        match apply_and_record(conn, &capture) {
            Ok(applied) => {
                let _ = move_into(&file, &done_dir(root, conn));
                out.imported += 1;
                for t in applied.touched {
                    if !out.touched.contains(&t) {
                        out.touched.push(t);
                    }
                }
            }
            Err(e) => {
                record_failure(conn, &capture.id, &capture.kind, &e);
                fail_file(root, &file, &capture.id, &e);
                out.failed += 1;
            }
        }
    }
    Ok(out)
}

pub fn import_inbox(conn: &Connection, root: &Path) -> Result<ImportResult, String> {
    import_inbox_aged(conn, root, MIN_FILE_AGE)
}

/// The captures waiting in `inbox/failed/`, with the reason written beside each.
pub fn list_failed(root: &Path) -> Vec<FailedCapture> {
    let dir = failed_dir(root);
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out: Vec<FailedCapture> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .map(|p| {
            let id = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let error = std::fs::read_to_string(dir.join(format!("{id}.error.txt")))
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Could not be added".into());
            FailedCapture { id, error }
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// The last capture ids applied, oldest first (the snapshot's `importedCaptureIds`).
pub fn imported_capture_ids(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<String>> {
    let mut ids: Vec<String> = conn
        .prepare("SELECT capture_id FROM phone_imports WHERE error IS NULL ORDER BY imported_at DESC, capture_id DESC LIMIT ?1")?
        .query_map(params![limit], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    ids.reverse();
    Ok(ids)
}

pub fn imported_today(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM phone_imports WHERE error IS NULL AND date(imported_at, 'localtime') = date('now', 'localtime')",
        [],
        |r| r.get(0),
    )
}

// ── Commands ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    pub root: Option<String>,
    pub exists: bool,
    pub snapshot_written_at: Option<String>,
    pub snapshot_bytes: Option<i64>,
    pub imported_today: i64,
    pub failed_count: usize,
    pub failed: Vec<FailedCapture>,
    /// For the snapshot: the last 200 capture ids applied.
    pub imported_capture_ids: Vec<String>,
    /// This Mac's name, for the snapshot's `mac`.
    pub mac: String,
}

fn meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", params![key], |r| r.get(0)).optional()
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// "Ahmad's MacBook Pro" — the name set in System Settings → Sharing.
fn mac_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    std::env::var("HOSTNAME").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "Mac".into())
}

pub fn status(conn: &Connection) -> rusqlite::Result<PhoneStatus> {
    let root = configured_root(conn)?;
    let failed = root.as_deref().map(list_failed).unwrap_or_default();
    Ok(PhoneStatus {
        exists: root.as_deref().is_some_and(Path::is_dir),
        root: root.map(|r| r.to_string_lossy().to_string()),
        snapshot_written_at: meta(conn, "phone_snapshot_written_at")?,
        snapshot_bytes: meta(conn, "phone_snapshot_bytes")?.and_then(|s| s.parse().ok()),
        imported_today: imported_today(conn)?,
        failed_count: failed.len(),
        failed,
        imported_capture_ids: imported_capture_ids(conn, IMPORTED_IDS_SHOWN)?,
        mac: mac_name(),
    })
}

#[tauri::command]
pub fn phone_get_status(state: State<DbState>) -> CmdResult<PhoneStatus> {
    let conn = state.0.lock().map_err(err)?;
    status(&conn).map_err(err)
}

/// Chooses the phone folder (None: back to the default) and creates its inbox.
#[tauri::command]
pub fn phone_set_root(state: State<DbState>, path: Option<String>) -> CmdResult<PhoneStatus> {
    let conn = state.0.lock().map_err(err)?;
    match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let root = validate_root(Path::new(&p))?;
            ensure_layout(&root).map_err(|e| format!("Could not create the phone folder: {e}"))?;
            set_meta(&conn, ROOT_KEY, &root.to_string_lossy()).map_err(err)?;
        }
        None => {
            conn.execute("DELETE FROM app_meta WHERE key = ?1", params![ROOT_KEY]).map_err(err)?;
            let root = default_root().ok_or("There is no OneDrive folder on this Mac.")?;
            ensure_layout(&root).map_err(|e| format!("Could not create the phone folder: {e}"))?;
        }
    }
    status(&conn).map_err(err)
}

fn root_for_writing(conn: &Connection) -> CmdResult<PathBuf> {
    let root = configured_root(conn).map_err(err)?.ok_or("There is no OneDrive folder on this Mac.")?;
    // The folder may not exist yet (first run); its OneDrive parent must.
    let anchor = if root.exists() { root.clone() } else { root.parent().map(Path::to_path_buf).unwrap_or_default() };
    if !crate::localfiles::is_within_onedrive(&anchor) {
        return Err("The phone folder is not inside OneDrive.".into());
    }
    Ok(root)
}

#[tauri::command]
pub fn phone_write_snapshot(state: State<DbState>, json: String) -> CmdResult<u64> {
    let conn = state.0.lock().map_err(err)?;
    let root = root_for_writing(&conn)?;
    let bytes = write_snapshot(&root, &json)?;
    set_meta(&conn, "phone_snapshot_written_at", &crate::commands::now_iso()).map_err(err)?;
    set_meta(&conn, "phone_snapshot_bytes", &bytes.to_string()).map_err(err)?;
    Ok(bytes)
}

fn import_now(app: &AppHandle, conn: &Connection) -> CmdResult<ImportResult> {
    let root = root_for_writing(conn)?;
    let result = import_inbox(conn, &root)?;
    if result.imported > 0 || result.failed > 0 {
        let _ = app.emit(EVENT_APPLIED, &result);
    }
    Ok(result)
}

#[tauri::command]
pub fn phone_import_inbox(app: AppHandle, state: State<DbState>) -> CmdResult<ImportResult> {
    let conn = state.0.lock().map_err(err)?;
    import_now(&app, &conn)
}

/// Every pinned company note, for the snapshot's `pinnedNotes`.
#[tauri::command]
pub fn phone_pinned_notes(state: State<DbState>) -> CmdResult<Vec<crate::activity::CompanyNoteEntry>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, company_id, company_name, body, is_legacy, created_at, updated_at, pinned
             FROM company_note_entries WHERE pinned = 1 ORDER BY created_at DESC, id DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(crate::activity::CompanyNoteEntry {
                id: r.get(0)?,
                company_id: r.get(1)?,
                company_name: r.get(2)?,
                body: r.get(3)?,
                is_legacy: r.get::<_, i64>(4)? != 0,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
                pinned: r.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Shows the phone folder (or its failed captures) in Finder.
#[tauri::command]
pub fn phone_reveal(state: State<DbState>, failed: bool) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    let root = root_for_writing(&conn)?;
    ensure_layout(&root).map_err(err)?;
    let target = if failed { failed_dir(&root) } else { root };
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|e| format!("Could not show the folder: {e}"))
}

/// Scans the inbox at launch and then every minute. Quietly does nothing when
/// there is no OneDrive on this Mac.
pub fn spawn_phone_import_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        scan_once(&app);
        std::thread::sleep(Duration::from_secs(60));
    });
}

fn scan_once(app: &AppHandle) {
    let state = app.state::<DbState>();
    let Ok(conn) = state.0.lock() else { return };
    if configured_root(&conn).ok().flatten().is_none() {
        return;
    }
    if let Err(e) = import_now(app, &conn) {
        eprintln!("[phone] import failed: {e}");
    }
}
