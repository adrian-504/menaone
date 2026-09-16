// Per-record saves and sync columns: changed rows keep their identity, deletes
// leave tombstones, and saving one entity no longer clears links held by others.
use menabig_tracker_lib::commands::{
    company_links, delete_note_rows, delete_proposal_rows, delete_todo_rows, upsert_contact_rows, upsert_note_rows,
    upsert_proposal_rows, upsert_todo_rows, write_notes, write_proposals,
};
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::models::{ActivityNote, Contact, Note, Proposal, Todo};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_records_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

fn proposal(id: i64, client: &str, status: &str) -> Proposal {
    Proposal { id, client: client.into(), status: status.into(), ..Default::default() }
}

fn sync_state(conn: &Connection, table: &str, id: i64) -> (String, i64) {
    conn.query_row(&format!("SELECT uuid, row_version FROM {table} WHERE id = ?1"), params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
}

#[test]
fn upserts_track_identity_versions_and_tombstones() {
    let (path, mut conn) = fresh_db("identity");
    let v: String = conn.query_row("SELECT value FROM app_meta WHERE key='schema_version'", [], |r| r.get(0)).unwrap();
    assert_eq!(v, "32");

    upsert_proposal_rows(&mut conn, &[proposal(1, "Acme Test Co", "Lead")]).unwrap();
    let (uuid1, ver1) = sync_state(&conn, "proposals", 1);
    assert_eq!(uuid1.len(), 36, "insert gets a uuid");
    assert_eq!(ver1, 1);

    // Saving identical values is a no-op: no version bump.
    upsert_proposal_rows(&mut conn, &[proposal(1, "Acme Test Co", "Lead")]).unwrap();
    assert_eq!(sync_state(&conn, "proposals", 1), (uuid1.clone(), 1));

    // A real change bumps the version and keeps the same identity.
    upsert_proposal_rows(&mut conn, &[proposal(1, "Acme Test Co", "Proposal sent to Client")]).unwrap();
    assert_eq!(sync_state(&conn, "proposals", 1), (uuid1.clone(), 2));

    // Other rows are never touched by saving one record.
    upsert_proposal_rows(&mut conn, &[proposal(2, "Other Co", "Lead")]).unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM proposals", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 2);
    assert_eq!(sync_state(&conn, "proposals", 1), (uuid1.clone(), 2));

    delete_proposal_rows(&mut conn, &[1]).unwrap();
    let tomb: i64 = conn
        .query_row("SELECT COUNT(*) FROM sync_tombstones WHERE table_name = 'proposals' AND uuid = ?1", params![uuid1], |r| r.get(0))
        .unwrap();
    assert_eq!(tomb, 1, "delete is recorded for sync");
    let indexed: i64 = conn
        .query_row("SELECT COUNT(*) FROM search_index WHERE entity_type = 'proposal' AND entity_id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(indexed, 0, "deleted proposal leaves search");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn proposal_activity_notes_are_diffed_not_replaced() {
    let (path, mut conn) = fresh_db("activity");
    let mut p = proposal(1, "Acme Test Co", "Lead");
    p.notes = vec![
        ActivityNote { id: 10, date: Some("2026-09-01".into()), text: Some("first".into()) },
        ActivityNote { id: 11, date: Some("2026-09-02".into()), text: Some("second".into()) },
    ];
    upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap();
    let (kept_uuid, _) = sync_state(&conn, "proposal_activity_notes", 10);

    p.notes.truncate(1);
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    let remaining: i64 = conn.query_row("SELECT COUNT(*) FROM proposal_activity_notes", [], |r| r.get(0)).unwrap();
    assert_eq!(remaining, 1);
    assert_eq!(sync_state(&conn, "proposal_activity_notes", 10), (kept_uuid, 1), "kept note untouched");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn saving_one_entity_keeps_links_held_by_other_tables() {
    let (path, mut conn) = fresh_db("links");
    upsert_proposal_rows(&mut conn, &[proposal(1, "Acme Test Co", "Lead")]).unwrap();
    upsert_note_rows(&mut conn, &[Note { id: 1, title: Some("Kickoff".into()), ..Default::default() }]).unwrap();
    conn.execute("INSERT INTO opportunities (id, name, proposal_id) VALUES (1, 'Acme workforce', 1)", []).unwrap();
    conn.execute("INSERT INTO meetings (id, title, note_id) VALUES (1, 'Acme kickoff', 1)", []).unwrap();

    upsert_proposal_rows(&mut conn, &[proposal(1, "Acme Test Co", "Proposal sent to Client")]).unwrap();
    upsert_note_rows(&mut conn, &[Note { id: 1, title: Some("Kickoff (edited)".into()), ..Default::default() }]).unwrap();
    let opp_link: Option<i64> = conn.query_row("SELECT proposal_id FROM opportunities WHERE id = 1", [], |r| r.get(0)).unwrap();
    let meeting_link: Option<i64> = conn.query_row("SELECT note_id FROM meetings WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(opp_link, Some(1), "per-record proposal save keeps the opportunity's proposal link");
    assert_eq!(meeting_link, Some(1), "per-record note save keeps the meeting's note link");

    // The old whole-table saves cleared both links through ON DELETE SET NULL.
    write_proposals(&mut conn, &[proposal(1, "Acme Test Co", "Proposal sent to Client")]).unwrap();
    write_notes(&mut conn, &[Note { id: 1, title: Some("Kickoff (edited)".into()), ..Default::default() }]).unwrap();
    let opp_link: Option<i64> = conn.query_row("SELECT proposal_id FROM opportunities WHERE id = 1", [], |r| r.get(0)).unwrap();
    let meeting_link: Option<i64> = conn.query_row("SELECT note_id FROM meetings WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(opp_link, None);
    assert_eq!(meeting_link, None);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn todos_keep_sort_order_and_tags_and_cascade_cleanup() {
    let (path, mut conn) = fresh_db("todos");
    let task = |id: i64, parent: Option<i64>, sort: Option<i64>, tags: Vec<&str>| Todo {
        id,
        title: format!("Task {id}"),
        parent_id: parent,
        sort_order: sort,
        tags: tags.into_iter().map(String::from).collect(),
        ..Default::default()
    };
    // Subtask arrives before its parent in the same batch.
    upsert_todo_rows(&mut conn, &[task(2, Some(1), Some(0), vec![]), task(1, None, Some(5), vec!["client", "urgent"])]).unwrap();
    upsert_todo_rows(&mut conn, &[task(3, None, None, vec![])]).unwrap();
    let sort3: i64 = conn.query_row("SELECT sort_order FROM todos WHERE id = 3", [], |r| r.get(0)).unwrap();
    assert_eq!(sort3, 6, "new task without a position goes to the end");

    // Resaving with no position keeps the stored one; dropping a tag removes only that tag.
    upsert_todo_rows(&mut conn, &[task(3, None, None, vec![]), task(1, None, Some(5), vec!["client"])]).unwrap();
    let sort3: i64 = conn.query_row("SELECT sort_order FROM todos WHERE id = 3", [], |r| r.get(0)).unwrap();
    assert_eq!(sort3, 6);
    let tags: i64 = conn.query_row("SELECT COUNT(*) FROM entity_tags WHERE entity_type='task' AND entity_id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(tags, 1);

    // Time and Someday are stored and only a real change rewrites the row.
    let timed = Todo { due_date: Some("2026-09-14".into()), due_time: Some("15:00".into()), someday: true, ..task(3, None, None, vec![]) };
    upsert_todo_rows(&mut conn, &[timed.clone()]).unwrap();
    let (time, someday, version): (Option<String>, i64, i64) = conn
        .query_row("SELECT due_time, someday, row_version FROM todos WHERE id = 3", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap();
    assert_eq!((time.as_deref(), someday), (Some("15:00"), 1));
    upsert_todo_rows(&mut conn, &[timed]).unwrap();
    let again: i64 = conn.query_row("SELECT row_version FROM todos WHERE id = 3", [], |r| r.get(0)).unwrap();
    assert_eq!(again, version, "unchanged resave keeps the version");

    delete_todo_rows(&mut conn, &[1]).unwrap();
    let left: i64 = conn.query_row("SELECT COUNT(*) FROM todos", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 1, "subtask removed with its parent");
    let orphan_tags: i64 = conn.query_row("SELECT COUNT(*) FROM entity_tags WHERE entity_type='task'", [], |r| r.get(0)).unwrap();
    assert_eq!(orphan_tags, 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn contact_list_membership_and_note_delete() {
    let (path, mut conn) = fresh_db("contacts");
    let contact = |lists: Vec<&str>| Contact {
        id: 1,
        client_name: Some("Acme Test Co".into()),
        name: Some("Jane Tester".into()),
        email: Some("jane@example.test".into()),
        lists: lists.into_iter().map(String::from).collect(),
        ..Default::default()
    };
    upsert_contact_rows(&mut conn, &[contact(vec!["Newsletter", "Prospects"])]).unwrap();
    upsert_contact_rows(&mut conn, &[contact(vec!["Prospects"])]).unwrap();
    let lists: Vec<String> = conn
        .prepare("SELECT list_name FROM contact_list_members WHERE contact_id = 1")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(lists, vec!["Prospects".to_string()]);
    let company_id: Option<i64> = conn.query_row("SELECT company_id FROM contacts WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert!(company_id.is_some(), "company resolved on save");

    upsert_note_rows(&mut conn, &[Note { id: 5, title: Some("Temp".into()), tags: vec!["x".into()], ..Default::default() }]).unwrap();
    delete_note_rows(&mut conn, &[5]).unwrap();
    let note_tags: i64 = conn.query_row("SELECT COUNT(*) FROM entity_tags WHERE entity_type='note'", [], |r| r.get(0)).unwrap();
    assert_eq!(note_tags, 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn agreements_from_proposals_are_idempotent_with_unique_refs() {
    use menabig_tracker_lib::commands::{create_agreements_from_proposals, delete_agreement_rows};
    let (path, mut conn) = fresh_db("agreements");
    let mut signed = proposal(1, "Acme Test Co", "Service Started");
    signed.r#type = Some("Workforce Services".into());
    signed.dbl_signed_date = Some("2026-09-10".into());
    signed.monthly_fee = Some(12000.0);
    let mut second = proposal(2, "Acme Test Co", "Kickoff Meeting Set");
    second.r#type = Some("Recruitment".into());
    second.dbl_signed_date = Some("2026-09-11".into());
    upsert_proposal_rows(&mut conn, &[signed, second, proposal(3, "Acme Test Co", "Lead")]).unwrap();

    let created = create_agreements_from_proposals(&mut conn).unwrap();
    let mut refs: Vec<String> = created.iter().filter_map(|a| a.agr_ref.clone()).collect();
    refs.sort();
    assert_eq!(refs, vec!["ACME_WF_001_0926".to_string(), "ACME_WF_002_0926".to_string()]);
    assert_eq!(create_agreements_from_proposals(&mut conn).unwrap().len(), 0, "second run creates nothing");

    // Deleting the first agreement and re-creating it must not reuse 002.
    let first_id = created.iter().find(|a| a.proposal_id == Some(1)).unwrap().id;
    delete_agreement_rows(&mut conn, &[first_id]).unwrap();
    let recreated = create_agreements_from_proposals(&mut conn).unwrap();
    assert_eq!(recreated.len(), 1);
    assert_eq!(recreated[0].agr_ref.as_deref(), Some("ACME_WF_003_0926"));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn tasks_and_notes_link_to_their_company_on_save() {
    let (path, mut conn) = fresh_db("company_links");
    upsert_todo_rows(&mut conn, &[Todo { id: 1, title: "Call Acme".into(), client: Some("Acme Test Co".into()), ..Default::default() }]).unwrap();
    upsert_note_rows(&mut conn, &[Note { id: 1, title: Some("Acme notes".into()), client_name: Some(" Acme Test Co ".into()), ..Default::default() }]).unwrap();
    let acme: i64 = conn.query_row("SELECT id FROM companies WHERE name = 'Acme Test Co'", [], |r| r.get(0)).unwrap();
    let todo_company: Option<i64> = conn.query_row("SELECT company_id FROM todos WHERE id = 1", [], |r| r.get(0)).unwrap();
    let note_company: Option<i64> = conn.query_row("SELECT company_id FROM notes WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(todo_company, Some(acme));
    assert_eq!(note_company, Some(acme), "names are trimmed before matching");

    // What the upsert commands hand back so the interface can match by id.
    let links = company_links(&conn, "notes", &[1, 99]).unwrap();
    assert_eq!(links.len(), 1, "unknown ids are simply absent");
    assert_eq!((links[0].id, links[0].company_id), (1, Some(acme)));

    // Clearing the name clears the link.
    upsert_todo_rows(&mut conn, &[Todo { id: 1, title: "Call Acme".into(), client: None, ..Default::default() }]).unwrap();
    let todo_company: Option<i64> = conn.query_row("SELECT company_id FROM todos WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(todo_company, None);

    let _ = std::fs::remove_file(&path);
}

/// Rehearses pending migrations on a copy of a real database. Opt-in:
/// `MENA_REHEARSAL_DB=/path/to/copy.sqlite3 cargo test -- --ignored rehearse`
#[test]
#[ignore]
fn rehearse_migrations_on_database_copy() {
    let Ok(path) = std::env::var("MENA_REHEARSAL_DB") else { return };
    let path = std::path::PathBuf::from(path);
    assert!(!path.to_string_lossy().contains("Application Support"), "point this at a copy, never the live database");
    // Deletes made in normal use already left tombstones; migrating must not add any.
    // (Migration 29 removes links to records that no longer exist; those are the only deletions allowed.)
    let tombstones_before: i64 = Connection::open(&path)
        .and_then(|c| c.query_row("SELECT COUNT(*) FROM sync_tombstones WHERE table_name <> 'entity_links'", [], |r| r.get(0)))
        .unwrap_or(0);
    let conn = init_connection(&path).expect("migrations apply cleanly");
    let v: String = conn.query_row("SELECT value FROM app_meta WHERE key='schema_version'", [], |r| r.get(0)).unwrap();
    println!("schema_version={v}");
    for t in menabig_tracker_lib::db::SYNC_TABLES {
        let (rows, missing): (i64, i64) = conn
            .query_row(&format!("SELECT COUNT(*), SUM(uuid IS NULL) FROM {t}"), [], |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))))
            .unwrap();
        println!("{t}: rows={rows} missing_uuid={missing}");
        assert_eq!(missing, 0);
    }
    for (t, c) in [("meetings", "company_name"), ("notes", "client_name"), ("todos", "client"), ("intelligence_items", "company_name"), ("emails", "company_name")] {
        let (named, linked): (i64, i64) = conn
            .query_row(&format!("SELECT SUM({c} IS NOT NULL AND TRIM({c}) != ''), SUM(company_id IS NOT NULL) FROM {t}"), [], |r| {
                Ok((r.get::<_, Option<i64>>(0)?.unwrap_or(0), r.get::<_, Option<i64>>(1)?.unwrap_or(0)))
            })
            .unwrap();
        println!("{t}: with company name={named} linked={linked}");
    }
    let tombstones: i64 = conn.query_row("SELECT COUNT(*) FROM sync_tombstones WHERE table_name <> 'entity_links'", [], |r| r.get(0)).unwrap();
    assert_eq!(tombstones, tombstones_before, "migrating must not delete anything");
}
