// Proposal revisions (owner, 29-Sep-2026): the client asks for changes to a sent
// proposal and the same proposal goes round Drafting → Sent again, with a number
// and a reason. Scratch databases only; fictional names.
use menabig_tracker_lib::commands::{delete_proposal_rows, read_all_data, upsert_proposal_rows};
use menabig_tracker_lib::commitments::{add_commitments, NewCommitment};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::models::{Proposal, ProposalRevision};
use menabig_tracker_lib::opportunities::create_company_named;
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> Connection {
    let path = std::env::temp_dir().join(format!("menabig_proposal_revisions_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    init_connection(&path).expect("init db")
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn load(conn: &Connection, id: i64) -> Proposal {
    read_all_data(conn).unwrap().proposals.into_iter().find(|p| p.id == id).unwrap()
}

/// A proposal sent to the client on 10 Sept, approved by the reviewer.
fn sent_proposal(conn: &mut Connection, id: i64) -> Proposal {
    create_company_named(conn, "Contoso Logistics").unwrap();
    let p = Proposal {
        id, client: "Contoso Logistics".into(), status: "Sent to Client".into(), date_sent_to_client: Some("2026-09-10".into()),
        sent_date: Some("2026-09-10".into()), review_status: Some("approved".into()), reviewed_at: Some("2026-09-09".into()),
        review_note: Some("Fine".into()), contract_months: Some(12), revision: 1, ..Default::default()
    };
    upsert_proposal_rows(conn, &[p]).unwrap();
    load(conn, id)
}

/// What the app does on "Start revision": one save of the whole record.
fn start_revision(conn: &mut Connection, mut p: Proposal, rev_id: i64, reason: &str) -> Proposal {
    p.revisions.push(ProposalRevision {
        id: rev_id, number: p.revision + 1, requested_at: "2026-09-20".into(), requested_by_contact_id: None,
        reason: Some(reason.into()), lines_before_json: r#"{"lines":[],"contractMonths":12}"#.into(), sent_at: None,
    });
    p.revision += 1;
    p.status = "Drafting".into();
    p.review_status = None;
    p.reviewed_at = None;
    p.review_note = None;
    upsert_proposal_rows(conn, &[p.clone()]).unwrap();
    load(conn, p.id)
}

/// What the app does on "Mark sent" during a revision.
fn send_revision(conn: &mut Connection, mut p: Proposal, day: &str) -> Proposal {
    p.status = "Sent to Client".into();
    p.last_sent_at = Some(day.into());
    if let Some(r) = p.revisions.iter_mut().find(|r| r.sent_at.is_none()) {
        r.sent_at = Some(day.into());
    }
    upsert_proposal_rows(conn, &[p.clone()]).unwrap();
    load(conn, p.id)
}

fn activity(conn: &Connection, id: i64) -> Vec<(String, String)> {
    let mut stmt = conn.prepare("SELECT action, COALESCE(detail,'') FROM activity WHERE entity_type = 'proposal' AND entity_id = ?1 ORDER BY id").unwrap();
    stmt.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap()
}

#[test]
fn migration_41_adds_the_columns_and_the_table() {
    let conn = fresh_db("migration");
    assert!(latest_schema_version() >= 41);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    for col in ["revision", "last_sent_at"] {
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_table_info('proposals') WHERE name = ?1", params![col], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "proposals.{col}");
    }
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'proposal_revisions'"), 1);
}

#[test]
fn a_proposal_saved_without_a_revision_is_revision_one() {
    let mut conn = fresh_db("default");
    create_company_named(&mut conn, "Contoso Logistics").unwrap();
    upsert_proposal_rows(&mut conn, &[Proposal { id: 1, client: "Contoso Logistics".into(), status: "Drafting".into(), ..Default::default() }]).unwrap();
    assert_eq!(load(&conn, 1).revision, 1);
}

#[test]
fn starting_a_revision_saves_the_row_the_status_and_the_review_reset_together() {
    let mut conn = fresh_db("start");
    let p = sent_proposal(&mut conn, 7);
    let p = start_revision(&mut conn, p, 1, "Price on three people");
    assert_eq!((p.revision, p.status.as_str()), (2, "Drafting"));
    assert_eq!((p.review_status.as_deref(), p.reviewed_at.as_deref(), p.review_note.as_deref()), (None, None, None));
    assert_eq!(p.date_sent_to_client.as_deref(), Some("2026-09-10"));
    assert_eq!(p.revisions.len(), 1);
    assert_eq!((p.revisions[0].number, p.revisions[0].reason.as_deref()), (2, Some("Price on three people")));
    assert!(p.revisions[0].sent_at.is_none());
    // One timeline row says it; the status change doesn't say it again.
    let acts = activity(&conn, 7);
    assert!(acts.contains(&("revision_requested".into(), "Revision 2: Price on three people".into())), "{acts:?}");
    assert!(!acts.iter().any(|(a, d)| a == "status_changed" && d.contains("→ Drafting")), "{acts:?}");

    // A second revision is number 3.
    let p = send_revision(&mut conn, p, "2026-09-25");
    let p = start_revision(&mut conn, p, 2, "Add Recruitment");
    assert_eq!(p.revision, 3);
    assert_eq!(p.revisions.iter().map(|r| r.number).collect::<Vec<_>>(), vec![2, 3]);
}

#[test]
fn a_failed_save_leaves_nothing_half_done() {
    let mut conn = fresh_db("atomic");
    let p = sent_proposal(&mut conn, 7);
    // Two revision rows with the same number break the unique rule: the whole save must roll back.
    let mut bad = p.clone();
    for id in [1, 2] {
        bad.revisions.push(ProposalRevision { id, number: 2, requested_at: "2026-09-20".into(), lines_before_json: "{}".into(), ..Default::default() });
    }
    bad.revision = 2;
    bad.status = "Drafting".into();
    assert!(upsert_proposal_rows(&mut conn, &[bad]).is_err());
    let after = load(&conn, 7);
    assert_eq!((after.revision, after.status.as_str(), after.revisions.len()), (1, "Sent to Client", 0));
}

#[test]
fn sending_a_revision_records_the_latest_send_and_keeps_the_first() {
    let mut conn = fresh_db("send");
    let p = sent_proposal(&mut conn, 7);
    let p = start_revision(&mut conn, p, 1, "Price on three people");
    let p = send_revision(&mut conn, p, "2026-09-25");
    assert_eq!(p.status, "Sent to Client");
    assert_eq!(p.last_sent_at.as_deref(), Some("2026-09-25"));
    assert_eq!(p.date_sent_to_client.as_deref(), Some("2026-09-10"));
    assert_eq!(p.revisions[0].sent_at.as_deref(), Some("2026-09-25"));
    let acts = activity(&conn, 7);
    assert!(acts.contains(&("revision_sent".into(), "Revision 2 sent".into())), "{acts:?}");
    assert!(!acts.iter().any(|(a, d)| a == "status_changed" && d == "Drafting → Sent to Client"), "{acts:?}");
    // Saving it again unchanged adds nothing.
    let before = activity(&conn, 7).len();
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    assert_eq!(activity(&conn, 7).len(), before);
}

#[test]
fn an_ordinary_status_change_is_still_in_the_timeline() {
    let mut conn = fresh_db("ordinary");
    let mut p = sent_proposal(&mut conn, 7);
    p.status = "Signed by Client".into();
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    assert!(activity(&conn, 7).contains(&("status_changed".into(), "Sent to Client → Signed by Client".into())));
}

#[test]
fn deleting_the_proposal_deletes_its_revisions() {
    let mut conn = fresh_db("cascade");
    let p = sent_proposal(&mut conn, 7);
    start_revision(&mut conn, p, 1, "Price");
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposal_revisions"), 1);
    delete_proposal_rows(&mut conn, &[7]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposal_revisions"), 0);
}

#[test]
fn a_promise_kept_when_first_sent_stays_kept_through_a_revision() {
    let mut conn = fresh_db("promise");
    let company = create_company_named(&mut conn, "Contoso Logistics").unwrap().unwrap();
    conn.execute("INSERT INTO services (name, active) VALUES ('Payroll', 1) ON CONFLICT(name) DO UPDATE SET active = 1, merged_into = NULL", []).unwrap();
    let added = add_commitments(&mut conn, &[NewCommitment {
        direction: "ours".into(), text: "Proposal for Payroll".into(), due_date: Some("2026-10-02".into()), company_id: Some(company),
        source_type: "meeting".into(), source_id: Some(10), source_key: Some("proposal for payroll".into()), proposal: true, ..Default::default()
    }]).unwrap();
    let (cm, pid) = (added.commitments[0].id, added.proposals[0].id);
    let mut p = load(&conn, pid);
    p.status = "Sent to Client".into();
    p.date_sent_to_client = Some("2026-09-10".into());
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    let kept = |conn: &Connection| conn.query_row("SELECT status FROM commitments WHERE id = ?1", params![cm], |r| r.get::<_, String>(0)).unwrap();
    assert_eq!(kept(&conn), "kept");
    let current = load(&conn, pid);
    let p = start_revision(&mut conn, current, 1, "Price");
    assert_eq!(kept(&conn), "kept", "back to Drafting does not reopen it");
    send_revision(&mut conn, p, "2026-09-25");
    assert_eq!(kept(&conn), "kept");
}
