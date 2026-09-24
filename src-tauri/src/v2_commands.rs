use crate::db::DbState;
use crate::v2_models::*;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ═══════════════════════════ AREAS ═══════════════════════════

#[tauri::command]
pub fn get_areas(state: State<DbState>) -> CmdResult<Vec<Area>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare("SELECT id, name, sort_order FROM areas ORDER BY sort_order, name").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(Area { id: r.get(0)?, name: r.get(1)?, sort_order: r.get(2)? }))
        .map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub fn save_area(state: State<DbState>, name: String) -> CmdResult<Area> {
    let conn = state.0.lock().map_err(err)?;
    let sort_order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM areas", [], |r| r.get(0)).map_err(err)?;
    conn.execute("INSERT OR IGNORE INTO areas (name, sort_order) VALUES (?1, ?2)", params![name, sort_order]).map_err(err)?;
    let id: i64 = conn.query_row("SELECT id FROM areas WHERE name = ?1", params![name], |r| r.get(0)).map_err(err)?;
    Ok(Area { id, name, sort_order: Some(sort_order) })
}

#[tauri::command]
pub fn delete_area(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM areas WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ═══════════════════════════ PROJECTS ═══════════════════════════

fn hydrate_project(conn: &Connection, mut p: Project) -> rusqlite::Result<Project> {
    let mut tstmt = conn.prepare_cached(
        "SELECT COUNT(*), SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) FROM todos WHERE project_id = ?1",
    )?;
    let (total, done): (i64, i64) = tstmt.query_row(params![p.id], |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))))?;
    p.task_count = total;
    p.task_done_count = done;
    p.computed_progress = match p.progress_override {
        Some(v) => v,
        None => if total > 0 { (done * 100) / total } else { 0 },
    };
    let mut tagstmt = conn.prepare_cached("SELECT tag FROM entity_tags WHERE entity_type = 'project' AND entity_id = ?1 ORDER BY tag")?;
    p.tags = tagstmt.query_map(params![p.id], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(p)
}

fn row_to_project(r: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        r#type: r.get(2)?,
        status: r.get(3)?,
        priority: r.get(4)?,
        owner: r.get(5)?,
        description: r.get(6)?,
        company_name: r.get(7)?,
        company_id: r.get(8)?,
        area_id: r.get(9)?,
        start_date: r.get(10)?,
        target_date: r.get(11)?,
        completion_date: r.get(12)?,
        progress_override: r.get(13)?,
        archived: r.get::<_, i64>(14)? != 0,
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
        tags: Vec::new(),
        task_count: 0,
        task_done_count: 0,
        computed_progress: 0,
    })
}

const PROJECT_COLUMNS: &str = "id, name, type, status, priority, owner, description, company_name, company_id, area_id, start_date, target_date, completion_date, progress_override, archived, created_at, updated_at";

#[tauri::command]
pub fn get_projects(state: State<DbState>, include_archived: bool) -> CmdResult<Vec<Project>> {
    let conn = state.0.lock().map_err(err)?;
    read_projects(&conn, include_archived).map_err(err)
}

