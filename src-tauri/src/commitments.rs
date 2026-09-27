//! Commitments: who promised what to whom, by when. `ours` is something
//! MENA BIG owes the client (it gets a task); `theirs` is something the
//! client owes us (it never does). They are written as `>>` / `<<` lines in
//! meeting notes, notes and quick capture (parsed in src/lib/commitments.ts)
//! or added by hand.
//!
//! The database keeps the rules that must hold whichever way a row changes:
//! - re-saving the same source creates nothing (unique source key);
//! - an `ours` commitment and its task move together: done ⇄ kept, reopened
//!   ⇄ open, due date ⇄ due date (triggers below);
//! - deleting a record a commitment points at unlinks it, never deletes it;
//! - created / kept / dropped go to the activity log.

use crate::db::DbState;
use crate::models::{RecordCompanyLink, Todo};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commitment {
    pub id: i64,
    /// `ours` (we owe it) or `theirs` (they owe it).
    pub direction: String,
    pub text: String,
    /// Who promised it (theirs) or who we promised it to (ours).
    #[serde(default)]
    pub contact_id: Option<i64>,
    #[serde(default)]
    pub due_date: Option<String>,
    /// `open`, `kept` or `dropped`.
    #[serde(default = "open")]
    pub status: String,
    #[serde(default)]
    pub closed_at: Option<String>,
    #[serde(default)]
    pub drop_reason: Option<String>,
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub opportunity_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
    /// `meeting`, `note`, `capture` or `manual`.
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub source_id: Option<i64>,
    /// Normalised text, so re-reading the same source finds it again.
    #[serde(default)]
    pub source_key: Option<String>,
    /// For `ours`: its task.
    #[serde(default)]
    pub todo_id: Option<i64>,
    /// For a promise to send a proposal: that proposal (instead of a task).
    #[serde(default)]
    pub proposal_id: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

fn open() -> String {
    "open".into()
}

pub const COMMITMENTS_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS commitments (
  id             INTEGER PRIMARY KEY,
  direction      TEXT NOT NULL CHECK(direction IN ('ours','theirs')),
  text           TEXT NOT NULL,
  contact_id     INTEGER,
  due_date       TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','kept','dropped')),
  closed_at      TEXT,
  drop_reason    TEXT,
  company_id     INTEGER,
  opportunity_id INTEGER,
  project_id     INTEGER,
  source_type    TEXT,
  source_id      INTEGER,
  source_key     TEXT,
  todo_id        INTEGER,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS commitments_source ON commitments(source_type, source_id, source_key)
  WHERE source_type IS NOT NULL AND source_type != 'manual';
CREATE INDEX IF NOT EXISTS idx_commitments_company ON commitments(company_id, status);
CREATE INDEX IF NOT EXISTS idx_commitments_opportunity ON commitments(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_commitments_project ON commitments(project_id);
CREATE INDEX IF NOT EXISTS idx_commitments_todo ON commitments(todo_id);

ALTER TABLE opportunities ADD COLUMN waiting_on TEXT;
ALTER TABLE opportunities ADD COLUMN waiting_since TEXT;
ALTER TABLE opportunities ADD COLUMN waiting_note TEXT;

-- Activity: created, kept, dropped.
CREATE TRIGGER IF NOT EXISTS act_commitment_insert AFTER INSERT ON commitments
WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, contact_id, opportunity_id, project_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'commitment', NEW.id, NEW.text,
          CASE NEW.direction WHEN 'ours' THEN 'We owe it' ELSE 'They owe it' END,
          NEW.company_id, NEW.contact_id, NEW.opportunity_id, NEW.project_id);
END;
CREATE TRIGGER IF NOT EXISTS act_commitment_status AFTER UPDATE OF status ON commitments
WHEN NEW.status IN ('kept','dropped') AND OLD.status IS NOT NEW.status
  AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id, contact_id, opportunity_id, project_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), NEW.status, 'commitment', NEW.id, NEW.text, NEW.drop_reason,
          NEW.company_id, NEW.contact_id, NEW.opportunity_id, NEW.project_id);
