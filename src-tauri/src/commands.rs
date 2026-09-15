use crate::db::DbState;
use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use tauri::{AppHandle, State};

type CmdResult<T> = Result<T, String>;

fn conn_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Today's date as `YYYY-MM-DD`, matching the date-only convention used
/// throughout the app (mirrors the frontend's `today()` in lib/utils.ts).
/// Used only as a server-side fallback timestamp for V2 entities that are
/// created/updated directly through a single-record command (Project,
/// Meeting, ...) rather than the bulk-array save pattern the V1 entities use
/// (where the frontend always supplies `dateAdded`/`updatedAt` itself).
/// Implemented without a date-library dependency via the standard
/// days-since-epoch civil calendar algorithm (Howard Hinnant's `civil_from_days`).
pub fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86400) as i64;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

// ═══════════════════════════ READ: full snapshot ═══════════════════════════

#[tauri::command]
pub fn get_all_data(state: State<DbState>) -> CmdResult<AppData> {
    let conn = state.0.lock().map_err(conn_err)?;
    read_all_data(&conn).map_err(conn_err)
}

pub fn read_all_data(conn: &Connection) -> rusqlite::Result<AppData> {
    Ok(AppData {
        proposals: read_proposals(conn)?,
        contacts: read_contacts(conn)?,
        agreements: read_agreements(conn)?,
        todos: read_todos(conn)?,
        notes: read_notes(conn)?,
        note_folders: read_note_folders(conn)?,
        contact_lists: read_contact_lists(conn)?,
        company_notes: read_company_notes(conn)?,
        services: crate::commercial::read_services(conn)?,
        business_entities: crate::commercial::read_business_entities(conn)?,
        team_members: crate::commercial::read_team_members(conn)?,
    })
}

fn read_proposals(conn: &Connection) -> rusqlite::Result<Vec<Proposal>> {
    let mut stmt = conn.prepare(
        "SELECT id, client, type, status, sent_date, dbl_signed_date, kickoff_date, finance,
                hubspot, owner, remarks, date_added, monthly_fee, contract_months, win_loss_reason,
                doc_link, archived, archived_at, snoozed_until, date_sent_to_hassan,
                date_sent_to_client, date_signed, company_id, business_entity_id, currency, one_time_fee,
                primary_contact_id, owner_id, reviewer_id, review_status, review_requested_at, reviewed_at,
                review_note, valid_until, folder_path, lead_source
         FROM proposals ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Proposal {
            id: r.get(0)?,
            client: r.get(1)?,
            r#type: r.get(2)?,
            status: r.get(3)?,
            sent_date: r.get(4)?,
            dbl_signed_date: r.get(5)?,
            kickoff_date: r.get(6)?,
            finance: r.get(7)?,
            hubspot: r.get(8)?,
            owner: r.get(9)?,
            remarks: r.get(10)?,
            date_added: r.get(11)?,
            monthly_fee: r.get(12)?,
            contract_months: r.get(13)?,
            win_loss_reason: r.get(14)?,
            doc_link: r.get(15)?,
            archived: r.get::<_, i64>(16)? != 0,
            archived_at: r.get(17)?,
            snoozed_until: r.get(18)?,
            date_sent_to_hassan: r.get(19)?,
            date_sent_to_client: r.get(20)?,
            date_signed: r.get(21)?,
            company_id: r.get(22)?,
            notes: Vec::new(),
            business_entity_id: r.get(23)?,
            currency: r.get(24)?,
            one_time_fee: r.get(25)?,
            primary_contact_id: r.get(26)?,
            owner_id: r.get(27)?,
            reviewer_id: r.get(28)?,
            review_status: r.get(29)?,
            review_requested_at: r.get(30)?,
            reviewed_at: r.get(31)?,
            review_note: r.get(32)?,
            valid_until: r.get(33)?,
            folder_path: r.get(34)?,
            lead_source: r.get(35)?,
            lines: Vec::new(),
            documents: Vec::new(),
        })
    })?;
    let mut proposals: Vec<Proposal> = rows.collect::<rusqlite::Result<_>>()?;

    let mut nstmt = conn.prepare(
        "SELECT id, proposal_id, note_date, text FROM proposal_activity_notes ORDER BY id",
    )?;
    let mut by_proposal: HashMap<i64, Vec<ActivityNote>> = HashMap::new();
    let note_rows = nstmt.query_map([], |r| {
        let pid: i64 = r.get(1)?;
        Ok((
            pid,
            ActivityNote {
                id: r.get(0)?,
                date: r.get(2)?,
                text: r.get(3)?,
            },
        ))
    })?;
    for row in note_rows {
        let (pid, note) = row?;
        by_proposal.entry(pid).or_default().push(note);
    }
    let mut lines = crate::commercial::read_lines(conn, "proposal_lines", "proposal_id")?;
    let mut documents = crate::commercial::read_documents(conn)?;
    for p in proposals.iter_mut() {
        if let Some(notes) = by_proposal.remove(&p.id) {
            p.notes = notes;
        }
        p.lines = lines.remove(&p.id).unwrap_or_default();
        p.documents = documents.remove(&p.id).unwrap_or_default();
    }
    Ok(proposals)
}

fn read_contacts(conn: &Connection) -> rusqlite::Result<Vec<Contact>> {
    let mut stmt = conn.prepare(
        "SELECT id, client_name, name, role, email, phone, whatsapp, service, company_id FROM contacts ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Contact {
            id: r.get(0)?,
            client_name: r.get(1)?,
            name: r.get(2)?,
            role: r.get(3)?,
            email: r.get(4)?,
            phone: r.get(5)?,
            whatsapp: r.get(6)?,
            service: r.get(7)?,
            company_id: r.get(8)?,
            lists: Vec::new(),
        })
    })?;
    let mut contacts: Vec<Contact> = rows.collect::<rusqlite::Result<_>>()?;

    let mut lstmt = conn.prepare("SELECT contact_id, list_name FROM contact_list_members")?;
    let mut by_contact: HashMap<i64, Vec<String>> = HashMap::new();
    let lrows = lstmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in lrows {
        let (cid, name) = row?;
        by_contact.entry(cid).or_default().push(name);
    }
    for c in contacts.iter_mut() {
        if let Some(lists) = by_contact.remove(&c.id) {
            c.lists = lists;
        }
    }
    Ok(contacts)
}

