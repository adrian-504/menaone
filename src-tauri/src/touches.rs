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
}

const SELECT: &str = "SELECT id, company_id, proposal_id, kind, direction, at, subject, contact_id, source, source_id, created_at FROM touches";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Touch> {
    Ok(Touch {
        id: r.get(0)?, company_id: r.get(1)?, proposal_id: r.get(2)?, kind: r.get(3)?, direction: r.get(4)?, at: r.get(5)?,
        subject: r.get(6)?, contact_id: r.get(7)?, source: r.get(8)?, source_id: r.get(9)?, created_at: r.get(10)?,
    })
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
    let direction = match t.kind.as_str() {
        "email_out" | "meeting" => "out",
        "email_in" => "in",
        _ => match t.direction.as_deref() { Some("in") => "in", _ => "out" },
    };
    let company_id = match (t.company_id, t.proposal_id) {
        (Some(c), _) => Some(c),
        (None, Some(p)) => conn.query_row("SELECT company_id FROM proposals WHERE id = ?1", params![p], |r| r.get(0)).unwrap_or(None),
        _ => None,
    };
    conn.execute(
        "INSERT INTO touches (company_id, proposal_id, kind, direction, at, subject, contact_id, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![company_id, t.proposal_id, t.kind, direction, t.at, t.subject, t.contact_id],
    )?;
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), params![conn.last_insert_rowid()], row)
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

/// Undo of a touch logged by mistake.
#[tauri::command]
pub fn touches_delete(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM touches WHERE id = ?1", params![id]).map(|_| ()).map_err(err)
}