END;

-- A task and its commitment move together. Each update is guarded so the
-- pair settles after one round instead of bouncing between the tables.
CREATE TRIGGER IF NOT EXISTS cm_task_done AFTER UPDATE OF status ON todos
WHEN NEW.status = 'Done' AND OLD.status IS NOT 'Done'
BEGIN
  UPDATE commitments SET status = 'kept', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE todo_id = NEW.id AND status = 'open';
END;
CREATE TRIGGER IF NOT EXISTS cm_task_reopened AFTER UPDATE OF status ON todos
WHEN OLD.status = 'Done' AND NEW.status IS NOT 'Done'
BEGIN
  UPDATE commitments SET status = 'open', closed_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE todo_id = NEW.id AND status = 'kept';
END;
CREATE TRIGGER IF NOT EXISTS cm_task_due AFTER UPDATE OF due_date ON todos
WHEN NEW.due_date IS NOT OLD.due_date
BEGIN
  UPDATE commitments SET due_date = NEW.due_date, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE todo_id = NEW.id AND due_date IS NOT NEW.due_date;
END;
CREATE TRIGGER IF NOT EXISTS cm_kept_task AFTER UPDATE OF status ON commitments
WHEN NEW.todo_id IS NOT NULL AND NEW.status = 'kept' AND OLD.status IS NOT 'kept'
BEGIN
  UPDATE todos SET status = 'Done', completed_at = COALESCE(completed_at, date('now','localtime'))
  WHERE id = NEW.todo_id AND status IS NOT 'Done';
END;
CREATE TRIGGER IF NOT EXISTS cm_reopened_task AFTER UPDATE OF status ON commitments
WHEN NEW.todo_id IS NOT NULL AND NEW.status = 'open' AND OLD.status = 'kept'
BEGIN
  UPDATE todos SET status = 'Pending', completed_at = NULL WHERE id = NEW.todo_id AND status = 'Done';
END;
CREATE TRIGGER IF NOT EXISTS cm_due_task AFTER UPDATE OF due_date ON commitments
WHEN NEW.todo_id IS NOT NULL AND NEW.due_date IS NOT OLD.due_date
BEGIN
  UPDATE todos SET due_date = NEW.due_date WHERE id = NEW.todo_id AND due_date IS NOT NEW.due_date;
END;

-- Deleting what a commitment points at unlinks it; the commitment stays.
CREATE TRIGGER IF NOT EXISTS cm_unlink_task AFTER DELETE ON todos
BEGIN UPDATE commitments SET todo_id = NULL WHERE todo_id = OLD.id; END;
CREATE TRIGGER IF NOT EXISTS cm_unlink_opportunity AFTER DELETE ON opportunities
BEGIN UPDATE commitments SET opportunity_id = NULL WHERE opportunity_id = OLD.id; END;
CREATE TRIGGER IF NOT EXISTS cm_unlink_project AFTER DELETE ON projects
BEGIN UPDATE commitments SET project_id = NULL WHERE project_id = OLD.id; END;
CREATE TRIGGER IF NOT EXISTS cm_unlink_meeting AFTER DELETE ON meetings
BEGIN UPDATE commitments SET source_id = NULL WHERE source_type = 'meeting' AND source_id = OLD.id; END;
CREATE TRIGGER IF NOT EXISTS cm_unlink_note AFTER DELETE ON notes
BEGIN UPDATE commitments SET source_id = NULL WHERE source_type = 'note' AND source_id = OLD.id; END;
CREATE TRIGGER IF NOT EXISTS cm_unlink_contact AFTER DELETE ON contacts
BEGIN UPDATE commitments SET contact_id = NULL WHERE contact_id = OLD.id; END;
CREATE TRIGGER IF NOT EXISTS cm_unlink_company AFTER DELETE ON companies
BEGIN UPDATE commitments SET company_id = NULL WHERE company_id = OLD.id; END;
"#;

