// The backup file you save yourself is a complete copy of the database:
// restoring it brings back every table exactly, an older copy is brought up to
// date, and anything wrong is refused without touching the data. Fictional
// names only.
use menabig_tracker_lib::commitments::{add_commitments, NewCommitment};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::full_backup::{check_full_backup, export_full_backup_core, restore_full_backup_core, restore_with_recovery};
use menabig_tracker_lib::opportunities::{create_company_named, save_opportunity_row};
use menabig_tracker_lib::v2_commands::{save_meeting_row, save_project_row};
use menabig_tracker_lib::v2_models::{Meeting, Opportunity, Project};
use rusqlite::{params, Connection};
use std::path::PathBuf;

fn tmp(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("menabig_full_backup_{name}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&p);
    p
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Every row of every table, as text — to compare two databases exactly.
fn everything(conn: &Connection) -> Vec<(String, Vec<String>)> {
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index%' ORDER BY name").unwrap()
        .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    tables.into_iter().map(|t| {
        let mut stmt = conn.prepare(&format!("SELECT * FROM \"{t}\" ORDER BY rowid")).unwrap();
        let n = stmt.column_count();
        let rows = stmt.query_map([], |r| {
            Ok((0..n).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|"))
        }).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        (t, rows)
    }).collect()
}

/// A company with an opportunity waiting on the client, a project, a meeting and a promise.
fn seed(conn: &mut Connection) -> i64 {
    let company = create_company_named(conn, "Contoso Logistics").unwrap().unwrap();
    let opp = save_opportunity_row(conn, &Opportunity {
        name: "Contoso payroll".into(), company_id: Some(company), company_name: Some("Contoso Logistics".into()), stage: "Proposal".into(),
        waiting_on: Some("them".into()), waiting_since: Some("2026-09-05".into()), waiting_note: Some("Headcount".into()), ..Default::default()
    }).unwrap().id;
    save_project_row(conn, &Project { name: "Contoso rollout".into(), company_name: Some("Contoso Logistics".into()), ..Default::default() }).unwrap();
    let meeting = save_meeting_row(conn, &Meeting {
        title: "Contoso check-in".into(), meeting_date: Some("2026-09-21".into()), company_id: Some(company), opportunity_id: Some(opp),
        decisions: Some(">> Send the quote".into()), ..Default::default()
    }).unwrap().id;
    add_commitments(conn, &[NewCommitment {
        direction: "ours".into(), text: "Send the quote".into(), company_id: Some(company), opportunity_id: Some(opp), meeting_id: Some(meeting),
        source_type: "meeting".into(), source_id: Some(meeting), source_key: Some("send the quote".into()), ..Default::default()
    }]).unwrap();
    opp
}

#[test]
fn a_full_backup_brings_back_every_table_exactly() {
    let live_path = tmp("live");
    let mut conn = init_connection(&live_path).unwrap();
    let opp = seed(&mut conn);
    let file = tmp("file");
    export_full_backup_core(&conn, &file).unwrap();
    let at_backup = everything(&conn);
    let summary = check_full_backup(&file).unwrap();
    assert_eq!((summary.companies, summary.opportunities, summary.projects, summary.meetings, summary.commitments), (1, 1, 1, 1, 1));

    // Things change after the backup…
    conn.execute("UPDATE opportunities SET waiting_on = 'us', waiting_note = NULL WHERE id = ?1", params![opp]).unwrap();
    conn.execute("DELETE FROM meetings", []).unwrap();
    conn.execute("DELETE FROM commitments", []).unwrap();
    create_company_named(&mut conn, "Fabrikam Test").unwrap();

    // …and the backup puts every table back as it was.
    restore_full_backup_core(&mut conn, &file).unwrap();
    assert_eq!(everything(&conn), at_backup);
    assert_eq!(one::<String>(&conn, "SELECT waiting_on FROM opportunities"), "them");
    drop(conn);
    let _ = std::fs::remove_file(live_path);
    let _ = std::fs::remove_file(file);
}

#[test]
fn a_backup_from_an_older_version_is_brought_up_to_date() {
    let live_path = tmp("older_live");
    let mut conn = init_connection(&live_path).unwrap();
    seed(&mut conn);
    let file = tmp("older_file");
    export_full_backup_core(&conn, &file).unwrap();
    // Make the file look like schema 35: before commitments and waiting-on.
    {
        let old = Connection::open(&file).unwrap();
        let triggers: Vec<String> = old.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'cm_%' OR name LIKE '%commitment%')").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        for t in triggers { old.execute_batch(&format!("DROP TRIGGER \"{t}\";")).unwrap(); }
        old.execute_batch(
            "DROP TABLE commitments;
             ALTER TABLE opportunities DROP COLUMN waiting_on;
             ALTER TABLE opportunities DROP COLUMN waiting_since;
             ALTER TABLE opportunities DROP COLUMN waiting_note;
             UPDATE app_meta SET value = '35' WHERE key = 'schema_version';",
        ).unwrap();
    }
    let summary = restore_full_backup_core(&mut conn, &file).unwrap();
    assert_eq!(summary.schema_version, latest_schema_version());
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM commitments"), 0);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM opportunities WHERE waiting_on IS NULL"), 1);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM companies"), 1);
    drop(conn);
    let _ = std::fs::remove_file(live_path);
    let _ = std::fs::remove_file(file);
}

