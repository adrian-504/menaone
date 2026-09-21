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

/// Pairs of related records that should share a company but don't.
pub const CROSS_RECORD_COMPANY_CHECKS: &[(&str, &str)] = &[
    ("opportunities whose proposal belongs to another company",
     "SELECT COUNT(*) FROM opportunities o JOIN proposals p ON p.id = o.proposal_id WHERE o.company_id IS NOT NULL AND p.company_id IS NOT NULL AND o.company_id <> p.company_id"),
    ("opportunities whose project belongs to another company",
     "SELECT COUNT(*) FROM opportunities o JOIN projects p ON p.id = o.project_id WHERE o.company_id IS NOT NULL AND p.company_id IS NOT NULL AND o.company_id <> p.company_id"),
    ("agreements whose proposal belongs to another company",
     "SELECT COUNT(*) FROM agreements a JOIN proposals p ON p.id = a.proposal_id WHERE a.company_id IS NOT NULL AND p.company_id IS NOT NULL AND a.company_id <> p.company_id"),
    ("meetings whose project belongs to another company",
     "SELECT COUNT(*) FROM meetings m JOIN projects p ON p.id = m.project_id WHERE m.company_id IS NOT NULL AND p.company_id IS NOT NULL AND m.company_id <> p.company_id"),
    ("meetings whose opportunity belongs to another company",
     "SELECT COUNT(*) FROM meetings m JOIN opportunities o ON o.id = m.opportunity_id WHERE m.company_id IS NOT NULL AND o.company_id IS NOT NULL AND m.company_id <> o.company_id"),
    ("tasks whose opportunity belongs to another company",
     "SELECT COUNT(*) FROM todos t JOIN opportunities o ON o.id = t.opportunity_id WHERE t.company_id IS NOT NULL AND o.company_id IS NOT NULL AND t.company_id <> o.company_id"),
    ("tasks whose project belongs to another company",
     "SELECT COUNT(*) FROM todos t JOIN projects p ON p.id = t.project_id WHERE t.company_id IS NOT NULL AND p.company_id IS NOT NULL AND t.company_id <> p.company_id"),
    ("commitments whose opportunity or project belongs to another company",
     "SELECT COUNT(*) FROM commitments c LEFT JOIN opportunities o ON o.id = c.opportunity_id LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.company_id IS NOT NULL AND ((o.company_id IS NOT NULL AND c.company_id <> o.company_id) OR (p.company_id IS NOT NULL AND c.company_id <> p.company_id))"),
    ("commitments whose contact belongs to another company",
     "SELECT COUNT(*) FROM commitments c JOIN contacts ct ON ct.id = c.contact_id WHERE c.company_id IS NOT NULL AND ct.company_id IS NOT NULL AND c.company_id <> ct.company_id"),
];

/// Groups of company ids whose names are the same once punctuation, capitals
/// and legal suffixes are removed ("Acme LLC" / "ACME"). Never merged
/// automatically — listed for a person to decide.
pub fn possible_duplicate_companies(conn: &Connection) -> rusqlite::Result<Vec<Vec<i64>>> {
    let mut stmt = conn.prepare("SELECT id, name FROM companies WHERE archived = 0 ORDER BY id")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    let mut groups: std::collections::BTreeMap<String, Vec<i64>> = std::collections::BTreeMap::new();
    for row in rows {
        let (id, name) = row?;
        let key = crate::company_migration::normalize_company_name(&name);
        if !key.is_empty() {
            groups.entry(key).or_default().push(id);
        }
    }
    Ok(groups.into_values().filter(|ids| ids.len() > 1).collect())
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
    // Company text that names a different company than the record's link: left
    // as it is (the link wins) and reported for a person to look at.
    for (table, col) in COMPANY_TEXT_COLUMNS {
        add(
            format!("{table}: company text doesn't match its linked company"),
            count(
                conn,
                &format!(
                    "SELECT COUNT(*) FROM {table} t JOIN companies c ON c.id = t.company_id
                     WHERE TRIM(COALESCE(t.{col}, '')) <> ''
                       AND TRIM(t.{col}) <> c.name COLLATE NOCASE
                       AND TRIM(t.{col}) <> COALESCE(c.legal_name, '') COLLATE NOCASE
                       AND NOT EXISTS (SELECT 1 FROM company_aliases a WHERE a.company_id = c.id AND a.alias = TRIM(t.{col}))"
                ),
            )?,
        );
    }
    add("companies that look like duplicates (same name without punctuation or legal suffixes)".into(), possible_duplicate_companies(conn)?.len() as i64);
    // Records linked to one company through a related record that belongs to another.
    for (label, sql) in CROSS_RECORD_COMPANY_CHECKS {
        add((*label).into(), count(conn, sql)?);
    }
    let with_company: Vec<String> = LINK_ENTITY_TABLES
        .iter()
        .filter(|(kind, _)| !matches!(*kind, "company" | "msfile"))
        .map(|(kind, table)| format!("SELECT COUNT(*) FROM entity_links l JOIN {table} x ON l.from_type = '{kind}' AND x.id = l.from_id WHERE l.to_type = 'company' AND x.company_id IS NOT NULL AND x.company_id <> l.to_id"))
        .collect();
    let mut contradicting = 0;
    for sql in &with_company {
        contradicting += count(conn, sql)?;
    }
    add("links to a company that contradict the record's own company".into(), contradicting);

    add(
        "companies whose names differ only by capitals".into(),
        count(conn, "SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) n FROM companies GROUP BY name COLLATE NOCASE HAVING n > 1)")?,
    );
    add(
        "company notes not linked to a company".into(),
        count(conn, "SELECT COUNT(*) FROM company_notes WHERE company_id IS NULL AND TRIM(COALESCE(note_text, '')) <> ''")?,
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