/// Migration 39: proposal requests. A proposal records when it was promised and
/// which request it was created with; a promise to send a proposal points at
/// that proposal, and follows it: sent or signed → kept, lost or withdrawn →
/// dropped (the status as the reason). Deleting the proposal unlinks it.
pub const PROPOSAL_REQUESTS_MIGRATION: &str = r#"
CREATE INDEX IF NOT EXISTS idx_proposals_request_group ON proposals(request_group);
CREATE INDEX IF NOT EXISTS idx_commitments_proposal ON commitments(proposal_id);

CREATE TRIGGER IF NOT EXISTS cm_proposal_sent AFTER UPDATE OF status ON proposals
WHEN NEW.status IN ('Sent to Client','Signed by Client','Signed by Both Parties') AND OLD.status IS NOT NEW.status
BEGIN
  UPDATE commitments SET status = 'kept', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE proposal_id = NEW.id AND status = 'open';
END;
CREATE TRIGGER IF NOT EXISTS cm_proposal_closed AFTER UPDATE OF status ON proposals
WHEN NEW.status IN ('Lost','Withdrawn') AND OLD.status IS NOT NEW.status
BEGIN
  UPDATE commitments SET status = 'dropped', drop_reason = NEW.status, closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE proposal_id = NEW.id AND status = 'open';
END;
CREATE TRIGGER IF NOT EXISTS cm_unlink_proposal AFTER DELETE ON proposals
BEGIN UPDATE commitments SET proposal_id = NULL WHERE proposal_id = OLD.id; END;
"#;

pub fn migrate_proposal_requests(conn: &Connection) -> rusqlite::Result<()> {
    // Each column only once: a restored backup may already have them.
    for (table, col, ty) in [("proposals", "promised_by", "TEXT"), ("proposals", "request_group", "TEXT"), ("commitments", "proposal_id", "INTEGER")] {
        if !crate::db::column_exists(conn, table, col)? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {ty};"))?;
        }
    }
    conn.execute_batch(PROPOSAL_REQUESTS_MIGRATION)
}

/// Migration 36: the table, its sync columns, the opportunity waiting fields.
pub fn migrate_commitments(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(COMMITMENTS_MIGRATION)?;
    crate::db::add_sync_columns_to(conn, &["commitments"])
}

const SELECT: &str = "SELECT id, direction, text, contact_id, due_date, status, closed_at, drop_reason, company_id, opportunity_id,
    project_id, source_type, source_id, source_key, todo_id, created_at, updated_at, proposal_id FROM commitments";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Commitment> {
    Ok(Commitment {
        id: r.get(0)?, direction: r.get(1)?, text: r.get(2)?, contact_id: r.get(3)?, due_date: r.get(4)?, status: r.get(5)?,
        closed_at: r.get(6)?, drop_reason: r.get(7)?, company_id: r.get(8)?, opportunity_id: r.get(9)?, project_id: r.get(10)?,
        source_type: r.get(11)?, source_id: r.get(12)?, source_key: r.get(13)?, todo_id: r.get(14)?, created_at: r.get(15)?,
        updated_at: r.get(16)?, proposal_id: r.get(17)?,
    })
}

pub fn read_commitments(conn: &Connection) -> rusqlite::Result<Vec<Commitment>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY id"))?;
    let rows = stmt.query_map([], row)?;
    rows.collect()
}

pub fn get_commitment(conn: &Connection, id: i64) -> rusqlite::Result<Option<Commitment>> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], row).optional()
}

