// Keeping the data safe and tidy (owner, 30-Sep-2026): WAL, the launch check,
// the OneDrive copy of the daily snapshot, and older install backups to the
// archive. Scratch directories only — nothing touches the real OneDrive or DevSSD.
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::housekeeping::{
    archive_old_install_backups, copy_snapshot_to_onedrive, file_is_intact, onedrive_backup_dir, prune_onedrive, run_quick_check, IntegrityResult,
};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("menabig_housekeeping_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn db_in(dir: &Path) -> (PathBuf, Connection) {
    let path = dir.join("menabig.sqlite3");
    let conn = init_connection(&path).expect("init db");
    (path, conn)
}

#[test]
fn the_database_runs_in_wal_and_keeps_it() {
    let dir = scratch("wal");
    let (path, conn) = db_in(&dir);
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "wal");
    let sync: i64 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0)).unwrap();
    assert_eq!(sync, 1, "NORMAL");
    drop(conn);
    // A plain connection later still finds WAL: the file kept it.
    let again = Connection::open(&path).unwrap();
    let mode: String = again.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "wal");
}

#[test]
fn the_quick_check_is_stored_for_settings() {
    let dir = scratch("quick");
    let (_, conn) = db_in(&dir);
    let r = run_quick_check(&conn).unwrap();
    assert!(r.ok && r.detail.is_none());
    let stored: String = conn.query_row("SELECT value FROM app_meta WHERE key = 'integrity_last'", [], |r| r.get(0)).unwrap();
    let back: IntegrityResult = serde_json::from_str(&stored).unwrap();
    assert_eq!(back, r);
}

#[test]
fn the_business_onedrive_is_chosen_for_backups() {
    let roots = vec![PathBuf::from("/x/OneDrive-Personal"), PathBuf::from("/x/OneDrive-MENABusinessInvestmentGroup")];
    assert_eq!(onedrive_backup_dir(&roots), Some(PathBuf::from("/x/OneDrive-MENABusinessInvestmentGroup/MENA One/Backups")));
    assert_eq!(onedrive_backup_dir(&roots[..1]), Some(PathBuf::from("/x/OneDrive-Personal/MENA One/Backups")));
    assert_eq!(onedrive_backup_dir(&[]), None);
}

#[test]
fn a_snapshot_is_copied_checked_and_the_last_14_kept() {
    let dir = scratch("onedrive");
    let (_, conn) = db_in(&dir);
    let snap = dir.join("daily-2026-09-30.sqlite3");
    conn.execute("VACUUM INTO ?1", [snap.to_string_lossy()]).unwrap();
    let od = dir.join("OneDrive/MENA One/Backups");
    // Sixteen older copies, and one file that isn't ours.
    std::fs::create_dir_all(&od).unwrap();
    for d in 1..=16 {
        std::fs::write(od.join(format!("menabig-2026-08-{d:02}.sqlite3")), b"old").unwrap();
    }
    std::fs::write(od.join("notes.txt"), b"keep me").unwrap();
    let made = copy_snapshot_to_onedrive(&snap, &od, "2026-09-30", 14).unwrap();
    let copy = made.expect("a new copy");
    assert!(file_is_intact(&copy));
    assert!(!od.join("menabig-2026-09-30.partial").exists());
    let mut names: Vec<String> = std::fs::read_dir(&od).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    names.sort();
    assert_eq!(names.iter().filter(|n| n.starts_with("menabig-")).count(), 14);
    assert!(names.contains(&"notes.txt".to_string()));
    assert!(!names.contains(&"menabig-2026-08-01.sqlite3".to_string()));
    // The same day again: nothing new.
    assert_eq!(copy_snapshot_to_onedrive(&snap, &od, "2026-09-30", 14).unwrap(), None);
}

#[test]
fn a_damaged_snapshot_is_not_kept_on_onedrive() {
    let dir = scratch("damaged");
    let snap = dir.join("daily-2026-09-30.sqlite3");
    std::fs::write(&snap, b"not a database").unwrap();
    let od = dir.join("OneDrive/MENA One/Backups");
    assert!(copy_snapshot_to_onedrive(&snap, &od, "2026-09-30", 14).is_err());
    assert!(!od.join("menabig-2026-09-30.sqlite3").exists());
    assert!(!od.join("menabig-2026-09-30.partial").exists());
    // And a missing snapshot is an error, not a crash.
    assert!(copy_snapshot_to_onedrive(&dir.join("nope.sqlite3"), &od, "2026-10-01", 14).is_err());
    prune_onedrive(&od, 14);
}

fn aged(path: &Path, days: u64) {
    let t = SystemTime::now() - Duration::from_secs(days * 24 * 60 * 60);
    std::fs::File::options().write(true).open(path).unwrap().set_modified(t).unwrap();
}

#[test]
fn install_backups_older_than_30_days_move_to_the_archive() {
    let dir = scratch("tidy");
    let app = dir.join("app");
    std::fs::create_dir_all(&app).unwrap();
    let volume = dir.join("Volume");
    let archive = volume.join("MENA One Archive/DB backups");
    std::fs::create_dir_all(&volume).unwrap();
    for (name, days) in [("menabig.sqlite3.pre-old-20260801", 31), ("menabig.sqlite3.pre-edge-20260831", 29), ("menabig.sqlite3.pre-new-20260929", 1)] {
        std::fs::write(app.join(name), name.as_bytes()).unwrap();
        aged(&app.join(name), days);
    }
    std::fs::write(app.join("menabig.sqlite3"), b"live").unwrap();
    aged(&app.join("menabig.sqlite3"), 90);

    let r = archive_old_install_backups(&app, &volume, &archive, 30, SystemTime::now());
    assert_eq!((r.moved, r.kept), (1, 2));
    assert!(archive.join("menabig.sqlite3.pre-old-20260801").exists());
    assert!(!app.join("menabig.sqlite3.pre-old-20260801").exists());
    assert!(app.join("menabig.sqlite3.pre-edge-20260831").exists());
    assert!(app.join("menabig.sqlite3").exists(), "the live database is never touched");
    assert_eq!(std::fs::read(archive.join("menabig.sqlite3.pre-old-20260801")).unwrap(), b"menabig.sqlite3.pre-old-20260801");
}

#[test]
fn without_the_archive_drive_nothing_moves() {
    let dir = scratch("unmounted");
    let app = dir.join("app");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::write(app.join("menabig.sqlite3.pre-old-20260801"), b"x").unwrap();
    aged(&app.join("menabig.sqlite3.pre-old-20260801"), 60);
    let volume = dir.join("NotMounted");
    let r = archive_old_install_backups(&app, &volume, &volume.join("MENA One Archive/DB backups"), 30, SystemTime::now());
    assert_eq!((r.moved, r.kept, r.archived_to), (0, 1, None));
    assert!(app.join("menabig.sqlite3.pre-old-20260801").exists());
    assert!(!volume.exists(), "nothing is created where the drive would be");
}
