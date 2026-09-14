use menabig_tracker_lib::db::init_connection;
use rusqlite::Connection;

/// Builds a minimal synthetic V1 database (fake data only — no real client
/// information belongs in a version-controlled test) with just enough rows to
/// prove the V2 migration is additive-only: every existing row must survive
/// untouched, new tables must appear, and running init twice (simulating two
/// app launches) must be a safe no-op the second time.
fn build_synthetic_v1_db(path: &std::path::Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE proposals (
          id INTEGER PRIMARY KEY, client TEXT NOT NULL, type TEXT, status TEXT NOT NULL,
          sent_date TEXT, dbl_signed_date TEXT, kickoff_date TEXT, finance TEXT, hubspot TEXT,
          owner TEXT, remarks TEXT, date_added TEXT, monthly_fee REAL, contract_months INTEGER,
          win_loss_reason TEXT, doc_link TEXT, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT,
          snoozed_until TEXT, date_sent_to_hassan TEXT, date_sent_to_client TEXT, date_signed TEXT
        );
        CREATE TABLE proposal_activity_notes (id INTEGER PRIMARY KEY, proposal_id INTEGER NOT NULL, note_date TEXT, text TEXT);
        CREATE TABLE contacts (id INTEGER PRIMARY KEY, client_name TEXT, name TEXT, role TEXT, email TEXT, phone TEXT, whatsapp TEXT, service TEXT);
        CREATE TABLE contact_list_defs (name TEXT PRIMARY KEY);
        CREATE TABLE contact_list_members (contact_id INTEGER NOT NULL, list_name TEXT NOT NULL, PRIMARY KEY (contact_id, list_name));
        CREATE TABLE agreements (
          id INTEGER PRIMARY KEY, agr_ref TEXT, client TEXT, type TEXT, status TEXT, prepared_by TEXT,
          date_prepared TEXT, date_sent_to_client TEXT, date_client_signed TEXT, date_mena_signed TEXT,
          date_filed TEXT, monthly_fee REAL, contract_months INTEGER, proposal_id INTEGER, hubspot TEXT,
          doc_link TEXT, action_date TEXT, remarks TEXT, created_at TEXT
        );
        CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, type TEXT, client TEXT, priority TEXT, due_date TEXT, status TEXT, description TEXT, created_at TEXT, completed_at TEXT);
        CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, content TEXT, folder TEXT, client_name TEXT, tags_json TEXT, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT);
        CREATE TABLE note_folders (name TEXT PRIMARY KEY, sort_order INTEGER);
        CREATE TABLE company_notes (company_name TEXT PRIMARY KEY, note_text TEXT);
        CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);

        INSERT INTO proposals (id, client, type, status) VALUES (1, 'Acme Test Co', 'Workforce', 'Service Started');
        INSERT INTO proposals (id, client, type, status) VALUES (2, 'Acme Test Co', 'Admin PRO', 'Proposal sent to Client');
        INSERT INTO contacts (id, client_name, name, email) VALUES (1, 'Acme Test Co', 'Jane Tester', 'jane@example.test');
        INSERT INTO agreements (id, agr_ref, client, status) VALUES (1, 'ACME_WF_001', 'Acme Test Co', 'Signed');
        INSERT INTO todos (id, title, status) VALUES (1, 'Follow up with Acme', 'Pending');
        INSERT INTO notes (id, title, content) VALUES (1, 'Kickoff notes', '<p>hello</p>');
        INSERT INTO note_folders (name, sort_order) VALUES ('Meeting Notes', 0);
        "#,
    )
    .unwrap();
}

#[test]
fn v2_migration_preserves_v1_data_and_is_idempotent() {
    let dst = std::env::temp_dir().join(format!("menabig_v2migration_test_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&dst);
    build_synthetic_v1_db(&dst);

    // First migration run.
    {
        let conn = init_connection(&dst).expect("migration should succeed on a real V1 db");
        let get = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(get("select count(*) from proposals"), 2, "proposals must be untouched");
        assert_eq!(get("select count(*) from contacts"), 1, "contacts must be untouched");
        assert_eq!(get("select count(*) from agreements where id = 1 and agr_ref = 'ACME_WF_001' and status = 'Signed'"), 1, "existing agreements must be untouched");
        // v22: the proposal at "Service Started" is won, and its new agreement
        // carries the fact that the service started.
        assert_eq!(get("select count(*) from agreements"), 2);
        assert_eq!(get("select count(*) from agreements where proposal_id = 1 and service_status = 'Active' and status = 'In Preparation'"), 1);
        assert_eq!(get("select count(*) from proposals where id = 1 and status = 'Signed by Both Parties' and currency = 'SAR'"), 1);
        assert_eq!(get("select count(*) from proposals where id = 2 and status = 'Sent to Client'"), 1);
        assert_eq!(get("select count(*) from proposal_lines"), 2, "one line per legacy proposal");
        assert_eq!(get("select count(*) from services"), 22, "catalog seeded from the built-in proposal types (v25 adds Liquidation and the Constitution & Maintenance package)");
        assert_eq!(get("select count(*) from team_members where name = 'Hassan Balaghi' and is_reviewer = 1"), 1);
        assert_eq!(get("select count(*) from activity where entity_type = 'proposal' and action = 'status_changed'"), 0, "the clean-up is not logged as activity");
        assert_eq!(get("select count(*) from todos"), 1, "todos must be untouched");
        assert_eq!(get("select count(*) from notes"), 1, "notes must be untouched");
        let client: String = conn.query_row("select client from proposals where id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(client, "Acme Test Co");
        assert_eq!(get("select count(*) from projects"), 0, "projects table should exist and start empty");
        assert_eq!(get("select count(*) from note_templates"), 11, "11 built-in templates should be seeded");
        let sv: String = conn.query_row("select value from app_meta where key='schema_version'", [], |r| r.get(0)).unwrap();
        // Bump this whenever a new entry is appended to MIGRATIONS in db.rs —
        // it was stuck at "6" for a long stretch of migrations without anyone
        // noticing because the suite wasn't being run.
        assert_eq!(sv, "29");
        // New nullable columns on todos must exist and be queryable (additive-only ALTER TABLE).
        assert_eq!(get("select count(*) from todos where project_id is null"), 1);
        // Migration 4 (Microsoft 365 integration): new tables exist, and the existing
        // meetings table gained its Outlook-sync columns without disturbing anything else.
        assert_eq!(get("select count(*) from microsoft_account"), 0);
        assert_eq!(get("select count(*) from emails"), 0);
        assert_eq!(get("select count(*) from intelligence_items"), 0);
        assert_eq!(get("select count(*) from email_completed_log"), 0);
        assert_eq!(get("select count(*) from meetings where outlook_event_id is null"), 0, "meetings table should exist and start empty");
    }

    // Second run (simulates the next app launch) must be a no-op: no errors, no duplication.
    {
        let conn = init_connection(&dst).expect("re-running migration must be idempotent");
        let get = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(get("select count(*) from proposals"), 2);
        assert_eq!(get("select count(*) from agreements"), 2);
        assert_eq!(get("select count(*) from proposal_lines"), 2);
        assert_eq!(get("select count(*) from note_templates"), 11, "templates must not duplicate on re-init");
        // Fixture pre-seeded 1 folder, so first-run defaulting (which only fires on an
        // empty table) never added the other two — confirms existing folders are never
        // touched or duplicated by the migration or by re-running init.
        assert_eq!(get("select count(*) from note_folders"), 1, "pre-existing folder must survive untouched, no defaults added on top");
    }

    let _ = std::fs::remove_file(&dst);
}