fn read_agreements(conn: &Connection) -> rusqlite::Result<Vec<Agreement>> {
    let mut stmt = conn.prepare(
        "SELECT id, agr_ref, client, type, status, prepared_by, date_prepared, date_sent_to_client,
                date_client_signed, date_mena_signed, date_filed, monthly_fee, contract_months,
                proposal_id, hubspot, doc_link, action_date, remarks, created_at, company_id,
                business_entity_id, currency, start_date, end_date, service_status, auto_renew, notice_days, prepared_by_id
         FROM agreements ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Agreement {
            id: r.get(0)?,
            agr_ref: r.get(1)?,
            client: r.get(2)?,
            r#type: r.get(3)?,
            status: r.get(4)?,
            prepared_by: r.get(5)?,
            date_prepared: r.get(6)?,
            date_sent_to_client: r.get(7)?,
            date_client_signed: r.get(8)?,
            date_mena_signed: r.get(9)?,
            date_filed: r.get(10)?,
            monthly_fee: r.get(11)?,
            contract_months: r.get(12)?,
            proposal_id: r.get(13)?,
            hubspot: r.get(14)?,
            doc_link: r.get(15)?,
            action_date: r.get(16)?,
            remarks: r.get(17)?,
            created_at: r.get(18)?,
            company_id: r.get(19)?,
            business_entity_id: r.get(20)?,
            currency: r.get(21)?,
            start_date: r.get(22)?,
            end_date: r.get(23)?,
            service_status: r.get(24)?,
            auto_renew: r.get::<_, i64>(25)? != 0,
            notice_days: r.get(26)?,
            prepared_by_id: r.get(27)?,
            lines: Vec::new(),
        })
    })?;
    let mut agreements: Vec<Agreement> = rows.collect::<rusqlite::Result<_>>()?;
    let mut lines = crate::commercial::read_lines(conn, "agreement_lines", "agreement_id")?;
    for a in agreements.iter_mut() {
        a.lines = lines.remove(&a.id).unwrap_or_default();
    }
    Ok(agreements)
}

fn read_todos(conn: &Connection) -> rusqlite::Result<Vec<Todo>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, type, client, priority, due_date, status, description, created_at, completed_at,
                project_id, parent_id, area_id, section, sort_order, recurrence_rule, meeting_id, company_id,
                due_time, someday
         FROM todos ORDER BY COALESCE(sort_order, id), id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Todo {
            id: r.get(0)?,
            title: r.get(1)?,
            r#type: r.get(2)?,
            client: r.get(3)?,
            priority: r.get(4)?,
            due_date: r.get(5)?,
            status: r.get(6)?,
            description: r.get(7)?,
            created_at: r.get(8)?,
            completed_at: r.get(9)?,
            project_id: r.get(10)?,
            parent_id: r.get(11)?,
            area_id: r.get(12)?,
            section: r.get(13)?,
            sort_order: r.get(14)?,
            recurrence_rule: r.get(15)?,
            tags: Vec::new(),
            meeting_id: r.get(16)?,
            company_id: r.get(17)?,
            due_time: r.get(18)?,
            someday: r.get::<_, i64>(19)? != 0,
        })
    })?;
    let mut todos: Vec<Todo> = rows.collect::<rusqlite::Result<_>>()?;

    let mut tstmt = conn.prepare("SELECT entity_id, tag FROM entity_tags WHERE entity_type = 'task' ORDER BY tag")?;
    let mut by_todo: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    let trows = tstmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in trows {
        let (id, tag) = row?;
        by_todo.entry(id).or_default().push(tag);
    }
    for t in todos.iter_mut() {
        if let Some(tags) = by_todo.remove(&t.id) {
            t.tags = tags;
        }
    }
    Ok(todos)
}

fn read_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, folder, client_name, tags_json, pinned, created_at, updated_at, company_id
         FROM notes ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        let tags_json: Option<String> = r.get(5)?;
        let tags: Vec<String> = tags_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Ok(Note {
            id: r.get(0)?,
            title: r.get(1)?,
            content: r.get(2)?,
            folder: r.get(3)?,
            client_name: r.get(4)?,
            company_id: r.get(9)?,
            tags,
            pinned: r.get::<_, i64>(6)? != 0,
            created_at: r.get(7)?,
            updated_at: r.get(8)?,
        })
    })?;
    rows.collect()
}

fn read_note_folders(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM note_folders ORDER BY sort_order, name")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

fn read_contact_lists(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM contact_list_defs ORDER BY name")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// note_text has no column default (unlike industries' NOT NULL DEFAULT
/// '[]'), so a row created via write_company_industries alone (before this
/// company ever had a note) could in principle have a NULL note_text — read
/// as Option and default to "" defensively rather than letting the whole
/// get_all_data load fail on one row (this app-crashing case actually
/// happened once from a direct-DB data-population script; write_company_industries
/// now always seeds '' explicitly, but this read stays defensive regardless).
fn read_company_notes(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT company_name, note_text FROM company_notes")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row?;
        map.insert(k, v.unwrap_or_default());
    }
    Ok(map)
}

// ═══════════════════════════ WRITE: replace-all per table ═══════════════════════════
// Mirrors the original app's save*() functions, which always persisted the *entire*
// in-memory array in one shot. Each command runs inside one transaction.

pub fn write_proposals(conn: &mut Connection, items: &[Proposal]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM proposal_activity_notes", [])?;
    tx.execute("DELETE FROM proposals", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO proposals (id, client, type, status, sent_date, dbl_signed_date, kickoff_date,
                finance, hubspot, owner, remarks, date_added, monthly_fee, contract_months, win_loss_reason,
                doc_link, archived, archived_at, snoozed_until, date_sent_to_hassan, date_sent_to_client, date_signed, company_id,
                business_entity_id, currency, one_time_fee, primary_contact_id, owner_id, reviewer_id, review_status,
                review_requested_at, reviewed_at, review_note, valid_until, folder_path, lead_source)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36)",
        )?;
        let mut nstmt = tx.prepare(
            "INSERT INTO proposal_activity_notes (id, proposal_id, note_date, text) VALUES (?1,?2,?3,?4)",
        )?;
        for p in items {
            // Resolved fresh on every save (not trusted from the caller) so
            // company_id can never drift from the free-text `client` the UI
            // actually edits — same server-owns-the-FK convention Opportunity
            // established (opportunities.rs's resolve_company).
            let company_id = crate::opportunities::resolve_company(&tx, Some(&p.client))?;
            stmt.execute(params![
                p.id, p.client, p.r#type, p.status, p.sent_date, p.dbl_signed_date, p.kickoff_date,
                p.finance, p.hubspot, p.owner, p.remarks, p.date_added, p.monthly_fee, p.contract_months,
                p.win_loss_reason, p.doc_link, p.archived as i64, p.archived_at, p.snoozed_until,
                p.date_sent_to_hassan, p.date_sent_to_client, p.date_signed, company_id,
                p.business_entity_id, p.currency, p.one_time_fee, p.primary_contact_id, p.owner_id, p.reviewer_id,
                p.review_status, p.review_requested_at, p.reviewed_at, p.review_note, p.valid_until, p.folder_path, p.lead_source,
            ])?;
            for n in &p.notes {
                nstmt.execute(params![n.id, p.id, n.date, n.text])?;
            }
        }
    }
    for p in items {
        crate::commercial::save_lines(&tx, "proposal_lines", "proposal_id", p.id, &p.lines)?;
        crate::commercial::save_documents(&tx, p.id, &p.documents)?;
        crate::commercial::apply_derived_proposal_totals(&tx, p.id, &p.lines)?;
    }
    for p in items {
        crate::v2_search::reindex_proposal(&tx, p.id)?;
        crate::v2_search::reindex_company(&tx, &p.client)?;
    }
    tx.commit()
}

