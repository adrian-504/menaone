// Checks the full backup against a real database COPY (never the live file):
// `cargo run --example full_backup_check -- <copy.sqlite3> <scratch dir>`.
// Exports it, restores the export into a second copy, and compares every table.
fn main() {
    let copy = std::path::PathBuf::from(std::env::args().nth(1).expect("database copy"));
    let dir = std::path::PathBuf::from(std::env::args().nth(2).expect("scratch dir"));
    assert!(!copy.to_string_lossy().contains("Application Support"), "use a copy, never the live database");
    let conn = menabig_tracker_lib::db::init_connection(&copy).expect("open copy");
    let file = dir.join("full-backup-check.sqlite3");
    let _ = std::fs::remove_file(&file);
    menabig_tracker_lib::full_backup::export_full_backup_core(&conn, &file).expect("export");
    let summary = menabig_tracker_lib::full_backup::check_full_backup(&file).expect("check");
    println!("backup holds: {summary:?}");
    let target_path = dir.join("full-backup-target.sqlite3");
    let _ = std::fs::remove_file(&target_path);
    let mut target = menabig_tracker_lib::db::init_connection(&target_path).expect("empty target");
    let restored = menabig_tracker_lib::full_backup::restore_full_backup_core(&mut target, &file).expect("restore");
    assert_eq!(restored, summary, "restored summary matches");
    let dump = |c: &rusqlite::Connection| -> Vec<(String, i64)> {
        let tables: Vec<String> = c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        tables.into_iter().map(|t| { let n = c.query_row(&format!("SELECT COUNT(*) FROM \"{t}\""), [], |r| r.get(0)).unwrap(); (t, n) }).collect()
    };
    let (a, b) = (dump(&conn), dump(&target));
    assert_eq!(a, b, "every table has the same rows");
    println!("{} tables, {} rows, identical after restore", a.len(), a.iter().map(|x| x.1).sum::<i64>());
    let size = std::fs::metadata(&file).unwrap().len();
    println!("backup file: {:.1} MB", size as f64 / 1_048_576.0);
}
