// The company page in one round trip (foundations P4).
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::dossier::build_company_dossier;
use rusqlite::Connection;

fn fresh(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_dossier_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    (path.clone(), init_connection(&path).expect("init db"))
}

#[test]
fn one_call_returns_everything_the_company_page_shows() {
    let (path, conn) = fresh("all");
    conn.execute("INSERT INTO companies (id, name, created_at) VALUES (7, 'Contoso Test', '2026-09-01')", []).unwrap();
    conn.execute("INSERT INTO company_note_entries (company_id, company_name, body, is_legacy, created_at) VALUES (7, 'Contoso Test', 'Prefers WhatsApp', 0, '2026-09-20')", []).unwrap();
    conn.execute("INSERT INTO microsoft_files (id, path, name, item_type) VALUES (3, '/tmp/none/Contoso deck.pptx', 'Contoso deck.pptx', 'file')", []).unwrap();
    conn.execute("INSERT INTO entity_links (from_type, from_id, to_type, to_id, created_at) VALUES ('msfile', 3, 'company', 7, '2026-09-20')", []).unwrap();
    let d = build_company_dossier(&conn, Some(7), Some("Contoso Test")).unwrap();
    assert_eq!(d.note_entries.len(), 1);
    assert_eq!(d.links.len(), 1);
    assert_eq!(d.files.len(), 1);
    assert!(d.activity.iter().any(|a| a.entity_type == "company"), "the company's own timeline is there");
    let json = serde_json::to_value(&d).unwrap();
    for key in ["activity", "noteEntries", "links", "files", "emails"] {
        assert!(json.get(key).is_some(), "payload has {key}");
    }
    // A company known only by name: its notes, no links.
    let by_name = build_company_dossier(&conn, None, Some("Nobody Yet")).unwrap();
    assert!(by_name.links.is_empty() && by_name.files.is_empty() && by_name.emails.is_empty());
    let _ = std::fs::remove_file(&path);
}
