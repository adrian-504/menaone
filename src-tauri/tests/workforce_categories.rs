// Migration 38: the Workforce categories take the names the proposal templates use,
// in the rate card and in saved proposal lines, so fees still land on the right rows.
use menabig_tracker_lib::db::init_connection;
use rusqlite::Connection;

fn one(c: &Connection, sql: &str) -> String { c.query_row(sql, [], |r| r.get(0)).unwrap() }

#[test]
fn renames_workforce_categories_in_rate_cards_and_saved_lines() {
    let path = std::env::temp_dir().join(format!("menabig_wf_categories_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    {
        let c = init_connection(&path).unwrap();
        c.execute_batch(r#"
            INSERT INTO rate_cards (name, category, pricing_json) VALUES ('WF test', 'Workforce Services',
              '{"tranches":[{"label":"Nationalized (Engineers & Managers)"},{"label":"Nationalized (Technicians & Supervisors)"},{"label":"Non-Nationalized (Unskilled)"},{"label":"Drivers"}]}');
            INSERT INTO proposals (id, client, status, date_added) VALUES (900, 'Acme Test Co', 'Drafting', '2026-09-22');
            INSERT INTO proposal_lines (proposal_id, service_name, rates_json) VALUES (900, 'Employer of Record', '[{"label":"Non-Nationalized (Unskilled)","price":1650}]');
            UPDATE app_meta SET value = '37' WHERE key = 'schema_version';
        "#).unwrap();
    }
    let c = init_connection(&path).unwrap();
    let card = one(&c, "SELECT pricing_json FROM rate_cards WHERE name = 'WF test'");
    assert!(card.contains(r#""High Category/White Collar (Managers, Engineers, Specialists & Admins)""#));
    assert!(card.contains(r#""Medium Category/Grey Collar (Technicians and Supervisors)""#));
    assert!(card.contains(r#""Low Category/Blue Collar (Unskilled and Workers)""#));
    assert!(card.contains(r#""Drivers""#) && !card.contains("Nationalized"));
    assert_eq!(one(&c, "SELECT rates_json FROM proposal_lines WHERE proposal_id = 900"), r#"[{"label":"Low Category/Blue Collar (Unskilled and Workers)","price":1650}]"#);
    let _ = std::fs::remove_file(&path);
}
