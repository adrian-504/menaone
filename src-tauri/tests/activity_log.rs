// My Day's nudge (1.57): a line in the existing activity table, removable for Undo. No schema change.
use menabig_tracker_lib::activity::{insert_activity, NewActivity};
use rusqlite::Connection;

#[test]
fn a_nudge_is_logged_and_undone() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE activity (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, entity_label TEXT, detail TEXT, company_id INTEGER, contact_id INTEGER, opportunity_id INTEGER, project_id INTEGER);").unwrap();
    let id = insert_activity(&conn, &NewActivity { action: "review_nudged".into(), entity_type: "proposal".into(), entity_id: 2, entity_label: Some("Acme — Recruitment".into()), detail: Some("Nudged Hassan Balaghi about the review".into()), company_id: Some(1) }).unwrap();
    let (action, detail): (String, String) = conn.query_row("SELECT action, detail FROM activity WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(action, "review_nudged");
    assert!(detail.contains("Hassan"));
    conn.execute("DELETE FROM activity WHERE id = ?1", [id]).unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM activity", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}
