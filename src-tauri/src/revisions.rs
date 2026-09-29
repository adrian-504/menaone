//! Proposal revisions (owner, 29-Sep-2026): a client reviews a sent proposal and
//! asks for a change. The same proposal goes round Drafting → Sent again with a
//! number and a reason, instead of a duplicate under a new SL#. The revision rows
//! travel with the proposal record and are saved with it (whole-record replace,
//! like its notes), so starting a revision — the row, the status and the review
//! reset — is one transaction.

use crate::models::ProposalRevision;
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// Migration 41. `date_sent_to_client` stays the first send; `last_sent_at` is
/// the latest revision's send.
const REVISIONS_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS proposal_revisions (
  id                      INTEGER PRIMARY KEY,
  proposal_id             INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  number                  INTEGER NOT NULL,
  requested_at            TEXT NOT NULL,
  requested_by_contact_id INTEGER,
  reason                  TEXT,
  lines_before_json       TEXT NOT NULL,
  sent_at                 TEXT,
  UNIQUE (proposal_id, number)
);
CREATE INDEX IF NOT EXISTS idx_proposal_revisions_proposal ON proposal_revisions(proposal_id);

-- The timeline says what happened: the client asked for changes, revision n was sent.
CREATE TRIGGER IF NOT EXISTS act_revision_requested AFTER INSERT ON proposal_revisions
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'revision_requested', 'proposal', p.id, p.client || ' — ' || COALESCE(p.type, 'Proposal'),
         'Revision ' || NEW.number || CASE WHEN NEW.reason IS NOT NULL AND NEW.reason <> '' THEN ': ' || NEW.reason ELSE '' END, p.company_id
  FROM proposals p WHERE p.id = NEW.proposal_id;
END;
CREATE TRIGGER IF NOT EXISTS act_revision_sent AFTER UPDATE OF sent_at ON proposal_revisions
WHEN OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'revision_sent', 'proposal', p.id, p.client || ' — ' || COALESCE(p.type, 'Proposal'),
         'Revision ' || NEW.number || ' sent', p.company_id
  FROM proposals p WHERE p.id = NEW.proposal_id;
END;

-- A revision's own rows say it; the status change that goes with it would say it twice.
DROP TRIGGER IF EXISTS act_proposal_status;
CREATE TRIGGER act_proposal_status AFTER UPDATE OF status ON proposals
WHEN OLD.status IS NOT NEW.status
  AND NOT (NEW.revision > OLD.revision)
  AND NOT (NEW.last_sent_at IS NOT NULL AND NEW.last_sent_at IS NOT OLD.last_sent_at)
  AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'status_changed', 'proposal', NEW.id, NEW.client || ' — ' || COALESCE(NEW.type, 'Proposal'), COALESCE(OLD.status, '—') || ' → ' || COALESCE(NEW.status, '—'), NEW.company_id);
END;
"#;

pub fn migrate_proposal_revisions(conn: &Connection) -> rusqlite::Result<()> {
    if !crate::db::column_exists(conn, "proposals", "revision")? {
        conn.execute("ALTER TABLE proposals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1", [])?;
    }
    if !crate::db::column_exists(conn, "proposals", "last_sent_at")? {
        conn.execute("ALTER TABLE proposals ADD COLUMN last_sent_at TEXT", [])?;
    }
    conn.execute_batch(REVISIONS_MIGRATION)?;
    crate::db::add_sync_columns_to(conn, &["proposal_revisions"])
}

/// Every proposal's revisions, oldest first.
pub fn read_revisions(conn: &Connection) -> rusqlite::Result<HashMap<i64, Vec<ProposalRevision>>> {
    let mut stmt = conn.prepare(
        "SELECT proposal_id, id, number, requested_at, requested_by_contact_id, reason, lines_before_json, sent_at
         FROM proposal_revisions ORDER BY proposal_id, number",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, ProposalRevision {
            id: r.get(1)?, number: r.get(2)?, requested_at: r.get(3)?, requested_by_contact_id: r.get(4)?,
            reason: r.get(5)?, lines_before_json: r.get(6)?, sent_at: r.get(7)?,
        }))
    })?;
    let mut out: HashMap<i64, Vec<ProposalRevision>> = HashMap::new();
    for row in rows {
        let (pid, rev) = row?;
        out.entry(pid).or_default().push(rev);
    }
    Ok(out)
}

/// The proposal's revisions as the app holds them: the rest removed, these
/// written (an unchanged row is not touched, so its triggers stay quiet).
pub fn save_revisions(tx: &Connection, proposal_id: i64, revisions: &[ProposalRevision]) -> rusqlite::Result<()> {
    let ids: Vec<i64> = revisions.iter().map(|r| r.id).collect();
    tx.execute(
        "DELETE FROM proposal_revisions WHERE proposal_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))",
        params![proposal_id, serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())],
    )?;
    let mut stmt = tx.prepare_cached(
        "INSERT INTO proposal_revisions (id, proposal_id, number, requested_at, requested_by_contact_id, reason, lines_before_json, sent_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET proposal_id = excluded.proposal_id, number = excluded.number, requested_at = excluded.requested_at,
           requested_by_contact_id = excluded.requested_by_contact_id, reason = excluded.reason,
           lines_before_json = excluded.lines_before_json, sent_at = excluded.sent_at
         WHERE proposal_revisions.number IS NOT excluded.number OR proposal_revisions.requested_at IS NOT excluded.requested_at
           OR proposal_revisions.requested_by_contact_id IS NOT excluded.requested_by_contact_id OR proposal_revisions.reason IS NOT excluded.reason
           OR proposal_revisions.lines_before_json IS NOT excluded.lines_before_json OR proposal_revisions.sent_at IS NOT excluded.sent_at
           OR proposal_revisions.proposal_id IS NOT excluded.proposal_id",
    )?;
    for r in revisions {
        stmt.execute(params![r.id, proposal_id, r.number, r.requested_at, r.requested_by_contact_id, r.reason, r.lines_before_json, r.sent_at])?;
    }
    Ok(())
}
