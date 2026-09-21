// Commitments (Slice 2): `>>` / `<<` lines from a meeting, saved the way the
// app saves them — the meeting first, then the lines the app read from it.
// A look-alike company (same name in capitals) exists throughout, so anything
// matched by name instead of id would land on the wrong company. Fictional
// names only.
use menabig_tracker_lib::activity::{query_activity, ActivityFilter};
use menabig_tracker_lib::commands::{import_legacy_backup_core, read_all_data, restore_backup_core, upsert_todo_rows, wipe_all_data_core};
use menabig_tracker_lib::commitments::{add_commitments, read_commitments, upsert_commitment_rows, NewCommitment};
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::integrity::integrity_report;
use menabig_tracker_lib::models::Todo;
use menabig_tracker_lib::opportunities::{create_company_named, merge_company_links_core, save_opportunity_row};
use menabig_tracker_lib::v2_commands::save_meeting_row;
use menabig_tracker_lib::v2_models::{Meeting, Opportunity};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_commitments_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

struct Setup { company: i64, rival: i64, opportunity: i64, meeting: i64 }

fn setup(conn: &mut Connection) -> Setup {
    let company = create_company_named(conn, "Contoso Logistics").unwrap().unwrap();
    conn.execute("INSERT INTO companies (name, created_at) VALUES ('CONTOSO LOGISTICS', '2026-09-15')", []).unwrap();
    let rival: i64 = one(conn, "SELECT id FROM companies WHERE name = 'CONTOSO LOGISTICS'");
    let opportunity = save_opportunity_row(conn, &Opportunity {
        name: "Contoso payroll".into(), company_id: Some(company), company_name: Some("Contoso Logistics".into()),
        stage: "Proposal".into(), ..Default::default()
    }).unwrap().id;
    let meeting = save_meeting_row(conn, &Meeting {
        title: "Contoso check-in".into(), meeting_date: Some("2026-09-21".into()), company_id: Some(company),
        company_name: Some("Contoso Logistics".into()), opportunity_id: Some(opportunity),
        decisions: Some(">> Send the revised quote by Thu\n<< Omar to share the headcount".into()), ..Default::default()
    }).unwrap().id;
    Setup { company, rival, opportunity, meeting }
}

/// The two lines as src/lib/commitments.ts reads them, with the meeting's context.
fn lines_from_meeting(s: &Setup) -> Vec<NewCommitment> {
    let base = NewCommitment {
        company_id: Some(s.company), opportunity_id: Some(s.opportunity), meeting_id: Some(s.meeting),
        source_type: "meeting".into(), source_id: Some(s.meeting), ..Default::default()
    };
    vec![
        NewCommitment { direction: "ours".into(), text: "Send the revised quote".into(), due_date: Some("2026-09-24".into()),
            source_key: Some("send the revised quote".into()), ..base.clone() },
        NewCommitment { direction: "theirs".into(), text: "Omar to share the headcount".into(),
            source_key: Some("omar to share the headcount".into()), ..base },
    ]
}

