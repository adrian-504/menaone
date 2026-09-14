// Company Master Data migration engine — verifies the safety guarantees the
// spec was built around: exact/fuzzy matches link instead of duplicating,
// a brand-new name auto-creates, a placeholder-like name never gets guessed
// (goes to the review queue instead), and re-running is a safe no-op for
// anything already resolved. Mirrors v2_migration.rs's convention: synthetic
// fake data only, a temp-dir SQLite file, cleaned up at the end.
use menabig_tracker_lib::company_migration::run_migration_on_db;
use menabig_tracker_lib::db::init_connection;
use rusqlite::Connection;

fn seed(conn: &Connection) {
    conn.execute_batch(
        r#"
        INSERT INTO companies (name, created_at) VALUES ('Acme Test Co', '2026-01-01');

        INSERT INTO proposals (id, client, type, status) VALUES (1, 'Acme Test Co', 'Workforce', 'Service Started');
        INSERT INTO proposals (id, client, type, status) VALUES (2, 'No Client Name', 'Workforce', 'Lead');

        INSERT INTO contacts (id, client_name, name, email) VALUES (1, 'Acme Test Co', 'Jane Tester', 'jane@example.test');

        INSERT INTO agreements (id, agr_ref, client, status) VALUES (1, 'ACME_WF_001', 'Acme Test Co Ltd', 'Signed');

        INSERT INTO projects (id, name, type, status, priority, company_name)
          VALUES (1, 'Ventures Kickoff', 'client', 'Active', 'Medium', 'Brand New Ventures');
        "#,
    )
    .unwrap();
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn company_migration_links_creates_and_queues_correctly() {
    let dst = std::env::temp_dir().join(format!("menabig_company_migration_test_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&dst);
    let mut backups_to_clean: Vec<String> = Vec::new();

    {
        let mut conn = init_connection(&dst).expect("schema init (incl. migration #16) should succeed");
        seed(&conn);

        // First run: an exact match links, a fuzzy match ("... Ltd") links to
        // the same existing company rather than duplicating it, a brand-new
        // name auto-creates, and a placeholder-like name is queued for review
        // instead of being guessed.
        let report = run_migration_on_db(&dst, &mut conn).expect("migration should succeed");
        backups_to_clean.push(report.backup_path.clone());

        assert_eq!(report.distinct_legacy_names_seen, 4, "Acme Test Co, Acme Test Co Ltd, Brand New Ventures, No Client Name");
        assert_eq!(report.companies_created, 1, "only Brand New Ventures has no plausible existing match");
        assert_eq!(report.fuzzy_matches_linked, 1, "'Acme Test Co Ltd' should link to the existing 'Acme Test Co', not duplicate it");
        assert_eq!(report.queued_for_review, 1, "'No Client Name' looks like a placeholder and must never be auto-linked or auto-created");
        assert_eq!(report.proposals_linked, 1, "only the 'Acme Test Co' proposal links; the placeholder one stays unresolved");
        assert_eq!(report.contacts_linked, 1);
        assert_eq!(report.agreements_linked, 1);
        assert_eq!(report.projects_linked, 1);
        assert_eq!(report.companies_total, 2);
        assert_eq!(report.companies_without_contacts, 1, "Brand New Ventures has no contacts; Acme Test Co does");

        // The fuzzy-matched agreement must point at the SAME company id as the
        // exact-matched proposal/contact — proof it linked rather than duplicated.
        let acme_id: i64 = conn.query_row("SELECT id FROM companies WHERE name = 'Acme Test Co'", [], |r| r.get(0)).unwrap();
        let proposal_company_id: i64 = conn.query_row("SELECT company_id FROM proposals WHERE id = 1", [], |r| r.get(0)).unwrap();
        let agreement_company_id: i64 = conn.query_row("SELECT company_id FROM agreements WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(proposal_company_id, acme_id);
        assert_eq!(agreement_company_id, acme_id, "fuzzy-matched 'Acme Test Co Ltd' must resolve to the SAME company, not a new one");

        // The placeholder proposal must remain unlinked and show up as a
        // pending review-queue entry, never silently resolved.
        let placeholder_company_id: Option<i64> =
            conn.query_row("SELECT company_id FROM proposals WHERE id = 2", [], |r| r.get(0)).unwrap();
        assert_eq!(placeholder_company_id, None);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM company_review_queue WHERE raw_name = 'No Client Name' AND status = 'pending'"),
            1
        );

        // Second run (simulates re-opening the app / re-running from Settings):
        // every already-resolved row is skipped entirely, and the
        // still-pending review entry is not queued a second time.
        let report2 = run_migration_on_db(&dst, &mut conn).expect("re-running the migration must be safe");
        backups_to_clean.push(report2.backup_path.clone());

        assert_eq!(report2.distinct_legacy_names_seen, 1, "only 'No Client Name' still has no company_id");
        assert_eq!(report2.companies_created, 0);
        assert_eq!(report2.fuzzy_matches_linked, 0);
        assert_eq!(report2.queued_for_review, 0, "already pending — must not be queued again");
        assert_eq!(report2.proposals_linked, 0);
        assert_eq!(report2.contacts_linked, 0);
        assert_eq!(report2.agreements_linked, 0);
        assert_eq!(report2.projects_linked, 0);
        assert_eq!(report2.companies_total, 2, "no new companies on the idempotent re-run");
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM company_review_queue WHERE raw_name = 'No Client Name'"),
            1,
            "still exactly one review-queue row, not duplicated"
        );
    }

    let _ = std::fs::remove_file(&dst);
    for path in backups_to_clean {
        let _ = std::fs::remove_file(&path);
    }
}
