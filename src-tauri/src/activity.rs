//! Unified activity: one `activity` table that every module feeds, read by
//! the company and contact pages (and anywhere else that needs "what
//! happened"). Rows are written by SQLite triggers (migration 21), so every
//! writer is covered — the app today, the sync layer later — without each
//! save path having to remember to log.
//!
//! Bulk rewrites (backup restore, wipe) mute the triggers with
//! `app_meta.activity_muted = '1'` so a restore doesn't read as thousands of
//! "created"/"deleted" events.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::v2_models::Company;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: i64,
    pub created_at: String,
    #[serde(default)]
    pub actor: Option<String>,
    /// created | updated | deleted | status_changed | stage_changed | completed | note_added | …
    pub action: String,
    /// proposal | agreement | contact | task | note | meeting | opportunity | project | company
    pub entity_type: String,
    pub entity_id: i64,
    #[serde(default)]
    pub entity_label: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub contact_id: Option<i64>,
    #[serde(default)]
    pub opportunity_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilter {
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub contact_id: Option<i64>,
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_id: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// Runs `f` with activity logging switched off (bulk restore/wipe).
pub fn with_activity_muted<T>(conn: &mut Connection, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> rusqlite::Result<T> {
    conn.execute("INSERT INTO app_meta (key, value) VALUES ('activity_muted', '1') ON CONFLICT(key) DO UPDATE SET value = '1'", [])?;
    let result = f(conn);
    conn.execute("UPDATE app_meta SET value = '0' WHERE key = 'activity_muted'", [])?;
    result
}

pub fn query_activity(conn: &Connection, filter: &ActivityFilter) -> rusqlite::Result<Vec<ActivityEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, actor, action, entity_type, entity_id, entity_label, detail, company_id, contact_id, opportunity_id, project_id
         FROM activity
         WHERE (?1 IS NULL OR company_id = ?1)
           AND (?2 IS NULL OR contact_id = ?2 OR (entity_type = 'contact' AND entity_id = ?2))
           AND (?3 IS NULL OR entity_type = ?3)
           AND (?4 IS NULL OR entity_id = ?4)
         ORDER BY created_at DESC, id DESC
         LIMIT ?5",
    )?;
    let rows = stmt.query_map(
        params![filter.company_id, filter.contact_id, filter.entity_type, filter.entity_id, filter.limit.unwrap_or(300)],
        |r| {
            Ok(ActivityEntry {
                id: r.get(0)?, created_at: r.get(1)?, actor: r.get(2)?, action: r.get(3)?, entity_type: r.get(4)?,
                entity_id: r.get(5)?, entity_label: r.get(6)?, detail: r.get(7)?, company_id: r.get(8)?,
                contact_id: r.get(9)?, opportunity_id: r.get(10)?, project_id: r.get(11)?,
            })
        },
    )?;
    rows.collect()
}

#[tauri::command]
pub fn get_activity(state: State<DbState>, filter: ActivityFilter) -> CmdResult<Vec<ActivityEntry>> {
    let conn = state.0.lock().map_err(err)?;
    query_activity(&conn, &filter).map_err(err)
}