#[test]
fn a_meeting_gives_one_commitment_each_way_and_only_ours_gets_a_task() {
    let (path, mut conn) = fresh_db("meeting");
    let s = setup(&mut conn);
    let added = add_commitments(&mut conn, &lines_from_meeting(&s)).unwrap();
    assert_eq!(added.commitments.len(), 2);
    assert_eq!(added.tasks.len(), 1, "theirs never gets a task");

    let ours = added.commitments.iter().find(|c| c.direction == "ours").unwrap();
    let theirs = added.commitments.iter().find(|c| c.direction == "theirs").unwrap();
    let task = &added.tasks[0];
    assert_eq!(ours.todo_id, Some(task.id));
    assert_eq!(theirs.todo_id, None);
    let (title, due, company, opp, meeting, client): (String, Option<String>, Option<i64>, Option<i64>, Option<i64>, Option<String>) = conn
        .query_row("SELECT title, due_date, company_id, opportunity_id, meeting_id, client FROM todos WHERE id = ?1", params![task.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
        .unwrap();
    assert_eq!((title.as_str(), due.as_deref()), ("Send the revised quote", Some("2026-09-24")));
    assert_eq!((company, opp, meeting), (Some(s.company), Some(s.opportunity), Some(s.meeting)));
    assert_eq!(client.as_deref(), Some("Contoso Logistics"));

    // Saving the meeting again reads the same lines: nothing new.
    let again = add_commitments(&mut conn, &lines_from_meeting(&s)).unwrap();
    assert!(again.commitments.is_empty() && again.tasks.is_empty());
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM commitments"), 2);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM todos"), 1);

    // An edited line is a new commitment; the old one stays open for the user to close.
    let mut edited = lines_from_meeting(&s);
    edited[0].text = "Send the revised quote with three people".into();
    edited[0].source_key = Some("send the revised quote with three people".into());
    assert_eq!(add_commitments(&mut conn, &edited[..1]).unwrap().commitments.len(), 1);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM commitments WHERE status = 'open'"), 3);

    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM commitments WHERE company_id = {}", s.rival)), 0);
    let hits: i64 = one(&conn, "SELECT COUNT(*) FROM search_index WHERE entity_type = 'commitment' AND title LIKE '%revised quote%'");
    assert!(hits >= 1, "commitments are searchable");
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn a_commitment_and_its_task_move_together() {
    let (path, mut conn) = fresh_db("task");
    let s = setup(&mut conn);
    let added = add_commitments(&mut conn, &lines_from_meeting(&s)).unwrap();
    let ours = added.commitments.iter().find(|c| c.direction == "ours").unwrap().clone();
    let task = added.tasks[0].clone();
    let status = |conn: &Connection| -> String { conn.query_row("SELECT status FROM commitments WHERE id = ?1", params![ours.id], |r| r.get(0)).unwrap() };
    let task_status = |conn: &Connection| -> String { conn.query_row("SELECT status FROM todos WHERE id = ?1", params![task.id], |r| r.get(0)).unwrap() };

    // Completing the task keeps the commitment, and the log says so.
    upsert_todo_rows(&mut conn, &[Todo { status: Some("Done".into()), completed_at: Some("2026-09-22".into()), ..task.clone() }]).unwrap();
    assert_eq!(status(&conn), "kept");
    let log = query_activity(&conn, &ActivityFilter { company_id: Some(s.company), ..Default::default() }).unwrap();
    assert!(log.iter().any(|e| e.entity_type == "commitment" && e.action == "kept" && e.opportunity_id == Some(s.opportunity)));
    assert!(log.iter().any(|e| e.entity_type == "commitment" && e.action == "created"));

    // Reopening the task reopens it.
    upsert_todo_rows(&mut conn, &[Todo { status: Some("Pending".into()), completed_at: None, ..task.clone() }]).unwrap();
    assert_eq!(status(&conn), "open");

    // A new due date on the task moves the commitment's, and the other way round.
    upsert_todo_rows(&mut conn, &[Todo { status: Some("Pending".into()), due_date: Some("2026-09-30".into()), ..task.clone() }]).unwrap();
    assert_eq!(one::<String>(&conn, &format!("SELECT due_date FROM commitments WHERE id = {}", ours.id)), "2026-09-30");
    let mut c = read_commitments(&conn).unwrap().into_iter().find(|x| x.id == ours.id).unwrap();
    c.due_date = Some("2026-10-02".into());
    upsert_commitment_rows(&mut conn, &[c.clone()]).unwrap();
    assert_eq!(one::<String>(&conn, &format!("SELECT due_date FROM todos WHERE id = {}", task.id)), "2026-10-02");

    // Marking the commitment kept completes the task; reopening it reopens the task.
    c.status = "kept".into();
    upsert_commitment_rows(&mut conn, &[c.clone()]).unwrap();
    assert_eq!(task_status(&conn), "Done");
    c.status = "open".into();
    upsert_commitment_rows(&mut conn, &[c.clone()]).unwrap();
    assert_eq!(task_status(&conn), "Pending");

    // Deleting the task leaves the commitment open, without a task.
    conn.execute("DELETE FROM todos WHERE id = ?1", params![task.id]).unwrap();
    let (st, todo): (String, Option<i64>) = conn.query_row("SELECT status, todo_id FROM commitments WHERE id = ?1", params![ours.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((st.as_str(), todo), ("open", None));
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn merges_keep_commitments_and_deletes_only_unlink_them() {
    let (path, mut conn) = fresh_db("links");
    let s = setup(&mut conn);
    add_commitments(&mut conn, &lines_from_meeting(&s)).unwrap();

    // Contoso Logistics merges into Contoso Group: its commitments follow.
    let group = create_company_named(&mut conn, "Contoso Group").unwrap().unwrap();
    merge_company_links_core(&mut conn, "Contoso Logistics", "Contoso Group").unwrap();
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM commitments WHERE company_id = {group}")), 2);
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM commitments WHERE company_id = {}", s.rival)), 0);

    conn.execute("DELETE FROM opportunities WHERE id = ?1", params![s.opportunity]).unwrap();
    conn.execute("DELETE FROM meetings WHERE id = ?1", params![s.meeting]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM commitments"), 2, "never deleted with what they point at");
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM commitments WHERE opportunity_id IS NOT NULL OR source_id IS NOT NULL"), 0);
    assert_eq!(integrity_report(&conn).unwrap().issues.iter().filter(|p| p.check.contains("commitments")).count(), 0);

    // Someone at the look-alike company named as who promised it: reported.
    conn.execute("INSERT INTO contacts (id, name, client_name, company_id) VALUES (90, 'Lina Saleh', 'CONTOSO LOGISTICS', ?1)", params![s.rival]).unwrap();
    conn.execute("UPDATE commitments SET contact_id = 90 WHERE direction = 'theirs'", []).unwrap();
    let issues = integrity_report(&conn).unwrap().issues;
    assert!(issues.iter().any(|p| p.check == "commitments whose contact belongs to another company" && p.count == 1));
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn backups_round_trip_commitments_and_an_older_backup_leaves_them_alone() {
    let (path, mut conn) = fresh_db("backup");
    let s = setup(&mut conn);
    add_commitments(&mut conn, &lines_from_meeting(&s)).unwrap();
    let backup = read_all_data(&conn).unwrap();
    assert_eq!(backup.commitments.as_ref().map(Vec::len), Some(2));
    // New backups always carry the key, even with none.
    assert!(serde_json::to_value(&backup).unwrap().get("commitments").unwrap().is_array());

    conn.execute("DELETE FROM commitments", []).unwrap();
    restore_backup_core(&mut conn, &backup).unwrap();
    assert_eq!(Some(read_commitments(&conn).unwrap()), backup.commitments);

    // A backup from before commitments existed (no key): today's stay.
    let mut json = serde_json::to_value(&backup).unwrap();
    json.as_object_mut().unwrap().remove("commitments");
    let older: menabig_tracker_lib::models::AppData = serde_json::from_value(json).unwrap();
    assert_eq!(older.commitments, None);
    restore_backup_core(&mut conn, &older).unwrap();
    assert_eq!(read_commitments(&conn).unwrap().len(), 2);

    // A current backup that had none: it is the whole set, so they go.
    let mut none = backup.clone();
    none.commitments = Some(vec![]);
    restore_backup_core(&mut conn, &none).unwrap();
    assert_eq!(read_commitments(&conn).unwrap().len(), 0);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM search_index WHERE entity_type = 'commitment'"), 0);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn wiping_all_data_takes_commitments_too_without_logging_it() {
    let (path, mut conn) = fresh_db("wipe");
    let s = setup(&mut conn);
    add_commitments(&mut conn, &lines_from_meeting(&s)).unwrap();
    wipe_all_data_core(&mut conn).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM commitments"), 0);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM search_index WHERE entity_type = 'commitment'"), 0);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM activity"), 0, "no activity written by the wipe");
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn importing_the_old_tracker_clears_commitments() {
    // The old tracker's tasks replace today's by id, so a commitment kept
    // across it could point at an unrelated task. It had no commitments: they go.
    let (path, mut conn) = fresh_db("legacy");
    let s = setup(&mut conn);
    add_commitments(&mut conn, &lines_from_meeting(&s)).unwrap();
    let json = r#"{"version":1,"data":{"menabig_todos_v1":[{"id":1,"title":"Call the landlord"}]}}"#;
    menabig_tracker_lib::activity::with_activity_muted(&mut conn, |c| import_legacy_backup_core(c, json)).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM commitments"), 0);
    assert_eq!(one::<String>(&conn, "SELECT title FROM todos WHERE id = 1"), "Call the landlord");
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn waiting_on_is_saved_with_the_opportunity() {
    let (path, mut conn) = fresh_db("waiting");
    let s = setup(&mut conn);
    let mut o = save_opportunity_row(&mut conn, &Opportunity {
        id: s.opportunity, name: "Contoso payroll".into(), company_id: Some(s.company), company_name: Some("Contoso Logistics".into()),
        stage: "Proposal".into(), waiting_on: Some("them".into()), waiting_since: Some("2026-09-05".into()),
        waiting_note: Some("Headcount from Omar".into()), ..Default::default()
    }).unwrap();
    assert_eq!((o.waiting_on.as_deref(), o.waiting_since.as_deref(), o.waiting_note.as_deref()), (Some("them"), Some("2026-09-05"), Some("Headcount from Omar")));
    o.waiting_on = None;
    o.waiting_since = None;
    let o = save_opportunity_row(&mut conn, &o).unwrap();
    assert_eq!(o.waiting_on, None);
    drop(conn);
    let _ = std::fs::remove_file(path);
}
