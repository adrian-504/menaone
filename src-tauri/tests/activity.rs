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

/// Company notes are a dated log: an old note is still readable after a new
/// one, editing keeps the original date, and a rename or merge carries every
/// entry across with its own date rather than gluing the text together.
#[test]
fn company_notes_are_dated_entries_that_survive_the_next_one() {
    use menabig_tracker_lib::activity::retarget_company_notes;
    let (path, conn) = fresh_db("company_notes");

    conn.execute("INSERT INTO companies (id, name) VALUES (1, 'Globex Industrial'), (2, 'Contoso Logistics')", []).unwrap();
    let add = |company_id: i64, name: &str, body: &str, created: &str| {
        conn.execute(
            "INSERT INTO company_note_entries (company_id, company_name, body, is_legacy, created_at) VALUES (?1,?2,?3,0,?4)",
            rusqlite::params![company_id, name, body, created],
        )
        .unwrap();
    };
    add(1, "Globex Industrial", "Finance signs off above SAR 50k.", "2026-03-02T09:00:00Z");
    add(1, "Globex Industrial", "New HR director from September.", "2026-09-16T09:00:00Z");

    let entries = |conn: &Connection, id: i64| -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare("SELECT created_at, body FROM company_note_entries WHERE company_id = ?1 ORDER BY created_at DESC")
            .unwrap();
        stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };

    // Writing a second note doesn't replace the first.
    let log = entries(&conn, 1);
    assert_eq!(log.len(), 2);
    assert!(log[0].1.contains("New HR director"), "newest first");
    assert!(log[1].1.contains("Finance signs off"), "the older note is still there");

    // Editing keeps the entry's original date.
    conn.execute(
        "UPDATE company_note_entries SET body = ?1, updated_at = ?2 WHERE created_at = '2026-03-02T09:00:00Z'",
        rusqlite::params!["Finance signs off above SAR 60k.", "2026-09-16T10:00:00Z"],
    )
    .unwrap();
    let edited = entries(&conn, 1);
    assert_eq!(edited[1].0, "2026-03-02T09:00:00Z", "an edit must not re-date the note");
    assert!(edited[1].1.contains("60k"));

    // A merge moves entries over, each keeping its own date.
    add(2, "Contoso Logistics", "Pays late, chase at day 25.", "2026-06-01T09:00:00Z");
    retarget_company_notes(&conn, "Contoso Logistics", "Globex Industrial", Some(1)).unwrap();
    let merged = entries(&conn, 1);
    assert_eq!(merged.len(), 3, "both companies' notes end up in one log");
    assert!(merged.iter().any(|(at, b)| at.starts_with("2026-06-01") && b.contains("Pays late")));
    assert!(entries(&conn, 2).is_empty());

    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_record_timeline_reads_several_records_and_the_work_on_them() {
    use menabig_tracker_lib::activity::RecordRef;
    use menabig_tracker_lib::opportunities::{create_company_named, save_opportunity_row};
    use menabig_tracker_lib::v2_models::Opportunity;
    let (path, mut conn) = fresh_db("records");
    let company = create_company_named(&mut conn, "Contoso Logistics").unwrap().unwrap();
    let opp = save_opportunity_row(&mut conn, &Opportunity { name: "Contoso payroll".into(), company_id: Some(company), company_name: Some("Contoso Logistics".into()), stage: "Lead".into(), ..Default::default() }).unwrap().id;
    let other = save_opportunity_row(&mut conn, &Opportunity { name: "Contoso audit".into(), company_id: Some(company), company_name: Some("Contoso Logistics".into()), stage: "Lead".into(), ..Default::default() }).unwrap().id;
    upsert_proposal_rows(&mut conn, &[Proposal { id: 7, client: "Contoso Logistics".into(), status: "Drafting".into(), ..Default::default() }]).unwrap();
    upsert_todo_rows(&mut conn, &[Todo { id: 1, title: "Call the CFO".into(), opportunity_id: Some(opp), status: Some("Pending".into()), ..Default::default() }]).unwrap();
    upsert_todo_rows(&mut conn, &[Todo { id: 2, title: "Audit prep".into(), opportunity_id: Some(other), status: Some("Pending".into()), ..Default::default() }]).unwrap();

    let this = actions(&conn, ActivityFilter { records: Some(vec![RecordRef { kind: "opportunity".into(), id: opp }]), ..Default::default() });
    assert!(this.contains(&"opportunity:created".to_string()), "{this:?}");
    assert!(this.contains(&"task:created".to_string()), "the work on it: {this:?}");
    let labels: Vec<String> = query_activity(&conn, &ActivityFilter { records: Some(vec![RecordRef { kind: "opportunity".into(), id: opp }]), ..Default::default() })
        .unwrap().into_iter().filter_map(|a| a.entity_label).collect();
    assert!(!labels.iter().any(|l| l == "Audit prep" || l == "Contoso audit"), "nothing from the other opportunity: {labels:?}");

    // A whole engagement: the opportunity and its proposal together.
    let both = actions(&conn, ActivityFilter { records: Some(vec![RecordRef { kind: "opportunity".into(), id: opp }, RecordRef { kind: "proposal".into(), id: 7 }]), ..Default::default() });
    assert!(both.contains(&"proposal:created".to_string()) && both.contains(&"opportunity:created".to_string()), "{both:?}");
    drop(conn);
    let _ = std::fs::remove_file(path);
}
