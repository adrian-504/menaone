// set_app_meta may only write interface state (SECURITY_AUDIT S3): the keys
// that repoint sign-in, the proposals folder or the schema must be refused.
use menabig_tracker_lib::commands::{ui_meta_key_allowed, UI_META_KEYS};

#[test]
fn interface_state_keys_are_allowed() {
    for key in ["myday_snoozed", "reminder_settings", "msfiles_pinned", "notes_markdown_migrated_v1"] {
        assert!(ui_meta_key_allowed(key), "{key} should be writable");
    }
}

#[test]
fn configuration_and_system_keys_are_refused() {
    for key in [
        "schema_version",
        "current_user_id",
        "proposals_root",
        "proposal_library_dir",
        "proposal_master_path",
        "ms365_client_id",
        "ms365_tenant_id",
        "",
        "myday_snoozed ",
        "MYDAY_SNOOZED",
    ] {
        assert!(!ui_meta_key_allowed(key), "{key:?} must not be writable from the interface");
    }
}

#[test]
fn list_has_no_duplicates() {
    let mut keys = UI_META_KEYS.to_vec();
    keys.sort();
    keys.dedup();
    assert_eq!(keys.len(), UI_META_KEYS.len());
}
