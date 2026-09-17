// Calendar sync reconciling deletions (MICROSOFT_AUDIT M3). Outlook events are
// built from JSON the way Graph sends them; fictional data only.
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::ms365::commands::{
    outlook_meetings_missing_from_range, remove_deleted_outlook_meeting, upsert_meeting_from_event, DeletedOutlookMeeting,
};
use menabig_tracker_lib::ms365::graph::GraphEvent;
use rusqlite::{params, Connection};
use std::collections::HashSet;

const WEEK_START: &str = "2026-09-13T21:00:00.000Z";
const WEEK_END: &str = "2026-09-20T20:59:59.000Z";

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_calendar_sync_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    (path.clone(), init_connection(&path).expect("init db"))
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn event(id: &str, start: &str, end: &str) -> GraphEvent {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "subject": format!("Meeting {id}"),
        "start": { "dateTime": start, "timeZone": "UTC" },
        "end": { "dateTime": end, "timeZone": "UTC" },
        "organizer": { "emailAddress": { "name": "Jane Tester", "address": "jane@example.test" } },
        "attendees": []
    }))
    .unwrap()
}

fn sync(conn: &Connection, e: &GraphEvent) {
    upsert_meeting_from_event(conn, e, "2026-09-14T08:00:00Z").unwrap();
}

fn meeting_id(conn: &Connection, event_id: &str) -> Option<i64> {
    conn.query_row("SELECT id FROM meetings WHERE outlook_event_id = ?1", params![event_id], |r| r.get(0)).ok()
}

#[test]
fn only_outlook_meetings_in_the_range_and_not_returned_are_missing() {
    let (path, conn) = fresh_db("missing");
    sync(&conn, &event("kept", "2026-09-15T09:00:00.0000000", "2026-09-15T10:00:00.0000000"));
    sync(&conn, &event("gone", "2026-09-16T09:00:00.0000000", "2026-09-16T10:00:00.0000000"));
    sync(&conn, &event("next-month", "2026-10-15T09:00:00.0000000", "2026-10-15T10:00:00.0000000"));
    // Ends exactly when the range starts: calendarView doesn't return it, so it isn't missing.
    sync(&conn, &event("ends-at-start", "2026-09-13T20:00:00.0000000", "2026-09-13T21:00:00.0000000"));
    sync(&conn, &event("cancelled", "2026-09-17T09:00:00.0000000", "2026-09-17T10:00:00.0000000"));
    conn.execute("UPDATE meetings SET is_cancelled = 1 WHERE outlook_event_id = 'cancelled'", []).unwrap();
    conn.execute(
        "INSERT INTO meetings (title, meeting_date, start_at, end_at, source, created_at, updated_at)
         VALUES ('Internal review', '2026-09-16', '2026-09-16T11:00:00.000Z', '2026-09-16T12:00:00.000Z', 'internal', '2026-09-14', '2026-09-14')",
        [],
    )
    .unwrap();

    let seen: HashSet<&str> = ["kept"].into_iter().collect();
    let missing = outlook_meetings_missing_from_range(&conn, WEEK_START, WEEK_END, &seen).unwrap();
    assert_eq!(missing, vec![("gone".to_string(), false), ("cancelled".to_string(), true)]);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn a_deleted_meeting_with_nothing_of_yours_is_removed() {
    let (path, conn) = fresh_db("removed");
    sync(&conn, &event("gone", "2026-09-16T09:00:00.0000000", "2026-09-16T10:00:00.0000000"));
    let id = meeting_id(&conn, "gone").unwrap();
    // Sync fills discussion from the invite; that alone isn't the user's work.
    conn.execute("UPDATE meetings SET discussion = 'Invite text from Outlook', company_name = 'Contoso Logistics' WHERE id = ?1", params![id]).unwrap();

    assert_eq!(remove_deleted_outlook_meeting(&conn, "gone").unwrap(), DeletedOutlookMeeting::Removed);
    assert_eq!(meeting_id(&conn, "gone"), None);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM sync_tombstones WHERE table_name = 'meetings'"), 1, "deletion recorded for sync");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM search_index WHERE entity_type = 'meeting' AND entity_id = ?1", params![id], |r| r.get::<_, i64>(0)).unwrap(),
        0
    );
    assert_eq!(remove_deleted_outlook_meeting(&conn, "gone").unwrap(), DeletedOutlookMeeting::NotFound);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn a_deleted_meeting_holding_your_work_is_kept_as_cancelled() {
    let (path, conn) = fresh_db("kept");
    for (event_id, day) in [("agenda", 14), ("decisions", 15), ("task", 16), ("document", 17)] {
        let start = format!("2026-09-{day}T09:00:00.0000000");
        let end = format!("2026-09-{day}T10:00:00.0000000");
        sync(&conn, &event(event_id, &start, &end));
    }
    conn.execute("UPDATE meetings SET agenda = '1. Renewal terms' WHERE outlook_event_id = 'agenda'", []).unwrap();
    conn.execute("UPDATE meetings SET decisions = 'Send revised quote' WHERE outlook_event_id = 'decisions'", []).unwrap();
    let task_meeting = meeting_id(&conn, "task").unwrap();
    conn.execute("INSERT INTO todos (title, meeting_id) VALUES ('Follow up with Contoso', ?1)", params![task_meeting]).unwrap();
    let doc_meeting = meeting_id(&conn, "document").unwrap();
    conn.execute("INSERT INTO documents (title, link, meeting_id) VALUES ('Minutes', 'https://example.test/minutes', ?1)", params![doc_meeting]).unwrap();

    for event_id in ["agenda", "decisions", "task", "document"] {
        assert_eq!(remove_deleted_outlook_meeting(&conn, event_id).unwrap(), DeletedOutlookMeeting::KeptAsCancelled, "{event_id}");
        let cancelled: bool = conn
            .query_row("SELECT is_cancelled FROM meetings WHERE outlook_event_id = ?1", params![event_id], |r| r.get(0))
            .unwrap();
        assert!(cancelled, "{event_id} shown as cancelled");
    }
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM todos WHERE meeting_id IS NOT NULL"), 1, "task still linked");

    // Settling it again on the next sync changes nothing.
    let version: i64 = one(&conn, "SELECT row_version FROM meetings WHERE outlook_event_id = 'agenda'");
    remove_deleted_outlook_meeting(&conn, "agenda").unwrap();
    assert_eq!(one::<i64>(&conn, "SELECT row_version FROM meetings WHERE outlook_event_id = 'agenda'"), version);
    drop(conn);
    let _ = std::fs::remove_file(path);
}