/// Renames a company in place, keeping its id — so every record already
/// linked to it stays linked. Refuses if another company already has the
/// name (that is a merge, which the Merge dialog handles).
pub fn rename_company_row(conn: &Connection, id: i64, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Company name can't be empty".into());
    }
    let clash: Option<i64> = conn
        .query_row("SELECT id FROM companies WHERE name = ?1 AND id != ?2", params![name, id], |r| r.get(0))
        .optional()
        .map_err(err)?;
    if clash.is_some() {
        return Err(format!("A company called \"{name}\" already exists — use Merge to combine them"));
    }
    let old: Option<String> = conn.query_row("SELECT name FROM companies WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(err)?;
    let Some(old) = old else { return Err("Company not found".into()) };
    conn.execute(
        "UPDATE companies SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, crate::commands::now_iso(), id],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM company_aliases WHERE alias = ?1", params![name]).map_err(err)?;
    crate::opportunities::remember_company_alias(conn, id, &old).map_err(err)?;
    // Company notes are linked by id; keep their stored name tidy too.
    conn.execute(
        "UPDATE OR IGNORE company_notes SET company_name = ?1 WHERE company_id = ?2 OR (company_id IS NULL AND company_name = ?3)",
        params![name, id, old],
    )
    .map_err(err)?;
    crate::db::link_company_notes(conn).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn rename_company(state: State<DbState>, id: i64, name: String) -> CmdResult<Company> {
    let conn = state.0.lock().map_err(err)?;
    rename_company_row(&conn, id, &name)?;
    crate::opportunities::read_company(&conn, id).map_err(err)
}

/// Trigger SQL for migration 21. Every trigger is silent while
/// `activity_muted` is set.
pub const ACTIVITY_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS activity (
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL,
  actor          TEXT,
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      INTEGER NOT NULL,
  entity_label   TEXT,
  detail         TEXT,
  company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id     INTEGER,
  opportunity_id INTEGER,
  project_id     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_company ON activity(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_contact ON activity(contact_id);

-- History that already existed before this table.
INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, opportunity_id)
  SELECT COALESCE(a.created_at, o.created_at, ''), a.kind, 'opportunity', a.opportunity_id, o.name, a.detail, o.company_id, a.opportunity_id
  FROM opportunity_activity a JOIN opportunities o ON o.id = a.opportunity_id;
INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, project_id)
  SELECT COALESCE(a.created_at, p.created_at, ''), a.kind, 'project', a.project_id, p.name, a.detail, p.company_id, a.project_id
  FROM project_activity a JOIN projects p ON p.id = a.project_id;
INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  SELECT COALESCE(n.note_date, ''), 'note_added', 'proposal', n.proposal_id, p.client || ' — ' || COALESCE(p.type, 'Proposal'), n.text, p.company_id
  FROM proposal_activity_notes n JOIN proposals p ON p.id = n.proposal_id;

-- Proposals
CREATE TRIGGER IF NOT EXISTS act_proposal_insert AFTER INSERT ON proposals
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'proposal', NEW.id, NEW.client || ' — ' || COALESCE(NEW.type, 'Proposal'), NEW.status, NEW.company_id);
END;
CREATE TRIGGER IF NOT EXISTS act_proposal_status AFTER UPDATE OF status ON proposals
WHEN OLD.status IS NOT NEW.status AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'status_changed', 'proposal', NEW.id, NEW.client || ' — ' || COALESCE(NEW.type, 'Proposal'), COALESCE(OLD.status, '—') || ' → ' || COALESCE(NEW.status, '—'), NEW.company_id);
END;
CREATE TRIGGER IF NOT EXISTS act_proposal_delete AFTER DELETE ON proposals
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'deleted', 'proposal', OLD.id, OLD.client || ' — ' || COALESCE(OLD.type, 'Proposal'), OLD.company_id);
END;
CREATE TRIGGER IF NOT EXISTS act_proposal_note AFTER INSERT ON proposal_activity_notes
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'note_added', 'proposal', p.id, p.client || ' — ' || COALESCE(p.type, 'Proposal'), NEW.text, p.company_id
  FROM proposals p WHERE p.id = NEW.proposal_id;
END;

-- Agreements
CREATE TRIGGER IF NOT EXISTS act_agreement_insert AFTER INSERT ON agreements
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'agreement', NEW.id, COALESCE(NEW.agr_ref, NEW.client || ' agreement'), NEW.status, NEW.company_id);
END;
CREATE TRIGGER IF NOT EXISTS act_agreement_status AFTER UPDATE OF status ON agreements
WHEN OLD.status IS NOT NEW.status AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'status_changed', 'agreement', NEW.id, COALESCE(NEW.agr_ref, NEW.client || ' agreement'), COALESCE(OLD.status, '—') || ' → ' || COALESCE(NEW.status, '—'), NEW.company_id);
END;

