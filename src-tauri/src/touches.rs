//! Follow-up touches (owner, 29-Sep-2026): "I send a proposal, 10 days later I
//! follow up by mail. All the app knows is that I sent the proposal; the counter
//! keeps climbing while in reality I talked to the client." A touch is one
//! contact with the client — an email, a call, a WhatsApp, a meeting — logged in
//! one click from Follow-up or the proposal page. Business metadata only: date,
//! kind, direction, subject, who; never a message body.

use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Migration 42. `source`/`source_id` are kept for a later automatic source;
/// today only 'manual' is written. `direction` says who reached out: a call or
/// a WhatsApp can be ours or the client's (email carries it in its kind).
const TOUCHES_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS touches (
  id          INTEGER PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('email_out','email_in','call','whatsapp','meeting')),
  direction   TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('out','in')),
  at          TEXT NOT NULL,
  subject     TEXT,
  contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('outlook','manual')),
  source_id   TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_touches_source ON touches(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_touches_company ON touches(company_id);
CREATE INDEX IF NOT EXISTS idx_touches_proposal ON touches(proposal_id);
"#;

pub fn migrate_touches(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(TOUCHES_MIGRATION)?;
    if crate::db::column_exists(conn, "touches", "uuid")? {
        return Ok(());
    }
    crate::db::add_sync_columns_to(conn, &["touches"])
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Touch {
    pub id: i64,
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub proposal_id: Option<i64>,
    /// email_out | email_in | call | whatsapp | meeting
    pub kind: String,
    /// out | in
    pub direction: String,
    /// ISO date (or date-time).
    pub at: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub contact_id: Option<i64>,
    pub source: String,
    #[serde(default)]
    pub source_id: Option<String>,
    pub created_at: String,
    /// Who did it (migration 45). None: not recorded — a one-click "Followed up" says nothing more than the day.
    #[serde(default)]
    pub by_member_id: Option<i64>,
    /// One optional line for what was said (kept apart from `subject`, which a synced email uses).
    #[serde(default)]
    pub note: Option<String>,
    /// Shared by the rows written as one entry across several proposals: the entry is edited and deleted as one.
    #[serde(default)]
    pub batch_id: Option<String>,
    /// On a client's reply: "will revert after" this day. The proposal is not due a follow-up until then.
    #[serde(default)]
    pub revert_after: Option<String>,
}

/// What the app sends to log one: kind and direction, the day, and what it is about.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewTouch {
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub proposal_id: Option<i64>,
    pub kind: String,
    #[serde(default)]
    pub direction: Option<String>,
    pub at: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub contact_id: Option<i64>,
    #[serde(default)]
    pub by_member_id: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub batch_id: Option<String>,
    #[serde(default)]
    pub revert_after: Option<String>,
}

/// What the app sends to change an entry afterwards: the day, how and who reached out, who did it, what was said
/// and the "will revert after" day. What it is about (the proposal, the company, the entry it belongs to) stays.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TouchChange {
    pub kind: String,
    #[serde(default)]
    pub direction: Option<String>,
    pub at: String,
    #[serde(default)]
    pub by_member_id: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub revert_after: Option<String>,
}

const SELECT: &str = "SELECT id, company_id, proposal_id, kind, direction, at, subject, contact_id, source, source_id, created_at, by_member_id, note, batch_id, revert_after FROM touches";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Touch> {
    Ok(Touch {
        id: r.get(0)?, company_id: r.get(1)?, proposal_id: r.get(2)?, kind: r.get(3)?, direction: r.get(4)?, at: r.get(5)?,
        subject: r.get(6)?, contact_id: r.get(7)?, source: r.get(8)?, source_id: r.get(9)?, created_at: r.get(10)?,
        by_member_id: r.get(11)?, note: r.get(12)?, batch_id: r.get(13)?, revert_after: r.get(14)?,
    })
}

/// An email's direction is its kind; a meeting we held counts as ours; a call or WhatsApp says who reached out
/// (ours by default).
fn direction_of(kind: &str, direction: Option<&str>) -> &'static str {
    match kind {
        "email_out" | "meeting" => "out",
        "email_in" => "in",
        _ => match direction { Some("in") => "in", _ => "out" },
    }
}

