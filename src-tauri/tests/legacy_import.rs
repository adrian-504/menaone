use menabig_tracker_lib::commands::{import_legacy_backup_core, read_all_data};
use menabig_tracker_lib::db::init_connection;

/// End-to-end test of the legacy (original HTML app) backup import path, using the
/// 175-proposal / 59-contact / 51-agreement dataset in the original single-file
/// app's backup format. Clients, people, emails, phones and remarks are fake;
/// types, statuses, dates and ids keep the shape of the original data.
/// This is the exact migration path a real user will exercise via "Restore from backup".
#[test]
fn imports_real_legacy_dataset_correctly() {
    let dir = std::env::temp_dir().join(format!("menabig_test_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&dir);
    let mut conn = init_connection(&dir).expect("init db");

    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/legacy_seed_backup.json"))
        .expect("read fixture");

    let summary = import_legacy_backup_core(&mut conn, &json).expect("import should succeed");

    assert_eq!(summary.proposals, 175, "proposal count must match INITIAL_DATA");
    assert_eq!(summary.contacts, 59, "contact count must match INITIAL_CONTACTS");
    assert_eq!(summary.agreements, 51, "agreement count must match INITIAL_AGREEMENTS");
    assert_eq!(summary.todos, 0);
    assert_eq!(summary.notes, 0);
    assert!(summary.warnings.is_empty(), "no records should be skipped as malformed: {:?}", summary.warnings);

    // Regression check: the frontend reads noteFolders/contactLists/companyNotes (camelCase)
    // off the JSON this struct serializes to — a missing #[serde(rename_all = "camelCase")]
    // here previously shipped as snake_case and showed as "undefined" in the restore
    // confirmation dialog (caught via manual QA of the built .app).
    let summary_json = serde_json::to_value(&summary).expect("serialize summary");
    for key in ["noteFolders", "contactLists", "companyNotes"] {
        assert!(summary_json.get(key).is_some(), "ImportSummary JSON must use camelCase key '{key}', got: {summary_json}");
    }

    // Read back through the exact same path the frontend uses on startup (get_all_data).
    let data = read_all_data(&conn).expect("read back");
    assert_eq!(data.proposals.len(), 175);
    assert_eq!(data.contacts.len(), 59);
    // The 51 imported agreements, plus one created for each won proposal that
    // had none (so the delivery stage its old status carried is kept).
    let imported_agreements = data.agreements.iter().filter(|a| !a.remarks.as_deref().unwrap_or("").starts_with("Auto-created")).count();
    assert_eq!(imported_agreements, 51);
    let won_without_imported_agreement = data.proposals.iter().filter(|p| p.status == "Signed by Both Parties").count();
    assert!(data.agreements.len() > 51 && data.agreements.len() <= 51 + won_without_imported_agreement);

    // Spot-check specific known records survived with correct field values and IDs preserved.
    let p29 = data.proposals.iter().find(|p| p.id == 29).expect("proposal 29 exists");
    assert_eq!(p29.client, "Test Client 001 Engineering LLC");
    assert_eq!(p29.r#type.as_deref(), Some("Company Maintenance"));
    assert_eq!(p29.status, "Signed by Both Parties", "legacy statuses move onto the current list");
    assert_eq!(p29.lines.len(), 1, "each legacy proposal gets one service line");
    assert_eq!(p29.lines[0].service_name, "Company Maintenance");
    assert_eq!(p29.sent_date.as_deref(), Some("2023-10-05"));

    let p1 = data.proposals.iter().find(|p| p.id == 1).expect("proposal 1 exists");
    assert_eq!(p1.client, "Test Client 039 Solutions");
    assert_eq!(p1.owner.as_deref(), Some("Referral"));

    let agr1 = data.agreements.iter().find(|a| a.id == 1).expect("agreement 1 exists");
    assert_eq!(agr1.agr_ref.as_deref(), Some("TAA_001_1024"));
    assert_eq!(agr1.client.as_deref(), Some("Test Client 007 Solutions"));
    assert_eq!(agr1.status.as_deref(), Some("Signed"));

    let contact1 = data.contacts.iter().find(|c| c.id == 1).expect("contact 1 exists");
    assert_eq!(contact1.client_name.as_deref(), Some("Test Client 122 Holdings"));
    assert_eq!(contact1.email.as_deref(), Some("contact001@client.test"));

    // Default note folders should survive (seeded at db-init, unaffected by the import
    // since the legacy fixture's menabig_nfolders_v1 was populated with the same defaults).
    assert_eq!(data.note_folders.len(), 3);

    // A second import (simulating a re-import / restore-again) must not duplicate rows —
    // every write_* is a full delete-and-reinsert, so counts must stay identical.
    let summary2 = import_legacy_backup_core(&mut conn, &json).expect("second import should succeed");
    assert_eq!(summary2.proposals, 175);
    let data2 = read_all_data(&conn).expect("read back again");
    assert_eq!(data2.proposals.len(), 175);
    assert_eq!(data2.agreements.len(), data.agreements.len(), "restoring again creates no extra agreements");
    assert_eq!(data2.proposals.iter().map(|p| p.lines.len()).sum::<usize>(), data.proposals.iter().map(|p| p.lines.len()).sum::<usize>());

    let _ = std::fs::remove_file(&dir);
}