/// Read by the command above and by the phone snapshot's opt-in size check.
pub fn read_projects(conn: &Connection, include_archived: bool) -> rusqlite::Result<Vec<Project>> {
    let sql = format!(
        "SELECT {PROJECT_COLUMNS} FROM projects {} ORDER BY updated_at DESC, id DESC",
        if include_archived { "" } else { "WHERE archived = 0" }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_project)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(hydrate_project(conn, row?)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_project(state: State<DbState>, id: i64) -> CmdResult<Option<Project>> {
    let conn = state.0.lock().map_err(err)?;
    let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1");
    let p = conn.query_row(&sql, params![id], row_to_project).optional().map_err(err)?;
    match p {
        Some(p) => Ok(Some(hydrate_project(&conn, p).map_err(err)?)),
        None => Ok(None),
    }
}

fn log_project_activity(tx: &Connection, project_id: i64, kind: &str, detail: Option<&str>) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO project_activity (project_id, kind, detail, created_at) VALUES (?1,?2,?3,?4)",
        params![project_id, kind, detail, crate::commands::now_iso()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn save_project(state: State<DbState>, project: Project) -> CmdResult<Project> {
    let mut conn = state.0.lock().map_err(err)?;
    save_project_row(&mut conn, &project)
}

pub fn save_project_row(conn: &mut Connection, project: &Project) -> CmdResult<Project> {
    let tx = conn.transaction().map_err(err)?;
    let now = crate::commands::now_iso();
    let is_new = project.id == 0;
    let prev_status: Option<String> = if project.id > 0 {
        tx.query_row("SELECT status FROM projects WHERE id = ?1", params![project.id], |r| r.get(0)).optional().map_err(err)?
    } else {
        None
    };
    let prior = crate::opportunities::prior_company(&tx, "projects", Some("company_name"), project.id).map_err(err)?;
    let company_id = crate::opportunities::company_for_save(&tx, prior.as_ref(), project.company_id, project.company_name.as_deref()).map_err(err)?;
    let id = if project.id > 0 {
        tx.execute(
            &format!(
                "UPDATE projects SET name=?2, type=?3, status=?4, priority=?5, owner=?6, owner_id={owner_id}, description=?7,
                    company_name=?8, company_id=?9, area_id=?10, start_date=?11, target_date=?12, completion_date=?13,
                    progress_override=?14, archived=?15, updated_at=?16
                 WHERE id=?1",
                owner_id = crate::identity::owner_id_for_name_sql(6)
            ),
            params![
                project.id, project.name, project.r#type, project.status, project.priority, project.owner,
                project.description, project.company_name, company_id, project.area_id, project.start_date,
                project.target_date, project.completion_date, project.progress_override,
                project.archived as i64, now,
            ],
        ).map_err(err)?;
        project.id
    } else {
        tx.execute(
            &format!(
                "INSERT INTO projects (name, type, status, priority, owner, owner_id, description, company_name, company_id, area_id,
                    start_date, target_date, completion_date, progress_override, archived, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,{owner_id},?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)",
                owner_id = crate::identity::owner_id_for_name_sql(5)
            ),
            params![
                project.name, project.r#type, project.status, project.priority, project.owner,
                project.description, project.company_name, company_id, project.area_id, project.start_date,
                project.target_date, project.completion_date, project.progress_override,
                project.archived as i64, now,
            ],
        ).map_err(err)?;
        tx.last_insert_rowid()
    };
    tx.execute("DELETE FROM entity_tags WHERE entity_type='project' AND entity_id=?1", params![id]).map_err(err)?;
    for tag in &project.tags {
        tx.execute("INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag) VALUES ('project', ?1, ?2)", params![id, tag]).map_err(err)?;
    }

    if is_new {
        log_project_activity(&tx, id, "created", None).map_err(err)?;
    } else if prev_status.as_deref() != Some(project.status.as_str()) {
        let detail = format!("{} → {}", prev_status.unwrap_or_default(), project.status);
        log_project_activity(&tx, id, "status_changed", Some(&detail)).map_err(err)?;
    }

    crate::v2_search::reindex_project(&tx, id).map_err(err)?;
    tx.commit().map_err(err)?;
    let conn2 = &*conn;
    let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1");
    let p = conn2.query_row(&sql, params![id], row_to_project).map_err(err)?;
    hydrate_project(conn2, p).map_err(err)
}

#[tauri::command]
pub fn delete_project(state: State<DbState>, id: i64) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM projects WHERE id = ?1", params![id]).map_err(err)?;
    tx.execute("DELETE FROM project_activity WHERE project_id = ?1", params![id]).map_err(err)?;
    tx.execute("DELETE FROM entity_tags WHERE entity_type='project' AND entity_id=?1", params![id]).map_err(err)?;
    tx.execute("DELETE FROM entity_links WHERE (from_type='project' AND from_id=?1) OR (to_type='project' AND to_id=?1)", params![id]).map_err(err)?;
    tx.execute("DELETE FROM search_index WHERE entity_type='project' AND entity_id=?1", params![id]).map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn get_project_activity(state: State<DbState>, project_id: i64) -> CmdResult<Vec<ProjectActivity>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, kind, detail, created_at FROM project_activity WHERE project_id = ?1 ORDER BY id DESC",
    ).map_err(err)?;
    let rows = stmt.query_map(params![project_id], |r| {
        Ok(ProjectActivity { id: r.get(0)?, project_id: r.get(1)?, kind: r.get(2)?, detail: r.get(3)?, created_at: r.get(4)? })
    }).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

// ═══════════════════════════ MILESTONES ═══════════════════════════

#[tauri::command]
pub fn get_milestones(state: State<DbState>, project_id: i64) -> CmdResult<Vec<Milestone>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, name, description, status, target_date, completion_date, sort_order
         FROM project_milestones WHERE project_id = ?1 ORDER BY sort_order, id",
    ).map_err(err)?;
    let rows = stmt.query_map(params![project_id], |r| Ok(Milestone {
        id: r.get(0)?, project_id: r.get(1)?, name: r.get(2)?, description: r.get(3)?,
        status: r.get(4)?, target_date: r.get(5)?, completion_date: r.get(6)?, sort_order: r.get(7)?,
    })).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Full replace of a project's milestone list — matches the app's existing
