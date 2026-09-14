//! Data integrity checks (Foundation Lock). Read-only: reports problems, never
//! fixes them. Used by the tests against clean and realistic databases, and
//! available to the app as `get_integrity_report`.

use crate::db::{DbState, LINK_ENTITY_TABLES, SYNC_TABLES};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityIssue {
    pub check: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    /// SQLite's own `PRAGMA integrity_check` ("ok" when healthy).
    pub sqlite: String,
    pub issues: Vec<IntegrityIssue>,
}

impl IntegrityReport {
    pub fn is_clean(&self) -> bool {
        self.sqlite == "ok" && self.issues.is_empty()
    }
    pub fn count(&self, check: &str) -> i64 {
        self.issues.iter().find(|i| i.check == check).map(|i| i.count).unwrap_or(0)
    }
}

/// Tables whose records carry a company name as text next to `company_id`.
pub const COMPANY_TEXT_COLUMNS: &[(&str, &str)] = &[
    ("proposals", "client"), ("contacts", "client_name"), ("agreements", "client"), ("todos", "client"),
    ("notes", "client_name"), ("meetings", "company_name"), ("projects", "company_name"), ("documents", "company_name"),
    ("intelligence_items", "company_name"), ("emails", "company_name"),
];

fn count(conn: &Connection, sql: &str) -> rusqlite::Result<i64> {
    conn.query_row(sql, [], |r| r.get(0))
}

pub fn integrity_report(conn: &Connection) -> rusqlite::Result<IntegrityReport> {
    let mut issues = Vec::new();
    let mut add = |check: String, n: i64| {
        if n > 0 {
            issues.push(IntegrityIssue { check, count: n });
        }
    };

    let fk: i64 = conn.prepare("PRAGMA foreign_key_check")?.query_map([], |_| Ok(()))?.count() as i64;
    add("foreign keys pointing at missing rows".into(), fk);

    for (kind, table) in LINK_ENTITY_TABLES {
        let n: i64 = conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM entity_links WHERE (from_type = ?1 AND from_id NOT IN (SELECT id FROM {table}))
                    OR (to_type = ?1 AND to_id NOT IN (SELECT id FROM {table}))"
            ),
            params![kind],
            |r| r.get(0),
        )?;
        add(format!("links to a missing {kind}"), n);
    }
    add("links of an unknown kind".into(), {
        let kinds: Vec<String> = LINK_ENTITY_TABLES.iter().map(|(k, _)| format!("'{k}'")).collect();
        let list = kinds.join(",");
        count(conn, &format!("SELECT COUNT(*) FROM entity_links WHERE from_type NOT IN ({list}) OR to_type NOT IN ({list})"))?
    });

    for (table, col) in COMPANY_TEXT_COLUMNS {
        add(
            format!("{table}: company name typed but not linked"),
            count(conn, &format!("SELECT COUNT(*) FROM {table} WHERE company_id IS NULL AND TRIM(COALESCE({col}, '')) <> ''"))?,
        );
        add(
            format!("{table}: linked company no longer exists"),
            count(conn, &format!("SELECT COUNT(*) FROM {table} WHERE company_id IS NOT NULL AND company_id NOT IN (SELECT id FROM companies)"))?,
        );
    }
    add(
        "opportunities: linked company no longer exists".into(),
        count(conn, "SELECT COUNT(*) FROM opportunities WHERE company_id IS NOT NULL AND company_id NOT IN (SELECT id FROM companies)")?,
    );
    add(
        "companies whose names differ only by capitals".into(),
        count(conn, "SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) n FROM companies GROUP BY name COLLATE NOCASE HAVING n > 1)")?,
    );
    add(
        "former company names that are also a current name".into(),
        count(conn, "SELECT COUNT(*) FROM company_aliases a JOIN companies c ON c.name = a.alias COLLATE NOCASE AND c.id <> a.company_id")?,
    );

    let tables = SYNC_TABLES.iter().chain(crate::commercial::COMMERCIAL_SYNC_TABLES).chain(["proposal_templates", "saved_lists"].iter());
    for table in tables {
        add(format!("{table}: rows without a uuid"), count(conn, &format!("SELECT COUNT(*) FROM {table} WHERE uuid IS NULL"))?);
        add(
            format!("{table}: uuid used twice"),
            count(conn, &format!("SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) n FROM {table} WHERE uuid IS NOT NULL GROUP BY uuid HAVING n > 1)"))?,
        );
        add(
            format!("{table}: tombstone for a record that still exists"),
            count(conn, &format!("SELECT COUNT(*) FROM sync_tombstones t JOIN {table} x ON x.uuid = t.uuid WHERE t.table_name = '{table}'"))?,
        );
    }

    add(
        "activity recorded twice".into(),
        count(
            conn,
            "SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) n FROM activity
               GROUP BY entity_type, entity_id, action, substr(created_at, 1, 19), COALESCE(detail, '') HAVING n > 1)",
        )?,
    );
    add(
        "opportunities linked to a missing proposal or project".into(),
        count(
            conn,
            "SELECT COUNT(*) FROM opportunities WHERE (proposal_id IS NOT NULL AND proposal_id NOT IN (SELECT id FROM proposals))
                OR (project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects))",
        )?,
    );
    add(
        "agreements linked to a missing proposal".into(),
        count(conn, "SELECT COUNT(*) FROM agreements WHERE proposal_id IS NOT NULL AND proposal_id NOT IN (SELECT id FROM proposals)")?,
    );
    add(
        "meetings synced twice from the same Outlook event".into(),
        count(conn, "SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) n FROM meetings WHERE outlook_event_id IS NOT NULL GROUP BY outlook_event_id HAVING n > 1)")?,
    );

    let sqlite: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    Ok(IntegrityReport { sqlite, issues })
}

#[tauri::command]
pub fn get_integrity_report(state: State<DbState>) -> Result<IntegrityReport, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    integrity_report(&conn).map_err(|e| e.to_string())
}
