//! Managed note attachments (Part 22 of the MENA One rebuild) — the
//! Markdown-first note model references attachments via `![](attachment://<id>)`
//! rather than embedding base64 data inline in the stored Markdown. Files live
//! on disk under `<app_data_dir>/attachments/<id>_<filename>`; the DB only
//! tracks the id/note/filename/mime — the path is always derivable, so there's
//! no separate path column to drift out of sync with the real file.

use crate::db::DbState;
use crate::v2_models::Attachment;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::params;
use std::fs;
use tauri::{AppHandle, Manager, State};

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn attachments_dir(app: &AppHandle) -> CmdResult<std::path::PathBuf> {
    let dir = app.path().app_data_dir().map_err(err)?.join("attachments");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// Only the file's own name is kept — never a folder part — so a name like
/// `../../x` can't place the file outside the attachments folder.
pub fn safe_file_name(filename: &str) -> String {
    let base = filename.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let cleaned: String = base.chars().filter(|c| !c.is_control()).collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." { "attachment".into() } else { cleaned }
}

/// Where an attachment's bytes live.
fn stored_path(dir: &std::path::Path, id: i64, filename: &str) -> std::path::PathBuf {
    dir.join(format!("{id}_{}", safe_file_name(filename)))
}

fn guess_mime(filename: &str) -> Option<String> {
    let ext = filename.rsplit('.').next()?.to_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => return None,
    }.to_string())
}

#[tauri::command]
pub fn save_attachment(app: AppHandle, state: State<DbState>, note_id: i64, filename: String, base64_data: String) -> CmdResult<Attachment> {
    // Data URLs (`data:image/png;base64,AAAA...`) are the common case from a
    // paste/drop event — strip the prefix if present, otherwise treat the
    // whole string as raw base64.
    let filename = safe_file_name(&filename);
    let raw_b64 = base64_data.split(',').last().unwrap_or(&base64_data);
    let bytes = STANDARD.decode(raw_b64).map_err(err)?;

    let mime_type = guess_mime(&filename);
    let now = crate::commands::now_iso();

    let conn = state.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO note_attachments (note_id, filename, mime_type, created_at) VALUES (?1,?2,?3,?4)",
        params![note_id, filename, mime_type, now],
    ).map_err(err)?;
    let id = conn.last_insert_rowid();
    drop(conn);

    let dir = attachments_dir(&app)?;
    let path = stored_path(&dir, id, &filename);
    fs::write(&path, &bytes).map_err(err)?;

    Ok(Attachment { id, note_id, filename, mime_type, created_at: Some(now) })
}

#[tauri::command]
pub fn get_attachment_data_url(app: AppHandle, state: State<DbState>, id: i64) -> CmdResult<String> {
    let conn = state.0.lock().map_err(err)?;
    let (filename, mime_type): (String, Option<String>) = conn.query_row(
        "SELECT filename, mime_type FROM note_attachments WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(err)?;
    drop(conn);

    let dir = attachments_dir(&app)?;
    let path = stored_path(&dir, id, &filename);
    let bytes = fs::read(&path).map_err(err)?;
    let mime = mime_type.unwrap_or_else(|| "application/octet-stream".to_string());
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn delete_attachment(app: AppHandle, state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    let filename: Option<String> = conn.query_row(
        "SELECT filename FROM note_attachments WHERE id = ?1",
        params![id],
        |r| r.get(0),
    ).ok();
    conn.execute("DELETE FROM note_attachments WHERE id = ?1", params![id]).map_err(err)?;
    drop(conn);

    if let Some(filename) = filename {
        let dir = attachments_dir(&app)?;
        let _ = fs::remove_file(stored_path(&dir, id, &filename));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::safe_file_name;

    #[test]
    fn attachment_names_cannot_leave_the_folder() {
        assert_eq!(safe_file_name("photo.png"), "photo.png");
        assert_eq!(safe_file_name("../../Library/LaunchAgents/x.plist"), "x.plist");
        assert_eq!(safe_file_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name(".."), "attachment");
        assert_eq!(safe_file_name(""), "attachment");
        assert_eq!(safe_file_name("a/"), "attachment");
    }
}