/// bulk-save convention for small, per-parent-scoped lists.
#[tauri::command]
pub fn save_milestones(state: State<DbState>, project_id: i64, items: Vec<Milestone>) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let keep: Vec<i64> = items.iter().filter(|m| m.id > 0).map(|m| m.id).collect();
    tx.execute(
        "DELETE FROM project_milestones WHERE project_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))",
        params![project_id, serde_json::to_string(&keep).unwrap_or_else(|_| "[]".into())],
    ).map_err(err)?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO project_milestones (id, project_id, name, description, status, target_date, completion_date, sort_order)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name,
               description = excluded.description, status = excluded.status, target_date = excluded.target_date,
               completion_date = excluded.completion_date, sort_order = excluded.sort_order
             WHERE project_milestones.project_id IS NOT excluded.project_id OR project_milestones.name IS NOT excluded.name
               OR project_milestones.description IS NOT excluded.description OR project_milestones.status IS NOT excluded.status
               OR project_milestones.target_date IS NOT excluded.target_date
               OR project_milestones.completion_date IS NOT excluded.completion_date
               OR project_milestones.sort_order IS NOT excluded.sort_order",
        ).map_err(err)?;
        for (i, m) in items.iter().enumerate() {
            let id = if m.id > 0 { Some(m.id) } else { None };
            stmt.execute(params![id, project_id, m.name, m.description, m.status, m.target_date, m.completion_date, i as i64]).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

// ═══════════════════════════ MEETINGS ═══════════════════════════

/// Outlook sync stores attendees as `[{"name":…,"email":…}]`; plain string
/// lists are accepted too.
pub(crate) fn parse_attendee_emails(json: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else { return Vec::new() };
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string).or_else(|| v.get("email").and_then(|e| e.as_str()).map(str::to_string)))
                .filter(|e| e.contains('@'))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn row_to_meeting(r: &rusqlite::Row) -> rusqlite::Result<Meeting> {
    let attendees_json: Option<String> = r.get(6)?;
    Ok(Meeting {
        id: r.get(0)?, title: r.get(1)?, meeting_date: r.get(2)?, company_name: r.get(3)?, project_id: r.get(4)?,
        note_id: r.get(5)?,
        attendees: attendees_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        agenda: r.get(7)?, discussion: r.get(8)?, decisions: r.get(9)?, action_items: r.get(10)?,
        follow_up: r.get(11)?, next_meeting: r.get(12)?, created_at: r.get(13)?, updated_at: r.get(14)?,
        outlook_event_id: r.get(15)?, start_at: r.get(16)?, end_at: r.get(17)?, organizer: r.get(18)?,
        location: r.get(19)?, is_online_meeting: r.get::<_, i64>(20)? != 0, online_meeting_url: r.get(21)?,
        is_cancelled: r.get::<_, i64>(22)? != 0, source: r.get(23)?, opportunity_id: r.get(24)?,
        company_id: r.get(25)?,
        organizer_email: r.get(26)?,
        attendee_emails: r.get::<_, Option<String>>(27)?.map(|s| parse_attendee_emails(&s)).unwrap_or_default(),
        invite_text: r.get(28)?,
    })
}
pub(crate) const MEETING_SELECT: &str = "SELECT id, title, meeting_date, company_name, project_id, note_id, attendees_json, agenda, discussion, decisions, action_items, follow_up, next_meeting, created_at, updated_at, outlook_event_id, start_at, end_at, organizer, location, is_online_meeting, online_meeting_url, is_cancelled, source, opportunity_id, company_id, organizer_email, attendee_emails_json, invite_text FROM meetings";

