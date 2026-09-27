// Proposal requests (owner, 27-Sep-2026): a `>>` promise to send a proposal
// becomes a proposal request instead of a task, the proposal records when it
// was promised and which request it came with, and the promise follows the
// proposal. Scratch databases only; fictional names.
use menabig_tracker_lib::commands::{delete_proposal_rows, read_all_data, upsert_proposal_rows};
use menabig_tracker_lib::commitments::{add_commitments, read_commitments, services_named_in, upsert_commitment_rows, NewCommitment};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::models::Proposal;
use menabig_tracker_lib::opportunities::create_company_named;
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> Connection {
    let path = std::env::temp_dir().join(format!("menabig_proposal_requests_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    init_connection(&path).expect("init db")
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

struct Setup { company: i64, owner: i64, reviewer: i64 }

fn setup(conn: &mut Connection) -> Setup {
    let company = create_company_named(conn, "Contoso Logistics").unwrap().unwrap();
    for name in ["Payroll", "Recruitment", "Business Setup", "Business Setup and Maintenance Package"] {
        conn.execute("INSERT INTO services (name, active) VALUES (?1, 1) ON CONFLICT(name) DO UPDATE SET active = 1, merged_into = NULL", params![name]).unwrap();
    }
    conn.execute("INSERT INTO team_members (name, is_reviewer, active) VALUES ('Test Reviewer', 1, 1)", []).unwrap();
    let reviewer = conn.last_insert_rowid();
    conn.execute("INSERT INTO team_members (name, is_reviewer, active) VALUES ('Test Owner', 0, 1)", []).unwrap();
    let owner = conn.last_insert_rowid();
    conn.execute("INSERT INTO app_meta (key, value) VALUES ('current_user_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![owner.to_string()]).unwrap();
    Setup { company, owner, reviewer }
}

fn promise(text: &str, company: Option<i64>, source_id: i64) -> NewCommitment {
    NewCommitment {
        direction: "ours".into(), text: text.into(), due_date: Some("2026-10-02".into()), company_id: company,
        source_type: "meeting".into(), source_id: Some(source_id),
        source_key: Some(text.to_lowercase()), proposal: true, ..Default::default()
    }
}

#[test]
fn migration_39_adds_the_columns() {
    let conn = fresh_db("migration");
    assert!(latest_schema_version() >= 39);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    for (table, col) in [("proposals", "promised_by"), ("proposals", "request_group"), ("commitments", "proposal_id")] {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"), params![col], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "{table}.{col}");
    }
}

#[test]
fn promised_by_and_request_group_are_saved_and_read_back() {
    let mut conn = fresh_db("roundtrip");
    let p = |id: i64| Proposal { id, client: "Contoso Logistics".into(), status: "Proposal Request Received".into(),
        promised_by: Some("2026-10-02".into()), request_group: Some("g-1".into()), ..Default::default() };
    upsert_proposal_rows(&mut conn, &[p(1), p(2)]).unwrap();
    let read = read_all_data(&conn).unwrap().proposals;
    assert!(read.iter().all(|x| x.promised_by.as_deref() == Some("2026-10-02") && x.request_group.as_deref() == Some("g-1")));
}

#[test]
fn a_promise_to_send_a_proposal_creates_a_request_and_no_task() {
    let mut conn = fresh_db("creates");
    let s = setup(&mut conn);
    conn.execute("INSERT INTO meetings (id, title, meeting_date) VALUES (3, 'Contoso check-in', '2026-09-27')", []).unwrap();
    let from_meeting = NewCommitment { meeting_id: Some(3), ..promise("Proposal for Payroll and Recruitment", Some(s.company), 3) };
    let added = add_commitments(&mut conn, &[from_meeting]).unwrap();
    assert!(added.tasks.is_empty(), "no task for a proposal promise");
    assert_eq!(added.proposals.len(), 1);
    let p = &added.proposals[0];
    assert_eq!(p.client, "Contoso Logistics");
    assert_eq!(p.company_id, Some(s.company));
    assert_eq!(p.status, "Proposal Request Received");
    assert_eq!(p.promised_by.as_deref(), Some("2026-10-02"));
    assert_eq!(p.r#type.as_deref(), Some("Payroll, Recruitment"), "services named in the line, in order");
    // The first active reviewer by name, as the create form picks it.
    let first_reviewer: i64 = one(&conn, "SELECT id FROM team_members WHERE active = 1 AND is_reviewer = 1 ORDER BY name LIMIT 1");
    assert!(first_reviewer == s.reviewer || first_reviewer < s.reviewer);
    assert_eq!((p.owner_id, p.owner.as_deref(), p.reviewer_id), (Some(s.owner), Some("Test Owner"), Some(first_reviewer)));
    assert_eq!(p.currency.as_deref(), Some("SAR"));
    assert!(p.date_added.is_some());
    let cm = &added.commitments[0];
    assert_eq!((cm.proposal_id, cm.todo_id), (Some(p.id), None));
    let todos: i64 = one(&conn, "SELECT COUNT(*) FROM todos");
    assert_eq!(todos, 0);
    let linked: i64 = conn.query_row("SELECT COUNT(*) FROM entity_links WHERE from_type = 'meeting' AND from_id = 3 AND to_type = 'proposal' AND to_id = ?1", params![p.id], |r| r.get(0)).unwrap();
    assert_eq!(linked, 1, "linked to the meeting it came from");

    // Saving the meeting again reads the same line: nothing is created twice.
    let again = add_commitments(&mut conn, &[promise("Proposal for Payroll and Recruitment", Some(s.company), 3)]).unwrap();
    assert!(again.commitments.is_empty() && again.proposals.is_empty());
    let proposals: i64 = one(&conn, "SELECT COUNT(*) FROM proposals");
    assert_eq!(proposals, 1);
}

#[test]
fn without_a_company_it_is_a_task_as_before() {
    let mut conn = fresh_db("no_company");
    setup(&mut conn);
    let added = add_commitments(&mut conn, &[promise("Proposal for Payroll", None, 4)]).unwrap();
    assert!(added.proposals.is_empty());
    assert_eq!(added.tasks.len(), 1);
    assert_eq!(added.commitments[0].proposal_id, None);
    assert!(added.commitments[0].todo_id.is_some());
}

#[test]
fn a_plain_promise_still_gets_its_task() {
    let mut conn = fresh_db("plain");
    let s = setup(&mut conn);
    let added = add_commitments(&mut conn, &[NewCommitment { proposal: false, ..promise("Send the org chart", Some(s.company), 5) }]).unwrap();
    assert!(added.proposals.is_empty());
    assert_eq!(added.tasks.len(), 1);
}

#[test]
fn service_names_match_whole_words_longest_first() {
    let mut conn = fresh_db("services");
    setup(&mut conn);
    assert_eq!(services_named_in(&conn, "Proposal for the Business Setup and Maintenance Package").unwrap(), vec!["Business Setup and Maintenance Package"]);
    assert_eq!(services_named_in(&conn, "proposal for business setup").unwrap(), vec!["Business Setup"]);
    assert!(services_named_in(&conn, "Proposal for Payrolls").unwrap().is_empty(), "whole words only");
}

fn linked_promise(conn: &mut Connection, company: i64, source: i64) -> (i64, i64) {
    let added = add_commitments(conn, &[promise("Proposal for Payroll", Some(company), source)]).unwrap();
    (added.commitments[0].id, added.proposals[0].id)
}

fn status_of(conn: &Connection, commitment: i64) -> (String, Option<String>, Option<String>) {
    conn.query_row("SELECT status, drop_reason, closed_at FROM commitments WHERE id = ?1", params![commitment], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap()
}

fn set_status(conn: &mut Connection, proposal: i64, status: &str) {
    let mut p = read_all_data(conn).unwrap().proposals.into_iter().find(|p| p.id == proposal).unwrap();
    p.status = status.into();
    upsert_proposal_rows(conn, &[p]).unwrap();
}

#[test]
fn sent_or_signed_keeps_the_promise() {
    for (i, status) in ["Sent to Client", "Signed by Client", "Signed by Both Parties"].into_iter().enumerate() {
        let mut conn = fresh_db(&format!("kept_{i}"));
        let s = setup(&mut conn);
        let (cm, p) = linked_promise(&mut conn, s.company, 10);
        set_status(&mut conn, p, "Drafting");
        assert_eq!(status_of(&conn, cm).0, "open", "drafting doesn't close it");
        set_status(&mut conn, p, status);
        let (st, reason, closed) = status_of(&conn, cm);
        assert_eq!((st.as_str(), reason), ("kept", None), "{status}");
        assert!(closed.is_some());
    }
}

#[test]
fn lost_or_withdrawn_drops_the_promise_with_the_reason() {
    for (i, status) in ["Lost", "Withdrawn"].into_iter().enumerate() {
        let mut conn = fresh_db(&format!("dropped_{i}"));
        let s = setup(&mut conn);
        let (cm, p) = linked_promise(&mut conn, s.company, 11);
        set_status(&mut conn, p, status);
        let (st, reason, _) = status_of(&conn, cm);
        assert_eq!((st.as_str(), reason.as_deref()), ("dropped", Some(status)));
    }
}

#[test]
fn a_promise_already_closed_is_left_alone() {
    let mut conn = fresh_db("closed");
    let s = setup(&mut conn);
    let (cm, p) = linked_promise(&mut conn, s.company, 12);
    conn.execute("UPDATE commitments SET status = 'dropped', drop_reason = 'Client changed plans' WHERE id = ?1", params![cm]).unwrap();
    set_status(&mut conn, p, "Sent to Client");
    assert_eq!(status_of(&conn, cm).0, "dropped");
}

#[test]
fn deleting_the_proposal_unlinks_the_promise() {
    let mut conn = fresh_db("unlink");
    let s = setup(&mut conn);
    let (cm, p) = linked_promise(&mut conn, s.company, 13);
    delete_proposal_rows(&mut conn, &[p]).unwrap();
    let c = read_commitments(&conn).unwrap().into_iter().find(|c| c.id == cm).expect("the promise stays");
    assert_eq!((c.proposal_id, c.status.as_str()), (None, "open"));
}

#[test]
fn saving_a_promise_from_the_app_keeps_its_proposal() {
    let mut conn = fresh_db("upsert");
    let s = setup(&mut conn);
    let (cm, p) = linked_promise(&mut conn, s.company, 14);
    let mut c = read_commitments(&conn).unwrap().into_iter().find(|c| c.id == cm).unwrap();
    c.text = "Proposal for Payroll (revised)".into();
    upsert_commitment_rows(&mut conn, &[c]).unwrap();
    let back = read_commitments(&conn).unwrap().into_iter().find(|c| c.id == cm).unwrap();
    assert_eq!(back.proposal_id, Some(p));
}

fn live(n: NewCommitment, keys: &[&str]) -> NewCommitment {
    NewCommitment { live_keys: keys.iter().map(|k| k.to_string()).collect(), ..n }
}

#[test]
fn an_edited_line_joins_its_request_instead_of_starting_another() {
    let mut conn = fresh_db("edited");
    let s = setup(&mut conn);
    let first = add_commitments(&mut conn, &[live(promise("Proposal for Payroll", Some(s.company), 20), &["proposal for payroll"])]).unwrap();
    let pid = first.proposals[0].id;
    // The meeting is saved again with the line edited: a new source key, the old line gone.
    let edited = NewCommitment { due_date: Some("2026-10-05".into()), ..promise("Proposal for Payroll and Recruitment", Some(s.company), 20) };
    let second = add_commitments(&mut conn, &[live(edited, &["proposal for payroll and recruitment"])]).unwrap();
    assert_eq!(second.proposals.len(), 1);
    assert_eq!(second.proposals[0].id, pid, "the same request");
    assert_eq!(second.proposals[0].promised_by.as_deref(), Some("2026-10-05"));
    assert_eq!(second.proposals[0].r#type.as_deref(), Some("Payroll, Recruitment"));
    let proposals: i64 = one(&conn, "SELECT COUNT(*) FROM proposals");
    assert_eq!(proposals, 1, "no second SL#");
    let pointing: i64 = conn.query_row("SELECT COUNT(*) FROM commitments WHERE proposal_id = ?1", params![pid], |r| r.get(0)).unwrap();
    assert_eq!(pointing, 2, "both promises point at it");
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM todos"), 0);
}

#[test]
fn a_second_different_proposal_line_is_its_own_request() {
    let mut conn = fresh_db("second_line");
    let s = setup(&mut conn);
    add_commitments(&mut conn, &[live(promise("Proposal for Payroll", Some(s.company), 21), &["proposal for payroll"])]).unwrap();
    // A new line under the first, which is still there.
    let second = add_commitments(&mut conn, &[live(promise("Proposal for Recruitment", Some(s.company), 21), &["proposal for payroll", "proposal for recruitment"])]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposals"), 2);
    assert_eq!(second.proposals[0].r#type.as_deref(), Some("Recruitment"));
}

#[test]
fn an_edit_does_not_reopen_a_request_already_sent() {
    let mut conn = fresh_db("sent_edit");
    let s = setup(&mut conn);
    let first = add_commitments(&mut conn, &[live(promise("Proposal for Payroll", Some(s.company), 22), &["proposal for payroll"])]).unwrap();
    set_status(&mut conn, first.proposals[0].id, "Sent to Client");
    add_commitments(&mut conn, &[live(promise("Proposal for Payroll v2", Some(s.company), 22), &["proposal for payroll v2"])]).unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM proposals"), 2, "a sent proposal isn't reused");
}

#[test]
fn an_edit_naming_a_new_service_adds_it_to_the_type_when_the_request_has_lines() {
    use menabig_tracker_lib::models::CommercialLine;
    let mut conn = fresh_db("edit_lines");
    let s = setup(&mut conn);
    let first = add_commitments(&mut conn, &[live(promise("Proposal for Payroll", Some(s.company), 23), &["proposal for payroll"])]).unwrap();
    // The app gives the named service its line.
    let mut p = first.proposals[0].clone();
    p.lines = vec![CommercialLine { service_name: "Payroll".into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(1250.0), ..Default::default() }];
    upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap();
    let second = add_commitments(&mut conn, &[live(promise("Proposal for Payroll and Recruitment", Some(s.company), 23), &["proposal for payroll and recruitment"])]).unwrap();
    assert_eq!(second.proposals[0].r#type.as_deref(), Some("Payroll, Recruitment"), "the app adds the Recruitment line from here");
}