pub fn write_contacts(conn: &mut Connection, items: &[Contact]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM contact_list_members", [])?;
    tx.execute("DELETE FROM contacts", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO contacts (id, client_name, name, role, email, phone, whatsapp, service, company_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        )?;
        let mut lstmt =
            tx.prepare("INSERT OR IGNORE INTO contact_list_members (contact_id, list_name) VALUES (?1,?2)")?;
        for c in items {
            let company_id = crate::opportunities::resolve_company(&tx, c.client_name.as_deref())?;
            stmt.execute(params![
                c.id, c.client_name, c.name, c.role, c.email, c.phone, c.whatsapp, c.service, company_id
            ])?;
            for list_name in &c.lists {
                tx.execute(
                    "INSERT OR IGNORE INTO contact_list_defs (name) VALUES (?1)",
                    params![list_name],
                )?;
                lstmt.execute(params![c.id, list_name])?;
            }
        }
    }
    for c in items {
        crate::v2_search::reindex_contact(&tx, c.id)?;
    }
    tx.commit()
}

pub fn write_agreements(conn: &mut Connection, items: &[Agreement]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM agreements", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO agreements (id, agr_ref, client, type, status, prepared_by, date_prepared,
                date_sent_to_client, date_client_signed, date_mena_signed, date_filed, monthly_fee,
                contract_months, proposal_id, hubspot, doc_link, action_date, remarks, created_at, company_id,
                business_entity_id, currency, start_date, end_date, service_status, auto_renew, notice_days, prepared_by_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28)",
        )?;
        for a in items {
            let company_id = crate::opportunities::resolve_company(&tx, a.client.as_deref())?;
            stmt.execute(params![
                a.id, a.agr_ref, a.client, a.r#type, a.status, a.prepared_by, a.date_prepared,
                a.date_sent_to_client, a.date_client_signed, a.date_mena_signed, a.date_filed,
                a.monthly_fee, a.contract_months, a.proposal_id, a.hubspot, a.doc_link, a.action_date,
                a.remarks, a.created_at, company_id,
                a.business_entity_id, a.currency, a.start_date, a.end_date, a.service_status, a.auto_renew as i64,
                a.notice_days, a.prepared_by_id,
            ])?;
        }
    }
    for a in items {
        crate::commercial::save_lines(&tx, "agreement_lines", "agreement_id", a.id, &a.lines)?;
        crate::commercial::apply_derived_agreement_totals(&tx, a.id, &a.lines)?;
        crate::v2_search::reindex_agreement(&tx, a.id)?;
    }
    tx.commit()
}

pub fn write_todos(conn: &mut Connection, items: &[Todo]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    // Subtasks (parent_id) self-reference this same table, and insert order isn't
    // guaranteed parent-before-child — defer FK checks to commit time so a bulk
    // replace never spuriously fails on ordering.
    tx.execute("PRAGMA defer_foreign_keys = ON", [])?;
    tx.execute("DELETE FROM todos", [])?;
    tx.execute("DELETE FROM entity_tags WHERE entity_type = 'task'", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO todos (id, title, type, client, priority, due_date, status, description, created_at, completed_at,
                project_id, parent_id, area_id, section, sort_order, recurrence_rule, meeting_id, due_time, someday)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        )?;
        let mut tagstmt = tx.prepare("INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag) VALUES ('task', ?1, ?2)")?;
        for (i, t) in items.iter().enumerate() {
            let sort_order = t.sort_order.unwrap_or(i as i64);
            stmt.execute(params![
                t.id, t.title, t.r#type, t.client, t.priority, t.due_date, t.status, t.description,
                t.created_at, t.completed_at, t.project_id, t.parent_id, t.area_id, t.section,
                sort_order, t.recurrence_rule, t.meeting_id, t.due_time, t.someday as i64,
            ])?;
            for tag in &t.tags {
                tagstmt.execute(params![t.id, tag])?;
            }
        }
    }
    for t in items {
        crate::v2_search::reindex_todo(&tx, t.id)?;
    }
    tx.commit()
}

pub fn write_notes(conn: &mut Connection, items: &[Note]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM notes", [])?;
    tx.execute("DELETE FROM entity_tags WHERE entity_type = 'note'", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO notes (id, title, content, folder, client_name, tags_json, pinned, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        )?;
        let mut tagstmt = tx.prepare("INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag) VALUES ('note', ?1, ?2)")?;
        for n in items {
            let tags_json = serde_json::to_string(&n.tags).unwrap_or_else(|_| "[]".into());
            stmt.execute(params![
                n.id, n.title, n.content, n.folder, n.client_name, tags_json, n.pinned as i64,
                n.created_at, n.updated_at
            ])?;
            for tag in &n.tags {
                tagstmt.execute(params![n.id, tag])?;
            }
        }
    }
    for n in items {
        crate::v2_search::reindex_note(&tx, n.id)?;
    }
    crate::v2_search::rebuild_note_links(&tx)?;
    tx.commit()
}

pub fn write_note_folders(conn: &mut Connection, items: &[String]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    write_note_folders_in(&tx, items)?;
    tx.commit()
}

pub fn write_note_folders_in(tx: &Connection, items: &[String]) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM note_folders", [])?;
    {
        let mut stmt = tx.prepare("INSERT INTO note_folders (name, sort_order) VALUES (?1, ?2)")?;
        for (i, name) in items.iter().enumerate() {
            stmt.execute(params![name, i as i64])?;
        }
    }
    Ok(())
}

pub fn write_contact_lists(conn: &mut Connection, items: &[String]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    write_contact_lists_in(&tx, items)?;
    tx.commit()
}

pub fn write_contact_lists_in(tx: &Connection, items: &[String]) -> rusqlite::Result<()> {
    // Keep existing memberships for lists that still exist; drop memberships of removed lists.
    tx.execute(
        "DELETE FROM contact_list_members WHERE list_name NOT IN (SELECT value FROM json_each(?1))",
        params![serde_json::to_string(items).unwrap_or_else(|_| "[]".into())],
    )?;
    tx.execute("DELETE FROM contact_list_defs", [])?;
    {
        let mut stmt = tx.prepare("INSERT INTO contact_list_defs (name) VALUES (?1)")?;
        for name in items {
            stmt.execute(params![name])?;
        }
    }
    Ok(())
}

