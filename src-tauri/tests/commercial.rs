// Commercial core: service lines drive a proposal's summary fields, a won
// proposal's agreement carries its lines, and the legacy clean-up can run
// again (after a restore) without duplicating anything. Fake data only.
use menabig_tracker_lib::commands::{create_agreements_from_proposals, read_all_data, upsert_proposal_rows, write_proposals};
use menabig_tracker_lib::commercial::{normalize_commercial_data, STATUS_WON};
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::models::{CommercialLine, LineRate, Proposal};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_commercial_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

fn service_id(conn: &Connection, name: &str) -> i64 {
    conn.query_row("SELECT id FROM services WHERE name = ?1", params![name], |r| r.get(0)).unwrap()
}

fn line(id: i64, service_id: Option<i64>, name: &str, billing: &str, price: Option<f64>) -> CommercialLine {
    CommercialLine { id, service_id, service_name: name.into(), billing: billing.into(), quantity: 1.0, unit_price: price, ..Default::default() }
}

#[test]
fn lines_drive_totals_and_keep_their_identity() {
    let (path, mut conn) = fresh_db("lines");
    let payroll = service_id(&conn, "Payroll");
    let constitution = service_id(&conn, "Company Constitution");
    let mut p = Proposal {
        id: 1, client: "Test Trading Co".into(), status: "Drafting".into(), currency: Some("SAR".into()),
        lines: vec![line(1, Some(payroll), "Payroll", "monthly", Some(3000.0)), line(2, Some(constitution), "Company Constitution", "one_time", Some(55000.0))],
        ..Default::default()
    };
    upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap();
    let (t, m, o): (String, f64, f64) = conn
        .query_row("SELECT type, monthly_fee, one_time_fee FROM proposals WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap();
    assert_eq!((t.as_str(), m, o), ("Payroll + Company Constitution", 3000.0, 55000.0));
    let uuid: String = conn.query_row("SELECT uuid FROM proposal_lines WHERE id = 1", [], |r| r.get(0)).unwrap();

    // Change the price of one line and remove the other.
    p.lines = vec![line(1, Some(payroll), "Payroll", "monthly", Some(3500.0))];
    upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap();
    let data = read_all_data(&conn).unwrap();
    let saved = data.proposals.iter().find(|x| x.id == 1).unwrap();
    assert_eq!(saved.lines.len(), 1);
    assert_eq!(saved.r#type.as_deref(), Some("Payroll"));
    assert_eq!(saved.monthly_fee, Some(3500.0));
    assert_eq!(saved.one_time_fee, None);
    let uuid_after: String = conn.query_row("SELECT uuid FROM proposal_lines WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(uuid, uuid_after, "an edited line keeps its sync identity");
    let tomb: i64 = conn.query_row("SELECT COUNT(*) FROM sync_tombstones WHERE table_name = 'proposal_lines'", [], |r| r.get(0)).unwrap();
    assert_eq!(tomb, 1, "the removed line is recorded for sync");

    drop(conn);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn won_proposal_gets_an_agreement_with_its_lines() {
    let (path, mut conn) = fresh_db("agreement");
    let recruitment = service_id(&conn, "Recruitment");
    let pro = service_id(&conn, "PRO");
    let eu: i64 = conn.query_row("SELECT id FROM business_entities WHERE code = 'EU'", [], |r| r.get(0)).unwrap();
    let p = Proposal {
        id: 7, client: "Example Europe SL".into(), status: STATUS_WON.into(), dbl_signed_date: Some("2026-09-01".into()),
        kickoff_date: Some("2026-10-01".into()), contract_months: Some(12), business_entity_id: Some(eu), currency: Some("EUR".into()),
        lines: vec![
            line(10, Some(recruitment), "Recruitment", "monthly", Some(4000.0)),
            CommercialLine {
                employee_count: Some(9),
                rates: vec![
                    LineRate { label: "1–5 employees".into(), from: Some(1), to: Some(5), price: Some(750.0), ..Default::default() },
                    LineRate { label: "6–15 employees".into(), from: Some(6), to: Some(15), price: Some(1500.0), ..Default::default() },
                ],
                ..line(11, Some(pro), "PRO", "monthly", Some(1000.0))
            },
        ],
        ..Default::default()
    };
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    let created = create_agreements_from_proposals(&mut conn).unwrap();
    assert_eq!(created.len(), 1);
    let a = &created[0];
    assert_eq!(a.status.as_deref(), Some("In Preparation"));
    assert_eq!(a.r#type.as_deref(), Some("Workforce"), "type comes from the first service in the catalog");
    assert_eq!(a.currency.as_deref(), Some("EUR"));
    assert_eq!(a.business_entity_id, Some(eu));
    assert_eq!(a.start_date.as_deref(), Some("2026-10-01"));
    assert_eq!(a.end_date.as_deref(), Some("2027-09-30"));
    assert_eq!(a.lines.len(), 2);
    assert_eq!(a.lines.iter().map(|l| l.unit_price.unwrap_or(0.0)).sum::<f64>(), 5000.0);
    let pro_line = a.lines.iter().find(|l| l.service_name == "PRO").unwrap();
    assert_eq!((pro_line.rates.len(), pro_line.employee_count), (2, Some(9)), "priced rows carry onto the agreement");
    let reread = read_all_data(&conn).unwrap().proposals.into_iter().find(|p| p.id == 7).unwrap();
    assert_eq!(reread.lines[1].rates[1].price, Some(1500.0));

    assert!(create_agreements_from_proposals(&mut conn).unwrap().is_empty(), "running again creates nothing");
    drop(conn);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn legacy_records_are_cleaned_up_once_and_restores_stay_consistent() {
    let (path, mut conn) = fresh_db("legacy");
    let hassan: i64 = conn.query_row("SELECT id FROM team_members WHERE name = 'Hassan Balaghi'", [], |r| r.get(0)).unwrap();
    // A restore of an old backup writes the original tracker's statuses.
    let legacy = vec![
        Proposal { id: 1, client: "Old Client A".into(), r#type: Some("Payroll".into()), status: "Service Started".into(), monthly_fee: Some(2500.0), kickoff_date: Some("2026-01-01".into()), contract_months: Some(12), ..Default::default() },
        Proposal { id: 2, client: "Old Client B".into(), r#type: Some("PRO".into()), status: "Proposal sent to Hassan for review".into(), date_sent_to_hassan: Some("2026-09-01".into()), ..Default::default() },
        Proposal { id: 3, client: "Old Client C".into(), r#type: Some("—".into()), status: "Closed".into(), ..Default::default() },
    ];
    write_proposals(&mut conn, &legacy).unwrap();
    normalize_commercial_data(&conn).unwrap();
    normalize_commercial_data(&conn).unwrap();

    let data = read_all_data(&conn).unwrap();
    let by_id = |id: i64| data.proposals.iter().find(|p| p.id == id).unwrap();
    assert_eq!(by_id(1).status, STATUS_WON);
    assert_eq!(by_id(1).lines.len(), 1, "one line, even after running twice");
    assert_eq!(by_id(1).lines[0].unit_price, Some(2500.0));
    assert_eq!(by_id(2).status, "In Internal Review");
    assert_eq!(by_id(2).reviewer_id, Some(hassan));
    assert_eq!(by_id(2).review_status.as_deref(), Some("pending"));
    assert_eq!(by_id(3).status, "Lost");
    assert!(by_id(3).lines.is_empty(), "no service, no line");
    assert!(data.proposals.iter().all(|p| p.currency.as_deref() == Some("SAR")));

    assert_eq!(data.agreements.len(), 1, "the won proposal gets exactly one agreement");
    let a = &data.agreements[0];
    assert_eq!(a.service_status.as_deref(), Some("Active"), "service started carries over");
    assert_eq!(a.end_date.as_deref(), Some("2026-12-31"));
    assert_eq!(a.lines.len(), 1);

    let activity: i64 = conn.query_row("SELECT COUNT(*) FROM activity WHERE action = 'status_changed'", [], |r| r.get(0)).unwrap();
    assert_eq!(activity, 0, "the clean-up is not logged as user activity");
    drop(conn);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn pricing_ranges_reach_an_existing_catalog_without_overwriting_edits() {
    use menabig_tracker_lib::commercial::migrate_pricing_ranges;
    let (path, conn) = fresh_db("pricing");
    let pricing = |name: &str| -> serde_json::Value {
        serde_json::from_str(&conn.query_row("SELECT pricing_json FROM rate_cards WHERE name = ?1", params![name], |r| r.get::<_, String>(0)).unwrap()).unwrap()
    };
    // A catalog as shipped before v25, with one card edited by the team.
    conn.execute("UPDATE rate_cards SET pricing_json = ?1 WHERE name = 'Company Constitution'", params![r#"{"name":"Company Constitution","oneTime":true,"noCommMin":55000,"noCommMax":66000}"#]).unwrap();
    conn.execute("UPDATE rate_cards SET pricing_json = ?1 WHERE name = 'GOSI & Payroll'", params![r#"{"name":"GOSI & Payroll","hasTranches":true,"showBands":4}"#]).unwrap();
    conn.execute("DELETE FROM services WHERE name IN ('Company Liquidation', 'Company Constitution & Maintenance Package')", []).unwrap();
    conn.execute("DELETE FROM rate_cards WHERE name IN ('Company Liquidation', 'Recruitment')", []).unwrap();
    conn.execute("UPDATE services SET rate_card_id = (SELECT id FROM rate_cards WHERE name = 'Manpower & Recruitment') WHERE name = 'Recruitment'", []).unwrap();

    for _ in 0..2 {
        migrate_pricing_ranges(&conn).unwrap();
    }
    let c = pricing("Company Constitution");
    assert_eq!((c["noCommMin"].as_f64(), c["standard"].as_f64(), c["noCommMax"].as_f64()), (Some(45000.0), Some(55000.0), Some(66000.0)));
    assert_eq!(pricing("GOSI & Payroll")["showBands"], 4, "an edited value stays");
    assert_eq!(pricing("Company Liquidation")["noCommMax"], 35000);
    assert_eq!(pricing("Recruitment")["percent"]["standard"], 10);
    let card: String = conn.query_row("SELECT r.name FROM services s JOIN rate_cards r ON r.id = s.rate_card_id WHERE s.name = 'Recruitment'", [], |r| r.get(0)).unwrap();
    assert_eq!(card, "Recruitment");
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM services WHERE name = 'Company Liquidation'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

// Agreements are no longer created behind the owner's back: the app shows what
// drafting from proposals would create, and only creates it when asked.
#[test]
fn pending_agreements_lists_what_drafting_would_create() {
    let (path, conn) = fresh_db("pending_agreements");
    conn.execute(
        "INSERT INTO proposals (id, client, type, status, date_added) VALUES
           (1,'Contoso Logistics','Recruitment','Signed by Both Parties','2026-09-01'),
           (2,'Fabrikam Trading','Payroll','Kickoff Meeting Set','2026-09-02'),
           (3,'Northwind Services','Payroll','Drafting','2026-09-03')",
        [],
    ).unwrap();

    let pending = menabig_tracker_lib::commercial::pending_agreements_core(&conn).unwrap();
    let clients: Vec<&str> = pending.iter().map(|p| p.client.as_str()).collect();
    assert_eq!(clients, vec!["Contoso Logistics", "Fabrikam Trading"], "signed proposals only, never a draft");

    let created = menabig_tracker_lib::commercial::create_agreements_core(&conn).unwrap();
    assert_eq!(created.len(), pending.len(), "it creates exactly what it listed");
    assert!(menabig_tracker_lib::commercial::pending_agreements_core(&conn).unwrap().is_empty(), "nothing left pending");

    // A proposal reaching a signed state later shows up as pending, and stays
    // pending until someone asks — nothing creates it in the background.
    conn.execute("UPDATE proposals SET status = 'Signed by Both Parties' WHERE id = 3", []).unwrap();
    let pending = menabig_tracker_lib::commercial::pending_agreements_core(&conn).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].client, "Northwind Services");
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn drafting_one_proposals_agreement_leaves_the_others_alone() {
    let (path, mut conn) = fresh_db("draft_one");
    conn.execute(
        "INSERT INTO proposals (id, client, type, status, date_added) VALUES
           (1,'Contoso Logistics','Recruitment','Signed by Both Parties','2026-09-01'),
           (2,'Fabrikam Trading','Payroll','Signed by Both Parties','2026-09-02'),
           (3,'Northwind Services','Payroll','Drafting','2026-09-03')",
        [],
    ).unwrap();
    let created = menabig_tracker_lib::commands::draft_agreement_for_proposal_core(&mut conn, 2).unwrap();
    assert_eq!(created.iter().map(|a| a.proposal_id).collect::<Vec<_>>(), vec![Some(2)]);
    assert!(menabig_tracker_lib::commands::draft_agreement_for_proposal_core(&mut conn, 2).unwrap().is_empty(), "never twice");
    assert!(menabig_tracker_lib::commands::draft_agreement_for_proposal_core(&mut conn, 3).unwrap().is_empty(), "not for an unsigned proposal");
    let pending = menabig_tracker_lib::commercial::pending_agreements_core(&conn).unwrap();
    assert_eq!(pending.iter().map(|p| p.proposal_id).collect::<Vec<_>>(), vec![1], "the other signed one is still waiting to be asked");
    drop(conn);
    let _ = std::fs::remove_file(path);
}