#[tauri::command]
pub fn get_meetings(state: State<DbState>) -> CmdResult<Vec<Meeting>> {
    let conn = state.0.lock().map_err(err)?;
    read_meetings(&conn).map_err(err)
}

/// Read by the command above and by the phone snapshot's opt-in size check.
pub fn read_meetings(conn: &Connection) -> rusqlite::Result<Vec<Meeting>> {
    let sql = format!("{MEETING_SELECT} ORDER BY meeting_date DESC, id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_meeting)?;
    rows.collect::<rusqlite::Result<_>>()
}

#[tauri::command]
pub fn save_meeting(state: State<DbState>, meeting: Meeting) -> CmdResult<Meeting> {
    let mut conn = state.0.lock().map_err(err)?;
    save_meeting_row(&mut conn, &meeting)
}

pub fn save_meeting_row(conn: &mut Connection, meeting: &Meeting) -> CmdResult<Meeting> {
    let tx = conn.transaction().map_err(err)?;
    let now = crate::commands::now_iso();
    let prior = crate::opportunities::prior_company(&tx, "meetings", Some("company_name"), meeting.id).map_err(err)?;
    let attendees_json = serde_json::to_string(&meeting.attendees).unwrap_or_else(|_| "[]".into());
    let id = if meeting.id > 0 {
        // Title, date and attendees of an Outlook meeting belong to Outlook: a sync
        // may have changed them since this copy was loaded, so they are only
        // written for meetings made in MENA One (schedule edits go to Outlook).
        tx.execute(
            "UPDATE meetings SET
                title = CASE WHEN outlook_event_id IS NULL THEN ?2 ELSE title END,
                meeting_date = CASE WHEN outlook_event_id IS NULL THEN ?3 ELSE meeting_date END,
                company_name=?4, project_id=?5, note_id=?6,
                attendees_json = CASE WHEN outlook_event_id IS NULL THEN ?7 ELSE attendees_json END,
                agenda=?8, discussion=?9, decisions=?10, action_items=?11, follow_up=?12,
                next_meeting=?13, updated_at=?14, opportunity_id=?15 WHERE id=?1",
            params![meeting.id, meeting.title, meeting.meeting_date, meeting.company_name, meeting.project_id,
                meeting.note_id, attendees_json, meeting.agenda, meeting.discussion, meeting.decisions,
                meeting.action_items, meeting.follow_up, meeting.next_meeting, now, meeting.opportunity_id],
        ).map_err(err)?;
        meeting.id
    } else {
        tx.execute(
            "INSERT INTO meetings (title, meeting_date, company_name, project_id, note_id, attendees_json,
                agenda, discussion, decisions, action_items, follow_up, next_meeting, created_at, updated_at, opportunity_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14)",
            params![meeting.title, meeting.meeting_date, meeting.company_name, meeting.project_id, meeting.note_id,
                attendees_json, meeting.agenda, meeting.discussion, meeting.decisions, meeting.action_items,
                meeting.follow_up, meeting.next_meeting, now, meeting.opportunity_id],
        ).map_err(err)?;
        tx.last_insert_rowid()
    };
    crate::opportunities::link_company(&tx, "meetings", id, prior.as_ref(), meeting.company_id, meeting.company_name.as_deref()).map_err(err)?;
    crate::v2_search::reindex_meeting(&tx, id).map_err(err)?;
    tx.commit().map_err(err)?;
    let conn2 = &*conn;
    let sql = format!("{MEETING_SELECT} WHERE id = ?1");
    conn2.query_row(&sql, params![id], row_to_meeting).map_err(err)
}

