// Phase 2 — Work Graph & core workflow. The acceptance scenario (company →
// contact → opportunity → proposal → won → project → kickoff meeting → meeting
// note → action item task → completed → Company 360), saved the way the app
// saves it: ids carried from the record the work was started from. Fictional
// names only.
use menabig_tracker_lib::activity::{query_activity, rename_company_row, ActivityFilter};
use menabig_tracker_lib::commands::{read_all_data, upsert_contact_rows, upsert_note_rows, upsert_proposal_rows, upsert_todo_rows};
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::integrity::integrity_report;
use menabig_tracker_lib::models::{Contact, Note, Proposal, Todo};
use menabig_tracker_lib::opportunities::{create_company_named, save_opportunity_row};
use menabig_tracker_lib::v2_commands::{save_meeting_row, save_project_row};
use menabig_tracker_lib::v2_models::{Meeting, Opportunity, Project};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_work_graph_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn company_id(conn: &Connection, table: &str, id: i64) -> Option<i64> {
    conn.query_row(&format!("SELECT company_id FROM {table} WHERE id = ?1"), params![id], |r| r.get(0)).unwrap()
}

fn link(conn: &Connection, from: (&str, i64), to: (&str, i64)) {
    conn.execute(
        "INSERT OR IGNORE INTO entity_links (from_type, from_id, to_type, to_id, created_at) VALUES (?1, ?2, ?3, ?4, '2026-09-15')",
        params![from.0, from.1, to.0, to.1],
    )
    .unwrap();
}

struct Scenario {
    company: i64,
    rival: i64,
    contact: i64,
    opportunity: i64,
    proposal: i64,
    project: i64,
    meeting: i64,
    note: i64,
    task: i64,
}