/// Was a blind DELETE-then-reinsert — safe while company_notes had only one
/// data column, but that would silently wipe every company's `industries`
/// (added alongside note_text in the same row, migration 13) on every notes
/// save. Upsert-only-note_text instead, so an unrelated column is never
/// touched by this write. Mirrored by write_company_industries below, which
/// does the same for `industries` without touching `note_text`.
pub fn write_company_notes(conn: &mut Connection, items: &HashMap<String, String>) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    write_company_notes_in(&tx, items)?;
    tx.commit()
}

pub fn write_company_notes_in(tx: &Connection, items: &HashMap<String, String>) -> rusqlite::Result<()> {
    tx.execute("UPDATE company_notes SET note_text = NULL", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO company_notes (company_name, note_text) VALUES (?1,?2)
             ON CONFLICT(company_name) DO UPDATE SET note_text = excluded.note_text",
        )?;
        for (k, v) in items {
            stmt.execute(params![k, v])?;
        }
    }
    tx.execute(
        "DELETE FROM company_notes WHERE (note_text IS NULL OR note_text = '') AND (industries IS NULL OR industries = '[]')",
        [],
    )?;
    Ok(())
}

// ═══════════════════════════ WRITE: per-record upsert / delete ═══════════════════════════
// The frontend sends only the records that changed. Whole-table replace (above)
// is kept solely for backup restore/import: deleting a table also fires
// ON DELETE SET NULL/CASCADE on other tables (opportunities.proposal_id,
// meetings.note_id, note_attachments), and would erase any row this device
// hasn't loaded yet.

fn upsert_sql(table: &str, cols: &[&str]) -> String {
    let placeholders = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
    let data_cols: Vec<&&str> = cols.iter().filter(|c| **c != "id").collect();
    let updates = data_cols.iter().map(|c| format!("{c} = excluded.{c}")).collect::<Vec<_>>().join(", ");
    let changed = data_cols.iter().map(|c| format!("{table}.{c} IS NOT excluded.{c}")).collect::<Vec<_>>().join(" OR ");
    format!(
        "INSERT INTO {table} ({}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {updates} WHERE {changed}",
        cols.join(", ")
    )
}

fn ids_json(ids: &[i64]) -> String {
    serde_json::to_string(ids).unwrap_or_else(|_| "[]".into())
}

fn strings_json(items: &[String]) -> String {
    serde_json::to_string(items).unwrap_or_else(|_| "[]".into())
}

const PROPOSAL_COLS: &[&str] = &[
    "id", "client", "type", "status", "sent_date", "dbl_signed_date", "kickoff_date", "finance", "hubspot",
    "owner", "remarks", "date_added", "monthly_fee", "contract_months", "win_loss_reason", "doc_link",
    "archived", "archived_at", "snoozed_until", "date_sent_to_hassan", "date_sent_to_client", "date_signed", "company_id",
    "business_entity_id", "currency", "one_time_fee", "primary_contact_id", "owner_id", "reviewer_id", "review_status",
    "review_requested_at", "reviewed_at", "review_note", "valid_until", "folder_path", "lead_source",
];
const ACTIVITY_NOTE_COLS: &[&str] = &["id", "proposal_id", "note_date", "text"];
const CONTACT_COLS: &[&str] = &["id", "client_name", "name", "role", "email", "phone", "whatsapp", "service", "company_id"];
const AGREEMENT_COLS: &[&str] = &[
    "id", "agr_ref", "client", "type", "status", "prepared_by", "date_prepared", "date_sent_to_client",
    "date_client_signed", "date_mena_signed", "date_filed", "monthly_fee", "contract_months", "proposal_id",
    "hubspot", "doc_link", "action_date", "remarks", "created_at", "company_id",
    "business_entity_id", "currency", "start_date", "end_date", "service_status", "auto_renew", "notice_days", "prepared_by_id",
];
const NOTE_COLS: &[&str] = &["id", "title", "content", "folder", "client_name", "tags_json", "pinned", "created_at", "updated_at"];

pub fn upsert_proposal_rows(conn: &mut Connection, items: &[Proposal]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    upsert_proposal_rows_in(&tx, items)?;
    tx.commit()
}

pub fn upsert_proposal_rows_in(tx: &Connection, items: &[Proposal]) -> rusqlite::Result<()> {
    for p in items {
        let prior = crate::opportunities::prior_company(tx, "proposals", Some("client"), p.id)?;
        let company_id = crate::opportunities::company_for_save(tx, prior.as_ref(), p.company_id, Some(&p.client))?;
        tx.prepare_cached(&upsert_sql("proposals", PROPOSAL_COLS))?.execute(params![
            p.id, p.client, p.r#type, p.status, p.sent_date, p.dbl_signed_date, p.kickoff_date,
            p.finance, p.hubspot, p.owner, p.remarks, p.date_added, p.monthly_fee, p.contract_months,
            p.win_loss_reason, p.doc_link, p.archived as i64, p.archived_at, p.snoozed_until,
            p.date_sent_to_hassan, p.date_sent_to_client, p.date_signed, company_id,
            p.business_entity_id, p.currency, p.one_time_fee, p.primary_contact_id, p.owner_id, p.reviewer_id,
            p.review_status, p.review_requested_at, p.reviewed_at, p.review_note, p.valid_until, p.folder_path, p.lead_source,
        ])?;
        let note_ids: Vec<i64> = p.notes.iter().map(|n| n.id).collect();
        tx.execute(
            "DELETE FROM proposal_activity_notes WHERE proposal_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))",
            params![p.id, ids_json(&note_ids)],
        )?;
        let mut nstmt = tx.prepare_cached(&upsert_sql("proposal_activity_notes", ACTIVITY_NOTE_COLS))?;
        for n in &p.notes {
            nstmt.execute(params![n.id, p.id, n.date, n.text])?;
        }
        drop(nstmt);
        crate::commercial::save_lines(tx, "proposal_lines", "proposal_id", p.id, &p.lines)?;
        crate::commercial::save_documents(tx, p.id, &p.documents)?;
        crate::commercial::apply_derived_proposal_totals(tx, p.id, &p.lines)?;
        crate::v2_search::reindex_proposal(tx, p.id)?;
        crate::v2_search::reindex_company(tx, &p.client)?;
    }
    Ok(())
}

pub fn delete_proposal_rows(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    delete_proposal_rows_in(&tx, ids)?;
    tx.commit()
}

