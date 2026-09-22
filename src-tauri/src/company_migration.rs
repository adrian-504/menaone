// ═══════════ Company Master Data — one-time (re-runnable) migration ═══════════
//
// Promotes every legacy free-text company name on contacts/proposals/
// agreements/projects into the canonical `companies` table, links the rows
// via `company_id`, and moves `company_notes.industries` (JSON, keyed by
// name) into `company_industries` (keyed by id), remapped onto the
// controlled taxonomy. Never guesses: anything with more than one plausible
// existing match, or that looks like a placeholder ("No Client Name", "N/A"),
// goes to `company_review_queue` instead of being auto-linked or auto-created.
// Idempotent — only touches rows where `company_id IS NULL`, so running it
// again after new data comes in only processes what's new.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use crate::db::DbState;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub const INDUSTRY_TAXONOMY: &[&str] = &[
    "Construction & Infrastructure",
    "Engineering & Consulting",
    "Transportation & Logistics",
    "Industrial & Manufacturing",
    "Technology",
    "Energy & Utilities",
    "Real Estate",
    "Financial Services",
    "Healthcare",
    "Education",
    "Retail & Consumer",
    "Hospitality",
    "Government/Public Sector",
    "Professional Services",
    // Chambers of commerce and business associations (owner, 22-Sep-2026).
    "Associations & Chambers",
    "Other",
    "Unknown",
];

#[tauri::command]
pub fn get_industry_taxonomy() -> Vec<&'static str> {
    INDUSTRY_TAXONOMY.to_vec()
}

/// Maps a legacy free-text industry value (from this session's earlier
/// company_notes research pass) onto the controlled taxonomy above. An
/// unrecognized value falls back to "Other" (it WAS classified by the
/// earlier research, just not into one of the 16 buckets) — never "Unknown",
/// which is reserved for companies with no classification at all.
fn map_legacy_industry(raw: &str) -> &'static str {
    match raw.trim() {
        "Construction" => "Construction & Infrastructure",
        "Architecture" | "Engineering Consultancy" => "Engineering & Consulting",
        "Logistics" | "Transportation" => "Transportation & Logistics",
        "Automotive" | "Chemicals" | "Manufacturing" | "Mining" => "Industrial & Manufacturing",
        "Technology" | "Telecommunications" => "Technology",
        "Energy" | "Oil & Gas" | "Renewable Energy" | "Water & Utilities" => "Energy & Utilities",
        "Real Estate" => "Real Estate",
        "Financial Services" => "Financial Services",
        "Healthcare" => "Healthcare",
        "Education" => "Education",
        "Retail" | "Food & Beverage" | "Cosmetics" => "Retail & Consumer",
        "Hospitality" => "Hospitality",
        "Defense & Security" => "Government/Public Sector",
        "Advertising" | "Marketing & Advertising" | "Public Relations" | "Media & Entertainment"
        | "Entertainment" | "Facility Management" => "Professional Services",
        _ => "Other",
    }
}

const LEGAL_SUFFIXES: &[&str] = &[
    "sole proprietorship",
    "branch",
    "l l c",
    "llc",
    "ltd",
    "limited",
    "plc",
    "llp",
    "lp",
    "sarl",
    "s a r l",
    "wll",
    "w l l",
    "fzc",
    "fze",
    "gmbh",
    "corporation",
    "corp",
    "inc",
    "co",
    "sa",
];

/// Fuzzy-normalize a company name for duplicate detection: lowercase, fold
/// punctuation to spaces, then iteratively strip trailing legal-entity
/// suffixes (Ltd/LLC/SA/GmbH/Co/Corp/...) so "Acme Trading Co. Ltd" and
/// "ACME TRADING" normalize identically.
pub fn normalize_company_name(name: &str) -> String {
    let mut s: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    loop {
        let mut stripped = false;
        for suf in LEGAL_SUFFIXES {
            if s == *suf {
                s.clear();
                stripped = true;
                break;
            }
            let with_space = format!(" {suf}");
            if s.ends_with(&with_space) {
                s.truncate(s.len() - with_space.len());
                stripped = true;
                break;
            }
        }
        if !stripped {
            break;
        }
    }
    s.trim().to_string()
}