/// Saves commitments by id (edits from the app). Unchanged rows aren't
/// touched, so saving doesn't count as an edit.
pub fn upsert_commitment_rows_in(tx: &Connection, items: &[Commitment]) -> rusqlite::Result<()> {
    let now = crate::commands::now_iso();
    for c in items {
        tx.execute(
            "INSERT INTO commitments (id, direction, text, contact_id, due_date, status, closed_at, drop_reason, company_id,
                opportunity_id, project_id, source_type, source_id, source_key, todo_id, created_at, updated_at, proposal_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,COALESCE(?16,?17),?17,?18)
             ON CONFLICT(id) DO UPDATE SET
               direction = excluded.direction, text = excluded.text, contact_id = excluded.contact_id, due_date = excluded.due_date,
               status = excluded.status, closed_at = excluded.closed_at, drop_reason = excluded.drop_reason,
               company_id = excluded.company_id, opportunity_id = excluded.opportunity_id, project_id = excluded.project_id,
               source_type = excluded.source_type, source_id = excluded.source_id, source_key = excluded.source_key,
               todo_id = excluded.todo_id, proposal_id = excluded.proposal_id, updated_at = excluded.updated_at
             WHERE commitments.direction IS NOT excluded.direction OR commitments.text IS NOT excluded.text
               OR commitments.contact_id IS NOT excluded.contact_id OR commitments.due_date IS NOT excluded.due_date
               OR commitments.status IS NOT excluded.status OR commitments.closed_at IS NOT excluded.closed_at
               OR commitments.drop_reason IS NOT excluded.drop_reason OR commitments.company_id IS NOT excluded.company_id
               OR commitments.opportunity_id IS NOT excluded.opportunity_id OR commitments.project_id IS NOT excluded.project_id
               OR commitments.source_type IS NOT excluded.source_type OR commitments.source_id IS NOT excluded.source_id
               OR commitments.source_key IS NOT excluded.source_key OR commitments.todo_id IS NOT excluded.todo_id
               OR commitments.proposal_id IS NOT excluded.proposal_id",
            params![
                c.id, c.direction, c.text, c.contact_id, c.due_date, c.status, c.closed_at, c.drop_reason, c.company_id,
                c.opportunity_id, c.project_id, c.source_type, c.source_id, c.source_key, c.todo_id, c.created_at, now,
                c.proposal_id,
            ],
        )?;
        crate::v2_search::reindex_commitment(tx, c.id)?;
    }
    Ok(())
}

pub fn upsert_commitment_rows(conn: &mut Connection, items: &[Commitment]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    upsert_commitment_rows_in(&tx, items)?;
    tx.commit()
}

pub fn delete_commitment_rows_in(tx: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let json = serde_json::to_string(ids).unwrap_or_else(|_| "[]".into());
    tx.execute("DELETE FROM commitments WHERE id IN (SELECT value FROM json_each(?1))", params![json])?;
    tx.execute("DELETE FROM search_index WHERE entity_type = 'commitment' AND entity_id IN (SELECT value FROM json_each(?1))", params![json])?;
    Ok(())
}

/// A commitment read from a source (or typed by hand) that may not exist yet.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewCommitment {
    pub direction: String,
    pub text: String,
    #[serde(default)]
    pub contact_id: Option<i64>,
    #[serde(default)]
    pub due_date: Option<String>,
    /// Already ticked in the source (`- [x] >> …`).
    #[serde(default)]
    pub kept: bool,
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub opportunity_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
    /// The meeting its task belongs to, when it came from one.
    #[serde(default)]
    pub meeting_id: Option<i64>,
    pub source_type: String,
    #[serde(default)]
    pub source_id: Option<i64>,
    #[serde(default)]
    pub source_key: Option<String>,
    /// A promise to send a proposal (`>> Proposal for …`, see isProposalCommitment
    /// in src/lib/commitments.ts): with a company it becomes a proposal request
    /// instead of a task.
    #[serde(default)]
    pub proposal: bool,
    /// The keys of every line in the source as it stands now. A proposal request
    /// whose promise line is no longer among them was edited: the edited line
    /// joins that request instead of starting another one.
    #[serde(default)]
    pub live_keys: Vec<String>,
}

