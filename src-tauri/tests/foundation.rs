// Foundation Lock: company identity, record-level saves, global ids and
// versions, tombstones, activity, the work graph, Outlook re-sync, migration
// atomicity, backups and restores. Fake data only.
use menabig_tracker_lib::activity::rename_company_row;
use menabig_tracker_lib::backups::{ensure_daily_backup, verify_snapshot};
use menabig_tracker_lib::commands::{
    delete_note_rows, delete_proposal_rows, import_legacy_backup_core, read_all_data, restore_backup_core, upsert_contact_rows,
    upsert_note_rows, upsert_proposal_rows, upsert_todo_rows,
};
use menabig_tracker_lib::db::{init_connection, run_test_steps};
use menabig_tracker_lib::integrity::integrity_report;
use menabig_tracker_lib::models::{Contact, Note, Proposal, Todo};
use menabig_tracker_lib::ms365::commands::upsert_meeting_from_event;
use menabig_tracker_lib::opportunities::{create_company_named, merge_company_links_core, save_opportunity_row};
use menabig_tracker_lib::v2_commands::{save_meeting_row, save_project_row};
use menabig_tracker_lib::v2_models::{Meeting, Opportunity, Project};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_foundation_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn proposal(id: i64, client: &str, status: &str) -> Proposal {
    Proposal { id, client: client.into(), status: status.into(), r#type: Some("Payroll".into()), ..Default::default() }
}

fn company_id(conn: &Connection, table: &str, id: i64) -> Option<i64> {
    conn.query_row(&format!("SELECT company_id FROM {table} WHERE id = ?1"), params![id], |r| r.get(0)).unwrap()
}

fn opportunity(name: &str, company: &str) -> Opportunity {
    Opportunity { name: name.into(), company_name: Some(company.into()), stage: "Lead".into(), status: "Open".into(), ..Default::default() }
}

#[test]
fn renamed_company_keeps_every_link_and_old_names_find_it() {
    let (path, mut conn) = fresh_db("rename");
    upsert_proposal_rows(&mut conn, &[proposal(1, "Alpha Test Co", "Drafting")]).unwrap();
    let alpha = company_id(&conn, "proposals", 1).unwrap();
    let opp = save_opportunity_row(&mut conn, &opportunity("Payroll deal", "Alpha Test Co")).unwrap();
    assert_eq!(opp.company_id, Some(alpha));

    rename_company_row(&conn, alpha, "Alpha Holdings").unwrap();
    let companies_before: i64 = one(&conn, "SELECT COUNT(*) FROM companies");

    // A save that still carries the old name (a screen not refreshed yet) stays with the renamed company.
    upsert_proposal_rows(&mut conn, &[Proposal { remarks: Some("edited".into()), ..proposal(1, "Alpha Test Co", "Drafting") }]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 1), Some(alpha));
    let stale = Opportunity { stage: "Proposal".into(), ..opp.clone() };
    assert_eq!(save_opportunity_row(&mut conn, &stale).unwrap().company_id, Some(alpha));
    // A brand-new record typed with the old name finds it too.
    upsert_contact_rows(&mut conn, &[Contact { id: 1, name: Some("Test Person".into()), client_name: Some("alpha test co".into()), ..Default::default() }]).unwrap();
    assert_eq!(company_id(&conn, "contacts", 1), Some(alpha));
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM companies"), companies_before, "no company re-created from the old name");

    assert!(integrity_report(&conn).unwrap().is_clean(), "{:?}", integrity_report(&conn).unwrap());
    // Someone deliberately creating a new company with the old name gets a new company.
    let new_alpha = create_company_named(&conn, "Alpha Test Co").unwrap().unwrap();
    assert_ne!(new_alpha, alpha);
    // Records still carrying the old name keep their link (the id wins), and the
    // opportunity saved from a copy that still shows the old name stays too. The
    // name now meaning two companies is reported as an ambiguity, not guessed.
    upsert_proposal_rows(&mut conn, &[Proposal { remarks: Some("edited".into()), ..proposal(1, "Alpha Test Co", "Drafting") }]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 1), Some(alpha));
    let stale_again = Opportunity { company_name: Some("Alpha Test Co".into()), description: Some("edited".into()), ..opp.clone() };
    assert_eq!(save_opportunity_row(&mut conn, &stale_again).unwrap().company_id, Some(alpha));
    // New text with that name means the company that has it now.
    upsert_proposal_rows(&mut conn, &[proposal(2, "Alpha Test Co", "Drafting")]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 2), Some(new_alpha));
    assert_eq!(integrity_report(&conn).unwrap().count("former company names that are also a current name"), 1);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn merged_company_name_is_not_re_created_and_similar_names_stay_apart() {
    let (path, mut conn) = fresh_db("merge");
    upsert_proposal_rows(&mut conn, &[proposal(1, "Beta Test LLC", "Drafting"), proposal(2, "Beta Test", "Drafting")]).unwrap();
    let (llc, plain) = (company_id(&conn, "proposals", 1).unwrap(), company_id(&conn, "proposals", 2).unwrap());
    assert_ne!(llc, plain, "similar names are never joined automatically");
    // Same name ignoring capitals is the same company.
    upsert_proposal_rows(&mut conn, &[proposal(3, "BETA TEST", "Drafting")]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 3), Some(plain));

    // Merge "Beta Test LLC" into "Beta Test" (the UI renames the records, then reconciles ids).
    upsert_proposal_rows(&mut conn, &[proposal(1, "Beta Test", "Drafting")]).unwrap();
    merge_company_links_core(&mut conn, "Beta Test LLC", "Beta Test").unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM companies"), 1);
    // A record still carrying the merged-away name lands on the surviving company.
    upsert_todo_rows(&mut conn, &[Todo { id: 1, title: "Call".into(), client: Some("Beta Test LLC".into()), ..Default::default() }]).unwrap();
    assert_eq!(company_id(&conn, "todos", 1), Some(plain));
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM companies"), 1, "merged-away company not re-created");
    assert!(integrity_report(&conn).unwrap().is_clean());
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn saving_one_record_leaves_others_alone_and_versions_track_real_changes() {
    let (path, mut conn) = fresh_db("persist");
    upsert_proposal_rows(&mut conn, &[proposal(1, "Gamma Test Co", "Drafting"), proposal(2, "Delta Test Co", "Drafting")]).unwrap();
    let version = |conn: &Connection, id: i64| -> i64 { conn.query_row("SELECT row_version FROM proposals WHERE id = ?1", params![id], |r| r.get(0)).unwrap() };
    let uuid = |conn: &Connection, id: i64| -> String { conn.query_row("SELECT uuid FROM proposals WHERE id = ?1", params![id], |r| r.get(0)).unwrap() };
    let (u1, u2) = (uuid(&conn, 1), uuid(&conn, 2));
    assert_ne!(u1, u2);
    assert_eq!(u1.len(), 36);

    // A changes, then B changes, in separate saves: both changes survive.
    upsert_proposal_rows(&mut conn, &[proposal(1, "Gamma Test Co", "Sent to Client")]).unwrap();
    upsert_proposal_rows(&mut conn, &[proposal(2, "Delta Test Co", "Lost")]).unwrap();
    let statuses: Vec<String> = conn.prepare("SELECT status FROM proposals ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    assert_eq!(statuses, ["Sent to Client", "Lost"]);
    assert_eq!((version(&conn, 1), version(&conn, 2)), (2, 2));

    // Saving an unchanged record is not an edit.
    upsert_proposal_rows(&mut conn, &[proposal(1, "Gamma Test Co", "Sent to Client")]).unwrap();
    assert_eq!(version(&conn, 1), 2);
    // Rapid consecutive edits: the last one wins, each counted once.
    for s in ["In Internal Review", "Sent to Client", "Signed by Client"] {
        upsert_proposal_rows(&mut conn, &[proposal(1, "Gamma Test Co", s)]).unwrap();
    }
    assert_eq!(one::<String>(&conn, "SELECT status FROM proposals WHERE id = 1"), "Signed by Client");
    assert_eq!(version(&conn, 1), 5);
    assert_eq!((uuid(&conn, 1), uuid(&conn, 2)), (u1.clone(), u2.clone()), "ids never change on update");

    // Deleting A leaves B untouched and records a tombstone for A only.
    let b_version = version(&conn, 2);
    delete_proposal_rows(&mut conn, &[1]).unwrap();
    assert_eq!(version(&conn, 2), b_version);
    let tomb: Vec<(String, String)> = conn.prepare("SELECT table_name, uuid FROM sync_tombstones WHERE table_name = 'proposals'").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
    assert_eq!(tomb, [("proposals".to_string(), u1)]);
    assert!(integrity_report(&conn).unwrap().is_clean());
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn activity_is_recorded_once_per_real_event() {
    let (path, mut conn) = fresh_db("activity");
    upsert_proposal_rows(&mut conn, &[proposal(1, "Epsilon Test Co", "Drafting")]).unwrap();
    upsert_proposal_rows(&mut conn, &[proposal(1, "Epsilon Test Co", "Drafting")]).unwrap();
    let count = |conn: &Connection, action: &str| -> i64 {
        conn.query_row("SELECT COUNT(*) FROM activity WHERE entity_type = 'proposal' AND entity_id = 1 AND action = ?1", params![action], |r| r.get(0)).unwrap()
    };
    assert_eq!(count(&conn, "created"), 1);
    assert_eq!(count(&conn, "status_changed"), 0, "an unchanged save logs nothing");
    upsert_proposal_rows(&mut conn, &[proposal(1, "Epsilon Test Co", "Sent to Client")]).unwrap();
    assert_eq!(count(&conn, "status_changed"), 1);
    let (created_at, company): (String, Option<i64>) = conn
        .query_row("SELECT created_at, company_id FROM activity WHERE entity_type = 'proposal' AND action = 'created'", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert!(created_at.starts_with("20") && created_at.ends_with('Z'), "UTC timestamp: {created_at}");
    assert_eq!(company, company_id(&conn, "proposals", 1));
    assert_eq!(integrity_report(&conn).unwrap().count("activity recorded twice"), 0);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

/// Company → Contact → Opportunity → Proposal → Project → Meeting → Note → Task → Activity.
fn build_work_graph(conn: &mut Connection, company: &str, base: i64) -> (i64, i64, i64, i64) {
    upsert_contact_rows(conn, &[Contact { id: base, name: Some("Graph Contact".into()), client_name: Some(company.into()), email: Some("graph@example.test".into()), ..Default::default() }]).unwrap();
    let co = company_id(conn, "contacts", base).unwrap();
    let opp = save_opportunity_row(conn, &opportunity("Workforce deal", company)).unwrap();
    upsert_proposal_rows(conn, &[proposal(base, company, "Drafting")]).unwrap();
    let opp = save_opportunity_row(conn, &Opportunity { proposal_id: Some(base), stage: "Proposal".into(), ..opp }).unwrap();
    let project = save_project_row(conn, &Project {
        name: "Workforce rollout".into(), r#type: "client".into(), status: "Active".into(), priority: "Medium".into(),
        company_name: Some(company.into()), ..Default::default()
    }).unwrap();
    let opp = save_opportunity_row(conn, &Opportunity { project_id: Some(project.id), ..opp }).unwrap();
    let meeting = save_meeting_row(conn, &Meeting {
        title: "Kickoff".into(), company_name: Some(company.into()), project_id: Some(project.id), opportunity_id: Some(opp.id),
        attendees: vec!["Graph Contact".into()], ..Default::default()
    }).unwrap();
    upsert_note_rows(conn, &[Note { id: base, title: Some("Kickoff notes".into()), client_name: Some(company.into()), ..Default::default() }]).unwrap();
    conn.execute("INSERT INTO entity_links (from_type, from_id, to_type, to_id, created_at) VALUES ('note', ?1, 'project', ?2, '2026-09-14')", params![base, project.id]).unwrap();
    upsert_todo_rows(conn, &[Todo { id: base, title: "Send the plan".into(), client: Some(company.into()), project_id: Some(project.id), meeting_id: Some(meeting.id), ..Default::default() }]).unwrap();

    for (table, id) in [("contacts", base), ("opportunities", opp.id), ("proposals", base), ("projects", project.id), ("meetings", meeting.id), ("notes", base), ("todos", base)] {
        assert_eq!(company_id(conn, table, id), Some(co), "{table} is linked to the company by id");
    }
    (co, opp.id, project.id, meeting.id)
}

#[test]
fn work_graph_survives_reload_rename_and_deletes() {
    let (path, mut conn) = fresh_db("graph");
    let (co, opp, project, meeting) = build_work_graph(&mut conn, "Zeta Test Co", 1);
    let uuids = |conn: &Connection| -> Vec<String> {
        conn.prepare("SELECT uuid FROM contacts UNION ALL SELECT uuid FROM opportunities UNION ALL SELECT uuid FROM proposals UNION ALL SELECT uuid FROM projects UNION ALL SELECT uuid FROM meetings UNION ALL SELECT uuid FROM notes UNION ALL SELECT uuid FROM todos")
            .unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };
    let before = uuids(&conn);
    assert!(one::<i64>(&conn, "SELECT COUNT(DISTINCT action || entity_type) FROM activity") >= 6, "activity from several modules");
    assert!(integrity_report(&conn).unwrap().is_clean(), "{:?}", integrity_report(&conn).unwrap());

    // Reopen the database: everything is still linked the same way.
    drop(conn);
    let mut conn = init_connection(&path).unwrap();
    assert_eq!(uuids(&conn), before);
    assert_eq!(one::<Option<i64>>(&conn, &format!("SELECT project_id FROM opportunities WHERE id = {opp}")), Some(project));
    assert_eq!(one::<Option<i64>>(&conn, &format!("SELECT opportunity_id FROM meetings WHERE id = {meeting}")), Some(opp));

    // Rename keeps every link and every id.
    rename_company_row(&conn, co, "Zeta Holdings").unwrap();
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM projects WHERE company_id = {co}")), 1);
    assert_eq!(uuids(&conn), before);

    // Deleting the note removes its link; deleting the project unlinks (not deletes) its meeting and task.
    delete_note_rows(&mut conn, &[1]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM entity_links"), 0);
    conn.execute("DELETE FROM projects WHERE id = ?1", params![project]).unwrap();
    assert_eq!(one::<Option<i64>>(&conn, &format!("SELECT project_id FROM meetings WHERE id = {meeting}")), None);
    assert_eq!(one::<Option<i64>>(&conn, "SELECT project_id FROM todos WHERE id = 1"), None);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM todos"), 1);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM contacts"), 1);
    assert!(integrity_report(&conn).unwrap().is_clean(), "{:?}", integrity_report(&conn).unwrap());
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn restoring_a_backup_keeps_global_ids_and_is_all_or_nothing() {
    let (path, mut conn) = fresh_db("restore");
    build_work_graph(&mut conn, "Eta Test Co", 1);
    upsert_proposal_rows(&mut conn, &[proposal(2, "Eta Test Co", "Drafting")]).unwrap();
    let backup = read_all_data(&conn).unwrap();
    let uuid1: String = one(&conn, "SELECT uuid FROM proposals WHERE id = 1");

    // Changes after the backup: one edit, one new record.
    upsert_proposal_rows(&mut conn, &[proposal(1, "Eta Test Co", "Lost"), proposal(3, "Eta Test Co", "Drafting")]).unwrap();
    let uuid3: String = one(&conn, "SELECT uuid FROM proposals WHERE id = 3");
    restore_backup_core(&mut conn, &backup).unwrap();
    assert_eq!(one::<String>(&conn, "SELECT status FROM proposals WHERE id = 1"), "Drafting");
    assert_eq!(one::<String>(&conn, "SELECT uuid FROM proposals WHERE id = 1"), uuid1, "a restored record keeps its global id");
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposals"), 2);
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM sync_tombstones WHERE uuid = '{uuid3}'")), 1, "the record not in the backup leaves a tombstone");
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM sync_tombstones WHERE uuid = '{uuid1}'")), 0);
    assert!(integrity_report(&conn).unwrap().is_clean(), "{:?}", integrity_report(&conn).unwrap());

    // A restore that fails part-way (a subtask whose parent doesn't exist) changes nothing.
    let before: i64 = one(&conn, "SELECT COUNT(*) FROM proposals");
    let bad = r#"{"data":{"menabig_v5":[{"id":50,"client":"Theta Test Co","status":"Lead"}],"menabig_todos_v1":[{"id":7,"title":"Orphan subtask","parentId":999}]}}"#;
    assert!(import_legacy_backup_core(&mut conn, bad).is_err(), "the broken file is refused");
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposals"), before, "nothing was replaced");
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposals WHERE client = 'Theta Test Co'"), 0);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn outlook_resync_is_idempotent_and_ids_stay_separate() {
    let (path, conn) = fresh_db("outlook");
    let event: menabig_tracker_lib::ms365::graph::GraphEvent = serde_json::from_value(serde_json::json!({
        "id": "AAMkAGI2-test-event", "subject": "Weekly sync",
        "start": { "dateTime": "2026-09-15T09:00:00.0000000", "timeZone": "UTC" },
        "end": { "dateTime": "2026-09-15T09:30:00.0000000", "timeZone": "UTC" },
        "organizer": { "emailAddress": { "name": "Organizer", "address": "organizer@example.test" } },
        "attendees": [{ "emailAddress": { "name": "Guest", "address": "guest@example.test" } }]
    })).unwrap();
    upsert_meeting_from_event(&conn, &event, "2026-09-14T10:00:00Z").unwrap();
    let (id, version): (i64, i64) = conn.query_row("SELECT id, row_version FROM meetings", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    upsert_meeting_from_event(&conn, &event, "2026-09-14T11:00:00Z").unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM meetings"), 1, "no duplicate on re-sync");
    assert_eq!(one::<i64>(&conn, "SELECT row_version FROM meetings"), version, "an unchanged event is not an edit");
    assert_ne!(one::<String>(&conn, "SELECT outlook_event_id FROM meetings"), id.to_string(), "Outlook's id is not MENA One's id");
    assert!(one::<String>(&conn, "SELECT attendee_emails_json FROM meetings").contains("guest@example.test"));

    let mut changed = event.clone();
    changed.subject = Some("Weekly sync (moved)".into());
    upsert_meeting_from_event(&conn, &changed, "2026-09-14T12:00:00Z").unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT row_version FROM meetings"), version + 1);
    assert_eq!(one::<i64>(&conn, "SELECT id FROM meetings"), id);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn a_failing_migration_leaves_no_trace() {
    let (path, conn) = fresh_db("migration");
    let version: String = one(&conn, "SELECT value FROM app_meta WHERE key = 'schema_version'");
    let base: i64 = version.parse().unwrap();
    // Two made-up steps after the real ones: the second creates a table, then fails.
    let good = Box::leak(format!("CREATE TABLE ok_step (id INTEGER);").into_boxed_str());
    let bad = "CREATE TABLE half_step (id INTEGER); INSERT INTO no_such_table VALUES (1);";
    let result = run_test_steps(&conn, &[(base + 1, good), (base + 2, bad)]);
    assert!(result.is_err());
    assert_eq!(one::<String>(&conn, "SELECT value FROM app_meta WHERE key = 'schema_version'"), (base + 1).to_string(), "stops at the last step that fully applied");
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'ok_step'"), 1);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'half_step'"), 0, "the failed step rolled back");
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn backups_are_readable_and_reopen_with_the_same_data() {
    let (path, mut conn) = fresh_db("backup");
    build_work_graph(&mut conn, "Iota Test Co", 1);
    let dir = std::env::temp_dir().join(format!("menabig_foundation_backups_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let snapshot = ensure_daily_backup(&conn, &dir, 14).unwrap().expect("a snapshot is written");
    assert!(verify_snapshot(&snapshot).unwrap());
    // Reopening the copy the way the app does keeps every record and link.
    let copy = dir.join("reopened.sqlite3");
    std::fs::copy(&snapshot, &copy).unwrap();
    let reopened = init_connection(&copy).unwrap();
    for table in ["companies", "contacts", "opportunities", "proposals", "projects", "meetings", "notes", "todos", "entity_links", "activity"] {
        let q = format!("SELECT COUNT(*) FROM {table}");
        assert_eq!(one::<i64>(&reopened, &q), one::<i64>(&conn, &q), "{table}");
    }
    assert!(integrity_report(&reopened).unwrap().is_clean());
    drop((conn, reopened));
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(path);
}

/// The fake legacy dataset (175 proposals, 59 contacts, 51 agreements, in the
/// original app's shape) imported, then the full workflow on top of it.
#[test]
fn realistic_legacy_data_migrates_and_stays_consistent() {
    let (path, mut conn) = fresh_db("legacy");
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/legacy_seed_backup.json")).unwrap();
    import_legacy_backup_core(&mut conn, &json).unwrap();
    let report = integrity_report(&conn).unwrap();
    assert!(report.is_clean(), "{report:?}");
    let proposals: i64 = one(&conn, "SELECT COUNT(*) FROM proposals");
    build_work_graph(&mut conn, "Test Client 001 Engineering LLC", 900);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposals"), proposals + 1);
    assert!(integrity_report(&conn).unwrap().is_clean());
    drop(conn);
    let _ = std::fs::remove_file(path);
}

/// Opt-in: `MENA_REHEARSAL_DB=<copy of a real database> cargo test --test foundation -- --ignored`.
/// Migrates the copy, checks it, and runs the full workflow on it.
#[test]
#[ignore]
fn real_database_copy_passes_the_integrity_checks() {
    let Ok(path) = std::env::var("MENA_REHEARSAL_DB") else { return };
    assert!(!path.contains("Application Support"), "point this at a copy, never the live database");
    let mut conn = init_connection(&std::path::PathBuf::from(&path)).unwrap();
    let report = integrity_report(&conn).unwrap();
    println!("{report:#?}");
    let counts = |conn: &Connection| -> Vec<i64> {
        ["companies", "contacts", "proposals", "agreements", "opportunities", "projects", "meetings", "notes", "todos"]
            .iter().map(|t| one::<i64>(conn, &format!("SELECT COUNT(*) FROM {t}"))).collect()
    };
    let before = counts(&conn);
    build_work_graph(&mut conn, "Foundation Lock Test Co", 900_000);
    let after = counts(&conn);
    println!("before {before:?} after {after:?}");
    assert_eq!(after[0], before[0] + 1, "one company added");
    assert!(integrity_report(&conn).unwrap().issues.len() <= report.issues.len());
}

// ── Foundation Lock, second pass: the id wins, conflicts are reported ─────────

#[test]
fn a_known_company_id_wins_over_unchanged_company_text() {
    let (path, mut conn) = fresh_db("idwins");
    let alpha = create_company_named(&conn, "Alpha Test Co").unwrap().unwrap();
    let beta = create_company_named(&conn, "Beta Holdings").unwrap().unwrap();
    upsert_contact_rows(&mut conn, &[Contact { id: 1, name: Some("Test Person".into()), client_name: Some("Alpha Test Co".into()), ..Default::default() }]).unwrap();
    assert_eq!(company_id(&conn, "contacts", 1), Some(alpha));
    // Someone links the contact to Beta by id (a review, a folder link) without changing the text.
    conn.execute("UPDATE contacts SET company_id = ?1 WHERE id = 1", params![beta]).unwrap();

    // Saving the contact with the same company text keeps the link: the id wins.
    upsert_contact_rows(&mut conn, &[Contact { id: 1, name: Some("Test Person".into()), role: Some("CFO".into()), client_name: Some("Alpha Test Co".into()), company_id: Some(alpha), ..Default::default() }]).unwrap();
    assert_eq!(company_id(&conn, "contacts", 1), Some(beta));
    // The disagreement is kept as it is and reported, not silently resolved.
    let report = integrity_report(&conn).unwrap();
    assert_eq!(report.count("contacts: company text doesn't match its linked company"), 1);
    assert_eq!(one::<String>(&conn, "SELECT client_name FROM contacts WHERE id = 1"), "Alpha Test Co");

    // Editing the company text is a real change of company.
    upsert_contact_rows(&mut conn, &[Contact { id: 1, name: Some("Test Person".into()), client_name: Some("Gamma Trading".into()), ..Default::default() }]).unwrap();
    let gamma = company_id(&conn, "contacts", 1).unwrap();
    assert!(gamma != alpha && gamma != beta);
    assert!(integrity_report(&conn).unwrap().is_clean());

    // A new record that arrives with a company id keeps it.
    upsert_todo_rows(&mut conn, &[Todo { id: 5, title: "Call".into(), client: Some("Beta Holdings".into()), company_id: Some(beta), ..Default::default() }]).unwrap();
    assert_eq!(company_id(&conn, "todos", 5), Some(beta));
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn legal_names_match_only_when_unique_and_look_alikes_are_flagged_not_merged() {
    let (path, mut conn) = fresh_db("legal");
    let acme = create_company_named(&conn, "Acme").unwrap().unwrap();
    conn.execute("UPDATE companies SET legal_name = 'Acme Trading LLC' WHERE id = ?1", params![acme]).unwrap();
    upsert_proposal_rows(&mut conn, &[proposal(1, "ACME TRADING LLC", "Drafting")]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 1), Some(acme), "the unique legal name finds the company");

    // Two companies with the same legal name: ambiguous, so neither is guessed —
    // the new record stays unlinked and the name goes to the review queue.
    let other = create_company_named(&conn, "Acme Riyadh Branch").unwrap().unwrap();
    conn.execute("UPDATE companies SET legal_name = 'Acme Trading LLC' WHERE id = ?1", params![other]).unwrap();
    upsert_proposal_rows(&mut conn, &[proposal(2, "Acme Trading LLC", "Drafting")]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 2), None);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM company_review_queue WHERE status = 'pending'"), 1);
    // …while the proposal already linked keeps its company.
    upsert_proposal_rows(&mut conn, &[Proposal { remarks: Some("edited".into()), ..proposal(1, "ACME TRADING LLC", "Drafting") }]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 1), Some(acme));

    // "Globex LLC" and "GLOBEX" are different companies, flagged as possible duplicates.
    upsert_proposal_rows(&mut conn, &[proposal(3, "Globex LLC", "Drafting"), proposal(4, "GLOBEX", "Drafting")]).unwrap();
    assert_ne!(company_id(&conn, "proposals", 3), company_id(&conn, "proposals", 4));
    let groups = menabig_tracker_lib::integrity::possible_duplicate_companies(&conn).unwrap();
    assert!(groups.iter().any(|g| g.len() == 2 && g.contains(&company_id(&conn, "proposals", 3).unwrap())));
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn contradicting_relationships_are_reported_and_left_untouched() {
    let (path, mut conn) = fresh_db("contradictions");
    let (co, opp, project, meeting) = build_work_graph(&mut conn, "Delta Test Co", 1);
    let other = create_company_named(&conn, "Epsilon Test Co").unwrap().unwrap();
    // The proposal the opportunity points at is moved to another company by id.
    conn.execute("UPDATE proposals SET company_id = ?1, client = 'Epsilon Test Co' WHERE id = 1", params![other]).unwrap();
    // A contact is linked to the other company through entity_links too.
    conn.execute("INSERT INTO entity_links (from_type, from_id, to_type, to_id, created_at) VALUES ('contact', 1, 'company', ?1, '2026-09-15')", params![other]).unwrap();
    let report = integrity_report(&conn).unwrap();
    assert_eq!(report.count("opportunities whose proposal belongs to another company"), 1);
    assert_eq!(report.count("links to a company that contradict the record's own company"), 1);
    // Nothing was changed to make them agree.
    assert_eq!(company_id(&conn, "opportunities", opp), Some(co));
    assert_eq!(company_id(&conn, "contacts", 1), Some(co));
    let _ = (project, meeting);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn outlook_owned_meeting_fields_survive_a_stale_save() {
    let (path, mut conn) = fresh_db("stale-meeting");
    let event: menabig_tracker_lib::ms365::graph::GraphEvent = serde_json::from_value(serde_json::json!({
        "id": "AAMk-stale-test", "subject": "Planning",
        "start": { "dateTime": "2026-09-20T09:00:00.0000000", "timeZone": "UTC" },
        "end": { "dateTime": "2026-09-20T10:00:00.0000000", "timeZone": "UTC" },
        "attendees": [{ "emailAddress": { "name": "Guest", "address": "guest@example.test" } }]
    })).unwrap();
    upsert_meeting_from_event(&conn, &event, "2026-09-15T08:00:00Z").unwrap();
    let loaded: Meeting = {
        let id: i64 = one(&conn, "SELECT id FROM meetings");
        Meeting { id, title: "Planning".into(), meeting_date: Some("2026-09-20".into()), attendees: vec!["Guest".into()], ..Default::default() }
    };
    // Outlook moves and renames the meeting while the page still holds the old copy…
    let mut moved = event.clone();
    moved.subject = Some("Planning (moved)".into());
    moved.start = serde_json::from_value(serde_json::json!({ "dateTime": "2026-09-21T09:00:00.0000000", "timeZone": "UTC" })).unwrap();
    upsert_meeting_from_event(&conn, &moved, "2026-09-15T09:00:00Z").unwrap();
    // …then the user types an agenda on that old copy.
    save_meeting_row(&mut conn, &Meeting { agenda: Some("1. Budget".into()), ..loaded }).unwrap();
    let (title, date, agenda): (String, String, String) = conn.query_row("SELECT title, meeting_date, agenda FROM meetings", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((title.as_str(), date.as_str(), agenda.as_str()), ("Planning (moved)", "2026-09-21", "1. Budget"));
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn migrations_run_in_version_order_even_when_listed_out_of_order() {
    let (path, conn) = fresh_db("order");
    let base: i64 = one::<String>(&conn, "SELECT value FROM app_meta WHERE key = 'schema_version'").parse().unwrap();
    run_test_steps(&conn, &[
        (base + 2, "INSERT INTO step_log (v) VALUES ('second');"),
        (base + 1, "CREATE TABLE step_log (v TEXT); INSERT INTO step_log (v) VALUES ('first');"),
    ]).unwrap();
    let order: Vec<String> = conn.prepare("SELECT v FROM step_log ORDER BY rowid").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    assert_eq!(order, ["first", "second"]);
    assert_eq!(one::<String>(&conn, "SELECT value FROM app_meta WHERE key = 'schema_version'"), (base + 2).to_string());
    // Running them again does nothing: the version is already there.
    run_test_steps(&conn, &[(base + 1, "INSERT INTO step_log (v) VALUES ('again');")]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM step_log"), 2);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn a_damaged_database_is_restored_from_its_backup() {
    let dir = std::env::temp_dir().join(format!("menabig_foundation_restore_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("menabig.sqlite3");
    let mut conn = init_connection(&db).unwrap();
    build_work_graph(&mut conn, "Zeta Restore Co", 1);
    let counts = |c: &Connection| -> Vec<i64> {
        ["companies", "contacts", "opportunities", "proposals", "projects", "meetings", "notes", "todos", "entity_links"]
            .iter().map(|t| one::<i64>(c, &format!("SELECT COUNT(*) FROM {t}"))).collect()
    };
    let before = counts(&conn);
    let backups = dir.join("backups");
    let snapshot = ensure_daily_backup(&conn, &backups, 14).unwrap().unwrap();
    // A half-written snapshot never counts as a backup.
    std::fs::write(backups.join("daily-2099-01-01.partial"), b"half").unwrap();
    assert!(menabig_tracker_lib::backups::list_backups(&backups).iter().all(|b| !b.file_name.ends_with(".partial")));
    drop(conn);

    // The database file is damaged.
    std::fs::write(&db, b"this is not a database").unwrap();
    assert!(init_connection(&db).is_err());

    // Restore = put the snapshot back and open it the way the app does.
    std::fs::copy(&snapshot, &db).unwrap();
    let restored = init_connection(&db).unwrap();
    assert_eq!(counts(&restored), before);
    assert!(integrity_report(&restored).unwrap().is_clean());
    drop(restored);
    let _ = std::fs::remove_dir_all(&dir);
}

// ── Final closure: the company invariant on every entity ─────────────────────

/// Links a record of every kind to `company` by id while its text names another
/// existing company, saves an unrelated field on each, and returns the ids.
#[test]
fn saving_unrelated_fields_never_moves_any_record_to_another_company() {
    let (path, mut conn) = fresh_db("invariant");
    let (x, opp, project, meeting) = build_work_graph(&mut conn, "Kappa Test Co", 1);
    let y = create_company_named(&conn, "Lambda Test Co").unwrap().unwrap();
    // Every record's company text now names Y, while its company_id stays X.
    for (table, col) in [("contacts", "client_name"), ("proposals", "client"), ("projects", "company_name"), ("meetings", "company_name"), ("notes", "client_name"), ("todos", "client")] {
        conn.execute(&format!("UPDATE {table} SET {col} = 'Lambda Test Co' WHERE company_id = ?1"), params![x]).unwrap();
    }
    let loaded = read_all_data(&conn).unwrap();
    let p = loaded.proposals.iter().find(|p| p.id == 1).unwrap().clone();
    let c = loaded.contacts.iter().find(|c| c.id == 1).unwrap().clone();
    let t = loaded.todos.iter().find(|t| t.id == 1).unwrap().clone();
    let n = loaded.notes.iter().find(|n| n.id == 1).unwrap().clone();

    upsert_proposal_rows(&mut conn, &[Proposal { status: "Sent to Client".into(), remarks: Some("Chased".into()), monthly_fee: Some(9000.0), ..p }]).unwrap();
    upsert_contact_rows(&mut conn, &[Contact { role: Some("CFO".into()), phone: Some("+000".into()), ..c }]).unwrap();
    upsert_todo_rows(&mut conn, &[Todo { title: "Send the plan today".into(), due_date: Some("2026-09-20".into()), status: Some("Done".into()), ..t }]).unwrap();
    upsert_note_rows(&mut conn, &[Note { title: Some("Kickoff notes v2".into()), content: Some("Decisions".into()), ..n }]).unwrap();
    let proj = Project {
        id: project, name: "Rollout (phase 2)".into(), r#type: "client".into(), status: "In Progress".into(), priority: "High".into(),
        company_name: Some("Lambda Test Co".into()), description: Some("changed".into()), ..Default::default()
    };
    save_project_row(&mut conn, &proj).unwrap();
    let mt = Meeting { id: meeting, title: "Kickoff (moved)".into(), company_name: Some("Lambda Test Co".into()), agenda: Some("1. Scope".into()), project_id: Some(project), ..Default::default() };
    save_meeting_row(&mut conn, &mt).unwrap();
    let o = Opportunity { id: opp, name: "Workforce deal".into(), company_name: Some("Kappa Test Co".into()), stage: "Negotiation".into(), status: "Open".into(), estimated_value: Some(50000.0), ..Default::default() };
    save_opportunity_row(&mut conn, &o).unwrap();

    for (table, id) in [("proposals", 1), ("contacts", 1), ("todos", 1), ("notes", 1), ("projects", project), ("meetings", meeting), ("opportunities", opp)] {
        assert_eq!(company_id(&conn, table, id), Some(x), "{table}: an unrelated edit must not change the company");
    }
    assert_eq!(one::<i64>(&conn, &format!("SELECT COUNT(*) FROM proposals WHERE company_id = {y}")), 0);
    // The disagreement between text and link is reported, not resolved.
    assert!(integrity_report(&conn).unwrap().count("proposals: company text doesn't match its linked company") == 1);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn renaming_a_company_keeps_every_link_and_shows_the_new_name() {
    let (path, mut conn) = fresh_db("rename-display");
    let (x, opp, _project, _meeting) = build_work_graph(&mut conn, "Acme", 1);
    rename_company_row(&conn, x, "Acme International").unwrap();
    assert_eq!(company_id(&conn, "opportunities", opp), Some(x));
    let shown: String = conn.query_row("SELECT c.name FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.id = ?1", params![opp], |r| r.get(0)).unwrap();
    assert_eq!(shown, "Acme International");
    // The old name is a former name: it finds the same company and creates nothing.
    let companies: i64 = one(&conn, "SELECT COUNT(*) FROM companies");
    assert_eq!(menabig_tracker_lib::opportunities::match_company_name(&conn, "Acme").unwrap(), menabig_tracker_lib::opportunities::CompanyMatch::One(x));
    upsert_contact_rows(&mut conn, &[Contact { id: 77, name: Some("New Person".into()), client_name: Some("Acme".into()), ..Default::default() }]).unwrap();
    assert_eq!(company_id(&conn, "contacts", 77), Some(x));
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM companies"), companies);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn ambiguous_names_keep_the_existing_link_or_go_to_review() {
    let (path, mut conn) = fresh_db("ambiguous");
    let a = create_company_named(&conn, "Mu Trading").unwrap().unwrap();
    let b = create_company_named(&conn, "Mu Contracting").unwrap().unwrap();
    conn.execute("UPDATE companies SET legal_name = 'Mu Group LLC' WHERE id IN (?1, ?2)", params![a, b]).unwrap();
    let companies: i64 = one(&conn, "SELECT COUNT(*) FROM companies");

    // A linked record whose company text is edited to the ambiguous name keeps its link.
    upsert_proposal_rows(&mut conn, &[proposal(1, "Mu Trading", "Drafting")]).unwrap();
    upsert_proposal_rows(&mut conn, &[proposal(1, "Mu Group LLC", "Drafting")]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 1), Some(a));

    // An unlinked record with the ambiguous name stays unlinked and goes to the review queue.
    upsert_contact_rows(&mut conn, &[Contact { id: 9, name: Some("Someone".into()), client_name: Some("Mu Group LLC".into()), ..Default::default() }]).unwrap();
    assert_eq!(company_id(&conn, "contacts", 9), None);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM company_review_queue WHERE raw_name = 'Mu Group LLC' AND status = 'pending'"), 1);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM companies"), companies, "no company invented for an ambiguous name");
    // A second record with the same name doesn't add a second review entry.
    upsert_todo_rows(&mut conn, &[Todo { id: 3, title: "Call".into(), client: Some("Mu Group LLC".into()), ..Default::default() }]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM company_review_queue WHERE raw_name = 'Mu Group LLC'"), 1);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn choosing_another_company_does_move_the_record() {
    let (path, mut conn) = fresh_db("reassign");
    let (x, opp, project, meeting) = build_work_graph(&mut conn, "Nu Test Co", 1);
    let y = create_company_named(&conn, "Xi Test Co").unwrap().unwrap();
    let o: Opportunity = Opportunity { id: opp, name: "Workforce deal".into(), company_id: Some(x), company_name: Some("Xi Test Co".into()), stage: "Proposal".into(), status: "Open".into(), ..Default::default() };
    assert_eq!(save_opportunity_row(&mut conn, &o).unwrap().company_id, Some(y));
    let loaded = read_all_data(&conn).unwrap();
    let p = loaded.proposals.iter().find(|p| p.id == 1).unwrap().clone();
    upsert_proposal_rows(&mut conn, &[Proposal { client: "Xi Test Co".into(), ..p }]).unwrap();
    assert_eq!(company_id(&conn, "proposals", 1), Some(y));
    save_project_row(&mut conn, &Project { id: project, name: "Rollout".into(), r#type: "client".into(), status: "Active".into(), priority: "Medium".into(), company_name: Some("Xi Test Co".into()), ..Default::default() }).unwrap();
    assert_eq!(company_id(&conn, "projects", project), Some(y));
    // Clearing the company removes the link.
    save_meeting_row(&mut conn, &Meeting { id: meeting, title: "Kickoff".into(), company_name: None, ..Default::default() }).unwrap();
    assert_eq!(company_id(&conn, "meetings", meeting), None);
    // A brand-new company typed in still works (legacy free-text behaviour).
    upsert_contact_rows(&mut conn, &[Contact { id: 50, name: Some("New".into()), client_name: Some("Omicron Test Co".into()), ..Default::default() }]).unwrap();
    assert!(company_id(&conn, "contacts", 50).is_some());
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn company_notes_follow_the_company_id_through_renames_and_merges() {
    let (path, mut conn) = fresh_db("company-notes");
    let pi = create_company_named(&conn, "Pi Test Co").unwrap().unwrap();
    menabig_tracker_lib::commands::save_company_note_row(&conn, "Pi Test Co", "Prefers email").unwrap();
    assert_eq!(one::<Option<i64>>(&conn, "SELECT company_id FROM company_notes"), Some(pi));
    rename_company_row(&conn, pi, "Pi Holdings").unwrap();
    let notes = read_all_data(&conn).unwrap().company_notes;
    assert_eq!(notes.get("Pi Holdings").map(String::as_str), Some("Prefers email"));
    assert!(!notes.contains_key("Pi Test Co"));
    menabig_tracker_lib::commands::save_company_note_row(&conn, "Pi Holdings", "Prefers email and calls").unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM company_notes"), 1);

    // Merging into a company without notes carries them over.
    let rho = create_company_named(&conn, "Rho Test Co").unwrap().unwrap();
    merge_company_links_core(&mut conn, "Pi Holdings", "Rho Test Co").unwrap();
    assert_eq!(one::<Option<i64>>(&conn, "SELECT company_id FROM company_notes"), Some(rho));
    assert_eq!(read_all_data(&conn).unwrap().company_notes.get("Rho Test Co").map(String::as_str), Some("Prefers email and calls"));

    // Notes saved under a name no company has stay readable by that name, unlinked.
    menabig_tracker_lib::commands::save_company_note_row(&conn, "Unknown Name Co", "Legacy note").unwrap();
    assert_eq!(read_all_data(&conn).unwrap().company_notes.get("Unknown Name Co").map(String::as_str), Some("Legacy note"));
    assert_eq!(integrity_report(&conn).unwrap().count("company notes not linked to a company"), 1);
    drop(conn);
    let _ = std::fs::remove_file(path);
}