-- Contacts
CREATE TRIGGER IF NOT EXISTS act_contact_insert AFTER INSERT ON contacts
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, contact_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'contact', NEW.id, COALESCE(NEW.name, 'Contact'), NEW.role, NEW.company_id, NEW.id);
END;

-- Tasks
CREATE TRIGGER IF NOT EXISTS act_task_insert AFTER INSERT ON todos
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id, project_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'task', NEW.id, NEW.title, NEW.company_id, NEW.project_id);
END;
CREATE TRIGGER IF NOT EXISTS act_task_done AFTER UPDATE OF status ON todos
WHEN NEW.status = 'Done' AND OLD.status IS NOT 'Done' AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id, project_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'completed', 'task', NEW.id, NEW.title, NEW.company_id, NEW.project_id);
END;

-- Notes: created, and "edited" at most once every 30 minutes per note.
CREATE TRIGGER IF NOT EXISTS act_note_insert AFTER INSERT ON notes
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'note', NEW.id, COALESCE(NULLIF(NEW.title, ''), 'Untitled'), NEW.company_id);
END;
CREATE TRIGGER IF NOT EXISTS act_note_edit AFTER UPDATE OF title, content ON notes
WHEN (OLD.title IS NOT NEW.title OR OLD.content IS NOT NEW.content)
  AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
  AND NOT EXISTS (SELECT 1 FROM activity WHERE entity_type = 'note' AND entity_id = NEW.id
                  AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'))
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'updated', 'note', NEW.id, COALESCE(NULLIF(NEW.title, ''), 'Untitled'), NEW.company_id);
END;

-- Meetings
CREATE TRIGGER IF NOT EXISTS act_meeting_insert AFTER INSERT ON meetings
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, opportunity_id, project_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'meeting', NEW.id, NEW.title, NEW.meeting_date, NEW.company_id, NEW.opportunity_id, NEW.project_id);
END;

-- Opportunities and projects already log their own history; mirror it.
CREATE TRIGGER IF NOT EXISTS act_opportunity_log AFTER INSERT ON opportunity_activity
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, opportunity_id)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'), NEW.kind, 'opportunity', o.id, o.name, NEW.detail, o.company_id, o.id
  FROM opportunities o WHERE o.id = NEW.opportunity_id;
END;
CREATE TRIGGER IF NOT EXISTS act_project_log AFTER INSERT ON project_activity
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, project_id)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'), NEW.kind, 'project', p.id, p.name, NEW.detail, p.company_id, p.id
  FROM projects p WHERE p.id = NEW.project_id;
END;

-- Companies
CREATE TRIGGER IF NOT EXISTS act_company_insert AFTER INSERT ON companies
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'company', NEW.id, NEW.name, NEW.id);
END;

-- Several records are linked to their company just after they're inserted;
-- carry the link onto their activity so it shows on the company page.
CREATE TRIGGER IF NOT EXISTS act_link_todo AFTER UPDATE OF company_id ON todos WHEN NEW.company_id IS NOT NULL
BEGIN UPDATE activity SET company_id = NEW.company_id WHERE entity_type = 'task' AND entity_id = NEW.id AND company_id IS NULL; END;
CREATE TRIGGER IF NOT EXISTS act_link_note AFTER UPDATE OF company_id ON notes WHEN NEW.company_id IS NOT NULL
BEGIN UPDATE activity SET company_id = NEW.company_id WHERE entity_type = 'note' AND entity_id = NEW.id AND company_id IS NULL; END;
CREATE TRIGGER IF NOT EXISTS act_link_meeting AFTER UPDATE OF company_id ON meetings WHEN NEW.company_id IS NOT NULL
BEGIN UPDATE activity SET company_id = NEW.company_id WHERE entity_type = 'meeting' AND entity_id = NEW.id AND company_id IS NULL; END;
"#;

