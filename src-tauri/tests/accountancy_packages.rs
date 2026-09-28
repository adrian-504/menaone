// Migration 40: the Accountancy & VAT rate card becomes two all-inclusive packages (Startup,
// Active); a card already changed by hand, and saved proposal lines, are left alone.
use menabig_tracker_lib::db::init_connection;
use rusqlite::Connection;

fn one(c: &Connection, sql: &str) -> String { c.query_row(sql, [], |r| r.get(0)).unwrap() }

const OLD: &str = r#"{"name":"Accountancy & VAT","packages":[{"name":"E-Invoicing 10/mo (Startup)","min":3500,"max":4000}],"rows":[{"counts":true,"label":"Accountancy (No Projects)","max":2750,"min":2250,"standard":2250},{"label":"Accountancy (Projects)","max":6250,"min":4750,"standard":4750},{"label":"VAT Return – Monthly Preparation & Declaration","max":1050,"min":900,"standard":900}]}"#;

fn at_39(name: &str, card: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("menabig_acc_packages_{name}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let c = init_connection(&path).unwrap();
    c.execute("INSERT OR IGNORE INTO rate_cards (name, category, pricing_json) VALUES ('Accountancy & VAT', 'Accountancy & VAT', '{}')", []).unwrap();
    c.execute("UPDATE rate_cards SET pricing_json = ?1 WHERE name = 'Accountancy & VAT'", [card]).unwrap();
    c.execute_batch(r#"
        INSERT INTO proposals (id, client, status, date_added) VALUES (901, 'Acme Test Co', 'Sent to Client', '2026-09-01');
        INSERT INTO proposal_lines (proposal_id, service_name, rates_json) VALUES (901, 'Accountancy', '[{"label":"Accountancy (No Projects)","price":2250}]');
        UPDATE app_meta SET value = '39' WHERE key = 'schema_version';
    "#).unwrap();
    path
}

#[test]
fn accountancy_rate_card_becomes_startup_and_active() {
    let path = at_39("old", OLD);
    let c = init_connection(&path).unwrap();
    let card: serde_json::Value = serde_json::from_str(&one(&c, "SELECT pricing_json FROM rate_cards WHERE name = 'Accountancy & VAT'")).unwrap();
    let rows: Vec<(String, f64, bool)> = card["rows"].as_array().unwrap().iter()
        .map(|r| (r["label"].as_str().unwrap().to_string(), r["standard"].as_f64().unwrap(), r.get("counts").and_then(|x| x.as_bool()).unwrap_or(false))).collect();
    assert_eq!(rows, vec![("Startup (up to 30 transactions per month)".to_string(), 3500.0, true), ("Active (more than 30 transactions per month)".to_string(), 6500.0, false)]);
    assert_eq!(card["packages"][0]["name"], "E-Invoicing 10/mo (Startup)", "the rest of the card stays");
    // A proposal already priced keeps its rows.
    assert!(one(&c, "SELECT rates_json FROM proposal_lines WHERE proposal_id = 901").contains("Accountancy (No Projects)"));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_hand_changed_accountancy_card_is_left_alone() {
    let custom = r#"{"rows":[{"label":"Bookkeeping","min":1000,"standard":1000,"max":1200}]}"#;
    let path = at_39("custom", custom);
    let c = init_connection(&path).unwrap();
    assert_eq!(one(&c, "SELECT pricing_json FROM rate_cards WHERE name = 'Accountancy & VAT'"), custom);
    let _ = std::fs::remove_file(&path);
}
