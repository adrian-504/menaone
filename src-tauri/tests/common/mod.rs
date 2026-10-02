// Shared by the opt-in real-template tests (proposal_audit, reprice_real): they generate dozens of decks, each
// on its own scratch files, so the cases run side by side on the machine's cores.
#![allow(dead_code)]
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

/// How many cases run at once: the machine's cores, or MENA_JOBS. Each case holds a few decks in memory.
pub fn jobs() -> usize {
    std::env::var("MENA_JOBS").ok().and_then(|v| v.parse::<usize>().ok()).filter(|n| *n > 0)
        .unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4))
}

/// `f` over every item, several at a time, the results in the items' order. A case that panics fails the test.
pub fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<R>>> = items.iter().map(|_| Mutex::new(None)).collect();
    std::thread::scope(|s| {
        for _ in 0..jobs().min(items.len().max(1)) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= items.len() { break; }
                let r = f(&items[i]);
                *slots[i].lock().unwrap() = Some(r);
            });
        }
    });
    slots.into_iter().map(|m| m.into_inner().unwrap().expect("every case ran")).collect()
}

/// A test's own scratch: a folder under MENA_OUT and its own copy of the database copy, so tests that run at the
/// same time never share a database file or a client folder. MENA_DB_COPY itself is only read.
pub fn own_scratch(db: &str, out: &str, tag: &str) -> (PathBuf, PathBuf) {
    assert!(!db.contains("Application Support"), "use a copy, never the live database");
    let cloud = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/CloudStorage");
    assert!(!Path::new(out).starts_with(&cloud), "MENA_OUT must be a scratch folder, not inside OneDrive");
    let dir = Path::new(out).join(tag);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let copy = Path::new(out).join(format!("{tag}.sqlite3"));
    for ext in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{ext}", copy.display())); }
    // The source may be in WAL mode with its pages still in the log: copy it through SQLite, not as a file.
    let src = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    src.execute("VACUUM INTO ?1", [copy.to_string_lossy().to_string()]).unwrap();
    (dir, copy)
}

/// The test's database copy is removed; its folder too unless MENA_KEEP_OUTPUT=1 leaves the decks to look at.
pub fn drop_scratch(dir: &Path, copy: &Path) {
    for ext in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{ext}", copy.display())); }
    if std::env::var("MENA_KEEP_OUTPUT").is_err() { let _ = std::fs::remove_dir_all(dir); }
}