#[tauri::command]
pub fn delete_meeting(state: State<DbState>, id: i64) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let has_outlook_event: Option<String> = conn
        .query_row("SELECT outlook_event_id FROM meetings WHERE id = ?1", params![id], |r| r.get(0))
        .optional().map_err(err)?.flatten();
    if has_outlook_event.is_some() {
        return Err("This meeting is synced from Outlook — cancel it instead (which also removes it from Outlook), rather than deleting it locally.".to_string());
    }
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM meetings WHERE id = ?1", params![id]).map_err(err)?;
    tx.execute("DELETE FROM entity_links WHERE (from_type='meeting' AND from_id=?1) OR (to_type='meeting' AND to_id=?1)", params![id]).map_err(err)?;
    tx.execute("DELETE FROM search_index WHERE entity_type='meeting' AND entity_id=?1", params![id]).map_err(err)?;
    tx.commit().map_err(err)
}

// ═══════════════════════════ DOCUMENTS ═══════════════════════════

fn row_to_document(r: &rusqlite::Row) -> rusqlite::Result<DocumentRecord> {
    Ok(DocumentRecord {
        id: r.get(0)?, title: r.get(1)?, link: r.get(2)?, doc_type: r.get(3)?, company_name: r.get(4)?,
        project_id: r.get(5)?, proposal_id: r.get(6)?, agreement_id: r.get(7)?, meeting_id: r.get(8)?,
        note_id: r.get(9)?, created_at: r.get(10)?, opportunity_id: r.get(11)?, company_id: r.get(12)?,
    })
}
const DOC_SELECT: &str = "SELECT id, title, link, doc_type, company_name, project_id, proposal_id, agreement_id, meeting_id, note_id, created_at, opportunity_id, company_id FROM documents";

#[tauri::command]
pub fn get_documents(state: State<DbState>) -> CmdResult<Vec<DocumentRecord>> {
    let conn = state.0.lock().map_err(err)?;
    let sql = format!("{DOC_SELECT} ORDER BY created_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt.query_map([], row_to_document).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[tauri::command]
pub fn save_document(state: State<DbState>, doc: DocumentRecord) -> CmdResult<DocumentRecord> {
    let conn = state.0.lock().map_err(err)?;
    let now = crate::commands::now_iso();
    let prior = crate::opportunities::prior_company(&conn, "documents", Some("company_name"), doc.id).map_err(err)?;
    let id = if doc.id > 0 {
        conn.execute(
            "UPDATE documents SET title=?2, link=?3, doc_type=?4, company_name=?5, project_id=?6,
                proposal_id=?7, agreement_id=?8, meeting_id=?9, note_id=?10, opportunity_id=?11 WHERE id=?1",
            params![doc.id, doc.title, doc.link, doc.doc_type, doc.company_name, doc.project_id,
                doc.proposal_id, doc.agreement_id, doc.meeting_id, doc.note_id, doc.opportunity_id],
        ).map_err(err)?;
        doc.id
    } else {
        conn.execute(
            "INSERT INTO documents (title, link, doc_type, company_name, project_id, proposal_id, agreement_id, meeting_id, note_id, created_at, opportunity_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![doc.title, doc.link, doc.doc_type, doc.company_name, doc.project_id, doc.proposal_id,
                doc.agreement_id, doc.meeting_id, doc.note_id, now, doc.opportunity_id],
        ).map_err(err)?;
        conn.last_insert_rowid()
    };
    crate::opportunities::link_company(&conn, "documents", id, prior.as_ref(), doc.company_id, doc.company_name.as_deref()).map_err(err)?;
    crate::v2_search::reindex_document(&conn, id).map_err(err)?;
    let sql = format!("{DOC_SELECT} WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_document).map_err(err)
}

#[tauri::command]
pub fn delete_document(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id]).map_err(err)?;
    crate::db::remove_orphan_links_of(&conn, "document").map_err(err)?;
    conn.execute("DELETE FROM search_index WHERE entity_type='document' AND entity_id=?1", params![id]).map_err(err)?;
    Ok(())
}

// ═══════════════════════════ ENTITY LINKS (relationships) ═══════════════════════════

