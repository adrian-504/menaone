// Company 360 as a briefing (schema 37): pinned company notes and the
// Decision maker flag on contacts. Both default to off, survive the full
// backup, and a JSON backup made before they existed still restores.
// Fictional names only.
use menabig_tracker_lib::activity::set_company_note_pinned_core;
use menabig_tracker_lib::commands::{read_all_data, restore_backup_core, upsert_contact_rows};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::full_backup::{export_full_backup_core, restore_full_backup_core};
use menabig_tracker_lib::models::{AppData, Contact};
use rusqlite::{params, Connection};
use std::path::PathBuf;

fn tmp(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("menabig_company_brief_{name}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&p);
    p
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn contact(id: i64, name: &str, dm: bool) -> Contact {
    Contact { id, client_name: Some("Contoso Logistics".into()), name: Some(name.into()), role: Some("Finance director".into()), is_decision_maker: dm, ..Default::default() }
}

#[test]
fn new_columns_default_to_off() {
    let mut conn = init_connection(&tmp("defaults")).unwrap();
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    assert!(latest_schema_version() >= 37);
    conn.execute("INSERT INTO contacts (id, client_name, name) VALUES (1, 'Contoso Logistics', 'Dana Park')", []).unwrap();
    conn.execute("INSERT INTO company_note_entries (company_name, body, created_at) VALUES ('Contoso Logistics', 'Signs off above SAR 50k', '2026-09-01')", []).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT is_decision_maker FROM contacts WHERE id = 1"), 0);
    assert_eq!(one::<i64>(&conn, "SELECT pinned FROM company_note_entries"), 0);
    assert!(!read_all_data(&conn).unwrap().contacts[0].is_decision_maker);
    let _ = &mut conn;
}

#[test]
fn saving_a_contact_keeps_the_flag_and_pinning_keeps_the_dates() {
    let mut conn = init_connection(&tmp("save")).unwrap();
    upsert_contact_rows(&mut conn, &[contact(1, "Dana Park", true), contact(2, "Sam Lee", false)]).unwrap();
    let all = read_all_data(&conn).unwrap().contacts;
    assert!(all.iter().find(|c| c.id == 1).unwrap().is_decision_maker);
    assert!(!all.iter().find(|c| c.id == 2).unwrap().is_decision_maker);
    // A later save of other fields keeps it, and unticking clears it.
    upsert_contact_rows(&mut conn, &[Contact { phone: Some("+966 00 000 0000".into()), ..contact(1, "Dana Park", true) }]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT is_decision_maker FROM contacts WHERE id = 1"), 1);
    upsert_contact_rows(&mut conn, &[contact(1, "Dana Park", false)]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT is_decision_maker FROM contacts WHERE id = 1"), 0);

    conn.execute("INSERT INTO company_note_entries (company_name, body, created_at) VALUES ('Contoso Logistics', 'Prefers email', '2026-09-01T08:00:00Z')", []).unwrap();
    let id = conn.last_insert_rowid();
    let e = set_company_note_pinned_core(&conn, id, true).unwrap();
    assert!(e.pinned);
    assert_eq!(e.created_at, "2026-09-01T08:00:00Z");
    assert!(e.updated_at.is_none());
    assert!(!set_company_note_pinned_core(&conn, id, false).unwrap().pinned);
}

#[test]
fn both_flags_survive_a_full_backup() {
    let mut conn = init_connection(&tmp("live")).unwrap();
    upsert_contact_rows(&mut conn, &[contact(1, "Dana Park", true)]).unwrap();
    conn.execute("INSERT INTO company_note_entries (company_name, body, created_at, pinned) VALUES ('Contoso Logistics', 'Prefers email', '2026-09-01', 1)", []).unwrap();
    let file = tmp("backup");
    export_full_backup_core(&conn, &file).unwrap();
    conn.execute("UPDATE contacts SET is_decision_maker = 0", []).unwrap();
    conn.execute("UPDATE company_note_entries SET pinned = 0", []).unwrap();
    restore_full_backup_core(&mut conn, &file).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT is_decision_maker FROM contacts WHERE id = 1"), 1);
    assert_eq!(one::<i64>(&conn, "SELECT pinned FROM company_note_entries"), 1);
}

#[test]
fn a_json_backup_from_before_the_flags_still_restores() {
    let mut conn = init_connection(&tmp("json")).unwrap();
    // A contact as an older version wrote it: no isDecisionMaker.
    let data: AppData = serde_json::from_value(serde_json::json!({
        "proposals": [], "agreements": [], "todos": [], "notes": [], "noteFolders": [], "contactLists": [], "companyNotes": {},
        "contacts": [{ "id": 7, "clientName": "Contoso Logistics", "name": "Dana Park", "role": "CEO", "lists": [] }]
    })).unwrap();
    restore_backup_core(&mut conn, &data).unwrap();
    let c: (String, i64) = conn.query_row("SELECT name, is_decision_maker FROM contacts WHERE id = 7", params![], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(c, ("Dana Park".into(), 0));
}