/// Empty text is "not recorded".
fn text(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

pub fn read_touches(conn: &Connection) -> rusqlite::Result<Vec<Touch>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY at, id"))?;
    let rows = stmt.query_map([], row)?;
    rows.collect()
}

/// A proposal's touches, newest first.
pub fn touches_for(conn: &Connection, proposal_id: i64) -> rusqlite::Result<Vec<Touch>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE proposal_id = ?1 ORDER BY at DESC, id DESC"))?;
    let rows = stmt.query_map(params![proposal_id], row)?;
    rows.collect()
}

/// Logs one manual touch. An email's direction is its kind; a meeting we held
/// counts as ours; a call or WhatsApp says who reached out (ours by default).
/// A proposal's company is taken from the proposal when none is given.
pub fn add_touch(conn: &Connection, t: &NewTouch) -> rusqlite::Result<Touch> {
    let direction = direction_of(&t.kind, t.direction.as_deref());
    let company_id = match (t.company_id, t.proposal_id) {
        (Some(c), _) => Some(c),
        (None, Some(p)) => conn.query_row("SELECT company_id FROM proposals WHERE id = ?1", params![p], |r| r.get(0)).unwrap_or(None),
        _ => None,
    };
    // "Will revert after" belongs to a reply from the client only.
    let revert_after = if direction == "in" { text(&t.revert_after) } else { None };
    conn.execute(
        "INSERT INTO touches (company_id, proposal_id, kind, direction, at, subject, contact_id, source, created_at, by_member_id, note, batch_id, revert_after)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual', strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?8, ?9, ?10, ?11)",
        params![company_id, t.proposal_id, t.kind, direction, t.at, t.subject, t.contact_id, t.by_member_id, text(&t.note), text(&t.batch_id), revert_after],
    )?;
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), params![conn.last_insert_rowid()], row)
}

/// Changes one logged entry afterwards (the day, the channel and who reached out, who did it, the line, the
/// "will revert after" day). Only a touch logged by hand can be changed; None when there is no such row.
pub fn update_touch(conn: &Connection, id: i64, c: &TouchChange) -> rusqlite::Result<Option<Touch>> {
    let direction = direction_of(&c.kind, c.direction.as_deref());
    let revert_after = if direction == "in" { text(&c.revert_after) } else { None };
    let n = conn.execute(
        "UPDATE touches SET kind = ?2, direction = ?3, at = ?4, by_member_id = ?5, note = ?6, revert_after = ?7 WHERE id = ?1 AND source = 'manual'",
        params![id, c.kind, direction, c.at, c.by_member_id, text(&c.note), revert_after],
    )?;
    if n == 0 {
        return Ok(None);
    }
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], row).map(Some)
}

#[tauri::command]
pub fn get_touches(state: State<DbState>) -> CmdResult<Vec<Touch>> {
    let conn = state.0.lock().map_err(err)?;
    read_touches(&conn).map_err(err)
}

#[tauri::command]
pub fn touches_add(state: State<DbState>, touch: NewTouch) -> CmdResult<Touch> {
    let conn = state.0.lock().map_err(err)?;
    add_touch(&conn, &touch).map_err(err)
}

#[tauri::command]
pub fn touches_for_proposal(state: State<DbState>, proposal_id: i64) -> CmdResult<Vec<Touch>> {
    let conn = state.0.lock().map_err(err)?;
    touches_for(&conn, proposal_id).map_err(err)
}

/// An entry changed afterwards: the row as saved.
#[tauri::command]
pub fn touches_update(state: State<DbState>, id: i64, change: TouchChange) -> CmdResult<Touch> {
    let conn = state.0.lock().map_err(err)?;
    update_touch(&conn, id, &change).map_err(err)?.ok_or_else(|| "That entry is no longer there.".to_string())
}

/// Undo of a touch logged by mistake.
#[tauri::command]
pub fn touches_delete(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM touches WHERE id = ?1", params![id]).map(|_| ()).map_err(err)
}
