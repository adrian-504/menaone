// Agreement terms and the proposal's last step (records, 1.61): migration 44
// adds, on agreements, what was decided about the renewal, when, the agreement
// a drafted renewal renews, how the term renews and how far the signatures
// got; on proposals, the day the service started. Records are saved two ways
// (the whole table, and row by row); a column missing from either would be
// lost on the next save. A save that does not change what an agreement's lines
// add up to leaves its stored monthly fee alone. Scratch databases only.
use menabig_tracker_lib::commands::{read_all_data, upsert_agreement_rows, upsert_proposal_rows, write_agreements, write_proposals};
use menabig_tracker_lib::db::{backfill_agreement_terms, init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::models::{Agreement, CommercialLine, Proposal};
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

fn columns(conn: &Connection, table: &str) -> Vec<String> {
    conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')")).unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
}

#[test]
fn migration_44_adds_six_nullable_columns_and_running_it_again_changes_nothing() {
    let conn = fresh_db("columns");
    assert!(latest_schema_version() >= 44);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    let agreements = columns(&conn, "agreements");
    for c in ["renewal_decision", "renewal_decided_at", "renewed_from", "renewal_type", "signature_status"] {
        assert_eq!(agreements.iter().filter(|x| x.as_str() == c).count(), 1, "agreements.{c} is there once");
    }
    let proposals = columns(&conn, "proposals");
    assert_eq!(proposals.iter().filter(|x| x.as_str() == "service_started_at").count(), 1);
    // Opening the same file again runs the migrations' guards, not the ALTERs.
    let path = conn.path().unwrap().to_string();
    drop(conn);
    let again = init_connection(&std::path::PathBuf::from(&path)).expect("reopen");
    assert_eq!(columns(&again, "agreements"), agreements);
    assert_eq!(columns(&again, "proposals"), proposals);
}

#[test]
fn the_backfills_fill_only_what_is_empty_from_what_is_already_recorded() {
    let mut conn = fresh_db("backfill");
    let mut auto = agreement(1);
    auto.auto_renew = true;
    let mut both = agreement(2);
    both.date_client_signed = Some("2026-01-05".into());
    both.date_mena_signed = Some("2026-01-06".into());
    let mut client_only = agreement(3);
    client_only.date_client_signed = Some("2026-01-05".into());
    let mut ours_only = agreement(4);
    ours_only.date_mena_signed = Some("2026-01-06".into());
    let mut chosen = agreement(5);
    chosen.auto_renew = true;
    chosen.renewal_type = Some("fixed".into());
    chosen.date_client_signed = Some("2026-01-05".into());
    chosen.signature_status = Some("client_po".into());
    write_agreements(&mut conn, &[auto, both, client_only, ours_only, chosen, agreement(6)]).unwrap();

    let p = |id: i64, status: &str| Proposal { id, client: "Sample Client".into(), status: status.into(), date_added: Some("2026-08-01".into()), ..Default::default() };
    let mut signed = p(1, "Signed by Both Parties");
    signed.dbl_signed_date = Some("2026-09-10".into());
    signed.date_sent_to_client = Some("2026-09-01".into());
    let mut sent_only = p(2, "Signed by Both Parties");
    sent_only.date_sent_to_client = Some("2026-09-02".into());
    let added_only = p(3, "Signed by Both Parties");
    let mut client_signed = p(4, "Signed by Client");
    client_signed.date_signed = Some("2026-09-12".into());
    let mut with_client = p(5, "Sent to Client");
    with_client.date_sent_to_client = Some("2026-09-03".into());
    let mut already = p(6, "Signed by Both Parties");
    already.dbl_signed_date = Some("2026-09-10".into());
    already.service_started_at = Some("2026-09-20".into());
    // Signed, with no date of its own: one with a kickoff, one whose agreement has a start date, one with nothing at all.
    let mut kickoff = Proposal { id: 7, client: "Sample Client".into(), status: "Signed by Both Parties".into(), ..Default::default() };
    kickoff.kickoff_date = Some("2026-09-15".into());
    let from_agreement = Proposal { id: 8, client: "Sample Client".into(), status: "Signed by Both Parties".into(), ..Default::default() };
    let undated = Proposal { id: 9, client: "Sample Client".into(), status: "Signed by Both Parties".into(), ..Default::default() };
    upsert_proposal_rows(&mut conn, &[signed, sent_only, added_only, client_signed, with_client, already, kickoff, from_agreement, undated]).unwrap();
    conn.execute("UPDATE agreements SET proposal_id = 8, start_date = '2026-01-06' WHERE id = 6", []).unwrap();

    assert_eq!(backfill_agreement_terms(&conn).unwrap(), (1, 3, 6), "rows filled: renewal type, signature status, service started");
    let data = read_all_data(&conn).unwrap();
    let renewal: Vec<Option<&str>> = data.agreements.iter().map(|a| a.renewal_type.as_deref()).collect();
    assert_eq!(renewal, vec![Some("auto"), None, None, None, Some("fixed"), None]);
    let signature: Vec<Option<&str>> = data.agreements.iter().map(|a| a.signature_status.as_deref()).collect();
    assert_eq!(signature, vec![None, Some("signed_both"), Some("client_signed"), Some("mena_signed"), Some("client_po"), None]);
    let started: Vec<Option<&str>> = data.proposals.iter().map(|p| p.service_started_at.as_deref()).collect();
    // Signed by both: the signature date, else the day it was sent, else the day it was added. Not signed by both: not started.
    assert_eq!(&started[..8], &[Some("2026-09-10"), Some("2026-09-02"), Some("2026-08-01"), None, None, Some("2026-09-20"), Some("2026-09-15"), Some("2026-01-06")]);
    // Nothing to go by at all: the day of the migration, so it still counts as started.
    assert!(started[8].is_some_and(|d| d.len() == 10));
    // A second run finds nothing left to fill.
    assert_eq!(backfill_agreement_terms(&conn).unwrap(), (0, 0, 0));
}

#[test]
fn the_service_start_survives_both_ways_of_saving_a_proposal() {
    let mut conn = fresh_db("proposal");
    let mut p = Proposal { id: 1, client: "Sample Client".into(), status: "Signed by Both Parties".into(), ..Default::default() };
    p.service_started_at = Some("2026-10-12".into());
    write_proposals(&mut conn, &[p.clone()]).unwrap();
    assert_eq!(read_all_data(&conn).unwrap().proposals[0].service_started_at.as_deref(), Some("2026-10-12"));
    p.service_started_at = Some("2026-10-01".into());
    upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap();
    assert_eq!(read_all_data(&conn).unwrap().proposals[0].service_started_at.as_deref(), Some("2026-10-01"));
    p.service_started_at = None;
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    assert_eq!(read_all_data(&conn).unwrap().proposals[0].service_started_at, None);
}

#[test]
fn a_save_that_leaves_the_lines_total_alone_leaves_the_stored_fee_alone() {
    let mut conn = fresh_db("fee");
    // The lines add up to 4,000 a month.
    write_agreements(&mut conn, &[agreement(1), agreement(2)]).unwrap();
    assert_eq!(read_all_data(&conn).unwrap().agreements[0].monthly_fee, Some(4000.0), "a new agreement takes its fee from its lines");
    // The billed figure differs from the lines on one, and is empty on the other.
    conn.execute("UPDATE agreements SET monthly_fee = 4500 WHERE id = 1", []).unwrap();
    conn.execute("UPDATE agreements SET monthly_fee = NULL WHERE id = 2", []).unwrap();
    let read = read_all_data(&conn).unwrap().agreements;
    assert_eq!((read[0].monthly_fee, read[1].monthly_fee), (Some(4500.0), None));

    // A renewal decision, a renewal type and a signature status — row by row.
    let mut a = read[0].clone();
    a.renewal_decision = Some("renew".into());
    a.renewal_type = Some("fixed".into());
    a.signature_status = Some("signed_both".into());
    let mut b = read[1].clone();
    b.renewal_decision = Some("end".into());
    upsert_agreement_rows(&mut conn, &[a, b]).unwrap();
    let read = read_all_data(&conn).unwrap().agreements;
    assert_eq!((read[0].monthly_fee, read[1].monthly_fee), (Some(4500.0), None), "a decision never changes a fee");
    assert_eq!(read[0].renewal_decision.as_deref(), Some("renew"));

    // …and the whole table at once.
    write_agreements(&mut conn, &read).unwrap();
    let read = read_all_data(&conn).unwrap().agreements;
    assert_eq!((read[0].monthly_fee, read[1].monthly_fee), (Some(4500.0), None));

    // Renaming a service on a line is not a change of fee either.
    let mut renamed = read[0].clone();
    renamed.lines[0].service_name = "Company upkeep".into();
    upsert_agreement_rows(&mut conn, &[renamed]).unwrap();
    assert_eq!(read_all_data(&conn).unwrap().agreements[0].monthly_fee, Some(4500.0));

    // Changing what the lines add up to is: the fee follows the lines.
    let mut repriced = read_all_data(&conn).unwrap().agreements[0].clone();
    repriced.lines[0].unit_price = Some(5000.0);
    upsert_agreement_rows(&mut conn, &[repriced]).unwrap();
    assert_eq!(read_all_data(&conn).unwrap().agreements[0].monthly_fee, Some(5000.0));
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

    // First what the app does on launch before it migrates: a checked snapshot, into a scratch folder beside the copy.
    let backups = std::path::PathBuf::from(&path).parent().unwrap().join("rehearsal-backups");
    let snapshot = menabig_tracker_lib::backups::backup_before_migrations(std::path::Path::new(&path), &backups).unwrap();
    if version_before < latest_schema_version() {
        let file = snapshot.expect("behind this build, so it is copied first");
        assert!(menabig_tracker_lib::housekeeping::file_is_intact(&file), "the snapshot passes its check");
        let kept = Connection::open(&file).unwrap();
        assert_eq!(schema_version(&kept).unwrap(), version_before, "the snapshot is the database as it was");
        println!("backup: {} taken before migrating, intact", file.file_name().unwrap().to_string_lossy());
    }
    // What the backfills should find, counted on the file as it is.
    let expect = {
        let plain = Connection::open(&path).unwrap();
        (
            count(&plain, "SELECT count(*) FROM agreements WHERE auto_renew = 1"),
            count(&plain, "SELECT count(*) FROM agreements WHERE ifnull(date_client_signed, '') <> '' OR ifnull(date_mena_signed, '') <> ''"),
            count(&plain, "SELECT count(*) FROM proposals WHERE status = 'Signed by Both Parties'"),
        )
    };
    let mut conn = init_connection(&std::path::PathBuf::from(&path)).unwrap();
    if version_before < 44 {
        let filled = (
            count(&conn, "SELECT count(*) FROM agreements WHERE renewal_type IS NOT NULL"),
            count(&conn, "SELECT count(*) FROM agreements WHERE signature_status IS NOT NULL"),
            count(&conn, "SELECT count(*) FROM proposals WHERE service_started_at IS NOT NULL"),
        );
        println!("backfilled: renewal_type {} · signature_status {} · service_started_at {} (of {} signed by both)", filled.0, filled.1, filled.2, expect.2);
        assert_eq!((filled.0, filled.1), (expect.0, expect.1));
        assert_eq!(filled.2, expect.2, "every proposal signed by both counts as started");
        assert_eq!(count(&conn, "SELECT count(*) FROM proposals WHERE service_started_at IS NOT NULL AND status <> 'Signed by Both Parties'"), 0);
    }
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
    // Since 1.61 a save that leaves the lines' total alone leaves the stored fee alone, so nothing moves — not even
    // on an agreement whose stored fee differs from its lines.
    assert!(moved.is_empty(), "saving what was read changes nothing (changed: {moved:?})");
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