/// What `add_commitments` created: the new commitments and their tasks.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddedCommitments {
    pub commitments: Vec<Commitment>,
    pub tasks: Vec<Todo>,
    /// Proposal requests created for promises to send a proposal.
    pub proposals: Vec<crate::models::Proposal>,
}

/// Adds commitments, skipping ones already read from the same source (same
/// source and key). Each new open `ours` commitment gets a task with the
/// same text, due date and context; `theirs` never do.
pub fn add_commitments_in(tx: &Connection, items: &[NewCommitment]) -> rusqlite::Result<AddedCommitments> {
    let now = crate::commands::now_iso();
    let today = chrono_today(tx)?;
    let mut out = AddedCommitments::default();
    // Requests an edited line has already joined in this batch.
    let mut claimed: Vec<i64> = Vec::new();
    for n in items {
        let text = n.text.trim();
        if text.is_empty() || !matches!(n.direction.as_str(), "ours" | "theirs") { continue; }
        let (status, closed_at) = if n.kept { ("kept", Some(now.clone())) } else { ("open", None) };
        let inserted = tx.execute(
            "INSERT INTO commitments (direction, text, contact_id, due_date, status, closed_at, company_id, opportunity_id, project_id,
                source_type, source_id, source_key, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)
             ON CONFLICT(source_type, source_id, source_key) WHERE source_type IS NOT NULL AND source_type != 'manual' DO NOTHING",
            params![n.direction, text, n.contact_id, n.due_date, status, closed_at, n.company_id, n.opportunity_id, n.project_id,
                n.source_type, n.source_id, n.source_key, now],
        )?;
        if inserted == 0 { continue; }
        let id = tx.last_insert_rowid();
        // A promise to send a proposal, with a company: the proposal is the work, not a task.
        if n.proposal && n.direction == "ours" && !n.kept {
            if let Some(cid) = n.company_id {
                let edited = edited_request(tx, n, cid, &claimed)?;
                let request = match edited {
                    Some(pid) => { claimed.push(pid); update_request(tx, pid, text, n.due_date.as_deref())? }
                    None => create_proposal_request(tx, cid, text, n.due_date.as_deref(), n.meeting_id, &today)?,
                };
                if let Some(p) = request {
                    tx.execute("UPDATE commitments SET proposal_id = ?2 WHERE id = ?1", params![id, p.id])?;
                    out.proposals.push(p);
                    crate::v2_search::reindex_commitment(tx, id)?;
                    if let Some(c) = get_commitment(tx, id)? { out.commitments.push(c); }
                    continue;
                }
            }
        }
        if n.direction == "ours" && !n.kept {
            let todo_id: i64 = tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM todos", [], |r| r.get(0))?;
            let client: Option<String> = match n.company_id {
                Some(cid) => tx.query_row("SELECT name FROM companies WHERE id = ?1", params![cid], |r| r.get(0)).optional()?,
                None => None,
            };
            let task = Todo {
                id: todo_id,
                title: text.to_string(),
                r#type: Some(if client.is_some() { "client" } else { "general" }.into()),
                client: client.clone(),
                priority: Some("Medium".into()),
                due_date: n.due_date.clone(),
                status: Some("Pending".into()),
                created_at: Some(today.clone()),
                project_id: n.project_id,
                meeting_id: n.meeting_id,
                company_id: n.company_id,
                opportunity_id: n.opportunity_id,
                ..Default::default()
            };
            crate::commands::upsert_todo_rows_in(tx, std::slice::from_ref(&task))?;
            tx.execute("UPDATE commitments SET todo_id = ?2 WHERE id = ?1", params![id, todo_id])?;
            out.tasks.push(task);
        }
        crate::v2_search::reindex_commitment(tx, id)?;
        if let Some(c) = get_commitment(tx, id)? { out.commitments.push(c); }
    }
    Ok(out)
}

