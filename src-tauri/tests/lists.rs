// Saved lists: hand-picked company lists, smart lists, name rules, and
// members following a company merge. Fake data only.
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::lists::{read_saved_lists, set_list_companies, upsert_saved_list, SavedList};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_lists_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

fn company(conn: &Connection, name: &str) -> i64 {
    conn.execute("INSERT INTO companies (name, created_at) VALUES (?1, '2026-01-01')", params![name]).unwrap();
    conn.last_insert_rowid()
}

fn list(name: &str, entity: &str, filters: Option<serde_json::Value>) -> SavedList {
    SavedList { name: name.into(), entity: entity.into(), filters, ..Default::default() }
}

#[test]
fn company_lists_keep_their_members() {
    let (path, mut conn) = fresh_db("members");
    let a = company(&conn, "Alpha Test Co");
    let b = company(&conn, "Beta Test Co");
    let l = upsert_saved_list(&conn, &list("Q4 campaign", "company", None)).unwrap();
    assert!(l.id > 0 && l.company_ids.is_empty());
    let l = set_list_companies(&mut conn, l.id, &[a, b, a, 9999], &[]).unwrap();
    assert_eq!(l.company_ids, vec![a, b]);
    let l = set_list_companies(&mut conn, l.id, &[], &[a]).unwrap();
    assert_eq!(l.company_ids, vec![b]);

    // Renaming keeps the members; deleting the company removes it from the list.
    let renamed = upsert_saved_list(&conn, &SavedList { name: "Q4 prospects".into(), ..l.clone() }).unwrap();
    assert_eq!((renamed.name.as_str(), renamed.company_ids.clone()), ("Q4 prospects", vec![b]));
    conn.execute("DELETE FROM companies WHERE id = ?1", params![b]).unwrap();
    assert!(read_saved_lists(&conn).unwrap()[0].company_ids.is_empty());

    // Deleting the list removes its members.
    set_list_companies(&mut conn, l.id, &[a], &[]).unwrap();
    conn.execute("DELETE FROM saved_lists WHERE id = ?1", params![l.id]).unwrap();
    let left: i64 = conn.query_row("SELECT COUNT(*) FROM company_list_members", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn smart_lists_and_name_rules() {
    let (path, mut conn) = fresh_db("rules");
    let a = company(&conn, "Gamma Test Co");
    let smart = upsert_saved_list(&conn, &list("Active clients", "company", Some(serde_json::json!({ "status": "client" })))).unwrap();
    assert_eq!(smart.filters.as_ref().unwrap()["status"], "client");
    assert!(set_list_companies(&mut conn, smart.id, &[a], &[]).is_err(), "smart lists have no hand-picked members");

    assert!(upsert_saved_list(&conn, &list("active CLIENTS", "company", None)).is_err(), "names are unique per module, ignoring case");
    assert!(upsert_saved_list(&conn, &list("Active clients", "contact", Some(serde_json::json!({})))).is_ok(), "the same name can exist in Contacts");
    assert!(upsert_saved_list(&conn, &list("  ", "company", None)).is_err());
    assert!(upsert_saved_list(&conn, &list("Hand-picked", "contact", None)).is_err(), "hand-picked contact lists stay in contact_list_defs");
    conn.execute("INSERT INTO contact_list_defs (name) VALUES ('Newsletter')", []).unwrap();
    assert!(upsert_saved_list(&conn, &list("newsletter", "contact", Some(serde_json::json!({})))).is_err(), "no clash with a contact list");
    drop(conn);
    let _ = std::fs::remove_file(path);
}
