// Follow-up touches (owner, 29-Sep-2026): an email, call, WhatsApp or meeting
// with the client, logged in one click against a proposal. Scratch databases
// only; fictional names.
use menabig_tracker_lib::commands::{delete_proposal_rows, upsert_proposal_rows};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::models::Proposal;
use menabig_tracker_lib::opportunities::create_company_named;
use menabig_tracker_lib::touches::{add_touch, read_touches, touches_for, NewTouch};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> Connection {
    let path = std::env::temp_dir().join(format!("menabig_touches_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    init_connection(&path).expect("init db")
}

/// A company and its proposal sent on 10 Sept.
fn setup(conn: &mut Connection) -> (i64, i64) {
    let company = create_company_named(conn, "Contoso Logistics").unwrap().unwrap();
    upsert_proposal_rows(conn, &[Proposal { id: 7, client: "Contoso Logistics".into(), status: "Sent to Client".into(), date_sent_to_client: Some("2026-09-10".into()), ..Default::default() }]).unwrap();
    (company, 7)
}

fn new(kind: &str, direction: Option<&str>, at: &str) -> NewTouch {
    NewTouch { proposal_id: Some(7), kind: kind.into(), direction: direction.map(Into::into), at: at.into(), ..Default::default() }
}

#[test]
fn migration_42_adds_the_table() {
    let conn = fresh_db("migration");
    assert!(latest_schema_version() >= 42);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'touches'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn a_manual_touch_takes_the_proposal_s_company_and_its_direction() {
    let mut conn = fresh_db("add");
    let (company, _) = setup(&mut conn);
    let t = add_touch(&conn, &new("email_out", None, "2026-09-20")).unwrap();
    assert_eq!((t.company_id, t.proposal_id, t.kind.as_str(), t.direction.as_str(), t.source.as_str()), (Some(company), Some(7), "email_out", "out", "manual"));
    // An email says its direction in its kind; a meeting we held is ours; a call says who called.
    assert_eq!(add_touch(&conn, &new("email_in", Some("out"), "2026-09-21")).unwrap().direction, "in");
    assert_eq!(add_touch(&conn, &new("meeting", Some("in"), "2026-09-22")).unwrap().direction, "out");
    assert_eq!(add_touch(&conn, &new("call", Some("in"), "2026-09-23")).unwrap().direction, "in");
    assert_eq!(add_touch(&conn, &new("whatsapp", None, "2026-09-24")).unwrap().direction, "out");
}

#[test]
fn a_proposal_s_touches_come_newest_first() {
    let mut conn = fresh_db("order");
    setup(&mut conn);
    for (kind, at) in [("email_out", "2026-09-15"), ("call", "2026-09-22"), ("whatsapp", "2026-09-18")] {
        add_touch(&conn, &new(kind, None, at)).unwrap();
    }
    let kinds: Vec<String> = touches_for(&conn, 7).unwrap().into_iter().map(|t| t.kind).collect();
    assert_eq!(kinds, vec!["call", "whatsapp", "email_out"]);
    assert_eq!(read_touches(&conn).unwrap().len(), 3);
}

#[test]
fn an_unknown_kind_is_refused() {
    let mut conn = fresh_db("check");
    setup(&mut conn);
    assert!(add_touch(&conn, &new("fax", None, "2026-09-20")).is_err());
}

#[test]
fn deleting_the_proposal_deletes_its_touches() {
    let mut conn = fresh_db("cascade");
    setup(&mut conn);
    add_touch(&conn, &new("call", None, "2026-09-20")).unwrap();
    delete_proposal_rows(&mut conn, &[7]).unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM touches", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}

#[test]
fn a_source_id_is_stored_once() {
    let mut conn = fresh_db("unique");
    setup(&mut conn);
    let insert = |conn: &Connection| conn.execute(
        "INSERT INTO touches (proposal_id, kind, at, source, source_id, created_at) VALUES (7, 'email_out', '2026-09-20', 'outlook', 'msg-1', '2026-09-20')", params![]);
    insert(&conn).unwrap();
    assert!(insert(&conn).is_err());
}