pub fn delete_proposal_rows_in(tx: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM proposals WHERE id IN (SELECT value FROM json_each(?1))", params![ids_json(ids)])?;
    crate::db::remove_orphan_links_of(tx, "proposal")?;
    tx.execute(
        "DELETE FROM search_index WHERE entity_type = 'proposal' AND entity_id IN (SELECT value FROM json_each(?1))",
        params![ids_json(ids)],
    )?;
    Ok(())
}

pub fn upsert_contact_rows(conn: &mut Connection, items: &[Contact]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    upsert_contact_rows_in(&tx, items)?;
    tx.commit()
}

pub fn upsert_contact_rows_in(tx: &Connection, items: &[Contact]) -> rusqlite::Result<()> {
    for c in items {
        let prior = crate::opportunities::prior_company(tx, "contacts", Some("client_name"), c.id)?;
        let company_id = crate::opportunities::company_for_save(tx, prior.as_ref(), c.company_id, c.client_name.as_deref())?;
        tx.prepare_cached(&upsert_sql("contacts", CONTACT_COLS))?.execute(params![
            c.id, c.client_name, c.name, c.role, c.email, c.phone, c.whatsapp, c.service, company_id
        ])?;
        tx.execute(
            "DELETE FROM contact_list_members WHERE contact_id = ?1 AND list_name NOT IN (SELECT value FROM json_each(?2))",
            params![c.id, strings_json(&c.lists)],
        )?;
        for list_name in &c.lists {
            tx.execute("INSERT OR IGNORE INTO contact_list_defs (name) VALUES (?1)", params![list_name])?;
            tx.execute(
                "INSERT OR IGNORE INTO contact_list_members (contact_id, list_name) VALUES (?1,?2)",
                params![c.id, list_name],
            )?;
        }
        crate::v2_search::reindex_contact(tx, c.id)?;
    }
    Ok(())
}

pub fn delete_contact_rows(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    delete_contact_rows_in(&tx, ids)?;
    tx.commit()
}

pub fn delete_contact_rows_in(tx: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM contacts WHERE id IN (SELECT value FROM json_each(?1))", params![ids_json(ids)])?;
    crate::db::remove_orphan_links_of(tx, "contact")?;
    tx.execute(
        "DELETE FROM search_index WHERE entity_type = 'contact' AND entity_id IN (SELECT value FROM json_each(?1))",
        params![ids_json(ids)],
    )?;
    Ok(())
}

pub fn upsert_agreement_rows(conn: &mut Connection, items: &[Agreement]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    upsert_agreement_rows_in(&tx, items)?;
    tx.commit()
}

pub fn upsert_agreement_rows_in(tx: &Connection, items: &[Agreement]) -> rusqlite::Result<()> {
    for a in items {
        let prior = crate::opportunities::prior_company(tx, "agreements", Some("client"), a.id)?;
        let company_id = crate::opportunities::company_for_save(tx, prior.as_ref(), a.company_id, a.client.as_deref())?;
        tx.prepare_cached(&upsert_sql("agreements", AGREEMENT_COLS))?.execute(params![
            a.id, a.agr_ref, a.client, a.r#type, a.status, a.prepared_by, a.date_prepared,
            a.date_sent_to_client, a.date_client_signed, a.date_mena_signed, a.date_filed,
            a.monthly_fee, a.contract_months, a.proposal_id, a.hubspot, a.doc_link, a.action_date,
            a.remarks, a.created_at, company_id,
            a.business_entity_id, a.currency, a.start_date, a.end_date, a.service_status, a.auto_renew as i64,
            a.notice_days, a.prepared_by_id,
        ])?;
        crate::commercial::save_lines(tx, "agreement_lines", "agreement_id", a.id, &a.lines)?;
        crate::commercial::apply_derived_agreement_totals(tx, a.id, &a.lines)?;
        crate::v2_search::reindex_agreement(tx, a.id)?;
    }
    Ok(())
}

pub fn delete_agreement_rows(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    delete_agreement_rows_in(&tx, ids)?;
    tx.commit()
}

pub fn delete_agreement_rows_in(tx: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM agreements WHERE id IN (SELECT value FROM json_each(?1))", params![ids_json(ids)])?;
    crate::db::remove_orphan_links_of(tx, "agreement")?;
    tx.execute(
        "DELETE FROM search_index WHERE entity_type = 'agreement' AND entity_id IN (SELECT value FROM json_each(?1))",
        params![ids_json(ids)],
    )?;
    Ok(())
}

pub fn upsert_todo_rows(conn: &mut Connection, items: &[Todo]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    upsert_todo_rows_in(&tx, items)?;
    tx.commit()
}

pub fn upsert_todo_rows_in(tx: &Connection, items: &[Todo]) -> rusqlite::Result<()> {
    // A new subtask and its new parent can arrive in the same batch in either order.
    tx.execute("PRAGMA defer_foreign_keys = ON", [])?;
    let sql = "INSERT INTO todos (id, title, type, client, priority, due_date, status, description, created_at, completed_at,
                   project_id, parent_id, area_id, section, sort_order, recurrence_rule, meeting_id, due_time, someday)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,
                   COALESCE(?15, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM todos)), ?16, ?17, ?18, ?19)
               ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title, type = excluded.type, client = excluded.client, priority = excluded.priority,
                   due_date = excluded.due_date, status = excluded.status, description = excluded.description,
                   created_at = excluded.created_at, completed_at = excluded.completed_at, project_id = excluded.project_id,
                   parent_id = excluded.parent_id, area_id = excluded.area_id, section = excluded.section,
                   sort_order = COALESCE(?15, todos.sort_order), recurrence_rule = excluded.recurrence_rule,
                   meeting_id = excluded.meeting_id, due_time = excluded.due_time, someday = excluded.someday
               WHERE todos.title IS NOT excluded.title OR todos.type IS NOT excluded.type OR todos.client IS NOT excluded.client
                   OR todos.priority IS NOT excluded.priority OR todos.due_date IS NOT excluded.due_date
                   OR todos.status IS NOT excluded.status OR todos.description IS NOT excluded.description
                   OR todos.created_at IS NOT excluded.created_at OR todos.completed_at IS NOT excluded.completed_at
                   OR todos.project_id IS NOT excluded.project_id OR todos.parent_id IS NOT excluded.parent_id
                   OR todos.area_id IS NOT excluded.area_id OR todos.section IS NOT excluded.section
                   OR todos.sort_order IS NOT COALESCE(?15, todos.sort_order)
                   OR todos.recurrence_rule IS NOT excluded.recurrence_rule OR todos.meeting_id IS NOT excluded.meeting_id
                   OR todos.due_time IS NOT excluded.due_time OR todos.someday IS NOT excluded.someday";
    for t in items {
        let prior = crate::opportunities::prior_company(tx, "todos", Some("client"), t.id)?;
        tx.prepare_cached(sql)?.execute(params![
            t.id, t.title, t.r#type, t.client, t.priority, t.due_date, t.status, t.description,
            t.created_at, t.completed_at, t.project_id, t.parent_id, t.area_id, t.section,
            t.sort_order, t.recurrence_rule, t.meeting_id, t.due_time, t.someday as i64,
        ])?;
        tx.execute(
            "DELETE FROM entity_tags WHERE entity_type = 'task' AND entity_id = ?1 AND tag NOT IN (SELECT value FROM json_each(?2))",
            params![t.id, strings_json(&t.tags)],
        )?;
        for tag in &t.tags {
            tx.execute("INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag) VALUES ('task', ?1, ?2)", params![t.id, tag])?;
        }
        crate::opportunities::link_company(tx, "todos", t.id, prior.as_ref(), t.company_id, t.client.as_deref())?;
        crate::v2_search::reindex_todo(tx, t.id)?;
    }
    Ok(())
}

