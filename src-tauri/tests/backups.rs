// Automatic local snapshots: one per day, pruned to a fixed count, and a copy
// taken before pending migrations touch an older database.
use menabig_tracker_lib::backups::{backup_before_migrations, ensure_daily_backup, list_backups};
use menabig_tracker_lib::db::{init_connection, latest_schema_version};
use rusqlite::Connection;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("menabig_backups_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn daily_backup_is_taken_once_and_old_ones_are_pruned() {
    let dir = temp_dir("daily");
    let backups = dir.join("backups");
    let conn = init_connection(&dir.join("menabig.sqlite3")).unwrap();
    conn.execute("INSERT INTO todos (id, title, status) VALUES (1, 'Kept in the snapshot', 'Pending')", []).unwrap();

    // Older snapshots plus an unrelated file that must never be pruned.
    std::fs::create_dir_all(&backups).unwrap();
    for day in ["2020-01-01", "2020-01-02", "2020-01-03"] {
        std::fs::write(backups.join(format!("daily-{day}.sqlite3")), b"old").unwrap();
    }
    std::fs::write(backups.join("pre_v2_migration_20260909_171616.sqlite3"), b"keep me").unwrap();

    let created = ensure_daily_backup(&conn, &backups, 2).unwrap().expect("first run writes today's snapshot");
    assert!(ensure_daily_backup(&conn, &backups, 2).unwrap().is_none(), "second run the same day is a no-op");

    let names: Vec<String> = list_backups(&backups).into_iter().map(|b| b.file_name).collect();
    assert!(names.contains(&"daily-2020-01-03.sqlite3".to_string()));
    assert!(!names.contains(&"daily-2020-01-01.sqlite3".to_string()));
    assert!(!names.contains(&"daily-2020-01-02.sqlite3".to_string()));
    assert!(names.contains(&"pre_v2_migration_20260909_171616.sqlite3".to_string()));
    assert!(!names.iter().any(|n| n.ends_with(".partial")));

    let copy = Connection::open(&created).unwrap();
    let title: String = copy.query_row("SELECT title FROM todos WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(title, "Kept in the snapshot");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn outdated_database_is_copied_before_migrating() {
    let dir = temp_dir("premigration");
    let backups = dir.join("backups");
    let db_file = dir.join("menabig.sqlite3");

    assert!(backup_before_migrations(&db_file, &backups).unwrap().is_none(), "no database yet, nothing to copy");

    drop(init_connection(&db_file).unwrap());
    assert!(backup_before_migrations(&db_file, &backups).unwrap().is_none(), "already current");

    let conn = Connection::open(&db_file).unwrap();
    conn.execute("UPDATE app_meta SET value = '18' WHERE key = 'schema_version'", []).unwrap();
    drop(conn);
    assert!(latest_schema_version() > 18);
    let copy = backup_before_migrations(&db_file, &backups).unwrap().expect("behind, so copied");
    assert!(copy.file_name().unwrap().to_string_lossy().starts_with("pre-migration-v18-"));

    let _ = std::fs::remove_dir_all(&dir);
}
