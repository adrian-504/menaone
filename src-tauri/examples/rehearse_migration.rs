// Runs every pending migration on a copy of a database: `cargo run --example rehearse_migration -- <copy.sqlite3>`.
// Never point this at the live database.
fn main() {
    let path = std::env::args().nth(1).expect("path to a database copy");
    assert!(!path.contains("Application Support"), "rehearse on a copy, never the live database");
    let conn = menabig_tracker_lib::db::init_connection(&std::path::PathBuf::from(&path)).expect("migrate");
    println!("schema {}", menabig_tracker_lib::db::schema_version(&conn).unwrap());
}
