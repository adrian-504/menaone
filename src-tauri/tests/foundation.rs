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

    // Someone deliberately creating a new company with the old name gets a new company.
    let new_alpha = create_company_named(&conn, "Alpha Test Co").unwrap().unwrap();
    assert_ne!(new_alpha, alpha);
    assert!(integrity_report(&conn).unwrap().is_clean(), "{:?}", integrity_report(&conn).unwrap());
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
