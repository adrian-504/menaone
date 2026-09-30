//! The app's log (foundations O1): one line per event in
//! `<app data>/logs/menaone.log`, rolling over at 1 MB into menaone.1.log …
//! menaone.4.log (five files at most). Launch timing, migrations,
//! housekeeping, Microsoft Graph failures (status codes and paths, never
//! tokens, query strings or message bodies) and frontend errors go here.
//! Nothing personal: no email bodies, no contact details.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use tauri::{AppHandle, Manager};

pub const MAX_BYTES: u64 = 1_048_576;
pub const FILES: usize = 5;
const NAME: &str = "menaone";

pub fn log_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs")
}

fn file_at(dir: &Path, n: usize) -> PathBuf {
    if n == 0 { dir.join(format!("{NAME}.log")) } else { dir.join(format!("{NAME}.{n}.log")) }
}

/// menaone.log → .1 → .2 … ; the oldest beyond `files` goes.
pub fn rotate(dir: &Path, files: usize) -> std::io::Result<()> {
    let _ = fs::remove_file(file_at(dir, files - 1));
    for n in (0..files - 1).rev() {
        let from = file_at(dir, n);
        if from.exists() {
            fs::rename(&from, file_at(dir, n + 1))?;
        }
    }
    Ok(())
}

/// Appends one line, rolling the files over first when the current one is full.
pub fn append(dir: &Path, line: &str, max_bytes: u64, files: usize) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let current = file_at(dir, 0);
    if fs::metadata(&current).map(|m| m.len() + line.len() as u64 > max_bytes).unwrap_or(false) {
        rotate(dir, files)?;
    }
    let mut f: File = OpenOptions::new().create(true).append(true).open(&current)?;
    f.write_all(line.as_bytes())
}

struct FileLogger {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info || cfg!(debug_assertions)
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "{} {:<5} {} {}\n",
            crate::commands::timestamp_utc(SystemTime::now()),
            record.level(),
            record.target().split("::").last().unwrap_or(""),
            record.args().to_string().replace('\n', " ⏎ "),
        );
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        if let Ok(_guard) = self.lock.lock() {
            let _ = append(&self.dir, &line, MAX_BYTES, FILES);
        }
    }

    fn flush(&self) {}
}

/// Starts the log; call first thing at launch so migrations are recorded.
pub fn init(app_data_dir: &Path) {
    let logger = FileLogger { dir: log_dir(app_data_dir), lock: Mutex::new(()) };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info });
    }
}

/// A line from the interface (an error it caught, the launch time it measured).
#[tauri::command]
pub fn log_frontend(level: String, message: String) {
    let message: String = message.chars().take(2000).collect();
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{message}"),
        "warn" => log::warn!(target: "frontend", "{message}"),
        _ => log::info!(target: "frontend", "{message}"),
    }
}

/// Settings → Data → "Show logs".
#[tauri::command]
pub fn reveal_logs_folder(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app.path().app_data_dir().map_err(|e| e.to_string())?);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| e.to_string())
}
