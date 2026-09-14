// Unified activity: triggers record what happens to every kind of record,
// link it to the company, stay quiet during a restore, and company renames
// keep ids.
use menabig_tracker_lib::activity::{query_activity, rename_company_row, with_activity_muted, ActivityFilter};
use menabig_tracker_lib::commands::{upsert_note_rows, upsert_proposal_rows, upsert_todo_rows, write_proposals};
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::models::{ActivityNote, Note, Proposal, Todo};
use rusqlite::Connection;

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_activity_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    (path.clone(), init_connection(&path).expect("init db"))
}

fn actions(conn: &Connection, filter: ActivityFilter) -> Vec<String> {
    let mut rows = query_activity(conn, &filter).unwrap();
    rows.reverse();
    rows.into_iter().map(|a| format!("{}:{}", a.entity_type, a.action)).collect()
}

#[test]
fn every_module_feeds_the_company_timeline() {
    let (path, mut conn) = fresh_db("timeline");
    let proposal = |status: &str, notes: Vec<ActivityNote>| Proposal {
        id: 1, client: "Acme Test Co".into(), r#type: Some("Workforce".into()), status: status.into(), notes, ..Default::default()
    };
    upsert_proposal_rows(&mut conn, &[proposal("Proposal Drafted", vec![])]).unwrap();
    upsert_proposal_rows(&mut conn, &[proposal("Proposal Drafted", vec![])]).unwrap(); // unchanged: nothing logged
    upsert_proposal_rows(&mut conn, &[proposal("Proposal sent to Client", vec![ActivityNote { id: 1, date: Some("2026-09-13".into()), text: Some("Called the CFO".into()) }])]).unwrap();
    upsert_todo_rows(&mut conn, &[Todo { id: 1, title: "Send pack".into(), client: Some("Acme Test Co".into()), status: Some("Pending".into()), ..Default::default() }]).unwrap();
    upsert_todo_rows(&mut conn, &[Todo { id: 1, title: "Send pack".into(), client: Some("Acme Test Co".into()), status: Some("Done".into()), ..Default::default() }]).unwrap();
    upsert_note_rows(&mut conn, &[Note { id: 1, title: Some("Kickoff".into()), content: Some("a".into()), client_name: Some("Acme Test Co".into()), ..Default::default() }]).unwrap();
    upsert_note_rows(&mut conn, &[Note { id: 1, title: Some("Kickoff".into()), content: Some("ab".into()), client_name: Some("Acme Test Co".into()), ..Default::default() }]).unwrap();

    let acme: i64 = conn.query_row("SELECT id FROM companies WHERE name = 'Acme Test Co'", [], |r| r.get(0)).unwrap();
    let log = actions(&conn, ActivityFilter { company_id: Some(acme), ..Default::default() });
    assert_eq!(log, vec![
        "company:created", "proposal:created", "proposal:status_changed", "proposal:note_added",
        "task:created", "task:completed", "note:created",
    ], "a note edited straight after creation isn't logged twice");

    let status = query_activity(&conn, &ActivityFilter { entity_type: Some("proposal".into()), ..Default::default() }).unwrap();
    assert!(status.iter().any(|a| a.detail.as_deref() == Some("Proposal Drafted → Proposal sent to Client")));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn restore_is_silent_and_rename_keeps_links() {
    let (path, mut conn) = fresh_db("restore");
    let before: i64 = conn.query_row("SELECT COUNT(*) FROM activity", [], |r| r.get(0)).unwrap();
    with_activity_muted(&mut conn, |c| {
        write_proposals(c, &[Proposal { id: 9, client: "Restored Co".into(), status: "Lead".into(), ..Default::default() }])
    }).unwrap();
    let after: i64 = conn.query_row("SELECT COUNT(*) FROM activity WHERE entity_type = 'proposal'", [], |r| r.get(0)).unwrap();
    assert_eq!(after, 0, "restore wrote no proposal activity (before: {before})");

    // Logging resumes afterwards.
    upsert_proposal_rows(&mut conn, &[Proposal { id: 10, client: "Restored Co".into(), status: "Lead".into(), ..Default::default() }]).unwrap();
    let resumed: i64 = conn.query_row("SELECT COUNT(*) FROM activity WHERE entity_type = 'proposal'", [], |r| r.get(0)).unwrap();
    assert_eq!(resumed, 1);

    let id: i64 = conn.query_row("SELECT id FROM companies WHERE name = 'Restored Co'", [], |r| r.get(0)).unwrap();
    rename_company_row(&conn, id, "Restored Company").unwrap();
    upsert_proposal_rows(&mut conn, &[Proposal { id: 10, client: "Restored Company".into(), status: "Lead".into(), ..Default::default() }]).unwrap();
    let (companies, linked): (i64, i64) = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM companies), (SELECT company_id FROM proposals WHERE id = 10)", [], |r| Ok((r.get(0)?, r.get(1)?))
    ).unwrap();
    assert_eq!((companies, linked), (1, id), "renamed in place: no second company, same id");

    upsert_proposal_rows(&mut conn, &[Proposal { id: 11, client: "Other Co".into(), status: "Lead".into(), ..Default::default() }]).unwrap();
    assert!(rename_company_row(&conn, id, "Other Co").unwrap_err().contains("Merge"));

    let _ = std::fs::remove_file(&path);
}