#[tauri::command]
pub fn get_links_for(state: State<DbState>, entity_type: String, entity_id: i64) -> CmdResult<Vec<EntityLink>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(
        "SELECT from_type, from_id, to_type, to_id FROM entity_links
         WHERE (from_type = ?1 AND from_id = ?2) OR (to_type = ?1 AND to_id = ?2)",
    ).map_err(err)?;
    let rows = stmt.query_map(params![entity_type, entity_id], |r| {
        Ok(EntityLink { from_type: r.get(0)?, from_id: r.get(1)?, to_type: r.get(2)?, to_id: r.get(3)? })
    }).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Replace the full outgoing link set from one entity (e.g. "this note links to
/// these projects/contacts/tasks"). Incoming links from other entities are untouched.
#[tauri::command]
pub fn set_links_from(state: State<DbState>, from_type: String, from_id: i64, links: Vec<EntityLink>) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let wanted: Vec<String> = links.iter().map(|l| format!("{}:{}", l.to_type, l.to_id)).collect();
    tx.execute(
        "DELETE FROM entity_links WHERE from_type = ?1 AND from_id = ?2
           AND (to_type || ':' || to_id) NOT IN (SELECT value FROM json_each(?3))",
        params![from_type, from_id, serde_json::to_string(&wanted).unwrap_or_else(|_| "[]".into())],
    ).map_err(err)?;
    let now = crate::commands::now_iso();
    for link in &links {
        tx.execute(
            "INSERT OR IGNORE INTO entity_links (from_type, from_id, to_type, to_id, created_at) VALUES (?1,?2,?3,?4,?5)",
            params![from_type, from_id, link.to_type, link.to_id, now],
        ).map_err(err)?;
    }
    tx.commit().map_err(err)
}

// ═══════════════════════════ TAGS ═══════════════════════════

#[tauri::command]
pub fn get_all_tags(state: State<DbState>) -> CmdResult<Vec<String>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare("SELECT DISTINCT tag FROM entity_tags ORDER BY tag").map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[tauri::command]
pub fn set_tags(state: State<DbState>, entity_type: String, entity_id: i64, tags: Vec<String>) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM entity_tags WHERE entity_type = ?1 AND entity_id = ?2", params![entity_type, entity_id]).map_err(err)?;
    for tag in &tags {
        let clean = tag.trim().trim_start_matches('#').to_string();
        if clean.is_empty() { continue; }
        tx.execute("INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag) VALUES (?1,?2,?3)", params![entity_type, entity_id, clean]).map_err(err)?;
    }
    tx.commit().map_err(err)
}

// ═══════════════════════════ NOTE TEMPLATES ═══════════════════════════

#[tauri::command]
pub fn get_note_templates(state: State<DbState>) -> CmdResult<Vec<NoteTemplate>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare("SELECT id, name, content, sort_order FROM note_templates ORDER BY sort_order, name").map_err(err)?;
    let rows = stmt.query_map([], |r| Ok(NoteTemplate { id: r.get(0)?, name: r.get(1)?, content: r.get(2)?, sort_order: r.get(3)? })).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[tauri::command]
pub fn save_note_template(state: State<DbState>, name: String, content: String) -> CmdResult<NoteTemplate> {
    let conn = state.0.lock().map_err(err)?;
    let sort_order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM note_templates", [], |r| r.get(0)).map_err(err)?;
    conn.execute(
        "INSERT INTO note_templates (name, content, sort_order) VALUES (?1,?2,?3)
         ON CONFLICT(name) DO UPDATE SET content = excluded.content",
        params![name, content, sort_order],
    ).map_err(err)?;
    let id: i64 = conn.query_row("SELECT id FROM note_templates WHERE name = ?1", params![name], |r| r.get(0)).map_err(err)?;
    Ok(NoteTemplate { id, name, content, sort_order: Some(sort_order) })
}

