// Phone sync over OneDrive (docs/phone-sync.md): the snapshot writer and the
// capture importer, on a scratch database and scratch folders under the temp
// directory — never the real OneDrive folder. Fictional names only.
use menabig_tracker_lib::commitments::{add_commitments, read_commitments, NewCommitment};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::opportunities::create_company_named;
use menabig_tracker_lib::phone::{
    import_inbox, import_inbox_aged, imported_capture_ids, list_failed, validate_root, write_snapshot, MAX_SNAPSHOT_BYTES,
};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn scratch(tag: &str) -> (PathBuf, Connection) {
    let dir = std::env::temp_dir().join(format!("menabig_phone_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let conn = init_connection(&dir.join("menabig.sqlite3")).expect("init db");
    let root = dir.join("MENA One Phone");
    (root, conn)
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Drops a capture into the inbox, as the phone would.
fn drop_capture(root: &Path, id: &str, body: &str) {
    std::fs::create_dir_all(root.join("inbox")).unwrap();
    std::fs::write(root.join("inbox").join(format!("{id}.json")), body).unwrap();
}

fn capture(id: &str, kind: &str, extra: &str) -> String {
    format!(r#"{{"format":"mena-one-capture/1","id":"{id}","createdAt":"2026-09-24T14:05:11+03:00","device":"Test iPhone","kind":"{kind}"{extra}}}"#)
}

fn import(conn: &Connection, root: &Path) -> menabig_tracker_lib::phone::ImportResult {
    import_inbox_aged(conn, root, Duration::ZERO).unwrap()
}

fn done_files(root: &Path) -> usize {
    let done = root.join("inbox/done");
    std::fs::read_dir(&done).map(|months| months.filter_map(|m| m.ok()).map(|m| std::fs::read_dir(m.path()).map(|f| f.count()).unwrap_or(0)).sum()).unwrap_or(0)
}

#[test]
fn migration_39_adds_phone_imports() {
    let (_, conn) = scratch("migration");
    assert!(latest_schema_version() >= 39);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    let n: i64 = one(&conn, "SELECT COUNT(*) FROM phone_imports");
    assert_eq!(n, 0);
}

#[test]
fn snapshot_is_written_whole_and_replaced_atomically() {
    let (root, _) = scratch("snapshot");
    assert_eq!(write_snapshot(&root, r#"{"format":"mena-one-phone/1","n":1}"#).unwrap(), 35);
    assert_eq!(write_snapshot(&root, r#"{"format":"mena-one-phone/1","n":2}"#).unwrap(), 35);
    assert_eq!(std::fs::read_to_string(root.join("snapshot.json")).unwrap(), r#"{"format":"mena-one-phone/1","n":2}"#);
    assert!(!root.join("snapshot.json.tmp").exists(), "no temporary file left behind");
    // The inbox layout comes with it.
    assert!(root.join("inbox/done").is_dir() && root.join("inbox/failed").is_dir());
}

#[test]
fn an_oversized_snapshot_is_refused_and_the_last_one_kept() {
    let (root, _) = scratch("oversize");
    write_snapshot(&root, "{}").unwrap();
    let big = "x".repeat(MAX_SNAPSHOT_BYTES + 1);
    let e = write_snapshot(&root, &big).unwrap_err();
    assert!(e.contains("over the 8 MB limit"), "{e}");
    assert_eq!(std::fs::read_to_string(root.join("snapshot.json")).unwrap(), "{}");
}

#[test]
fn the_phone_folder_must_be_inside_onedrive() {
    let (root, _) = scratch("root");
    std::fs::create_dir_all(&root).unwrap();
    assert_eq!(validate_root(&root).unwrap_err(), "Choose a folder inside OneDrive.");
    assert!(validate_root(&root.join("missing")).is_err());
    // On a Mac with OneDrive, a OneDrive root itself passes (read only: nothing is written there).
    if let Some(home) = std::env::var_os("HOME") {
        let cloud = PathBuf::from(home).join("Library/CloudStorage");
        if let Some(od) = std::fs::read_dir(&cloud).ok().and_then(|mut d| d.find_map(|e| e.ok().filter(|e| e.file_name().to_string_lossy().starts_with("OneDrive")))) {
            assert!(validate_root(&od.path()).is_ok());
        }
    }
}

#[test]
fn a_promise_we_owe_lands_with_its_task_and_is_applied_once() {
    let (root, mut conn) = scratch("commitment");
    let co = create_company_named(&mut conn, "Contoso Logistics").unwrap().unwrap();
    conn.execute("INSERT INTO contacts (id, client_name, company_id, name) VALUES (21, 'Contoso Logistics', ?1, 'Sara Haddad')", params![co]).unwrap();
    let body = capture("b7e1c2d4-0000-4000-8000-000000000001", "commitment",
        &format!(r#","text":"Send the revised fee schedule","direction":"ours","companyId":{co},"companyName":"Contoso Logistics","contactId":21,"dueDate":"2026-09-30""#));
    drop_capture(&root, "b7e1c2d4-0000-4000-8000-000000000001", &body);
    let r = import(&conn, &root);
    assert_eq!((r.imported, r.failed), (1, 0));
    let cms = read_commitments(&conn).unwrap();
    assert_eq!(cms.len(), 1);
    let cm = &cms[0];
    assert_eq!((cm.direction.as_str(), cm.company_id, cm.contact_id, cm.due_date.as_deref()), ("ours", Some(co), Some(21), Some("2026-09-30")));
    assert_eq!((cm.source_type.as_deref(), cm.source_key.as_deref()), (Some("capture"), Some("phone:b7e1c2d4-0000-4000-8000-000000000001")));
    let task = cm.todo_id.expect("ours gets a task");
    let (title, client): (String, Option<String>) = conn.query_row("SELECT title, client FROM todos WHERE id = ?1", params![task], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((title.as_str(), client.as_deref()), ("Send the revised fee schedule", Some("Contoso Logistics")));
    assert!(r.touched.iter().any(|t| t.kind == "commitment" && t.id == cm.id) && r.touched.iter().any(|t| t.kind == "task" && t.id == task));
    let logged: i64 = one(&conn, "SELECT COUNT(*) FROM activity WHERE entity_type = 'commitment' AND action = 'created'");
    assert_eq!(logged, 1);
    assert_eq!(done_files(&root), 1);
    assert_eq!(imported_capture_ids(&conn, 200).unwrap(), vec!["b7e1c2d4-0000-4000-8000-000000000001".to_string()]);

    // The same file again (the phone re-sent it): moved to done, nothing re-applied.
    drop_capture(&root, "b7e1c2d4-0000-4000-8000-000000000001", &body);
    let again = import(&conn, &root);
    assert_eq!((again.imported, again.failed), (0, 0));
    assert_eq!(read_commitments(&conn).unwrap().len(), 1);
    let tasks: i64 = one(&conn, "SELECT COUNT(*) FROM todos");
    assert_eq!(tasks, 1);
    assert!(std::fs::read_dir(root.join("inbox")).unwrap().filter_map(|e| e.ok()).all(|e| e.path().is_dir()), "inbox is empty");
}

#[test]
fn a_promise_they_owe_has_no_task_and_an_unknown_company_id_falls_back_to_the_name() {
    let (root, mut conn) = scratch("theirs");
    let co = create_company_named(&mut conn, "Northwind Trading").unwrap().unwrap();
    drop_capture(&root, "c1", &capture("c1", "commitment", r#","text":"Confirm the hiring budget","direction":"theirs","companyId":9999,"companyName":"northwind trading""#));
    import(&conn, &root);
    let cm = &read_commitments(&conn).unwrap()[0];
    assert_eq!((cm.direction.as_str(), cm.company_id, cm.todo_id), ("theirs", Some(co), None));
}

#[test]
fn a_task_links_its_company_by_name_and_an_unknown_name_lands_unlinked() {
    let (root, mut conn) = scratch("task");
    let co = create_company_named(&mut conn, "Fabrikam Engineering").unwrap().unwrap();
    drop_capture(&root, "t1", &capture("t1", "task", r#","text":"Send the UAE setup options","companyId":null,"companyName":"Fabrikam Engineering","dueDate":"2026-09-26""#));
    drop_capture(&root, "t2", &capture("t2", "task", r#","text":"Call Globex back","companyName":"Globex""#));
    let r = import(&conn, &root);
    assert_eq!(r.imported, 2);
    let linked: (Option<i64>, Option<String>, String, String) = conn.query_row(
        "SELECT company_id, client, status, due_date FROM todos WHERE title = 'Send the UAE setup options'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
    assert_eq!(linked, (Some(co), Some("Fabrikam Engineering".into()), "Pending".into(), "2026-09-26".into()));
    let unlinked: (Option<i64>, Option<String>, Option<String>) = conn.query_row(
        "SELECT company_id, client, description FROM todos WHERE title = 'Call Globex back'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((unlinked.0, unlinked.1), (None, None));
    assert!(unlinked.2.unwrap().contains("Globex"));
    let companies: i64 = one(&conn, "SELECT COUNT(*) FROM companies WHERE name = 'Globex'");
    assert_eq!(companies, 0, "no company is created from the phone");
}

#[test]
fn a_note_goes_to_the_company_log_or_the_inbox() {
    let (root, mut conn) = scratch("note");
    let co = create_company_named(&mut conn, "Tailspin Hotels").unwrap().unwrap();
    drop_capture(&root, "n1", &capture("n1", "note", &format!(r#","text":"New GM starts in October","companyId":{co}"#)));
    drop_capture(&root, "n2", &capture("n2", "note", r#","text":"Idea: a hospitality payroll bundle""#));
    let r = import(&conn, &root);
    assert_eq!(r.imported, 2);
    let entry: (i64, String) = conn.query_row("SELECT company_id, body FROM company_note_entries", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(entry, (co, "New GM starts in October".into()));
    let inbox: (String, String, i64) = conn.query_row("SELECT item_type, content, processed FROM inbox_items", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!(inbox, ("note".into(), "Idea: a hospitality payroll bundle".into(), 0));
}

#[test]
fn keep_closes_the_task_and_done_keeps_the_promise_through_the_triggers() {
    let (root, mut conn) = scratch("keep_done");
    let co = create_company_named(&mut conn, "Contoso Logistics").unwrap().unwrap();
    let added = add_commitments(&mut conn, &[
        NewCommitment { direction: "ours".into(), text: "Send the payroll proposal".into(), company_id: Some(co), source_type: "manual".into(), ..Default::default() },
        NewCommitment { direction: "ours".into(), text: "Send the org chart".into(), company_id: Some(co), source_type: "manual".into(), ..Default::default() },
    ]).unwrap();
    let (first, second) = (&added.commitments[0], &added.commitments[1]);
    drop_capture(&root, "k1", &capture("k1", "keep", &format!(r#","commitmentId":{}"#, first.id)));
    drop_capture(&root, "k2", &capture("k2", "done", &format!(r#","todoId":{}"#, second.todo_id.unwrap())));
    let r = import(&conn, &root);
    assert_eq!((r.imported, r.failed), (2, 0));
    let status = |id: i64| -> (String, String) {
        conn.query_row("SELECT c.status, t.status FROM commitments c JOIN todos t ON t.id = c.todo_id WHERE c.id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
    };
    assert_eq!(status(first.id), ("kept".into(), "Done".into()), "keep → the task closes by trigger");
    assert_eq!(status(second.id), ("kept".into(), "Done".into()), "done → the promise is kept by trigger");
    let kept_logged: i64 = one(&conn, "SELECT COUNT(*) FROM activity WHERE entity_type = 'commitment' AND action = 'kept'");
    assert_eq!(kept_logged, 2);
    assert!(r.touched.iter().any(|t| t.kind == "task" && Some(t.id) == first.todo_id));
    assert!(r.touched.iter().any(|t| t.kind == "commitment" && t.id == second.id));
}

#[test]
fn unreadable_or_unapplicable_captures_go_to_failed_with_the_reason() {
    let (root, conn) = scratch("failed");
    drop_capture(&root, "broken", "{ not json");
    drop_capture(&root, "k9", &capture("k9", "keep", r#","commitmentId":424242"#));
    drop_capture(&root, "v2", &capture("v2", "task", r#","text":"x""#).replace("mena-one-capture/1", "mena-one-capture/2"));
    let r = import(&conn, &root);
    assert_eq!((r.imported, r.failed), (0, 3));
    let failed = list_failed(&root);
    let ids: Vec<&str> = failed.iter().map(|f| f.id.as_str()).collect();
    assert_eq!(ids, vec!["broken", "k9", "v2"]);
    assert!(failed[0].error.starts_with("Not a capture file"));
    assert_eq!(failed[1].error, "That promise is no longer on the Mac");
    assert!(failed[2].error.contains("Unknown format"));
    assert!(root.join("inbox/failed/k9.error.txt").is_file());
    // A failed capture's transaction left nothing behind.
    let rows: i64 = one(&conn, "SELECT COUNT(*) FROM commitments");
    assert_eq!(rows, 0);
    assert!(imported_capture_ids(&conn, 200).unwrap().is_empty());
}

#[test]
fn a_file_still_arriving_is_left_for_the_next_scan() {
    let (root, conn) = scratch("young");
    drop_capture(&root, "y1", &capture("y1", "note", r#","text":"Just written""#));
    let r = import_inbox(&conn, &root).unwrap();
    assert_eq!((r.imported, r.failed), (0, 0));
    assert!(root.join("inbox/y1.json").is_file());
    let later = import(&conn, &root);
    assert_eq!(later.imported, 1);
}