pub fn delete_todo_rows(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    delete_todo_rows_in(&tx, ids)?;
    tx.commit()
}

pub fn delete_todo_rows_in(tx: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM todos WHERE id IN (SELECT value FROM json_each(?1))", params![ids_json(ids)])?;
    crate::db::remove_orphan_links_of(tx, "task")?;
    // Subtasks go with their parent via ON DELETE CASCADE, so clean up by what's left rather than by the ids given.
    tx.execute("DELETE FROM entity_tags WHERE entity_type = 'task' AND entity_id NOT IN (SELECT id FROM todos)", [])?;
    tx.execute("DELETE FROM search_index WHERE entity_type = 'task' AND entity_id NOT IN (SELECT id FROM todos)", [])?;
    Ok(())
}

pub fn upsert_note_rows(conn: &mut Connection, items: &[Note]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    upsert_note_rows_in(&tx, items)?;
    tx.commit()
}

pub fn upsert_note_rows_in(tx: &Connection, items: &[Note]) -> rusqlite::Result<()> {
    for n in items {
        let prior = crate::opportunities::prior_company(tx, "notes", Some("client_name"), n.id)?;
        let tags_json = strings_json(&n.tags);
        tx.prepare_cached(&upsert_sql("notes", NOTE_COLS))?.execute(params![
            n.id, n.title, n.content, n.folder, n.client_name, tags_json, n.pinned as i64, n.created_at, n.updated_at
        ])?;
        tx.execute(
            "DELETE FROM entity_tags WHERE entity_type = 'note' AND entity_id = ?1 AND tag NOT IN (SELECT value FROM json_each(?2))",
            params![n.id, tags_json],
        )?;
        for tag in &n.tags {
            tx.execute("INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag) VALUES ('note', ?1, ?2)", params![n.id, tag])?;
        }
        crate::opportunities::link_company(tx, "notes", n.id, prior.as_ref(), n.company_id, n.client_name.as_deref())?;
        crate::v2_search::reindex_note(tx, n.id)?;
    }
    crate::v2_search::rebuild_note_links(tx)?;
    Ok(())
}

pub fn delete_note_rows(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    delete_note_rows_in(&tx, ids)?;
    tx.commit()
}

pub fn delete_note_rows_in(tx: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM notes WHERE id IN (SELECT value FROM json_each(?1))", params![ids_json(ids)])?;
    crate::db::remove_orphan_links_of(tx, "note")?;
    tx.execute("DELETE FROM entity_tags WHERE entity_type = 'note' AND entity_id NOT IN (SELECT id FROM notes)", [])?;
    tx.execute("DELETE FROM search_index WHERE entity_type = 'note' AND entity_id NOT IN (SELECT id FROM notes)", [])?;
    crate::v2_search::rebuild_note_links(tx)?;
    Ok(())
}

// ═══════════════════════════ Agreements created from proposals ═══════════════════════════

pub fn proposal_type_to_agreement_type(ptype: Option<&str>) -> &'static str {
    let t = ptype.unwrap_or("").to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if has(&["workforce", "recruit", "manpower", "staffing", "mobiliz", "dedicated"]) { return "Workforce"; }
    if has(&["admin", "payroll", "gosi", "pro", "gm rep"]) { return "Administration"; }
    if has(&["account", "vat", "finance"]) { return "Accountancy"; }
    if has(&["maintenance"]) { return "Company Maintenance"; }
    if has(&["constitution"]) { return "Company Constitution"; }
    if has(&["consult"]) { return "Consultancy"; }
    "Other"
}

/// `CLIE_WF_007_0926`: client prefix, type code, sequence, month+year. The
/// sequence follows the highest existing number for that prefix and type, so
/// deleting an agreement never causes a later reference to repeat.
pub fn next_agreement_ref(conn: &Connection, client: &str, agr_type: &str, date: &str) -> rusqlite::Result<String> {
    let prefix: String = client.chars().filter(|c| c.is_ascii_alphabetic()).take(4).collect::<String>().to_uppercase();
    let code = match agr_type {
        "Workforce" => "WF",
        "Administration" => "ADM",
        "Accountancy" => "ACC",
        "Company Maintenance" => "CM",
        "Company Constitution" => "CC",
        "Consultancy" => "CON",
        _ => "OTH",
    };
    let stem = format!("{prefix}_{code}_");
    let mut stmt = conn.prepare("SELECT agr_ref FROM agreements WHERE agr_ref IS NOT NULL")?;
    let refs = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut max_seq = 0;
    for r in refs {
        let r = r?;
        if let Some(rest) = r.strip_prefix(&stem) {
            if let Some(seq) = rest.split('_').next().and_then(|s| s.parse::<i64>().ok()) {
                max_seq = max_seq.max(seq);
            }
        }
    }
    let month = date.get(5..7).unwrap_or("01");
    let year = date.get(2..4).unwrap_or("00");
    Ok(format!("{stem}{:03}_{month}{year}", max_seq + 1))
}

/// Creates an agreement for every won proposal that has none yet. Safe to
/// run any number of times; returns only the agreements it created.
pub fn create_agreements_from_proposals(conn: &mut Connection) -> rusqlite::Result<Vec<Agreement>> {
    let tx = conn.transaction()?;
    let created_ids = crate::commercial::create_agreements_core(&tx)?;
    tx.commit()?;
    Ok(read_agreements(conn)?.into_iter().filter(|a| created_ids.contains(&a.id)).collect())
}

#[tauri::command]
pub fn sync_agreements_from_proposals(state: State<DbState>) -> CmdResult<Vec<Agreement>> {
    let mut conn = state.0.lock().map_err(conn_err)?;
    create_agreements_from_proposals(&mut conn).map_err(conn_err)
}

