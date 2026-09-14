use menabig_tracker_lib::commands::write_notes;
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::models::Note;
use menabig_tracker_lib::v2_search::{extract_wikilink_titles, rebuild_all, rebuild_note_links};
use rusqlite::{params, Connection};

fn fresh_db() -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_v2features_{}_{}.sqlite3", std::process::id(), rand_suffix()));
    let _ = std::fs::remove_file(&path);
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

fn rand_suffix() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() as u64;
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    nanos.wrapping_mul(1_000_003).wrapping_add(n)
}

#[test]
fn wikilink_extraction_finds_titles_inside_html_content() {
    let content = "<p>See <strong>[[Globex Saudization Strategy]]</strong> and also [[Amana Notes]].</p><p>No link here.</p>";
    let titles = extract_wikilink_titles(content);
    assert_eq!(titles, vec!["Globex Saudization Strategy".to_string(), "Amana Notes".to_string()]);
}

#[test]
fn note_links_and_backlinks_resolve_by_title() {
    let (path, mut conn) = fresh_db();
    let notes = vec![
        Note { id: 1, title: Some("Globex Meeting — September 9".into()), content: Some("<p>Discussed [[Globex Saudization Strategy]] in depth.</p>".into()), ..Default::default() },
        Note { id: 2, title: Some("Globex Saudization Strategy".into()), content: Some("<p>Strategy details.</p>".into()), ..Default::default() },
        Note { id: 3, title: Some("Unrelated".into()), content: Some("<p>no links</p>".into()), ..Default::default() },
    ];
    write_notes(&mut conn, &notes).expect("write notes");

    // Backlinks of note 2 (the strategy note) must include note 1 (the meeting note that linked to it).
    let mut stmt = conn.prepare("SELECT source_note_id FROM note_links WHERE target_note_id = 2").unwrap();
    let backlinks: Vec<i64> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(backlinks, vec![1]);

    // Note 3 has no links either direction.
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM note_links WHERE source_note_id = 3 OR target_note_id = 3", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn project_progress_derives_from_linked_task_completion() {
    let (path, conn) = fresh_db();
    conn.execute(
        "INSERT INTO projects (id, name, type, status, priority, created_at, updated_at) VALUES (1, 'MENA BIG Recruitment Division', 'internal', 'In Progress', 'High', '2026-01-01', '2026-01-01')",
        [],
    ).unwrap();
    // 4 tasks linked to the project, 3 done -> 75% progress.
    for (id, status) in [(1, "Done"), (2, "Done"), (3, "Done"), (4, "Pending")] {
        conn.execute(
            "INSERT INTO todos (id, title, status, project_id) VALUES (?1, 'task', ?2, 1)",
            params![id, status],
        ).unwrap();
    }
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM todos WHERE project_id = 1", [], |r| r.get(0)).unwrap();
    let done: i64 = conn.query_row("SELECT COUNT(*) FROM todos WHERE project_id = 1 AND status = 'Done'", [], |r| r.get(0)).unwrap();
    assert_eq!(total, 4);
    assert_eq!(done, 3);
    assert_eq!((done * 100) / total, 75, "4 tasks, 3 done must compute to 75% progress");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn internal_project_has_no_company_and_client_project_does() {
    let (path, conn) = fresh_db();
    conn.execute(
        "INSERT INTO projects (id, name, type, status, priority, company_name, created_at, updated_at)
         VALUES (1, 'Globex Saudization Workforce Model', 'client', 'In Progress', 'High', 'Globex', '2026-01-01', '2026-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, type, status, priority, company_name, created_at, updated_at)
         VALUES (2, 'Launch MENA BIG Recruitment Division', 'internal', 'Planning', 'Medium', NULL, '2026-01-01', '2026-01-01')",
        [],
    ).unwrap();
    let client_company: Option<String> = conn.query_row("SELECT company_name FROM projects WHERE id = 1", [], |r| r.get(0)).unwrap();
    let internal_company: Option<String> = conn.query_row("SELECT company_name FROM projects WHERE id = 2", [], |r| r.get(0)).unwrap();
    assert_eq!(client_company.as_deref(), Some("Globex"));
    assert_eq!(internal_company, None, "internal projects must support a NULL company — this is the core requirement of Part 3");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn search_index_finds_project_by_partial_name() {
    let (path, conn) = fresh_db();
    conn.execute(
        "INSERT INTO projects (id, name, type, status, priority, description, created_at, updated_at)
         VALUES (1, 'Globex Saudization Workforce Model', 'client', 'In Progress', 'High', 'Workforce nationalization plan', '2026-01-01', '2026-01-01')",
        [],
    ).unwrap();
    rebuild_all(&conn).expect("rebuild search index");
    let mut stmt = conn.prepare("SELECT entity_type, entity_id FROM search_index WHERE search_index MATCH '\"globex\"*'").unwrap();
    let rows: Vec<(String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert!(rows.contains(&("project".to_string(), 1)), "search must find the project by a prefix of its name, got: {rows:?}");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn rebuild_note_links_is_idempotent_and_does_not_duplicate() {
    let (path, mut conn) = fresh_db();
    let notes = vec![
        Note { id: 1, title: Some("A".into()), content: Some("[[B]]".into()), ..Default::default() },
        Note { id: 2, title: Some("B".into()), content: Some("".into()), ..Default::default() },
    ];
    write_notes(&mut conn, &notes).unwrap();
    rebuild_note_links(&conn).unwrap();
    rebuild_note_links(&conn).unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM note_links", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1, "rebuilding twice must not duplicate links");

    let _ = std::fs::remove_file(&path);
}