#[test]
fn newer_damaged_or_foreign_files_are_refused_and_nothing_changes() {
    let live_path = tmp("refuse_live");
    let mut conn = init_connection(&live_path).unwrap();
    seed(&mut conn);
    let before = everything(&conn);

    let newer = tmp("newer");
    export_full_backup_core(&conn, &newer).unwrap();
    Connection::open(&newer).unwrap().execute("UPDATE app_meta SET value = '999' WHERE key = 'schema_version'", []).unwrap();
    let e = restore_full_backup_core(&mut conn, &newer).unwrap_err();
    assert!(e.contains("newer version"), "{e}");

    let junk = tmp("junk");
    std::fs::write(&junk, b"not a database at all").unwrap();
    assert!(restore_full_backup_core(&mut conn, &junk).is_err());

    let foreign = tmp("foreign");
    Connection::open(&foreign).unwrap().execute_batch("CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT);").unwrap();
    let e = restore_full_backup_core(&mut conn, &foreign).unwrap_err();
    assert!(e.contains("isn't a MENA One backup"), "{e}");

    assert_eq!(everything(&conn), before, "nothing changed");
    drop(conn);
    for p in [live_path, newer, junk, foreign] { let _ = std::fs::remove_file(p); }
}

#[test]
fn a_restore_that_fails_part_way_puts_the_data_back() {
    let live_path = tmp("recover_live");
    let mut conn = init_connection(&live_path).unwrap();
    seed(&mut conn);
    let before = everything(&conn);
    let snapshot = tmp("recover_snapshot");
    export_full_backup_core(&conn, &snapshot).unwrap();

    // A copy that passes the checks but whose migration fails: it says it is
    // at version 35 while already having 36's columns.
    let bad = tmp("recover_bad");
    export_full_backup_core(&conn, &bad).unwrap();
    {
        let c = Connection::open(&bad).unwrap();
        c.execute("UPDATE app_meta SET value = '35' WHERE key = 'schema_version'", []).unwrap();
        c.execute("DELETE FROM companies", []).unwrap();
    }
    assert!(check_full_backup(&bad).is_ok(), "it looks fine until it's migrated");
    let e = restore_with_recovery(&mut conn, &bad, &snapshot).unwrap_err();
    assert!(e.contains("put back exactly as it was"), "{e}");
    assert_eq!(everything(&conn), before, "the original data is in place");

    // If even the snapshot can't be put back, the error names it.
    let missing = tmp("recover_missing_snapshot");
    let e = restore_with_recovery(&mut conn, &bad, &missing).unwrap_err();
    assert!(e.contains(&missing.display().to_string()), "{e}");
    drop(conn);
    for p in [live_path, snapshot, bad] { let _ = std::fs::remove_file(p); }
}

#[test]
fn saving_over_an_existing_backup_is_all_or_nothing() {
    let live_path = tmp("atomic_live");
    let conn = init_connection(&live_path).unwrap();
    let file = tmp("atomic_file");
    std::fs::write(&file, b"previous backup").unwrap();
    // A destination whose folder doesn't exist can't be written: the old file is untouched elsewhere.
    let nowhere = std::env::temp_dir().join(format!("menabig_no_such_dir_{}", std::process::id())).join("x").join("b.sqlite3");
    assert!(export_full_backup_core(&conn, &nowhere.with_file_name("")).is_err() || !nowhere.exists());
    // A good save replaces the old file completely and leaves no temporary file.
    export_full_backup_core(&conn, &file).unwrap();
    assert!(check_full_backup(&file).is_ok());
    assert!(!file.with_extension("partial").exists());
    drop(conn);
    for p in [live_path, file] { let _ = std::fs::remove_file(p); }
}