pub fn company_links(conn: &Connection, table: &str, ids: &[i64]) -> rusqlite::Result<Vec<RecordCompanyLink>> {
    let mut stmt = conn.prepare(&format!("SELECT id, company_id FROM {table} WHERE id IN (SELECT value FROM json_each(?1))"))?;
    let rows = stmt.query_map(params![ids_json(ids)], |r| Ok(RecordCompanyLink { id: r.get(0)?, company_id: r.get(1)? }))?;
    rows.collect()
}

macro_rules! record_commands {
    ($table:literal, $upsert_cmd:ident, $upsert_fn:ident, $delete_cmd:ident, $delete_fn:ident, $ty:ty) => {
        #[tauri::command]
        pub fn $upsert_cmd(state: State<DbState>, items: Vec<$ty>) -> CmdResult<Vec<RecordCompanyLink>> {
            let mut conn = state.0.lock().map_err(conn_err)?;
            $upsert_fn(&mut conn, &items).map_err(conn_err)?;
            let ids: Vec<i64> = items.iter().map(|i| i.id).collect();
            company_links(&conn, $table, &ids).map_err(conn_err)
        }
        #[tauri::command]
        pub fn $delete_cmd(state: State<DbState>, ids: Vec<i64>) -> CmdResult<()> {
            let mut conn = state.0.lock().map_err(conn_err)?;
            $delete_fn(&mut conn, &ids).map_err(conn_err)
        }
    };
}

record_commands!("proposals", upsert_proposals, upsert_proposal_rows, delete_proposals, delete_proposal_rows, Proposal);
record_commands!("contacts", upsert_contacts, upsert_contact_rows, delete_contacts, delete_contact_rows, Contact);
record_commands!("agreements", upsert_agreements, upsert_agreement_rows, delete_agreements, delete_agreement_rows, Agreement);
record_commands!("todos", upsert_todos, upsert_todo_rows, delete_todos, delete_todo_rows, Todo);
record_commands!("notes", upsert_notes, upsert_note_rows, delete_notes, delete_note_rows, Note);

macro_rules! save_command {
    ($fn_name:ident, $write_fn:ident, $ty:ty) => {
        #[tauri::command]
        pub fn $fn_name(state: State<DbState>, items: Vec<$ty>) -> CmdResult<()> {
            let mut conn = state.0.lock().map_err(conn_err)?;
            $write_fn(&mut conn, &items).map_err(conn_err)
        }
    };
}

save_command!(save_note_folders, write_note_folders, String);
save_command!(save_contact_lists, write_contact_lists, String);