/// Catalogue services named in `text` (whole words, any case), longest first so
/// "Business Setup and Maintenance Package" wins over "Business Setup".
pub fn services_named_in(conn: &Connection, text: &str) -> rusqlite::Result<Vec<String>> {
    let mut names: Vec<String> = conn
        .prepare("SELECT name FROM services WHERE active = 1 AND merged_into IS NULL")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    names.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
    let mut taken: Vec<(usize, usize)> = Vec::new();
    let mut found: Vec<(usize, String)> = Vec::new();
    for name in names {
        let Ok(re) = regex::Regex::new(&format!(r"(?i)(^|[^\p{{L}}\p{{N}}]){}($|[^\p{{L}}\p{{N}}])", regex::escape(&name))) else { continue };
        if let Some(m) = re.find(text) {
            let (s, e) = (m.start(), m.end());
            if taken.iter().any(|(a, b)| s < *b && *a < e) { continue; }
            taken.push((s, e));
            found.push((s, name));
        }
    }
    found.sort();
    Ok(found.into_iter().map(|(_, n)| n).collect())
}

/// The request an edited promise line belongs to: from the same meeting or note,
/// for the same company, still a request or a draft, whose own line is no longer
/// in the source. None for quick capture and hand-written promises.
fn edited_request(tx: &Connection, n: &NewCommitment, company: i64, claimed: &[i64]) -> rusqlite::Result<Option<i64>> {
    let Some(source) = n.source_id else { return Ok(None) };
    if !matches!(n.source_type.as_str(), "meeting" | "note") { return Ok(None); }
    let mut stmt = tx.prepare(
        "SELECT c.proposal_id, c.source_key FROM commitments c JOIN proposals p ON p.id = c.proposal_id
         WHERE c.source_type = ?1 AND c.source_id = ?2 AND p.company_id = ?3
           AND p.status IN ('Proposal Request Received', 'Drafting')
         ORDER BY c.id DESC",
    )?;
    let rows: Vec<(i64, Option<String>)> = stmt.query_map(params![n.source_type, source, company], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    // A request is still in use when any of its lines is live.
    let live = |pid: i64| rows.iter().any(|(p, k)| *p == pid && k.as_deref().is_some_and(|k| n.live_keys.iter().any(|l| l == k)));
    Ok(rows.iter().map(|(p, _)| *p).find(|pid| !claimed.contains(pid) && !live(*pid)))
}

/// An edited line's new date and services on its request.
fn update_request(tx: &Connection, id: i64, text: &str, promised_by: Option<&str>) -> rusqlite::Result<Option<crate::models::Proposal>> {
    let Some(mut p) = crate::commands::read_proposals(tx)?.into_iter().find(|x| x.id == id) else { return Ok(None) };
    if let Some(d) = promised_by { p.promised_by = Some(d.to_string()); }
    let services = services_named_in(tx, text)?;
    if !services.is_empty() && p.lines.is_empty() { p.r#type = Some(services.join(", ")); }
    crate::commands::upsert_proposal_rows_in(tx, std::slice::from_ref(&p))?;
    // With lines the type follows them; services the edit names that have no line
    // yet are added to the type, and the app gives each its line (addNamedServiceLines).
    let have: Vec<String> = p.lines.iter().map(|l| l.service_name.clone()).collect();
    let new: Vec<String> = services.into_iter().filter(|s| !have.contains(s)).collect();
    if !have.is_empty() && !new.is_empty() {
        let names: Vec<String> = have.into_iter().chain(new).collect();
        tx.execute("UPDATE proposals SET type = ?2 WHERE id = ?1", params![id, names.join(", ")])?;
    }
    Ok(crate::commands::read_proposals(tx)?.into_iter().find(|x| x.id == id))
}

/// A proposal request for `company`, as the create form would make one with its
/// defaults: status Request, received today, promised by the promise's date,
/// the services the line names, this device's user as owner, the first reviewer,
/// the KSA entity. Linked to the meeting it came from.
fn create_proposal_request(tx: &Connection, company: i64, text: &str, promised_by: Option<&str>, meeting: Option<i64>, today: &str) -> rusqlite::Result<Option<crate::models::Proposal>> {
    let Some(client) = tx.query_row("SELECT name FROM companies WHERE id = ?1", params![company], |r| r.get::<_, String>(0)).optional()? else {
        return Ok(None);
    };
    let services = services_named_in(tx, text)?;
    let owner = crate::identity::current_user_id(tx)?;
    let owner_name: Option<String> = match owner {
        Some(id) => tx.query_row("SELECT name FROM team_members WHERE id = ?1", params![id], |r| r.get(0)).optional()?,
        None => None,
    };
    let reviewer: Option<i64> = tx
        .query_row("SELECT id FROM team_members WHERE active = 1 AND is_reviewer = 1 ORDER BY name LIMIT 1", [], |r| r.get(0))
        .optional()?;
    let entity: Option<(i64, String)> = tx
        .query_row(
            "SELECT id, currency FROM business_entities WHERE active = 1 ORDER BY (code = 'KSA') DESC, sort_order, id LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let id: i64 = tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM proposals", [], |r| r.get(0))?;
    let p = crate::models::Proposal {
        id,
        client,
        company_id: Some(company),
        r#type: if services.is_empty() { None } else { Some(services.join(", ")) },
        status: "Proposal Request Received".into(),
        date_added: Some(today.to_string()),
        owner: owner_name,
        owner_id: owner,
        reviewer_id: reviewer,
        business_entity_id: entity.as_ref().map(|(id, _)| *id),
        currency: Some(entity.map(|(_, c)| c).unwrap_or_else(|| "SAR".into())),
        promised_by: promised_by.map(str::to_string),
        remarks: Some(format!("From the promise: {text}")),
        ..Default::default()
    };
    crate::commands::upsert_proposal_rows_in(tx, std::slice::from_ref(&p))?;
    if let Some(m) = meeting {
        tx.execute(
            "INSERT OR IGNORE INTO entity_links (from_type, from_id, to_type, to_id, created_at) VALUES ('meeting', ?1, 'proposal', ?2, ?3)",
            params![m, id, crate::commands::now_iso()],
        )?;
    }
    let saved = crate::commands::read_proposals(tx)?.into_iter().find(|x| x.id == id);
    Ok(saved.or(Some(p)))
}

pub fn add_commitments(conn: &mut Connection, items: &[NewCommitment]) -> rusqlite::Result<AddedCommitments> {
    let tx = conn.transaction()?;
    let out = add_commitments_in(&tx, items)?;
    tx.commit()?;
    Ok(out)
}

fn chrono_today(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_commitments(state: State<DbState>) -> CmdResult<Vec<Commitment>> {
    let conn = state.0.lock().map_err(err)?;
    read_commitments(&conn).map_err(err)
}

#[tauri::command]
pub fn commitments_add(state: State<DbState>, items: Vec<NewCommitment>) -> CmdResult<AddedCommitments> {
    let mut conn = state.0.lock().map_err(err)?;
    add_commitments(&mut conn, &items).map_err(err)
}

#[tauri::command]
pub fn upsert_commitments(state: State<DbState>, items: Vec<Commitment>) -> CmdResult<Vec<RecordCompanyLink>> {
    let mut conn = state.0.lock().map_err(err)?;
    upsert_commitment_rows(&mut conn, &items).map_err(err)?;
    let ids: Vec<i64> = items.iter().map(|c| c.id).collect();
    crate::commands::company_links(&conn, "commitments", &ids).map_err(err)
}

#[tauri::command]
pub fn delete_commitments(state: State<DbState>, ids: Vec<i64>) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    delete_commitment_rows_in(&tx, &ids).map_err(err)?;
    tx.commit().map_err(err)
}
