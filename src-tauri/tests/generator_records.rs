// The generator's records (generator, 1.66): migration 46 adds the proposal a
// new one was started from; on a proposal's documents the review round and its
// reason, the version sent to the client, the file's fingerprint when it was
// written, the version a price revision was made from and whether hand edits
// were not carried; and a custom line's unit, on proposal and agreement lines.
// Every save path carries them, and a custom line's unit and billing always
// agree after a save. Scratch databases only.
use menabig_tracker_lib::commands::{read_all_data, upsert_agreement_rows, upsert_proposal_rows, write_agreements, write_proposals};
use menabig_tracker_lib::commercial::{derive_totals, normalize_custom_line};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version, MIGRATION_46_COLUMNS};
use menabig_tracker_lib::models::{Agreement, CommercialLine, LineRate, Proposal, ProposalDocument};
use rusqlite::Connection;

fn fresh_db(tag: &str) -> Connection {
    let path = std::env::temp_dir().join(format!("menabig_generator_records_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    init_connection(&path).expect("init db")
}

fn columns(conn: &Connection, table: &str) -> Vec<String> {
    conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')")).unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn proposal(id: i64) -> Proposal {
    Proposal { id, client: "Sample Client".into(), status: "Drafting".into(), ..Default::default() }
}

fn custom(id: i64, name: &str, unit: &str, price: f64) -> CommercialLine {
    CommercialLine { id, service_name: name.into(), description: Some("What is in scope, in a few words".into()), billing: "monthly".into(), quantity: 1.0, unit_price: Some(price), unit: Some(unit.into()), ..Default::default() }
}

#[test]
fn migration_46_adds_nine_nullable_columns_and_running_it_again_changes_nothing() {
    let conn = fresh_db("columns");
    assert!(latest_schema_version() >= 46);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    assert_eq!(MIGRATION_46_COLUMNS.len(), 9);
    for (table, column, _) in MIGRATION_46_COLUMNS {
        assert_eq!(columns(&conn, table).iter().filter(|x| x.as_str() == *column).count(), 1, "{table}.{column} is there once");
        let notnull: i64 = conn.query_row(&format!("SELECT \"notnull\" FROM pragma_table_info('{table}') WHERE name = '{column}'"), [], |r| r.get(0)).unwrap();
        assert_eq!(notnull, 0, "{table}.{column} is nullable");
    }
    let before: Vec<Vec<String>> = ["proposals", "proposal_documents", "proposal_lines", "agreement_lines"].iter().map(|t| columns(&conn, t)).collect();
    let path = conn.path().unwrap().to_string();
    drop(conn);
    let again = init_connection(&std::path::PathBuf::from(&path)).expect("reopen");
    let after: Vec<Vec<String>> = ["proposals", "proposal_documents", "proposal_lines", "agreement_lines"].iter().map(|t| columns(&again, t)).collect();
    assert_eq!(before, after);
}

#[test]
fn what_a_proposal_was_based_on_survives_both_ways_of_saving_and_never_dangles() {
    let mut conn = fresh_db("based_on");
    let mut copy = proposal(2);
    copy.based_on_id = Some(1);
    // The whole table: the link is kept when the other proposal is in the set, whatever the order.
    write_proposals(&mut conn, &[copy.clone(), proposal(1)]).unwrap();
    let based = |conn: &Connection| read_all_data(conn).unwrap().proposals.into_iter().map(|p| (p.id, p.based_on_id)).collect::<Vec<_>>();
    assert_eq!(based(&conn), vec![(1, None), (2, Some(1))]);
    // Row by row: saving what was read changes nothing.
    let read = read_all_data(&conn).unwrap().proposals;
    upsert_proposal_rows(&mut conn, &read).unwrap();
    assert_eq!(based(&conn), vec![(1, None), (2, Some(1))]);
    // A link to a proposal that is not there, or to itself, is dropped rather than refused.
    let mut dangling = proposal(3);
    dangling.based_on_id = Some(99);
    let mut own = proposal(4);
    own.based_on_id = Some(4);
    upsert_proposal_rows(&mut conn, &[dangling, own]).unwrap();
    assert_eq!(based(&conn), vec![(1, None), (2, Some(1)), (3, None), (4, None)]);
    // The proposal it was based on is deleted: the copy stays, with no link.
    conn.execute("DELETE FROM proposals WHERE id = 1", []).unwrap();
    assert_eq!(based(&conn), vec![(2, None), (3, None), (4, None)]);
    // Cleared row by row.
    let mut cleared = proposal(2);
    cleared.based_on_id = None;
    upsert_proposal_rows(&mut conn, &[cleared]).unwrap();
    assert_eq!(count(&conn, "SELECT count(*) FROM proposals WHERE based_on_id IS NOT NULL"), 0);
}

#[test]
fn a_documents_round_fingerprint_and_sent_mark_survive_a_save_and_a_reread() {
    let mut conn = fresh_db("documents");
    let mut p = proposal(1);
    p.documents = vec![
        ProposalDocument { id: 1, kind: "proposal".into(), version: Some(1), file_name: "Sample_Payroll Proposal_011026.pptx".into(), path: Some("/scratch/V1.pptx".into()), created_at: Some("2026-10-01".into()), generated_sha256: Some("aa11".into()), round: Some("internal".into()), ..Default::default() },
        ProposalDocument { id: 2, kind: "proposal".into(), version: Some(2), file_name: "Sample_Payroll Proposal_021026_V2.pptx".into(), path: Some("/scratch/V2.pptx".into()), created_at: Some("2026-10-02".into()), notes: Some("9 amounts updated on slides 14, 15; dates on slides 1 and 2".into()),
            round: Some("client".into()), round_reason: Some("Price on three people".into()), sent_to_client_at: Some("2026-10-02".into()), generated_sha256: Some("bb22".into()), carried_from_version: Some(1), ..Default::default() },
        ProposalDocument { id: 3, kind: "proposal".into(), version: Some(3), file_name: "Sample_Payroll Proposal_031026_V3.pptx".into(), path: Some("/scratch/V3.pptx".into()), created_at: Some("2026-10-03".into()), not_carried: true, carried_from_version: Some(2), ..Default::default() },
        ProposalDocument { id: 4, kind: "supporting".into(), file_name: "Old upload.pdf".into(), path: Some("/scratch/old.pdf".into()), ..Default::default() },
    ];
    let expect = p.documents.clone();
    for save in ["whole table", "row by row", "row by row again"] {
        if save == "whole table" { write_proposals(&mut conn, &[p.clone()]).unwrap(); } else { upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap(); }
        let back = read_all_data(&conn).unwrap().proposals.into_iter().next().unwrap().documents;
        for (b, e) in back.iter().zip(expect.iter()) {
            assert_eq!((b.id, &b.round, &b.round_reason, &b.sent_to_client_at, &b.generated_sha256, b.carried_from_version, b.not_carried, &b.notes),
                (e.id, &e.round, &e.round_reason, &e.sent_to_client_at, &e.generated_sha256, e.carried_from_version, e.not_carried, &e.notes), "{save}: document {}", e.id);
        }
    }
    // What was recorded before 1.66 has none of them, and "not carried" is stored only when it is so.
    assert_eq!(count(&conn, "SELECT count(*) FROM proposal_documents WHERE id = 4 AND round IS NULL AND generated_sha256 IS NULL AND sent_to_client_at IS NULL AND carried_from_version IS NULL AND not_carried IS NULL"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM proposal_documents WHERE not_carried = 1"), 1);
    // The mark moves to another version: the first one loses it.
    p.documents[1].sent_to_client_at = None;
    p.documents[2].sent_to_client_at = Some("2026-10-04".into());
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    assert_eq!(conn.query_row("SELECT group_concat(id) FROM proposal_documents WHERE sent_to_client_at IS NOT NULL", [], |r| r.get::<_, String>(0)).unwrap(), "3");
}

#[test]
fn a_custom_lines_unit_and_billing_always_agree_after_a_save_on_both_paths() {
    let mut conn = fresh_db("unit");
    // Every unit, each saved with the wrong billing on purpose.
    let lines = vec![
        CommercialLine { billing: "one_time".into(), ..custom(1, "Site supervision", "per_month", 4000.0) },
        CommercialLine { billing: "monthly".into(), ..custom(2, "Set-up workshop", "one_time", 9000.0) },
        CommercialLine { billing: "one_time".into(), ..custom(3, "On-site support", "per_person_per_month", 150.0) },
        CommercialLine { billing: "monthly".into(), ..custom(4, "Visa processing", "per_visa", 1200.0) },
        CommercialLine { billing: "monthly".into(), ..custom(5, "Executive search", "percent_of_annual_package", 12.0) },
        // A catalogue line: no unit, left exactly as it is.
        CommercialLine { id: 6, service_id: None, service_name: "Payroll".into(), billing: "monthly".into(), quantity: 2.0, unit_price: Some(3000.0), ..Default::default() },
        // A unit it does not know: saved as an ordinary line.
        CommercialLine { id: 7, service_name: "Odd one".into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(10.0), unit: Some("per_fortnight".into()), ..Default::default() },
    ];
    let expect: Vec<(i64, Option<&str>, &str, Option<f64>)> = vec![
        (1, Some("per_month"), "monthly", Some(4000.0)), (2, Some("one_time"), "one_time", Some(9000.0)),
        (3, Some("per_person_per_month"), "monthly", None), (4, Some("per_visa"), "one_time", None), (5, Some("percent_of_annual_package"), "one_time", None),
        (6, None, "monthly", Some(3000.0)), (7, None, "monthly", Some(10.0)),
    ];
    let shape = |ls: &[CommercialLine]| ls.iter().map(|l| (l.id, l.unit.clone(), l.billing.clone(), l.unit_price)).collect::<Vec<_>>();
    let want: Vec<(i64, Option<String>, String, Option<f64>)> = expect.iter().map(|(i, u, b, p)| (*i, u.map(str::to_string), b.to_string(), *p)).collect();

    // The proposal path: the whole table, then row by row, then what was read saved again.
    let mut p = proposal(1);
    p.lines = lines.clone();
    write_proposals(&mut conn, &[p.clone()]).unwrap();
    assert_eq!(shape(&read_all_data(&conn).unwrap().proposals[0].lines), want, "proposal lines, whole table");
    upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap();
    let read = read_all_data(&conn).unwrap().proposals;
    assert_eq!(shape(&read[0].lines), want, "proposal lines, row by row");
    upsert_proposal_rows(&mut conn, &read).unwrap();
    let saved = read_all_data(&conn).unwrap().proposals.into_iter().next().unwrap();
    assert_eq!(shape(&saved.lines), want, "saving what was read changes nothing");
    // The three units that are not a sum keep their price in the line's one priced row, and its scope text stays.
    assert_eq!(saved.lines[2].rates, vec![LineRate { label: "Per person per month".into(), price: Some(150.0), ..Default::default() }]);
    assert_eq!(saved.lines[3].rates, vec![LineRate { label: "Per visa".into(), price: Some(1200.0), ..Default::default() }]);
    assert_eq!(saved.lines[4].rates, vec![LineRate { label: "% of annual package".into(), percent: Some(12.0), ..Default::default() }]);
    assert_eq!(saved.lines[2].description.as_deref(), Some("What is in scope, in a few words"));
    // Totals read billing and nothing else: per month and one-time count; the other three never do.
    let (_, monthly, one_time) = derive_totals(&saved.lines);
    assert_eq!((monthly, one_time), (Some(4000.0 + 6000.0 + 10.0), Some(9000.0)));
    assert_eq!((saved.monthly_fee, saved.one_time_fee), (Some(10010.0), Some(9000.0)), "the proposal's stored totals follow");

    // The agreement path, both ways.
    let agreement = Agreement { id: 1, agr_ref: Some("SMP_ADM_001_1026".into()), client: Some("Sample Client".into()), status: Some("In Preparation".into()), lines: lines.iter().map(|l| CommercialLine { id: l.id + 100, ..l.clone() }).collect(), ..Default::default() };
    let want_agr: Vec<(i64, Option<String>, String, Option<f64>)> = want.iter().map(|(i, u, b, p)| (i + 100, u.clone(), b.clone(), *p)).collect();
    write_agreements(&mut conn, &[agreement.clone()]).unwrap();
    assert_eq!(shape(&read_all_data(&conn).unwrap().agreements[0].lines), want_agr, "agreement lines, whole table");
    upsert_agreement_rows(&mut conn, &[agreement]).unwrap();
    let read = read_all_data(&conn).unwrap().agreements;
    assert_eq!(shape(&read[0].lines), want_agr, "agreement lines, row by row");
    upsert_agreement_rows(&mut conn, &read).unwrap();
    assert_eq!(shape(&read_all_data(&conn).unwrap().agreements[0].lines), want_agr);

    // In the table itself no custom line's unit and billing disagree.
    for table in ["proposal_lines", "agreement_lines"] {
        assert_eq!(count(&conn, &format!("SELECT count(*) FROM {table} WHERE unit IS NOT NULL")), 5);
        assert_eq!(count(&conn, &format!(
            "SELECT count(*) FROM {table} WHERE (unit IN ('per_month', 'per_person_per_month') AND billing <> 'monthly')
               OR (unit IN ('one_time', 'per_visa', 'percent_of_annual_package') AND billing <> 'one_time')
               OR (unit IN ('per_person_per_month', 'per_visa', 'percent_of_annual_package') AND unit_price IS NOT NULL)"
        )), 0, "{table}");
    }
}

#[test]
fn normalising_a_custom_line_is_stable_and_leaves_catalogue_lines_alone() {
    let once = normalize_custom_line(&custom(1, "On-site support", "per_person_per_month", 150.0));
    assert_eq!(normalize_custom_line(&once), once, "a second pass changes nothing");
    assert_eq!((once.billing.as_str(), once.unit_price, once.quantity), ("monthly", None, 1.0));
    let catalogue = CommercialLine { id: 2, service_id: Some(15), service_name: "Workforce".into(), billing: "monthly".into(), quantity: 1.0, rates: vec![LineRate { label: "Engineers".into(), price: Some(500.0), ..Default::default() }], ..Default::default() };
    assert_eq!(normalize_custom_line(&catalogue), catalogue);
    let blank = CommercialLine { unit: Some("  ".into()), ..catalogue.clone() };
    assert_eq!(normalize_custom_line(&blank).unit, None);
}

#[test]
fn drafting_an_agreement_carries_a_custom_lines_unit() {
    let mut conn = fresh_db("draft");
    let mut p = Proposal { id: 1, client: "Sample Client".into(), status: "Signed by Both Parties".into(), dbl_signed_date: Some("2026-10-01".into()), ..Default::default() };
    p.lines = vec![custom(1, "Visa processing", "per_visa", 1200.0), custom(2, "Site supervision", "per_month", 4000.0)];
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    let drafted = menabig_tracker_lib::commands::draft_agreement_for_proposal_core(&mut conn, 1).unwrap();
    let lines = &drafted[0].lines;
    assert_eq!(lines.iter().map(|l| (l.service_name.as_str(), l.unit.as_deref(), l.billing.as_str(), l.unit_price)).collect::<Vec<_>>(),
        vec![("Visa processing", Some("per_visa"), "one_time", None), ("Site supervision", Some("per_month"), "monthly", Some(4000.0))]);
    assert_eq!(drafted[0].monthly_fee, Some(4000.0));
}

/// Every row's listed columns as one string, to compare before and after without printing a value.
fn rows_of(conn: &Connection, table: &str, cols: &[String]) -> Vec<String> {
    let list = cols.iter().map(|c| format!("quote(\"{c}\")")).collect::<Vec<_>>().join(" || '|' || ");
    conn.prepare(&format!("SELECT {list} FROM {table} ORDER BY id")).unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
}

/// Opt-in, against a COPY of a real database (never the live file):
///   MENA_REHEARSAL_DB=/scratch/copy.sqlite3 cargo test --test generator_records -- --ignored --nocapture
/// Opens only that file and a backups folder beside it. Prints counts and column names, never a value.
#[test]
#[ignore]
fn rehearse_migration_46_on_a_copy() {
    let Ok(path) = std::env::var("MENA_REHEARSAL_DB") else { return };
    // The live database is under ~/Library/Application Support, the shared folder under ~/Library/CloudStorage.
    assert!(!path.contains("/Application Support/") && !path.contains("/CloudStorage/"), "use a scratch copy, not the live database");
    const TABLES: [&str; 5] = ["proposals", "proposal_documents", "proposal_lines", "agreement_lines", "agreements"];
    // What is there before: every table's own columns (minus the sync bookkeeping a save may bump), row by row.
    let (version_before, before) = {
        let plain = Connection::open(&path).unwrap();
        let before: Vec<(Vec<String>, Vec<String>)> = TABLES.iter().map(|t| {
            let cols: Vec<String> = columns(&plain, t).into_iter().filter(|c| c != "row_version" && c != "row_updated_at").collect();
            let rows = rows_of(&plain, t, &cols);
            (cols, rows)
        }).collect();
        (schema_version(&plain).unwrap(), before)
    };
    println!("before: schema {version_before}, {}", TABLES.iter().zip(before.iter()).map(|(t, (_, rows))| format!("{} {t}", rows.len())).collect::<Vec<_>>().join(", "));

    // First what the app does on launch before it migrates: a checked snapshot, into a scratch folder beside the copy.
    let backups = std::path::PathBuf::from(&path).parent().unwrap().join("rehearsal-backups");
    let snapshot = menabig_tracker_lib::backups::backup_before_migrations(std::path::Path::new(&path), &backups).unwrap();
    if version_before < latest_schema_version() {
        let file = snapshot.expect("behind this build, so it is copied first");
        assert!(menabig_tracker_lib::housekeeping::file_is_intact(&file), "the snapshot passes its check");
        assert_eq!(schema_version(&Connection::open(&file).unwrap()).unwrap(), version_before, "the snapshot is the database as it was");
        println!("backup: {} taken before migrating, intact", file.file_name().unwrap().to_string_lossy());
    }

    let mut conn = init_connection(&std::path::PathBuf::from(&path)).unwrap();
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    for (table, column, _) in MIGRATION_46_COLUMNS {
        assert_eq!(columns(&conn, table).iter().filter(|x| x.as_str() == *column).count(), 1, "{table}.{column}");
        assert_eq!(count(&conn, &format!("SELECT count(*) FROM {table} WHERE {column} IS NOT NULL")), 0, "{table}.{column} starts empty on every row");
    }
    let unchanged = |conn: &Connection, what: &str| {
        for (t, (cols, rows)) in TABLES.iter().zip(before.iter()) {
            assert_eq!(&rows_of(conn, t, cols), rows, "{what}: {t} is as it was in every column it had");
        }
    };
    unchanged(&conn, "after migrating");
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(check, "ok");
    println!("after:  schema {}, every row of {} unchanged in every column it had; the 9 new columns empty; integrity {check}", schema_version(&conn).unwrap(), TABLES.join(", "));

    // The app's own saves: every proposal and every agreement as read, written back row by row.
    let data = read_all_data(&conn).unwrap();
    upsert_proposal_rows(&mut conn, &data.proposals).unwrap();
    upsert_agreement_rows(&mut conn, &data.agreements).unwrap();
    unchanged(&conn, "after re-saving");
    assert_eq!(count(&conn, "SELECT count(*) FROM proposal_lines WHERE unit IS NOT NULL") + count(&conn, "SELECT count(*) FROM agreement_lines WHERE unit IS NOT NULL"), 0, "no catalogue line gained a unit");
    println!("re-save: {} proposals and {} agreements written back as read; nothing moved, no line gained a unit", data.proposals.len(), data.agreements.len());

    // And the new fields survive a save and a re-read on one proposal, touching nothing else of it.
    if let Some(first) = data.proposals.iter().find(|p| !p.documents.is_empty()).or(data.proposals.first()) {
        let mut p = first.clone();
        p.based_on_id = data.proposals.iter().map(|x| x.id).find(|id| *id != first.id);
        if let Some(d) = p.documents.first_mut() { d.round = Some("client".into()); d.round_reason = Some("rehearsal".into()); d.sent_to_client_at = Some("2026-10-01".into()); d.generated_sha256 = Some("rehearsal".into()); }
        let id = p.lines.iter().map(|l| l.id).max().unwrap_or(0).max(count(&conn, "SELECT coalesce(max(id), 0) FROM proposal_lines")) + 1;
        p.lines.push(CommercialLine { id, service_name: "Rehearsal line".into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(1.0), unit: Some("per_visa".into()), ..Default::default() });
        upsert_proposal_rows(&mut conn, &[p]).unwrap();
        let back = read_all_data(&conn).unwrap().proposals.into_iter().find(|x| x.id == first.id).unwrap();
        assert!(back.based_on_id.is_some());
        let line = back.lines.iter().find(|l| l.id == id).unwrap();
        assert_eq!((line.unit.as_deref(), line.billing.as_str(), line.unit_price), (Some("per_visa"), "one_time", None));
        if let Some(d) = back.documents.first() { assert_eq!((d.round.as_deref(), d.sent_to_client_at.as_deref()), (Some("client"), Some("2026-10-01"))); }
        // Put back as it was: the custom line goes, the link and the marks clear.
        upsert_proposal_rows(&mut conn, &[first.clone()]).unwrap();
        unchanged(&conn, "after the new fields were set and cleared");
        println!("new fields: set, read back and cleared on one proposal; every table is as it was");
    }
}