/// Saves one company's notes (empty text clears them). Only that company's
/// row is written — the whole-map `write_company_notes` is for restores.
pub fn save_company_note_row(conn: &Connection, company_name: &str, text: &str) -> rusqlite::Result<()> {
    let name = company_name.trim();
    if name.is_empty() {
        return Ok(());
    }
    if text.trim().is_empty() {
        conn.execute("UPDATE company_notes SET note_text = NULL WHERE company_name = ?1", params![name])?;
        conn.execute(
            "DELETE FROM company_notes WHERE company_name = ?1 AND (industries IS NULL OR industries = '[]')",
            params![name],
        )?;
    } else {
        conn.execute(
            "INSERT INTO company_notes (company_name, note_text) VALUES (?1, ?2)
             ON CONFLICT(company_name) DO UPDATE SET note_text = excluded.note_text",
            params![name, text],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_company_note(state: State<DbState>, company_name: String, text: String) -> CmdResult<()> {
    let conn = state.0.lock().map_err(conn_err)?;
    save_company_note_row(&conn, &company_name, &text).map_err(conn_err)
}

// ═══════════════════════════ Backup / restore ═══════════════════════════

#[tauri::command]
pub fn export_backup_json(state: State<DbState>) -> CmdResult<String> {
    let conn = state.0.lock().map_err(conn_err)?;
    let data = read_all_data(&conn).map_err(conn_err)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(conn_err)?;
    let envelope = serde_json::json!({
        "version": 2,
        "app": "MENA One (Desktop)",
        "exportedAtEpochMs": now.as_millis() as u64,
        "summary": {
            "proposals": data.proposals.len(),
            "contacts": data.contacts.len(),
            "agreements": data.agreements.len(),
            "todos": data.todos.len(),
            "notes": data.notes.len(),
        },
        "data": data,
    });
    serde_json::to_string_pretty(&envelope).map_err(conn_err)
}

/// Exports and "Save as" copies: asks where to save with the system dialog
/// and writes the file there. The page never passes a path, so nothing
/// running in it can write to an arbitrary place on disk.
#[tauri::command]
pub async fn save_text_file_dialog(app: AppHandle, default_name: String, contents: String, extensions: Vec<String>) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let file_name = std::path::Path::new(&default_name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "export.txt".into());
    let extensions: Vec<String> = extensions.into_iter().filter(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric())).collect();
    let (tx, rx) = std::sync::mpsc::channel();
    let mut dialog = app.dialog().file().set_file_name(&file_name);
    if !extensions.is_empty() {
        let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(extensions.join("/").to_uppercase(), &refs);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.map_err(conn_err)?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(conn_err)?;
    std::fs::write(&path, contents).map_err(conn_err)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Restore from this app's own (v2) backup format produced by `export_backup_json`.
#[tauri::command]
pub fn import_backup_json(app: AppHandle, state: State<DbState>, json: String) -> CmdResult<ImportSummary> {
    let parsed: serde_json::Value = serde_json::from_str(&json).map_err(conn_err)?;
    let data_val = parsed.get("data").ok_or("Not a valid MENA One backup file (missing 'data')")?;
    let data: AppData = serde_json::from_value(data_val.clone()).map_err(conn_err)?;

    let mut conn = state.0.lock().map_err(conn_err)?;
    crate::backups::snapshot_before_change(&app, &conn, "restore")?;
    restore_backup_core(&mut conn, &data).map_err(conn_err)?;

    Ok(ImportSummary {
        proposals: data.proposals.len(),
        contacts: data.contacts.len(),
        agreements: data.agreements.len(),
        todos: data.todos.len(),
        notes: data.notes.len(),
        note_folders: data.note_folders.len(),
        contact_lists: data.contact_lists.len(),
        company_notes: data.company_notes.len(),
        warnings: vec![],
    })
}

/// Restores this app's own backup. All or nothing: one transaction, with
/// activity muted. See `restore_records_in` for how records are applied.
pub fn restore_backup_core(conn: &mut Connection, data: &AppData) -> rusqlite::Result<()> {
    crate::activity::with_activity_muted(conn, |conn| {
        let tx = conn.transaction()?;
        restore_records_in(
            &tx, &data.proposals, &data.contacts, &data.agreements, &data.todos, &data.notes,
            &data.note_folders, &data.contact_lists, &data.company_notes,
        )?;
        crate::commercial::restore_setup(&tx, &data.services, &data.business_entities, &data.team_members)?;
        crate::commercial::normalize_commercial_data(&tx)?;
        tx.commit()
    })
}

/// Records in a backup are saved by id, so a record that is still here keeps
/// its global id (uuid) and version history instead of being deleted and
/// re-created; records not in the backup are deleted, leaving tombstones.
#[allow(clippy::too_many_arguments)]
pub fn restore_records_in(
    tx: &Connection, proposals: &[Proposal], contacts: &[Contact], agreements: &[Agreement], todos: &[Todo], notes: &[Note],
    note_folders: &[String], contact_lists: &[String], company_notes: &HashMap<String, String>,
) -> rusqlite::Result<()> {
    fn missing(tx: &Connection, table: &str, keep: Vec<i64>) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = tx.prepare(&format!("SELECT id FROM {table} WHERE id NOT IN (SELECT value FROM json_each(?1))"))?;
        let rows = stmt.query_map(params![ids_json(&keep)], |r| r.get(0))?;
        rows.collect()
    }
    let gone = missing(tx, "agreements", agreements.iter().map(|a| a.id).collect())?;
    delete_agreement_rows_in(tx, &gone)?;
    let gone = missing(tx, "proposals", proposals.iter().map(|p| p.id).collect())?;
    delete_proposal_rows_in(tx, &gone)?;
    let gone = missing(tx, "contacts", contacts.iter().map(|c| c.id).collect())?;
    delete_contact_rows_in(tx, &gone)?;
    let gone = missing(tx, "todos", todos.iter().map(|t| t.id).collect())?;
    delete_todo_rows_in(tx, &gone)?;
    let gone = missing(tx, "notes", notes.iter().map(|n| n.id).collect())?;
    delete_note_rows_in(tx, &gone)?;
    upsert_proposal_rows_in(tx, proposals)?;
    upsert_contact_rows_in(tx, contacts)?;
    upsert_agreement_rows_in(tx, agreements)?;
    upsert_todo_rows_in(tx, todos)?;
    upsert_note_rows_in(tx, notes)?;
    write_note_folders_in(tx, note_folders)?;
    write_contact_lists_in(tx, contact_lists)?;
    write_company_notes_in(tx, company_notes)
}

/// Import the *original HTML app's* localStorage-based backup file
/// (produced by its `backupAllData()` button — `{"version":1,"data":{"menabig_v5":[...],...}}`).
/// This is the primary one-time migration path from the legacy tracker.
#[tauri::command]
pub fn import_legacy_backup_json(app: AppHandle, state: State<DbState>, json: String) -> CmdResult<ImportSummary> {
    let mut conn = state.0.lock().map_err(conn_err)?;
    crate::backups::snapshot_before_change(&app, &conn, "import")?;
    crate::activity::with_activity_muted(&mut conn, |conn| import_legacy_backup_core(conn, &json)).map_err(conn_err)
}

/// Core legacy-import logic, decoupled from Tauri's `State` wrapper so it can be
/// unit-tested directly against a plain `rusqlite::Connection` (see tests/legacy_import.rs).
pub fn import_legacy_backup_core(conn: &mut Connection, json: &str) -> rusqlite::Result<ImportSummary> {
    let parsed: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    let data = parsed.get("data").ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(
            "This does not look like a MENA BIG backup file (missing 'data').".into(),
        )
    })?;

    let mut warnings = Vec::new();

    let proposals = parse_legacy_array::<Proposal>(data, "menabig_v5", &mut warnings);
    let contacts = parse_legacy_array::<Contact>(data, "menabig_contacts_v1", &mut warnings);
    let agreements = parse_legacy_array::<Agreement>(data, "menabig_agreements_v1", &mut warnings);
    let todos = parse_legacy_array::<Todo>(data, "menabig_todos_v1", &mut warnings);
    let notes = parse_legacy_array::<Note>(data, "menabig_notes_v1", &mut warnings);
    let note_folders: Vec<String> = data
        .get("menabig_nfolders_v1")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let contact_lists: Vec<String> = data
        .get("menabig_ct_lists_v1")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let company_notes: HashMap<String, String> = data
        .get("menabig_co_notes")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let tx = conn.transaction()?;
    restore_records_in(&tx, &proposals, &contacts, &agreements, &todos, &notes, &note_folders, &contact_lists, &company_notes)?;
    crate::commercial::normalize_commercial_data(&tx)?;
    tx.commit()?;

    Ok(ImportSummary {
        proposals: proposals.len(),
        contacts: contacts.len(),
        agreements: agreements.len(),
        todos: todos.len(),
        notes: notes.len(),
        note_folders: note_folders.len(),
        contact_lists: contact_lists.len(),
        company_notes: company_notes.len(),
        warnings,
    })
}

fn parse_legacy_array<T: serde::de::DeserializeOwned>(
    data: &serde_json::Value,
    key: &str,
    warnings: &mut Vec<String>,
) -> Vec<T> {
    let Some(raw) = data.get(key) else { return Vec::new() };
    let Some(arr) = raw.as_array() else { return Vec::new() };
    let mut out = Vec::with_capacity(arr.len());
    for (i, item) in arr.iter().enumerate() {
        match serde_json::from_value::<T>(item.clone()) {
            Ok(v) => out.push(v),
            Err(e) => warnings.push(format!("{key}[{i}]: skipped malformed record ({e})")),
        }
    }
    out
}

/// Generic app_meta key/value read — used for one-off flags like the Notes
/// Markdown migration's "already ran" marker (`ms365::commands` has its own
/// private copy of this same pattern for client/tenant id; this public
/// version is for callers outside that module).
#[tauri::command]
pub fn get_app_meta(state: State<DbState>, key: String) -> CmdResult<Option<String>> {
    let conn = state.0.lock().map_err(conn_err)?;
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", [&key], |r| r.get(0))
        .optional()
        .map_err(conn_err)
}

#[tauri::command]
pub fn set_app_meta(state: State<DbState>, key: String, value: String) -> CmdResult<()> {
    let conn = state.0.lock().map_err(conn_err)?;
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    ).map_err(conn_err)?;
    Ok(())
}

#[tauri::command]
pub fn wipe_all_data(app: AppHandle, state: State<DbState>) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(conn_err)?;
    crate::backups::snapshot_before_change(&app, &conn, "wipe")?;
    crate::activity::with_activity_muted(&mut conn, |conn| {
        // One transaction: everything goes, or nothing does.
        let tx = conn.transaction()?;
        restore_records_in(&tx, &[], &[], &[], &[], &[], &[], &[], &HashMap::new())?;
        tx.execute("DELETE FROM saved_lists", [])?;
        tx.execute("DELETE FROM activity", [])?;
        tx.commit()
    })
    .map_err(conn_err)
}
