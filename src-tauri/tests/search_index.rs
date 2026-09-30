// Launch (foundations P1): the search index is rebuilt at launch only when the
// data changed outside the app, and at quit only when it changed in the session.
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::v2_search::{index_fingerprint, rebuild_if_stale, refresh_at_quit};
use rusqlite::Connection;

fn fresh(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_search_index_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    (path.clone(), init_connection(&path).expect("init db"))
}

fn indexed(conn: &Connection, text: &str) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM search_index WHERE search_index MATCH ?1", [text], |r| r.get(0)).unwrap()
}

#[test]
fn launch_rebuilds_only_when_the_data_changed_outside_the_app() {
    let (path, conn) = fresh("launch");
    assert!(rebuild_if_stale(&conn).unwrap(), "no fingerprint yet: rebuild");
    assert!(!rebuild_if_stale(&conn).unwrap(), "nothing changed: skip");
    // An edit made outside the app (no reindex): the next launch notices and rebuilds.
    conn.execute("INSERT INTO contacts (id, client_name, name) VALUES (501, 'Contoso Test', 'Zanzibar Quill')", []).unwrap();
    assert_eq!(indexed(&conn, "Zanzibar"), 0);
    assert!(rebuild_if_stale(&conn).unwrap());
    assert_eq!(indexed(&conn, "Zanzibar"), 1);
    assert!(!rebuild_if_stale(&conn).unwrap());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn quit_rebuilds_only_after_a_change_in_the_session() {
    let (path, conn) = fresh("quit");
    rebuild_if_stale(&conn).unwrap();
    let at_launch = index_fingerprint(&conn).unwrap();
    assert!(!refresh_at_quit(&conn, &at_launch).unwrap(), "a session with no changes quits at once");
    conn.execute("INSERT INTO contacts (id, client_name, name) VALUES (502, 'Contoso Test', 'Quokka Fenwick')", []).unwrap();
    assert!(refresh_at_quit(&conn, &at_launch).unwrap());
    assert_eq!(indexed(&conn, "Quokka"), 1);
    assert!(!rebuild_if_stale(&conn).unwrap(), "so the next launch skips it");
    let _ = std::fs::remove_file(&path);
}