fn looks_like_placeholder(name: &str) -> bool {
    matches!(
        name.trim().to_lowercase().as_str(),
        "no client name" | "n/a" | "na" | "unknown" | "tbd" | "none" | "-" | "test" | ""
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompanyMigrationReport {
    pub backup_path: String,
    pub distinct_legacy_names_seen: i64,
    pub companies_created: i64,
    pub fuzzy_matches_linked: i64,
    pub queued_for_review: i64,
    pub contacts_linked: i64,
    pub proposals_linked: i64,
    pub agreements_linked: i64,
    pub projects_linked: i64,
    pub industries_migrated: i64,
    pub companies_total: i64,
    pub companies_missing_industry: i64,
    pub companies_without_contacts: i64,
}

struct ExistingCompany {
    id: i64,
    norm: String,
}

pub(crate) fn queue_for_review(tx: &Connection, raw_name: &str, suggested: Option<i64>, now: &str) -> rusqlite::Result<bool> {
    let exists: Option<i64> = tx
        .query_row(
            "SELECT id FROM company_review_queue WHERE raw_name = ?1 AND status = 'pending'",
            params![raw_name],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_some() {
        return Ok(false);
    }
    tx.execute(
        "INSERT INTO company_review_queue (source_table, source_id, raw_name, suggested_company_id, status, created_at)
         VALUES ('multiple', 0, ?1, ?2, 'pending', ?3)",
        params![raw_name, suggested, now],
    )?;
    Ok(true)
}

const LEGACY_SOURCES: [(&str, &str); 10] = [
    ("contacts", "client_name"),
    ("proposals", "client"),
    ("agreements", "client"),
    ("projects", "company_name"),
    ("meetings", "company_name"),
    ("notes", "client_name"),
    ("todos", "client"),
    ("intelligence_items", "company_name"),
    ("emails", "company_name"),
    ("documents", "company_name"),
];

fn run_migration_tx(tx: &Connection, backup_path: String) -> rusqlite::Result<CompanyMigrationReport> {
    let mut report = CompanyMigrationReport {
        backup_path,
        ..Default::default()
    };
    let now = crate::commands::now_iso();

    let mut existing: Vec<ExistingCompany> = {
        let mut stmt = tx.prepare("SELECT id, name FROM companies")?;
        let out = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                let name: String = r.get(1)?;
                Ok(ExistingCompany { id, norm: normalize_company_name(&name) })
            })?
            .collect::<rusqlite::Result<_>>()?;
        out
    };

    use std::collections::BTreeSet;
    let mut distinct_names: BTreeSet<String> = BTreeSet::new();
    for (table, col) in LEGACY_SOURCES.iter() {
        let sql = format!(
            "SELECT DISTINCT {col} FROM {table} WHERE company_id IS NULL AND {col} IS NOT NULL AND TRIM({col}) != ''"
        );
        let mut stmt = tx.prepare(&sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            distinct_names.insert(row?);
        }
    }
    report.distinct_legacy_names_seen = distinct_names.len() as i64;

    use std::collections::HashMap;
    let mut resolved: HashMap<String, i64> = HashMap::new();

    for name in &distinct_names {
        if let Some(id) = tx
            .query_row("SELECT id FROM companies WHERE name = ?1", params![name], |r| r.get::<_, i64>(0))
            .optional()?
        {
            resolved.insert(name.clone(), id);
            continue;
        }

        if looks_like_placeholder(name) {
            if queue_for_review(tx, name, None, &now)? {
                report.queued_for_review += 1;
            }
            continue;
        }

        let norm = normalize_company_name(name);
        let candidates: Vec<i64> = if norm.is_empty() {
            Vec::new()
        } else {
            existing.iter().filter(|e| e.norm == norm).map(|e| e.id).collect()
        };

        match candidates.len() {
            1 => {
                resolved.insert(name.clone(), candidates[0]);
                report.fuzzy_matches_linked += 1;
            }
            0 => {
                tx.execute("INSERT INTO companies (name, created_at) VALUES (?1, ?2)", params![name, now])?;
                let id = tx.last_insert_rowid();
                existing.push(ExistingCompany { id, norm });
                resolved.insert(name.clone(), id);
                report.companies_created += 1;
            }
            _ => {
                if queue_for_review(tx, name, Some(candidates[0]), &now)? {
                    report.queued_for_review += 1;
                }
            }
        }
    }

    for (table, col) in LEGACY_SOURCES.iter() {
        let sql = format!(
            "SELECT id, {col} FROM {table} WHERE company_id IS NULL AND {col} IS NOT NULL AND TRIM({col}) != ''"
        );
        let rows: Vec<(i64, String)> = {
            let mut stmt = tx.prepare(&sql)?;
            let out = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
                .collect::<rusqlite::Result<_>>()?;
            out
        };
        let mut linked = 0i64;
        let update_sql = format!("UPDATE {table} SET company_id = ?1 WHERE id = ?2");
        for (row_id, name) in rows {
            if let Some(company_id) = resolved.get(&name) {
                tx.execute(&update_sql, params![company_id, row_id])?;
                linked += 1;
            }
        }
        match *table {
            "contacts" => report.contacts_linked = linked,
            "proposals" => report.proposals_linked = linked,
            "agreements" => report.agreements_linked = linked,
            "projects" => report.projects_linked = linked,
            _ => {}
        }
    }

    {
        let rows: Vec<(String, String)> = {
            let mut stmt = tx.prepare(
                "SELECT company_name, industries FROM company_notes WHERE industries IS NOT NULL AND industries != '[]'",
            )?;
            let out = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
            out
        };
        for (name, industries_json) in rows {
            let company_id = match tx
                .query_row("SELECT id FROM companies WHERE name = ?1", params![name], |r| r.get::<_, i64>(0))
                .optional()?
            {
                Some(id) => id,
                None => continue,
            };
            let values: Vec<String> = serde_json::from_str(&industries_json).unwrap_or_default();
            for raw in values {
                let mapped = map_legacy_industry(&raw);
                let changed = tx.execute(
                    "INSERT OR IGNORE INTO company_industries (company_id, industry) VALUES (?1, ?2)",
                    params![company_id, mapped],
                )?;
                report.industries_migrated += changed as i64;
            }
        }
    }

    report.companies_total = tx.query_row("SELECT COUNT(*) FROM companies", [], |r| r.get(0))?;
    report.companies_missing_industry = tx.query_row(
        "SELECT COUNT(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM company_industries ci WHERE ci.company_id = c.id)",
        [],
        |r| r.get(0),
    )?;
    report.companies_without_contacts = tx.query_row(
        "SELECT COUNT(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.company_id = c.id)",
        [],
        |r| r.get(0),
    )?;

    Ok(report)
}

/// Backs up the on-disk database file, then runs the migration against an
/// already-open connection to that same file. Factored out from the Tauri
/// command below so it can also be driven from a plain `main()` (see
/// src/bin/migrate_companies.rs) — the command only adds resolving
/// `app_data_dir` into a concrete path, everything safety-relevant lives here.
pub fn run_migration_on_db(db_file: &std::path::Path, conn: &mut Connection) -> Result<CompanyMigrationReport, String> {
    let stamp = crate::commands::now_iso().replace(':', "-").replace('.', "-");
    let backup_path = db_file.with_file_name(format!(
        "{}.pre-company-migration-{stamp}",
        db_file.file_name().and_then(|n| n.to_str()).unwrap_or("menabig.sqlite3")
    ));
    std::fs::copy(db_file, &backup_path).map_err(err)?;

    let tx = conn.transaction().map_err(err)?;
    let report = run_migration_tx(&tx, backup_path.to_string_lossy().to_string()).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(report)
}

#[tauri::command]
pub fn run_company_migration(app: tauri::AppHandle, state: State<DbState>) -> CmdResult<CompanyMigrationReport> {
    let app_data_dir = app.path().app_data_dir().map_err(err)?;
    let db_file = crate::db::db_path(&app_data_dir);
    let mut conn = state.0.lock().map_err(err)?;
    run_migration_on_db(&db_file, &mut conn)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueueEntry {
    pub id: i64,
    pub raw_name: String,
    pub suggested_company_id: Option<i64>,
    pub suggested_company_name: Option<String>,
    pub status: String,
    pub created_at: Option<String>,
}

#[tauri::command]
pub fn get_review_queue(state: State<DbState>) -> CmdResult<Vec<ReviewQueueEntry>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT q.id, q.raw_name, q.suggested_company_id, c.name, q.status, q.created_at
             FROM company_review_queue q LEFT JOIN companies c ON c.id = q.suggested_company_id
             WHERE q.status = 'pending' ORDER BY q.id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ReviewQueueEntry {
                id: r.get(0)?,
                raw_name: r.get(1)?,
                suggested_company_id: r.get(2)?,
                suggested_company_name: r.get(3)?,
                status: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Resolves one review-queue entry: `action` is "confirm" (link raw_name's
/// rows to the suggested company), "select" (link to `company_id`), "create"
/// (create a new company named `raw_name` and link to it), or "ignore"
/// (leave unresolved but stop showing it — spec's "Leave unresolved").
#[tauri::command]
pub fn resolve_review_queue_entry(
    state: State<DbState>,
    id: i64,
    action: String,
    company_id: Option<i64>,
) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let now = crate::commands::now_iso();

    let (raw_name, suggested): (String, Option<i64>) = tx
        .query_row(
            "SELECT raw_name, suggested_company_id FROM company_review_queue WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;

    let resolved_company_id: Option<i64> = match action.as_str() {
        "confirm" => suggested,
        "select" => company_id,
        "create" => {
            tx.execute("INSERT INTO companies (name, created_at) VALUES (?1, ?2)", params![raw_name, now])
                .map_err(err)?;
            Some(tx.last_insert_rowid())
        }
        "ignore" => None,
        other => return Err(format!("Unknown review action: {other}")),
    };

    if let Some(cid) = resolved_company_id {
        // The confirmed name keeps meaning this company for later saves and imports.
        crate::opportunities::remember_company_alias(&tx, cid, &raw_name).map_err(err)?;
        for (table, col) in LEGACY_SOURCES.iter() {
            let sql = format!("UPDATE {table} SET company_id = ?1 WHERE company_id IS NULL AND {col} = ?2");
            tx.execute(&sql, params![cid, raw_name]).map_err(err)?;
        }
    }

    let status = if resolved_company_id.is_some() { "resolved" } else { "ignored" };
    tx.execute(
        "UPDATE company_review_queue SET status = ?1, resolved_at = ?2 WHERE id = ?3",
        params![status, now, id],
    )
    .map_err(err)?;

    tx.commit().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_legacy_industry_maps_known_values() {
        assert_eq!(map_legacy_industry("Oil & Gas"), "Energy & Utilities");
        assert_eq!(map_legacy_industry("Water & Utilities"), "Energy & Utilities");
        assert_eq!(map_legacy_industry("Engineering Consultancy"), "Engineering & Consulting");
        assert_eq!(map_legacy_industry("Manufacturing"), "Industrial & Manufacturing");
    }

    #[test]
    fn map_legacy_industry_falls_back_to_other() {
        // A value that WAS classified by the earlier research pass, just not
        // into one of the 16 taxonomy buckets, should land in "Other" — never
        // silently in "Unknown" (reserved for no classification at all).
        assert_eq!(map_legacy_industry("Something Nobody Researched"), "Other");
    }

    #[test]
    fn normalize_company_name_strips_legal_suffixes_and_punctuation() {
        assert_eq!(normalize_company_name("Acme Trading Co. Ltd"), normalize_company_name("ACME TRADING"));
        assert_eq!(normalize_company_name("Al Test Capital LLC"), normalize_company_name("Al Test Capital"));
        assert_eq!(normalize_company_name("Aguas de Prueba SA"), "aguas de prueba");
    }

    #[test]
    fn placeholder_names_are_recognized() {
        assert!(looks_like_placeholder("No Client Name"));
        assert!(looks_like_placeholder("n/a"));
        assert!(looks_like_placeholder("  TBD  "));
        assert!(!looks_like_placeholder("Acme Holdings"));
    }
}