// ═══════════════════ Company notes as a dated log ═══════════════════
// A company's notes are entries, not one text box: each is written on a date
// and stays there, so a note from March is still readable after one added in
// September. Entries follow the company by id (schema 32).

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyNoteEntry {
    pub id: i64,
    pub company_id: Option<i64>,
    pub company_name: Option<String>,
    pub body: String,
    /// The note that existed before entries; its real date was never recorded.
    pub is_legacy: bool,
    pub created_at: String,
    pub updated_at: Option<String>,
}

fn row_to_entry(r: &rusqlite::Row) -> rusqlite::Result<CompanyNoteEntry> {
    Ok(CompanyNoteEntry {
        id: r.get(0)?,
        company_id: r.get(1)?,
        company_name: r.get(2)?,
        body: r.get(3)?,
        is_legacy: r.get::<_, i64>(4)? != 0,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

const ENTRY_SELECT: &str =
    "SELECT id, company_id, company_name, body, is_legacy, created_at, updated_at FROM company_note_entries";

/// A company's notes, newest first. Matches by id, and by name as well so a
/// company that was never linked still shows what was written about it.
#[tauri::command]
pub fn company_note_entries(state: State<DbState>, company_id: Option<i64>, company_name: Option<String>) -> CmdResult<Vec<CompanyNoteEntry>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare(&format!(
            "{ENTRY_SELECT} WHERE (?1 IS NOT NULL AND company_id = ?1)
                OR (?2 IS NOT NULL AND company_id IS NULL AND company_name = ?2)
             ORDER BY created_at DESC, id DESC"
        ))
        .map_err(err)?;
    let rows = stmt.query_map(params![company_id, company_name], |r| row_to_entry(r)).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[tauri::command]
pub fn add_company_note_entry(state: State<DbState>, company_id: Option<i64>, company_name: Option<String>, body: String) -> CmdResult<CompanyNoteEntry> {
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("Write something first.".into());
    }
    let conn = state.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO company_note_entries (company_id, company_name, body, is_legacy, created_at) VALUES (?1,?2,?3,0,?4)",
        params![company_id, company_name, body, crate::commands::now_iso()],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    conn.query_row(&format!("{ENTRY_SELECT} WHERE id = ?1"), params![id], |r| row_to_entry(r)).map_err(err)
}

/// Editing an entry keeps its original date and stamps `updated_at`, so the
/// log still says when the note was first written.
#[tauri::command]
pub fn update_company_note_entry(state: State<DbState>, id: i64, body: String) -> CmdResult<CompanyNoteEntry> {
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("A note can't be empty — delete it instead.".into());
    }
    let conn = state.0.lock().map_err(err)?;
    conn.execute(
        "UPDATE company_note_entries SET body = ?1, updated_at = ?2 WHERE id = ?3",
        params![body, crate::commands::now_iso(), id],
    )
    .map_err(err)?;
    conn.query_row(&format!("{ENTRY_SELECT} WHERE id = ?1"), params![id], |r| row_to_entry(r)).map_err(err)
}

#[tauri::command]
pub fn delete_company_note_entry(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM company_note_entries WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

/// Moves a company's notes when it is renamed or merged into another: every
/// entry keeps its own date rather than being concatenated into one blob.
pub fn retarget_company_notes(conn: &Connection, old_name: &str, new_name: &str, new_id: Option<i64>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE company_note_entries SET company_name = ?1, company_id = COALESCE(?2, company_id)
         WHERE company_name = ?3 OR (?2 IS NOT NULL AND company_id = ?2)",
        params![new_name, new_id, old_name],
    )?;
    Ok(())
}

#[tauri::command]
pub fn move_company_note_entries(state: State<DbState>, old_name: String, new_name: String, new_id: Option<i64>) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    retarget_company_notes(&conn, &old_name, &new_name, new_id).map_err(err)
}