#[tauri::command]
pub fn update_note_template(state: State<DbState>, id: i64, name: String, content: String) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute(
        "UPDATE note_templates SET name = ?1, content = ?2 WHERE id = ?3",
        params![name, content, id],
    ).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_note_template(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM note_templates WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ═══════════════════════════ INBOX ═══════════════════════════

#[tauri::command]
pub fn get_inbox_items(state: State<DbState>) -> CmdResult<Vec<InboxItem>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(
        "SELECT id, item_type, content, created_at, processed, converted_to_type, converted_to_id
         FROM inbox_items WHERE processed = 0 ORDER BY created_at DESC",
    ).map_err(err)?;
    let rows = stmt.query_map([], |r| Ok(InboxItem {
        id: r.get(0)?, item_type: r.get(1)?, content: r.get(2)?, created_at: r.get(3)?,
        processed: r.get::<_, i64>(4)? != 0, converted_to_type: r.get(5)?, converted_to_id: r.get(6)?,
    })).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[tauri::command]
pub fn add_inbox_item(state: State<DbState>, item_type: String, content: String) -> CmdResult<InboxItem> {
    let conn = state.0.lock().map_err(err)?;
    let now = crate::commands::now_iso();
    conn.execute(
        "INSERT INTO inbox_items (item_type, content, created_at, processed) VALUES (?1,?2,?3,0)",
        params![item_type, content, now],
    ).map_err(err)?;
    let id = conn.last_insert_rowid();
    Ok(InboxItem { id, item_type, content, created_at: Some(now), processed: false, converted_to_type: None, converted_to_id: None })
}

#[tauri::command]
pub fn resolve_inbox_item(state: State<DbState>, id: i64, converted_to_type: Option<String>, converted_to_id: Option<i64>) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute(
        "UPDATE inbox_items SET processed = 1, converted_to_type = ?2, converted_to_id = ?3 WHERE id = ?1",
        params![id, converted_to_type, converted_to_id],
    ).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_inbox_item(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM inbox_items WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ═══════════════════════════ SEARCH ═══════════════════════════

#[tauri::command]
pub fn search_workspace(state: State<DbState>, query: String) -> CmdResult<Vec<SearchResult>> {
    let conn = state.0.lock().map_err(err)?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    // Sanitize into an FTS5 prefix-match query: quote each token and OR them so
    // partial words (e.g. "globex sau") still match, without exposing raw FTS5 syntax
    // injection from user input (quoting neutralizes special characters).
    let match_expr = query
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ");
    if match_expr.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT entity_type, entity_id, title, snippet(search_index, 3, '', '', '…', 12)
         FROM search_index WHERE search_index MATCH ?1 ORDER BY rank LIMIT 40",
    ).map_err(err)?;
    let rows = stmt.query_map(params![match_expr], |r| {
        Ok(SearchResult { entity_type: r.get(0)?, entity_id: r.get(1)?, title: r.get(2)?, snippet: r.get(3)? })
    }).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Notes that [[wikilink]] *to* the given note — the backlinks panel shown
/// under a note's editor. note_links is rebuilt wholesale on every notes save
/// (see v2_search::rebuild_note_links), so this is a plain read.
#[tauri::command]
pub fn get_note_backlinks(state: State<DbState>, note_id: i64) -> CmdResult<Vec<NoteRef>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title FROM note_links nl
         JOIN notes n ON n.id = nl.source_note_id
         WHERE nl.target_note_id = ?1 ORDER BY n.title",
    ).map_err(err)?;
    let rows = stmt.query_map(params![note_id], |r| {
        Ok(NoteRef { id: r.get(0)?, title: r.get::<_, Option<String>>(1)?.unwrap_or_default() })
    }).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Rebuilds the entire search index from scratch across all entity types.
/// Called once at startup and after bulk imports/restores, where individual
/// per-save reindexing (see v2_search.rs) wouldn't otherwise run.
#[tauri::command]
pub fn rebuild_search_index(state: State<DbState>) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    crate::v2_search::rebuild_all(&tx).map_err(err)?;
    tx.commit().map_err(err)
}

/// For opt-in checks against a copy of a real database (tests/insights_rehearsal.rs).
pub const MEETING_SELECT_PUBLIC: &str = MEETING_SELECT;
pub fn row_to_meeting_public(r: &rusqlite::Row) -> rusqlite::Result<Meeting> {
    row_to_meeting(r)
}
