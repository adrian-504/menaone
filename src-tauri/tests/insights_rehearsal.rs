// Opt-in check against a COPY of a real database (never the live file):
//   MENA_REHEARSAL_DB=/tmp/copy.sqlite3 cargo test --test insights_rehearsal -- --ignored --nocapture
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::insights::pipeline_facts;

#[test]
#[ignore]
fn pipeline_facts_and_meeting_emails_on_a_copy() {
    let Ok(path) = std::env::var("MENA_REHEARSAL_DB") else { return };
    assert!(!path.contains("Application Support"), "use a copy, not the live database");
    let conn = init_connection(&std::path::PathBuf::from(&path)).unwrap();
    let facts = pipeline_facts(&conn).unwrap();
    println!("opportunities with facts: {}", facts.len());
    for f in facts.iter().take(5) {
        println!("  #{} entered {:?} last activity {:?} stages {:?}", f.opportunity_id, f.stage_entered_at, f.last_activity_at, f.stages.iter().map(|s| s.stage.as_str()).collect::<Vec<_>>());
    }
    let mut stmt = conn.prepare(&format!("{} WHERE source = 'outlook'", menabig_tracker_lib::v2_commands::MEETING_SELECT_PUBLIC)).unwrap();
    let meetings = stmt.query_map([], menabig_tracker_lib::v2_commands::row_to_meeting_public).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
    let with_emails = meetings.iter().filter(|m| !m.attendee_emails.is_empty()).count();
    println!("outlook meetings: {}, with attendee emails: {}", meetings.len(), with_emails);
    assert!(meetings.is_empty() || with_emails > 0);
}
