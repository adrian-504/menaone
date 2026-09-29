//! Template emails (owner, 29-Sep-2026): on each company page, pick a template
//! and a contact and get the email ready to copy or open in Outlook. The
//! templates are plain text with placeholders ({first_name}, {company},
//! {services}, {signature}…) filled on the frontend (src/lib/emailTemplates.ts).
//! A row named `_signature` holds the signature; it is not listed as a template.
//! Seeds are business text only: the signature is a placeholder that Ahmad
//! fills in Settings, so no personal details live in the code.

use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub const SIGNATURE_NAME: &str = "_signature";

const MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS email_templates (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
"#;

const INTRO_BODY: &str = "MENA Business Investment Group is a Spanish-founded consultancy with its own licensed entity in Riyadh. For eight years we have been the local team for international companies entering and operating in Saudi Arabia. In practice that means we handle the parts that are hard to do from abroad:\n\n- Setting up and keeping the company compliant, from registration to licences, portals and renewals, so it stays in good standing without a local back office.\n- Employing and paying people in the Kingdom, through payroll and GOSI, visas and government relations, or by hiring staff on our own licence as Employer of Record until you have yours.\n- Finding the right people, from executive search to national staffing that meets Saudization requirements.\n- Advising on labour law, finance and tax, including accounting, VAT and the questions that come up in the first year.\n\nMore than fifty companies have taken this route with us, across construction, energy, technology, industry and professional services, with teams in Riyadh and Barcelona working in your time zone and in the Kingdom's.\n\nIf it would be useful, I would suggest a twenty-minute call to understand {company}'s plans and tell you honestly where we can help and where you will not need us. Would {day_1} or {day_2} suit you?\n\nKind regards,\n{signature}";

/// (name, subject, body) in order; texts approved by Ahmad (29-Sep-2026).
fn seeds() -> Vec<(&'static str, &'static str, String)> {
    vec![
        ("Sending a proposal", "{company} — {services} Proposal",
         "Dear {first_name},\n\nI trust this email finds you well.\n\nPlease find attached the {services} proposal for your kind review and consideration.\n\nPlease do not hesitate to contact us at any time if you have any questions.\n\nLooking forward to hearing back from you.\n\n{signature}".into()),
        ("Following up on a proposal", "Re: {company} — {services} Proposal",
         "Dear {first_name},\n\nI trust this email finds you well.\n\nI just wanted to follow up on the {services} proposal sent on {proposal_date}, and to see whether you have had the chance to review it, or whether a short call would help.\n\nPlease let me know what suits you.\n\n{signature}".into()),
        ("After a call — next steps", "{company} — next steps",
         "Dear {first_name},\n\nThank you for your time on today's call. It was very helpful to learn more about {company}'s current situation and requirements.\n\nAs discussed, please note the following next steps:\n\n1. \n2. \n3. \n\n{signature}".into()),
        ("Sending the NDA", "MENA BIG — Non-Disclosure Agreement",
         "Dear {first_name},\n\nFurther to our discussion, please find attached MENA BIG's Non-Disclosure Agreement for your review and signature.\n\nThe NDA is intended to ensure the confidentiality of any documents, information and materials shared between {company} and MENA BIG.\n\n{signature}".into()),
        ("Thank you for the information", "Re: {company}",
         "Dear {first_name},\n\nThank you for your email and for the information and documents provided.\n\nTo reach accurate conclusions for our assessment and our recommendations for {company}, we would appreciate the following:\n\n- \n- \n\n{signature}".into()),
        ("Introduction · after meeting", "Following our conversation at {where} — MENA BIG in Saudi Arabia",
         format!("Dear {{first_name}},\n\nIt was a pleasure meeting you at {{where}}. You mentioned {{what_they_said}}, and I wanted to follow up while it is fresh.\n\n{INTRO_BODY}")),
        ("Introduction · first contact", "MENA BIG — supporting {company} in Saudi Arabia",
         format!("Dear {{first_name}},\n\nI am writing because {{company}} {{reason_for_writing}}.\n\n{INTRO_BODY}")),
        (SIGNATURE_NAME, "", "{my_name}\n{my_title}\nMENA Business Investment Group\n{email} · {phone}\nwww.mena-big.com".into()),
    ]
}

/// Migration 43: the table and the seeds (by name, so a template already
/// there — edited or re-seeded — is never overwritten).
pub fn migrate_email_templates(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(MIGRATION)?;
    for (i, (name, subject, body)) in seeds().into_iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO email_templates (name, subject, body, sort_order, updated_at)
             VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![name, subject, body, i as i64 + 1],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmailTemplate {
    /// 0 for a new one.
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub updated_at: String,
}

pub fn read_templates(conn: &Connection) -> rusqlite::Result<Vec<EmailTemplate>> {
    let mut stmt = conn.prepare("SELECT id, name, subject, body, sort_order, updated_at FROM email_templates ORDER BY sort_order, id")?;
    let rows = stmt.query_map([], |r| Ok(EmailTemplate { id: r.get(0)?, name: r.get(1)?, subject: r.get(2)?, body: r.get(3)?, sort_order: r.get(4)?, updated_at: r.get(5)? }))?;
    rows.collect()
}

/// Saves one: a new one (id 0) goes last; an existing one keeps its place.
pub fn save_template(conn: &Connection, t: &EmailTemplate) -> rusqlite::Result<EmailTemplate> {
    let name = t.name.trim();
    if name.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName("A template needs a name".into()));
    }
    let id = if t.id > 0 {
        conn.execute(
            "UPDATE email_templates SET name = ?1, subject = ?2, body = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?4",
            params![name, t.subject, t.body, t.id],
        )?;
        t.id
    } else {
        conn.execute(
            "INSERT INTO email_templates (name, subject, body, sort_order, updated_at)
             VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM email_templates), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![name, t.subject, t.body],
        )?;
        conn.last_insert_rowid()
    };
    conn.query_row("SELECT id, name, subject, body, sort_order, updated_at FROM email_templates WHERE id = ?1", params![id],
        |r| Ok(EmailTemplate { id: r.get(0)?, name: r.get(1)?, subject: r.get(2)?, body: r.get(3)?, sort_order: r.get(4)?, updated_at: r.get(5)? }))
}

/// Deletes a template; the signature row stays.
pub fn delete_template(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM email_templates WHERE id = ?1 AND name <> ?2", params![id, SIGNATURE_NAME])?;
    Ok(())
}

#[tauri::command]
pub fn get_email_templates(state: State<DbState>) -> CmdResult<Vec<EmailTemplate>> {
    let conn = state.0.lock().map_err(err)?;
    read_templates(&conn).map_err(err)
}

#[tauri::command]
pub fn save_email_template(state: State<DbState>, template: EmailTemplate) -> CmdResult<EmailTemplate> {
    let conn = state.0.lock().map_err(err)?;
    save_template(&conn, &template).map_err(err)
}

#[tauri::command]
pub fn delete_email_template(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    delete_template(&conn, id).map_err(err)
}