/// Runs the acceptance scenario. A second company whose name differs only by
/// capitals exists, so anything resolved by name instead of id would be
/// ambiguous and show up as a wrong or missing company.
fn run_scenario(conn: &mut Connection) -> Scenario {
    // 1. Company.
    let company = create_company_named(conn, "Contoso Logistics").unwrap().unwrap();
    conn.execute("INSERT INTO companies (name, created_at) VALUES ('CONTOSO LOGISTICS', '2026-09-15')", []).unwrap();
    let rival: i64 = one(conn, "SELECT id FROM companies WHERE name = 'CONTOSO LOGISTICS'");
    // The company page's name, typed differently by someone: must still be the page's company.
    let typed = "contoso logistics";

    // 2. Contact, created from the company page.
    upsert_contact_rows(conn, &[Contact { id: 1, name: Some("Dana Test".into()), client_name: Some(typed.into()), company_id: Some(company), ..Default::default() }]).unwrap();

    // 3. Opportunity from the company page.
    let opp = save_opportunity_row(conn, &Opportunity {
        name: "Contoso Saudization".into(), company_id: Some(company), company_name: Some(typed.into()), stage: "Lead".into(), status: "Open".into(), ..Default::default()
    }).unwrap();
    link(conn, ("contact", 1), ("opportunity", opp.id));

    // 4. Proposal from the opportunity (inherits company; linked to the opportunity).
    upsert_proposal_rows(conn, &[Proposal { id: 1, client: typed.into(), company_id: Some(company), status: "Drafting".into(), r#type: Some("Saudization".into()), ..Default::default() }]).unwrap();
    let opp = save_opportunity_row(conn, &Opportunity { proposal_id: Some(1), stage: "Proposal".into(), ..opp }).unwrap();

    // 5. Won.
    let opp = save_opportunity_row(conn, &Opportunity { stage: "Won".into(), ..opp }).unwrap();

    // 6. Project from the won opportunity ("Create Project" is an explicit action).
    let project = save_project_row(conn, &Project {
        name: "Contoso Saudization Project".into(), r#type: "client".into(), status: "Planning".into(), priority: "High".into(),
        company_name: Some(typed.into()), company_id: Some(company), ..Default::default()
    }).unwrap();
    let opp = save_opportunity_row(conn, &Opportunity { project_id: Some(project.id), ..opp }).unwrap();

    // 7. Kickoff meeting from the project: company and project.
    let meeting = save_meeting_row(conn, &Meeting {
        title: "Contoso Saudization Kickoff".into(), meeting_date: Some("2026-09-15".into()),
        company_name: Some(typed.into()), company_id: Some(company), project_id: Some(project.id), ..Default::default()
    }).unwrap();

    // 8. Meeting note: company, linked to the project; the meeting points at it.
    upsert_note_rows(conn, &[Note {
        id: 1, title: Some("Contoso Saudization Kickoff — 15 Sep 2026".into()), content: Some("## Action Items\n- [ ] Send revised Saudization model".into()),
        client_name: Some(typed.into()), company_id: Some(company), ..Default::default()
    }]).unwrap();
    link(conn, ("note", 1), ("project", project.id));
    let meeting = save_meeting_row(conn, &Meeting { note_id: Some(1), ..meeting }).unwrap();

    // 9. The action item becomes a task: company, project and meeting; linked to the note.
    upsert_todo_rows(conn, &[Todo {
        id: 1, title: "Send revised Saudization model".into(), r#type: Some("client".into()), client: Some(typed.into()), company_id: Some(company),
        project_id: Some(project.id), meeting_id: Some(meeting.id), status: Some("Pending".into()), priority: Some("Medium".into()), ..Default::default()
    }]).unwrap();
    link(conn, ("task", 1), ("note", 1));

    // 10. Complete it.
    let mut task = read_all_data(conn).unwrap().todos.into_iter().find(|t| t.id == 1).unwrap();
    task.status = Some("Done".into());
    task.completed_at = Some("2026-09-15".into());
    upsert_todo_rows(conn, &[task]).unwrap();

    Scenario { company, rival, contact: 1, opportunity: opp.id, proposal: 1, project: project.id, meeting: meeting.id, note: 1, task: 1 }
}

#[test]
fn acceptance_scenario_links_every_record_by_id_and_persists() {
    let (path, mut conn) = fresh_db("scenario");
    let s = run_scenario(&mut conn);

    // Every record belongs to the company by id — never to the look-alike.
    for (table, id) in [("contacts", s.contact), ("opportunities", s.opportunity), ("proposals", s.proposal), ("projects", s.project), ("meetings", s.meeting), ("notes", s.note), ("todos", s.task)] {
        assert_eq!(company_id(&conn, table, id), Some(s.company), "{table} keeps the company it was created from");
    }
    for table in ["contacts", "opportunities", "proposals", "projects", "meetings", "notes", "todos"] {
        assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM {table} WHERE company_id = {}", s.rival)), 0, "nothing moved to the look-alike company");
    }
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM company_review_queue"), 0, "ids avoided every ambiguity");

    // Reopen: the whole chain is still there.
    drop(conn);
    let conn = init_connection(&path).unwrap();
    let data = read_all_data(&conn).unwrap();
    assert_eq!(one::<Option<i64>>(&conn, &format!("SELECT proposal_id FROM opportunities WHERE id = {}", s.opportunity)), Some(s.proposal));
    assert_eq!(one::<Option<i64>>(&conn, &format!("SELECT project_id FROM opportunities WHERE id = {}", s.opportunity)), Some(s.project));
    assert_eq!(one::<String>(&conn, &format!("SELECT stage FROM opportunities WHERE id = {}", s.opportunity)), "Won");
    let meeting: (Option<i64>, Option<i64>, Option<i64>) = conn
        .query_row("SELECT project_id, note_id, company_id FROM meetings WHERE id = ?1", params![s.meeting], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap();
    assert_eq!(meeting, (Some(s.project), Some(s.note), Some(s.company)));
    let task = data.todos.iter().find(|t| t.id == s.task).unwrap();
    assert_eq!((task.project_id, task.meeting_id, task.company_id, task.status.as_deref()), (Some(s.project), Some(s.meeting), Some(s.company), Some("Done")));
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM entity_links WHERE from_type = 'task' AND from_id = {} AND to_type = 'note' AND to_id = {}", s.task, s.note)), 1);
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM entity_links WHERE from_type = 'note' AND to_type = 'project' AND to_id = {}", s.project)), 1);

    // Company 360: every record is found by the company id.
    for (sql, expected) in [
        (format!("SELECT COUNT(*) FROM contacts WHERE company_id = {}", s.company), 1),
        (format!("SELECT COUNT(*) FROM opportunities WHERE company_id = {}", s.company), 1),
        (format!("SELECT COUNT(*) FROM proposals WHERE company_id = {}", s.company), 1),
        (format!("SELECT COUNT(*) FROM projects WHERE company_id = {}", s.company), 1),
        (format!("SELECT COUNT(*) FROM meetings WHERE company_id = {}", s.company), 1),
        (format!("SELECT COUNT(*) FROM notes WHERE company_id = {}", s.company), 1),
        (format!("SELECT COUNT(*) FROM todos WHERE company_id = {} AND status = 'Done'", s.company), 1),
    ] {
        assert_eq!(one::<i64>(&conn, &sql), expected, "{sql}");
    }
    // Its activity tells the story once per event.
    let activity = query_activity(&conn, &ActivityFilter { company_id: Some(s.company), ..Default::default() }).unwrap();
    let has = |action: &str, entity: &str| activity.iter().filter(|a| a.action == action && a.entity_type == entity).count();
    assert_eq!(has("created", "meeting"), 1);
    assert_eq!(has("created", "note"), 1);
    assert_eq!(has("created", "task"), 1);
    assert_eq!(has("completed", "task"), 1);
    assert!(activity.iter().any(|a| a.entity_type == "opportunity"), "opportunity events: {activity:?}");
    assert_eq!(integrity_report(&conn).unwrap().count("activity recorded twice"), 0);
    let report = integrity_report(&conn).unwrap();
    assert_eq!(report.count("tasks whose opportunity belongs to another company"), 0);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn tasks_belong_to_opportunities_and_mismatches_are_reported_not_fixed() {
    let (path, mut conn) = fresh_db("task-opportunity");
    let s = run_scenario(&mut conn);
    let other = create_company_named(&conn, "Fabrikam").unwrap().unwrap();

    // A task created from the opportunity carries its id and shows in its activity.
    upsert_todo_rows(&mut conn, &[Todo { id: 2, title: "Chase signature".into(), client: Some("Contoso Logistics".into()), company_id: Some(s.company), opportunity_id: Some(s.opportunity), ..Default::default() }]).unwrap();
    let task = read_all_data(&conn).unwrap().todos.into_iter().find(|t| t.id == 2).unwrap();
    assert_eq!((task.opportunity_id, task.company_id), (Some(s.opportunity), Some(s.company)));
    assert_eq!(one::<Option<i64>>(&conn, "SELECT opportunity_id FROM activity WHERE entity_type = 'task' AND entity_id = 2"), Some(s.opportunity));

    // Explicit reassignment: choosing another company moves the task; its opportunity is left alone and the mismatch reported.
    upsert_todo_rows(&mut conn, &[Todo { client: Some("Fabrikam".into()), company_id: None, ..task.clone() }]).unwrap();
    assert_eq!(company_id(&conn, "todos", 2), Some(other));
    assert_eq!(one::<Option<i64>>(&conn, "SELECT opportunity_id FROM todos WHERE id = 2"), Some(s.opportunity));
    assert_eq!(integrity_report(&conn).unwrap().count("tasks whose opportunity belongs to another company"), 1);

    // No silent reassignment: saving unrelated fields keeps the company, even with stale text.
    let moved = read_all_data(&conn).unwrap().todos.into_iter().find(|t| t.id == 2).unwrap();
    upsert_todo_rows(&mut conn, &[Todo { description: Some("edited".into()), company_id: Some(s.company), ..moved }]).unwrap();
    assert_eq!(company_id(&conn, "todos", 2), Some(other), "a stale company id never undoes an explicit reassignment");

    // Renaming the company changes nothing about the links.
    rename_company_row(&conn, s.company, "Contoso Logistics KSA").unwrap();
    for (table, id) in [("opportunities", s.opportunity), ("projects", s.project), ("meetings", s.meeting), ("notes", s.note), ("todos", s.task)] {
        assert_eq!(company_id(&conn, table, id), Some(s.company));
    }

    // Deleting the opportunity unlinks (not deletes) its tasks.
    conn.execute("DELETE FROM opportunities WHERE id = ?1", params![s.opportunity]).unwrap();
    assert_eq!(one::<Option<i64>>(&conn, "SELECT opportunity_id FROM todos WHERE id = 2"), None);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM todos"), 2);
    drop(conn);
    let _ = std::fs::remove_file(path);
}
