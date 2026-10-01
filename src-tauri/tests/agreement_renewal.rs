// Agreement renewal (records, 1.61): migration 44 adds what was decided, when,
// and — on a drafted renewal — the agreement it renews. Agreements are saved
// two ways (the whole table, and row by row); a column missing from either
// would be lost on the next save. Scratch databases only.
use menabig_tracker_lib::commands::{read_all_data, upsert_agreement_rows, write_agreements};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::models::{Agreement, CommercialLine};
use rusqlite::Connection;

fn fresh_db(tag: &str) -> Connection {
    let path = std::env::temp_dir().join(format!("menabig_agreement_renewal_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    init_connection(&path).expect("init db")
}

fn agreement(id: i64) -> Agreement {
    Agreement {
        id, agr_ref: Some(format!("GLX_BS_00{id}_0126")), client: Some("Globex".into()), r#type: Some("Company maintenance".into()),
        status: Some("Signed".into()), start_date: Some("2026-01-06".into()), end_date: Some("2026-12-31".into()),
        service_status: Some("Active".into()), notice_days: Some(90), contract_months: Some(12), currency: Some("SAR".into()),
        lines: vec![CommercialLine { id: 40 + id, service_name: "Company maintenance".into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(4000.0), ..Default::default() }],
        ..Default::default()
    }
}

fn columns(conn: &Connection) -> Vec<String> {
    conn.prepare("SELECT name FROM pragma_table_info('agreements')").unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
}

#[test]
fn migration_44_adds_three_nullable_columns_and_running_it_again_changes_nothing() {
    let conn = fresh_db("columns");
    assert!(latest_schema_version() >= 44);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    let cols = columns(&conn);
    for c in ["renewal_decision", "renewal_decided_at", "renewed_from"] {
        assert_eq!(cols.iter().filter(|x| x.as_str() == c).count(), 1, "{c} is there once");
    }
    // Opening the same file again runs the migrations' guards, not the ALTERs.
    let path = conn.path().unwrap().to_string();
    drop(conn);
    let again = init_connection(&std::path::PathBuf::from(&path)).expect("reopen");
    assert_eq!(columns(&again), cols);
}

#[test]
fn an_agreement_saved_before_the_decision_reads_as_undecided() {
    let mut conn = fresh_db("undecided");
    write_agreements(&mut conn, &[agreement(1)]).unwrap();
    let a = &read_all_data(&conn).unwrap().agreements[0];
    assert_eq!((a.renewal_decision.as_deref(), a.renewal_decided_at.as_deref(), a.renewed_from), (None, None, None));
}

#[test]
fn the_decision_and_the_drafted_renewal_survive_both_ways_of_saving() {
    let mut conn = fresh_db("roundtrip");
    let mut old = agreement(1);
    old.renewal_decision = Some("renew".into());
    old.renewal_decided_at = Some("2026-10-01".into());
    let mut draft = agreement(2);
    draft.status = Some("In Preparation".into());
    draft.start_date = Some("2027-01-01".into());
    draft.end_date = Some("2027-12-31".into());
    draft.renewed_from = Some(1);

    // The whole table at once.
    write_agreements(&mut conn, &[old.clone(), draft.clone()]).unwrap();
    let read = read_all_data(&conn).unwrap().agreements;
    assert_eq!(read[0].renewal_decision.as_deref(), Some("renew"));
    assert_eq!(read[0].renewal_decided_at.as_deref(), Some("2026-10-01"));
    assert_eq!(read[1].renewed_from, Some(1));
    // Each agreement keeps its own line.
    assert_eq!((read[0].lines.len(), read[1].lines.len()), (1, 1));

    // Row by row (what the app does on an edit): change the decision, then clear it.
    let mut changed = read[0].clone();
    changed.renewal_decision = Some("end".into());
    upsert_agreement_rows(&mut conn, &[changed]).unwrap();
    let read = read_all_data(&conn).unwrap().agreements;
    assert_eq!(read[0].renewal_decision.as_deref(), Some("end"));
    assert_eq!(read[1].renewed_from, Some(1), "saving one row leaves the other alone");

    let mut cleared = read[0].clone();
    cleared.renewal_decision = None;
    cleared.renewal_decided_at = None;
    upsert_agreement_rows(&mut conn, &[cleared]).unwrap();
    let a = &read_all_data(&conn).unwrap().agreements[0];
    assert_eq!((a.renewal_decision.as_deref(), a.renewal_decided_at.as_deref()), (None, None));
}

const OLD_COLUMNS: &[&str] = &[
    "id", "agr_ref", "client", "type", "status", "prepared_by", "date_prepared", "date_sent_to_client", "date_client_signed",
    "date_mena_signed", "date_filed", "monthly_fee", "contract_months", "proposal_id", "hubspot", "doc_link", "action_date",
    "remarks", "created_at", "company_id", "business_entity_id", "currency", "start_date", "end_date", "service_status",
    "auto_renew", "notice_days", "prepared_by_id",
];

/// Every agreement as one string over the columns that existed before migration 44, in id order.
fn old_rows(conn: &Connection) -> Vec<String> {
    let cols = OLD_COLUMNS.iter().map(|c| format!("quote({c})")).collect::<Vec<_>>().join(" || '|' || ");
    conn.prepare(&format!("SELECT {cols} FROM agreements ORDER BY id")).unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
}

/// Which of the old columns differ between two snapshots, with how many rows each.
fn columns_changed(before: &[String], after: &[String]) -> Vec<(String, usize)> {
    let mut hits = vec![0usize; OLD_COLUMNS.len()];
    for (b, a) in before.iter().zip(after.iter()) {
        if b == a { continue; }
        let (bp, ap): (Vec<&str>, Vec<&str>) = (b.split('|').collect(), a.split('|').collect());
        if bp.len() != ap.len() || bp.len() != OLD_COLUMNS.len() { hits[0] += 1; continue; }
        for (i, (x, y)) in bp.iter().zip(ap.iter()).enumerate() { if x != y { hits[i] += 1; } }
    }
    OLD_COLUMNS.iter().zip(hits).filter(|(_, n)| *n > 0).map(|(c, n)| (c.to_string(), n)).collect()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Opt-in, against a COPY of a real database (never the live file):
///   MENA_REHEARSAL_DB=/scratch/copy.sqlite3 cargo test --test agreement_renewal -- --ignored --nocapture
/// Opens only that file: the migration reads and writes no other path.
#[test]
#[ignore]
fn rehearse_migration_44_on_a_copy() {
    let Ok(path) = std::env::var("MENA_REHEARSAL_DB") else { return };
    // The live database is under ~/Library/Application Support, the shared folder under ~/Library/CloudStorage.
    assert!(!path.contains("/Application Support/") && !path.contains("/CloudStorage/"), "use a scratch copy, not the live database");
    let (version_before, rows_before, lines_before, proposals_before) = {
        let plain = Connection::open(&path).unwrap();
        (schema_version(&plain).unwrap(), old_rows(&plain), count(&plain, "SELECT count(*) FROM agreement_lines"), count(&plain, "SELECT count(*) FROM proposals"))
    };
    println!("before: schema {version_before}, {} agreements, {lines_before} agreement lines, {proposals_before} proposals", rows_before.len());

    let mut conn = init_connection(&std::path::PathBuf::from(&path)).unwrap();
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    assert!(columns_changed(&rows_before, &old_rows(&conn)).is_empty(), "no existing agreement value changed");
    assert_eq!(count(&conn, "SELECT count(*) FROM agreement_lines"), lines_before);
    assert_eq!(count(&conn, "SELECT count(*) FROM proposals"), proposals_before);
    if version_before < 44 {
        assert_eq!(count(&conn, "SELECT count(*) FROM agreements WHERE renewal_decision IS NOT NULL OR renewal_decided_at IS NOT NULL OR renewed_from IS NOT NULL"), 0, "every agreement starts undecided");
    }
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(check, "ok");
    println!("after:  schema {}, {} agreements unchanged, integrity {check}", schema_version(&conn).unwrap(), rows_before.len());

    // The app's own save: every agreement as read, written back row by row.
    let all = read_all_data(&conn).unwrap().agreements;
    upsert_agreement_rows(&mut conn, &all).unwrap();
    // Names the columns that moved, never the values (this runs on real records).
    let moved = columns_changed(&rows_before, &old_rows(&conn));
    println!("re-save: columns that changed on any agreement: {moved:?}");
    // A save has always re-derived the monthly fee from the agreement's lines (apply_derived_agreement_totals);
    // an agreement whose stored fee differs from its lines is corrected by any save, with or without this migration.
    let unexpected: Vec<_> = moved.iter().filter(|(c, _)| c != "monthly_fee").collect();
    assert!(unexpected.is_empty(), "saving what was read changes nothing but derived fees (changed: {unexpected:?})");
    let after_save = old_rows(&conn);
    assert_eq!(count(&conn, "SELECT count(*) FROM agreement_lines"), lines_before);

    // And a decision on the first one survives a save and a re-read.
    if let Some(first) = all.first() {
        let mut a = first.clone();
        a.renewal_decision = Some("end".into());
        a.renewal_decided_at = Some("2026-10-01".into());
        upsert_agreement_rows(&mut conn, &[a]).unwrap();
        let back = read_all_data(&conn).unwrap().agreements.into_iter().find(|x| x.id == first.id).unwrap();
        assert_eq!(back.renewal_decision.as_deref(), Some("end"));
        assert!(columns_changed(&after_save, &old_rows(&conn)).is_empty(), "the decision touches no other column");
        println!("decision: saved and read back on one agreement; nothing else moved");
    }
}
