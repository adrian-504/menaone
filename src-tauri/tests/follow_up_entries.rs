// Following up and closing (followup, 1.65): migration 45 adds, on touches,
// who followed up, what was said, the entry shared by several proposals and
// the "will revert after" day; on proposals, who sent it, the day it was
// accepted, the day the engagement letter went out, the day it was lost and
// to whom, and Follow-up's "keep, with a reason". Proposals are saved two ways
// (the whole table, and row by row); a column missing from either would be
// lost on the next save. A one-click "Followed up" still writes none of the
// new fields. Scratch databases only.
use menabig_tracker_lib::commands::{read_all_data, upsert_proposal_rows, write_proposals};
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version, MIGRATION_45_COLUMNS};
use menabig_tracker_lib::models::Proposal;
use menabig_tracker_lib::touches::{add_touch, read_touches, update_touch, NewTouch, TouchChange};
use rusqlite::Connection;

fn fresh_db(tag: &str) -> Connection {
    let path = std::env::temp_dir().join(format!("menabig_follow_up_entries_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    init_connection(&path).expect("init db")
}

fn columns(conn: &Connection, table: &str) -> Vec<String> {
    conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')")).unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn member(conn: &Connection, name: &str) -> i64 {
    conn.execute("INSERT INTO team_members (name, active) VALUES (?1, 1)", [name]).unwrap();
    conn.last_insert_rowid()
}

fn sent(id: i64) -> Proposal {
    Proposal { id, client: "Sample Client".into(), status: "Sent to Client".into(), date_sent_to_client: Some("2026-09-01".into()), ..Default::default() }
}

#[test]
fn migration_45_adds_eleven_nullable_columns_and_running_it_again_changes_nothing() {
    let conn = fresh_db("columns");
    assert!(latest_schema_version() >= 45);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    assert_eq!(MIGRATION_45_COLUMNS.len(), 11);
    for (table, column, _) in MIGRATION_45_COLUMNS {
        assert_eq!(columns(&conn, table).iter().filter(|x| x.as_str() == *column).count(), 1, "{table}.{column} is there once");
        let notnull: i64 = conn.query_row(&format!("SELECT \"notnull\" FROM pragma_table_info('{table}') WHERE name = '{column}'"), [], |r| r.get(0)).unwrap();
        assert_eq!(notnull, 0, "{table}.{column} is nullable");
    }
    let (touches, proposals) = (columns(&conn, "touches"), columns(&conn, "proposals"));
    // Opening the same file again runs the migration's guards, not the ALTERs.
    let path = conn.path().unwrap().to_string();
    drop(conn);
    let again = init_connection(&std::path::PathBuf::from(&path)).expect("reopen");
    assert_eq!(columns(&again, "touches"), touches);
    assert_eq!(columns(&again, "proposals"), proposals);
}

#[test]
fn the_new_proposal_fields_survive_both_ways_of_saving_a_proposal() {
    let mut conn = fresh_db("proposal");
    let who = member(&conn, "Sample Member");
    let mut p = sent(1);
    p.sent_by_id = Some(who);
    p.accepted_at = Some("2026-09-20".into());
    p.engagement_letter_sent_at = Some("2026-09-22".into());
    p.lost_at = Some("2026-09-25".into());
    p.lost_to = Some("Another provider".into());
    p.keep_reason = Some("Budget in January".into());
    p.keep_until = Some("2026-10-31".into());
    let fields = |conn: &Connection| {
        let p = read_all_data(conn).unwrap().proposals.into_iter().next().unwrap();
        (p.sent_by_id, p.accepted_at, p.engagement_letter_sent_at, p.lost_at, p.lost_to, p.keep_reason, p.keep_until)
    };
    let all = (Some(who), Some("2026-09-20".to_string()), Some("2026-09-22".to_string()), Some("2026-09-25".to_string()), Some("Another provider".to_string()), Some("Budget in January".to_string()), Some("2026-10-31".to_string()));

    // The whole table.
    write_proposals(&mut conn, &[p.clone()]).unwrap();
    assert_eq!(fields(&conn), all);
    // Row by row: saving what was read changes nothing.
    let read = read_all_data(&conn).unwrap().proposals;
    upsert_proposal_rows(&mut conn, &read).unwrap();
    assert_eq!(fields(&conn), all);
    // A change, row by row.
    p.accepted_at = Some("2026-09-21".into());
    p.keep_until = Some("2026-11-15".into());
    upsert_proposal_rows(&mut conn, &[p.clone()]).unwrap();
    let back = fields(&conn);
    assert_eq!((back.1.as_deref(), back.6.as_deref()), (Some("2026-09-21"), Some("2026-11-15")));
    // Cleared, row by row: each goes back to not recorded.
    let cleared = sent(1);
    upsert_proposal_rows(&mut conn, &[cleared]).unwrap();
    assert_eq!(fields(&conn), (None, None, None, None, None, None, None));
    // A proposal that never had them, saved either way, stays without them.
    write_proposals(&mut conn, &[sent(1), sent(2)]).unwrap();
    assert_eq!(count(&conn, "SELECT count(*) FROM proposals WHERE sent_by_id IS NOT NULL OR accepted_at IS NOT NULL OR engagement_letter_sent_at IS NOT NULL OR lost_at IS NOT NULL OR lost_to IS NOT NULL OR keep_reason IS NOT NULL OR keep_until IS NOT NULL"), 0);
}

#[test]
fn who_sent_it_goes_back_to_not_recorded_when_that_team_member_is_deleted() {
    let mut conn = fresh_db("member");
    let who = member(&conn, "Sample Member");
    let mut p = sent(1);
    p.sent_by_id = Some(who);
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
    let t = add_touch(&conn, &NewTouch { proposal_id: Some(1), kind: "call".into(), at: "2026-09-10".into(), by_member_id: Some(who), ..Default::default() }).unwrap();
    conn.execute("DELETE FROM team_members WHERE id = ?1", [who]).unwrap();
    assert_eq!(read_all_data(&conn).unwrap().proposals[0].sent_by_id, None);
    assert_eq!(read_touches(&conn).unwrap().into_iter().find(|x| x.id == t.id).unwrap().by_member_id, None);
}

#[test]
fn a_one_click_follow_up_writes_none_of_the_new_fields() {
    let mut conn = fresh_db("oneclick");
    upsert_proposal_rows(&mut conn, &[sent(1)]).unwrap();
    let t = add_touch(&conn, &NewTouch { proposal_id: Some(1), kind: "email_out".into(), at: "2026-09-12".into(), ..Default::default() }).unwrap();
    assert_eq!((t.kind.as_str(), t.direction.as_str(), t.at.as_str()), ("email_out", "out", "2026-09-12"));
    assert_eq!((t.by_member_id, t.note, t.batch_id, t.revert_after), (None, None, None, None));
}

#[test]
fn an_entry_carries_who_what_was_said_its_batch_and_the_revert_day_and_can_be_changed() {
    let mut conn = fresh_db("entry");
    let who = member(&conn, "Sample Member");
    let other = member(&conn, "Other Member");
    upsert_proposal_rows(&mut conn, &[sent(1), sent(2)]).unwrap();
    // One entry across two proposals: a row each, the same batch.
    let entry = |proposal: i64| NewTouch {
        proposal_id: Some(proposal), kind: "whatsapp".into(), direction: Some("in".into()), at: "2026-09-18".into(),
        by_member_id: Some(who), note: Some("  Will come back after the board meeting  ".into()), batch_id: Some("batch-1".into()), revert_after: Some("2026-10-15".into()), ..Default::default()
    };
    let a = add_touch(&conn, &entry(1)).unwrap();
    let b = add_touch(&conn, &entry(2)).unwrap();
    for t in [&a, &b] {
        assert_eq!((t.direction.as_str(), t.by_member_id, t.note.as_deref(), t.batch_id.as_deref(), t.revert_after.as_deref()),
            ("in", Some(who), Some("Will come back after the board meeting"), Some("batch-1"), Some("2026-10-15")));
    }
    assert_eq!(count(&conn, "SELECT count(*) FROM touches WHERE batch_id = 'batch-1'"), 2);

    // Changed afterwards: the day, the channel, who, the line. What it is about and its batch stay.
    let changed = update_touch(&conn, a.id, &TouchChange { kind: "call".into(), direction: Some("in".into()), at: "2026-09-17".into(), by_member_id: Some(other), note: Some("Asked for a lower fee".into()), revert_after: None }).unwrap().unwrap();
    assert_eq!((changed.kind.as_str(), changed.direction.as_str(), changed.at.as_str(), changed.by_member_id, changed.note.as_deref(), changed.revert_after.as_deref()),
        ("call", "in", "2026-09-17", Some(other), Some("Asked for a lower fee"), None));
    assert_eq!((changed.proposal_id, changed.batch_id.as_deref(), changed.created_at.as_str()), (Some(1), Some("batch-1"), a.created_at.as_str()));
    // The other row of the entry is untouched.
    assert_eq!(read_touches(&conn).unwrap().into_iter().find(|x| x.id == b.id).unwrap(), b);

    // "Will revert after" belongs to a client's reply: a follow-up of ours never carries it; an empty line is no line.
    let ours = add_touch(&conn, &NewTouch { proposal_id: Some(1), kind: "email_out".into(), at: "2026-09-19".into(), note: Some("   ".into()), revert_after: Some("2026-10-15".into()), ..Default::default() }).unwrap();
    assert_eq!((ours.note, ours.revert_after), (None, None));
    let turned = update_touch(&conn, b.id, &TouchChange { kind: "email_out".into(), direction: None, at: "2026-09-18".into(), by_member_id: Some(who), note: None, revert_after: Some("2026-10-15".into()) }).unwrap().unwrap();
    assert_eq!((turned.direction.as_str(), turned.revert_after), ("out", None));

    // An entry that is gone, and one that did not come from a click, cannot be changed.
    assert!(update_touch(&conn, 9999, &TouchChange { kind: "call".into(), at: "2026-09-17".into(), ..Default::default() }).unwrap().is_none());
    conn.execute("INSERT INTO touches (proposal_id, kind, direction, at, source, source_id, created_at) VALUES (1, 'email_in', 'in', '2026-09-20', 'outlook', 'msg-1', '2026-09-20T09:00:00Z')", []).unwrap();
    let synced = conn.last_insert_rowid();
    assert!(update_touch(&conn, synced, &TouchChange { kind: "call".into(), at: "2026-09-17".into(), ..Default::default() }).unwrap().is_none());
}

const OLD_PROPOSAL_COLUMNS: &[&str] = &[
    "id", "client", "type", "status", "sent_date", "dbl_signed_date", "kickoff_date", "finance", "hubspot", "owner", "remarks", "date_added",
    "monthly_fee", "contract_months", "win_loss_reason", "doc_link", "archived", "archived_at", "snoozed_until", "date_sent_to_hassan",
    "date_sent_to_client", "date_signed", "company_id", "business_entity_id", "currency", "one_time_fee", "primary_contact_id", "owner_id",
    "reviewer_id", "review_status", "review_requested_at", "reviewed_at", "review_note", "valid_until", "folder_path", "lead_source",
    "promised_by", "request_group", "revision", "last_sent_at", "service_started_at",
];
const OLD_TOUCH_COLUMNS: &[&str] = &["id", "company_id", "proposal_id", "kind", "direction", "at", "subject", "contact_id", "source", "source_id", "created_at"];

/// Every row's old columns as one string, to compare before and after without printing a value.
fn old_rows(conn: &Connection, table: &str, cols: &[&str]) -> Vec<String> {
    let list = cols.iter().map(|c| format!("quote({c})")).collect::<Vec<_>>().join(" || '|' || ");
    conn.prepare(&format!("SELECT {list} FROM {table} ORDER BY id")).unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
}

/// Opt-in, against a COPY of a real database (never the live file):
///   MENA_REHEARSAL_DB=/scratch/copy.sqlite3 cargo test --test follow_up_entries -- --ignored --nocapture
/// Opens only that file and a backups folder beside it. Prints counts and column names, never a value.
#[test]
#[ignore]
fn rehearse_migration_45_on_a_copy() {
    let Ok(path) = std::env::var("MENA_REHEARSAL_DB") else { return };
    // The live database is under ~/Library/Application Support, the shared folder under ~/Library/CloudStorage.
    assert!(!path.contains("/Application Support/") && !path.contains("/CloudStorage/"), "use a scratch copy, not the live database");
    let (version_before, proposals_before, touches_before, agreements_before, notes_before, lines_before) = {
        let plain = Connection::open(&path).unwrap();
        (schema_version(&plain).unwrap(), old_rows(&plain, "proposals", OLD_PROPOSAL_COLUMNS), old_rows(&plain, "touches", OLD_TOUCH_COLUMNS),
         count(&plain, "SELECT count(*) FROM agreements"), count(&plain, "SELECT count(*) FROM proposal_activity_notes"), count(&plain, "SELECT count(*) FROM proposal_lines"))
    };
    println!("before: schema {version_before}, {} proposals, {} touches, {agreements_before} agreements, {notes_before} proposal notes, {lines_before} proposal lines", proposals_before.len(), touches_before.len());

    // First what the app does on launch before it migrates: a checked snapshot, into a scratch folder beside the copy.
    let backups = std::path::PathBuf::from(&path).parent().unwrap().join("rehearsal-backups");
    let snapshot = menabig_tracker_lib::backups::backup_before_migrations(std::path::Path::new(&path), &backups).unwrap();
    if version_before < latest_schema_version() {
        let file = snapshot.expect("behind this build, so it is copied first");
        assert!(menabig_tracker_lib::housekeeping::file_is_intact(&file), "the snapshot passes its check");
        let kept = Connection::open(&file).unwrap();
        assert_eq!(schema_version(&kept).unwrap(), version_before, "the snapshot is the database as it was");
        println!("backup: {} taken before migrating, intact", file.file_name().unwrap().to_string_lossy());
    }

    let mut conn = init_connection(&std::path::PathBuf::from(&path)).unwrap();
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    for (table, column, _) in MIGRATION_45_COLUMNS {
        assert_eq!(columns(&conn, table).iter().filter(|x| x.as_str() == *column).count(), 1, "{table}.{column}");
        assert_eq!(count(&conn, &format!("SELECT count(*) FROM {table} WHERE {column} IS NOT NULL")), 0, "{table}.{column} starts empty on every row");
    }
    assert_eq!(old_rows(&conn, "proposals", OLD_PROPOSAL_COLUMNS), proposals_before, "no existing proposal value changed");
    assert_eq!(old_rows(&conn, "touches", OLD_TOUCH_COLUMNS), touches_before, "no existing touch value changed");
    assert_eq!(count(&conn, "SELECT count(*) FROM agreements"), agreements_before);
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(check, "ok");
    println!("after:  schema {}, {} proposals and {} touches unchanged in every old column, 11 new columns empty, integrity {check}", schema_version(&conn).unwrap(), proposals_before.len(), touches_before.len());

    // The app's own save: every proposal as read, written back row by row.
    let all = read_all_data(&conn).unwrap().proposals;
    upsert_proposal_rows(&mut conn, &all).unwrap();
    assert_eq!(old_rows(&conn, "proposals", OLD_PROPOSAL_COLUMNS), proposals_before, "saving what was read changes no old column");
    assert_eq!(count(&conn, "SELECT count(*) FROM proposal_activity_notes"), notes_before);
    assert_eq!(count(&conn, "SELECT count(*) FROM proposal_lines"), lines_before);
    assert_eq!(old_rows(&conn, "touches", OLD_TOUCH_COLUMNS), touches_before, "saving proposals leaves the touches alone");
    println!("re-save: every proposal written back as read; no old column moved, notes {notes_before}, lines {lines_before}, touches intact");

    // And the new fields on the first sent proposal survive a save and a re-read, touching nothing else.
    if let Some(first) = all.iter().find(|p| p.status == "Sent to Client") {
        let mut p = first.clone();
        p.accepted_at = Some("2026-10-01".into());
        p.keep_reason = Some("rehearsal".into());
        p.keep_until = Some("2026-10-31".into());
        upsert_proposal_rows(&mut conn, &[p]).unwrap();
        let back = read_all_data(&conn).unwrap().proposals.into_iter().find(|x| x.id == first.id).unwrap();
        assert_eq!((back.accepted_at.as_deref(), back.keep_reason.as_deref(), back.keep_until.as_deref()), (Some("2026-10-01"), Some("rehearsal"), Some("2026-10-31")));
        assert_eq!(old_rows(&conn, "proposals", OLD_PROPOSAL_COLUMNS), proposals_before, "the new fields touch no old column");
        println!("new fields: saved and read back on one proposal; nothing else moved");
        // One entry, changed, then removed: the touches are as they were.
        let t = add_touch(&conn, &NewTouch { proposal_id: Some(first.id), kind: "call".into(), at: "2026-10-01".into(), note: Some("rehearsal".into()), batch_id: Some("rehearsal".into()), ..Default::default() }).unwrap();
        let changed = update_touch(&conn, t.id, &TouchChange { kind: "whatsapp".into(), direction: Some("in".into()), at: "2026-09-30".into(), by_member_id: None, note: None, revert_after: Some("2026-10-20".into()) }).unwrap().unwrap();
        assert_eq!((changed.kind.as_str(), changed.revert_after.as_deref()), ("whatsapp", Some("2026-10-20")));
        conn.execute("DELETE FROM touches WHERE id = ?1", [t.id]).unwrap();
        assert_eq!(old_rows(&conn, "touches", OLD_TOUCH_COLUMNS), touches_before);
        println!("entry: logged, changed and removed on one proposal; the touches are as they were");
    }
}
