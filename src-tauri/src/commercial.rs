//! Commercial core (schema v22): the service catalog, business entities
//! (MENA BIG KSA in SAR, MENA BIG Europe in EUR), the team directory,
//! service lines on proposals and agreements, proposal documents, the
//! internal review step, and the clean-up of legacy proposal statuses.

use crate::commands::now_iso;
use crate::db::DbState;
use crate::models::{CommercialLine, ProposalDocument};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ═══════════════════════════ Statuses ═══════════════════════════

pub const STATUS_REQUEST: &str = "Proposal Request Received";
pub const STATUS_DRAFTING: &str = "Drafting";
pub const STATUS_REVIEW: &str = "In Internal Review";
pub const STATUS_SENT: &str = "Sent to Client";
pub const STATUS_CLIENT_SIGNED: &str = "Signed by Client";
/// A proposal is won once both parties have signed it.
pub const STATUS_WON: &str = "Signed by Both Parties";
pub const STATUS_LOST: &str = "Lost";
pub const STATUS_WITHDRAWN: &str = "Withdrawn";

pub const PROPOSAL_STATUSES: &[&str] = &[
    STATUS_REQUEST, STATUS_DRAFTING, STATUS_REVIEW, STATUS_SENT, STATUS_CLIENT_SIGNED, STATUS_WON, STATUS_LOST, STATUS_WITHDRAWN,
];

/// The status a proposal from the original tracker's 11-step list moves to.
/// `Lead` is handled separately (those records already live on as
/// opportunities). Unknown values are left alone.
pub fn map_legacy_proposal_status(status: &str) -> Option<&'static str> {
    match status.trim() {
        "Lead" | "Proposal Request Received" => Some(STATUS_REQUEST),
        "Proposal Drafted" => Some(STATUS_DRAFTING),
        "Proposal sent to Hassan for review" => Some(STATUS_REVIEW),
        "Proposal sent to Client" => Some(STATUS_SENT),
        "Proposal signed by Client" => Some(STATUS_CLIENT_SIGNED),
        "Proposal Signed by MENA" | "Double Signed Proposal sent to Client" | "Kickoff Meeting Set" | "Service Started" => Some(STATUS_WON),
        "Closed" => Some(STATUS_LOST),
        _ => None,
    }
}

pub const AGREEMENT_IN_PREPARATION: &str = "In Preparation";

// ═══════════════════════════ Models ═══════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub agreement_type: Option<String>,
    /// monthly | one_time
    #[serde(default)]
    pub billing: String,
    #[serde(default)]
    pub default_price: Option<f64>,
    #[serde(default)]
    pub rate_card_id: Option<i64>,
    /// Which modules of the master proposal deck this service uses (Sprint 7).
    #[serde(default)]
    pub template_key: Option<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub sort_order: Option<i64>,
    /// Set when this service was merged into another: the row stays so old
    /// proposals still resolve, and points at the service that survives.
    #[serde(default)]
    pub merged_into: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RateCard {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    /// Tiers, packages and bundles exactly as the Pricing tab shows them.
    #[serde(default)]
    pub pricing: serde_json::Value,
    #[serde(default)]
    pub addons: serde_json::Value,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEntity {
    #[serde(default)]
    pub id: i64,
    pub code: String,
    pub name: String,
    pub currency: String,
    #[serde(default)]
    pub vat_rate: Option<f64>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub job_title: Option<String>,
    #[serde(default)]
    pub department: Option<String>,
    #[serde(default)]
    pub is_reviewer: bool,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommercialSetup {
    pub services: Vec<Service>,
    pub rate_cards: Vec<RateCard>,
    pub business_entities: Vec<BusinessEntity>,
    pub team_members: Vec<TeamMember>,
    /// Units of the reporting currency (SAR) per one unit of each other currency.
    pub fx_rates: HashMap<String, f64>,
    pub proposals_root: Option<String>,
}

// ═══════════════════════════ Migration ═══════════════════════════

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS business_entities (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  currency   TEXT NOT NULL,
  vat_rate   REAL,
  country    TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS team_members (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  job_title   TEXT,
  department  TEXT,
  is_reviewer INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  category     TEXT,
  pricing_json TEXT NOT NULL DEFAULT '{}',
  addons_json  TEXT NOT NULL DEFAULT '[]',
  sort_order   INTEGER,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  category       TEXT,
  description    TEXT,
  agreement_type TEXT,
  billing        TEXT NOT NULL DEFAULT 'monthly',
  default_price  REAL,
  rate_card_id   INTEGER REFERENCES rate_cards(id) ON DELETE SET NULL,
  template_key   TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER,
  created_at     TEXT,
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS proposal_lines (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_id   INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  description  TEXT,
  billing      TEXT NOT NULL DEFAULT 'monthly',
  quantity     REAL NOT NULL DEFAULT 1,
  unit_price   REAL,
  commission   INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  rates_json   TEXT,
  employee_count INTEGER,
  with_recruitment INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_proposal_lines_proposal ON proposal_lines(proposal_id);

CREATE TABLE IF NOT EXISTS agreement_lines (
  id           INTEGER PRIMARY KEY,
  agreement_id INTEGER NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  service_id   INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  description  TEXT,
  billing      TEXT NOT NULL DEFAULT 'monthly',
  quantity     REAL NOT NULL DEFAULT 1,
  unit_price   REAL,
  commission   INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  rates_json   TEXT,
  employee_count INTEGER,
  with_recruitment INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agreement_lines_agreement ON agreement_lines(agreement_id);

CREATE TABLE IF NOT EXISTS proposal_documents (
  id          INTEGER PRIMARY KEY,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'proposal',
  version     INTEGER,
  file_name   TEXT NOT NULL,
  path        TEXT,
  url         TEXT,
  notes       TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposal_documents_proposal ON proposal_documents(proposal_id);

ALTER TABLE proposals ADD COLUMN business_entity_id INTEGER REFERENCES business_entities(id) ON DELETE SET NULL;
ALTER TABLE proposals ADD COLUMN currency TEXT;
ALTER TABLE proposals ADD COLUMN one_time_fee REAL;
ALTER TABLE proposals ADD COLUMN primary_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE proposals ADD COLUMN owner_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE proposals ADD COLUMN reviewer_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE proposals ADD COLUMN review_status TEXT;
ALTER TABLE proposals ADD COLUMN review_requested_at TEXT;
ALTER TABLE proposals ADD COLUMN reviewed_at TEXT;
ALTER TABLE proposals ADD COLUMN review_note TEXT;
ALTER TABLE proposals ADD COLUMN valid_until TEXT;
ALTER TABLE proposals ADD COLUMN folder_path TEXT;
ALTER TABLE proposals ADD COLUMN lead_source TEXT;

ALTER TABLE agreements ADD COLUMN business_entity_id INTEGER REFERENCES business_entities(id) ON DELETE SET NULL;
ALTER TABLE agreements ADD COLUMN currency TEXT;
ALTER TABLE agreements ADD COLUMN start_date TEXT;
ALTER TABLE agreements ADD COLUMN end_date TEXT;
ALTER TABLE agreements ADD COLUMN service_status TEXT;
ALTER TABLE agreements ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agreements ADD COLUMN notice_days INTEGER;
ALTER TABLE agreements ADD COLUMN prepared_by_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE opportunities ADD COLUMN business_entity_id INTEGER REFERENCES business_entities(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN business_entity_id INTEGER REFERENCES business_entities(id) ON DELETE SET NULL;

-- The review step and the agreement's service status show up in the timeline.
CREATE TRIGGER IF NOT EXISTS act_proposal_review AFTER UPDATE OF review_status ON proposals
WHEN OLD.review_status IS NOT NEW.review_status AND NEW.review_status IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          CASE NEW.review_status WHEN 'approved' THEN 'review_approved' WHEN 'changes_requested' THEN 'review_changes_requested' ELSE 'review_requested' END,
          'proposal', NEW.id, NEW.client || ' — ' || COALESCE(NEW.type, 'Proposal'),
          COALESCE((SELECT name FROM team_members WHERE id = NEW.reviewer_id), '') || CASE WHEN NEW.review_note IS NOT NULL AND NEW.review_note <> '' THEN ': ' || NEW.review_note ELSE '' END,
          NEW.company_id);
END;
CREATE TRIGGER IF NOT EXISTS act_agreement_service AFTER UPDATE OF service_status ON agreements
WHEN OLD.service_status IS NOT NEW.service_status AND NEW.service_status IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
BEGIN
  INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, detail, company_id)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'service_status_changed', 'agreement', NEW.id,
          COALESCE(NEW.agr_ref, NEW.client || ' agreement'), COALESCE(OLD.service_status, '—') || ' → ' || NEW.service_status, NEW.company_id);
END;
"#;

pub const COMMERCIAL_SYNC_TABLES: &[&str] = &[
    "business_entities", "team_members", "rate_cards", "services", "proposal_lines", "agreement_lines", "proposal_documents",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedService {
    name: String,
    category: Option<String>,
    agreement_type: Option<String>,
    billing: String,
    rate_card: Option<String>,
    sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedRateCard {
    name: String,
    category: Option<String>,
    sort_order: i64,
    pricing: serde_json::Value,
    addons: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSeed {
    services: Vec<SeedService>,
    rate_cards: Vec<SeedRateCard>,
}

/// The rate card and proposal types the app shipped with, moved into the
/// editable catalog.
const CATALOG_SEED: &str = include_str!("catalog_seed.json");

pub fn migrate_commercial_core(conn: &Connection) -> rusqlite::Result<()> {
    crate::db::atomic(conn, "commercial_core", |tx| {
        tx.execute_batch(SCHEMA)?;
        seed_reference_data(tx)?;
        crate::db::add_sync_columns_to(tx, COMMERCIAL_SYNC_TABLES)?;
        normalize_commercial_data(tx)
    })
}

fn seed_reference_data(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_iso();
    conn.execute(
        "INSERT OR IGNORE INTO business_entities (code, name, currency, vat_rate, country, active, sort_order, created_at)
         VALUES ('KSA', 'MENA BIG KSA', 'SAR', 15, 'Saudi Arabia', 1, 0, ?1)",
        params![now],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO business_entities (code, name, currency, vat_rate, country, active, sort_order, created_at)
         VALUES ('EU', 'MENA BIG Europe', 'EUR', NULL, NULL, 1, 1, ?1)",
        params![now],
    )?;
    let reviewers: i64 = conn.query_row("SELECT COUNT(*) FROM team_members WHERE name = 'Hassan Balaghi'", [], |r| r.get(0))?;
    if reviewers == 0 {
        conn.execute(
            "INSERT INTO team_members (name, is_reviewer, active, created_at) VALUES ('Hassan Balaghi', 1, 1, ?1)",
            params![now],
        )?;
    }

    let seed: CatalogSeed = serde_json::from_str(CATALOG_SEED).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    for rc in &seed.rate_cards {
        conn.execute(
            "INSERT OR IGNORE INTO rate_cards (name, category, pricing_json, addons_json, sort_order, updated_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![rc.name, rc.category, rc.pricing.to_string(), rc.addons.to_string(), rc.sort_order, now],
        )?;
    }
    for s in &seed.services {
        conn.execute(
            "INSERT OR IGNORE INTO services (name, category, agreement_type, billing, rate_card_id, active, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, (SELECT id FROM rate_cards WHERE name = ?5), 1, ?6, ?7)",
            params![s.name, s.category, s.agreement_type, s.billing, s.rate_card, s.sort_order, now],
        )?;
    }
    Ok(())
}

/// Migration 26: priced rows per line (tranches, categories, staff types,
/// countries), the client's employee count and Workforce with recruitment.
/// Databases created at v22 or later already have the columns.
pub fn add_line_rate_columns(conn: &Connection) -> rusqlite::Result<()> {
    for table in ["proposal_lines", "agreement_lines"] {
        let existing: Vec<String> = conn.prepare(&format!("PRAGMA table_info({table})"))?.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<_, _>>()?;
        for (col, ddl) in [("rates_json", "TEXT"), ("employee_count", "INTEGER"), ("with_recruitment", "INTEGER NOT NULL DEFAULT 0")] {
            if !existing.iter().any(|c| c == col) {
                conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {ddl};"))?;
            }
        }
    }
    Ok(())
}

/// Migration 25: rate cards as ranges with a standard price — Constitution
/// 45,000–66,000 (standard 55,000), the Constitution & Maintenance package,
/// Liquidation 20,000–35,000, Recruitment as a percentage (standard 10%),
/// three employee bands shown on Admin and GOSI proposals. Cards and services
/// the team already edited keep their values; only missing fields are added.
pub fn migrate_pricing_ranges(conn: &Connection) -> rusqlite::Result<()> {
    crate::db::atomic(conn, "pricing_ranges", migrate_pricing_ranges_inner)
}

fn migrate_pricing_ranges_inner(tx: &Connection) -> rusqlite::Result<()> {
    let now = now_iso();
    let seed: CatalogSeed = serde_json::from_str(CATALOG_SEED).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    for rc in &seed.rate_cards {
        let stored: Option<String> = tx.query_row("SELECT pricing_json FROM rate_cards WHERE name = ?1", params![rc.name], |r| r.get(0)).optional()?;
        match stored {
            None => {
                tx.execute(
                    "INSERT INTO rate_cards (name, category, pricing_json, addons_json, sort_order, updated_at) VALUES (?1,?2,?3,?4,?5,?6)",
                    params![rc.name, rc.category, rc.pricing.to_string(), rc.addons.to_string(), rc.sort_order, now],
                )?;
            }
            Some(json) => {
                let Ok(serde_json::Value::Object(mut current)) = serde_json::from_str::<serde_json::Value>(&json) else { continue };
                let serde_json::Value::Object(wanted) = &rc.pricing else { continue };
                let mut changed = false;
                for (k, v) in wanted {
                    if !current.contains_key(k) {
                        current.insert(k.clone(), v.clone());
                        changed = true;
                    }
                }
                // The shipped Constitution minimum was the standard price.
                if rc.name == "Company Constitution" && current.get("noCommMin").and_then(|v| v.as_f64()) == Some(55000.0) {
                    current.insert("noCommMin".into(), serde_json::json!(45000));
                    changed = true;
                }
                if changed {
                    tx.execute("UPDATE rate_cards SET pricing_json = ?1, updated_at = ?2 WHERE name = ?3", params![serde_json::Value::Object(current).to_string(), now, rc.name])?;
                }
            }
        }
    }
    for s in &seed.services {
        tx.execute(
            "INSERT OR IGNORE INTO services (name, category, agreement_type, billing, rate_card_id, active, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, (SELECT id FROM rate_cards WHERE name = ?5), 1, ?6, ?7)",
            params![s.name, s.category, s.agreement_type, s.billing, s.rate_card, s.sort_order, now],
        )?;
    }
    // Services that moved to their own card (only if still on the card they shipped with).
    for (service, card, old_card) in [
        ("Business Setup and Maintenance Package", "Business Setup & Maintenance Package", "Company Maintenance"),
        ("GM Representative", "GM Representative", ""),
        ("Mobilization", "Mobilization", "Workforce Services"),
    ] {
        tx.execute(
            "UPDATE services SET rate_card_id = (SELECT id FROM rate_cards WHERE name = ?2)
             WHERE name = ?1 AND (rate_card_id IS NULL OR rate_card_id IS (SELECT id FROM rate_cards WHERE name = ?3))",
            params![service, card, old_card],
        )?;
    }
    // Recruitment is priced as a percentage, not the manpower retainer.
    tx.execute(
        "UPDATE services SET rate_card_id = (SELECT id FROM rate_cards WHERE name = 'Recruitment')
         WHERE name = 'Recruitment' AND rate_card_id IS (SELECT id FROM rate_cards WHERE name = 'Manpower & Recruitment')",
        [],
    )?;
    Ok(())
}

fn set_muted(conn: &Connection, muted: bool) -> rusqlite::Result<Option<String>> {
    let previous: Option<String> = conn
        .query_row("SELECT value FROM app_meta WHERE key = 'activity_muted'", [], |r| r.get(0))
        .optional()?;
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('activity_muted', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![if muted { "1" } else { "0" }],
    )?;
    Ok(previous)
}

fn restore_muted(conn: &Connection, previous: Option<String>) -> rusqlite::Result<()> {
    match previous {
        Some(v) => conn.execute("UPDATE app_meta SET value = ?1 WHERE key = 'activity_muted'", params![v])?,
        None => conn.execute("DELETE FROM app_meta WHERE key = 'activity_muted'", [])?,
    };
    Ok(())
}

/// Brings proposals and agreements written in the original tracker's format
/// onto the current model. Runs in the v22 migration and again after every
/// restore or legacy import, and is safe to repeat.
pub fn normalize_commercial_data(conn: &Connection) -> rusqlite::Result<()> {
    let previous = set_muted(conn, true)?;
    let result = normalize_inner(conn);
    restore_muted(conn, previous)?;
    result
}

fn normalize_inner(conn: &Connection) -> rusqlite::Result<()> {
    let today = now_iso();
    let ksa: Option<i64> = conn.query_row("SELECT id FROM business_entities WHERE code = 'KSA'", [], |r| r.get(0)).optional()?;
    let hassan: Option<i64> = conn
        .query_row("SELECT id FROM team_members WHERE is_reviewer = 1 ORDER BY id LIMIT 1", [], |r| r.get(0))
        .optional()?;

    // 1. Signed proposals get their agreement first, so the delivery stage the
    //    old statuses carried (kickoff set, service started) has a home.
    create_agreements_core(conn)?;
    conn.execute(
        "UPDATE agreements SET service_status = 'Active'
         WHERE service_status IS NULL AND proposal_id IN (SELECT id FROM proposals WHERE status = 'Service Started')",
        [],
    )?;
    conn.execute(
        "UPDATE agreements SET service_status = 'Kickoff scheduled'
         WHERE service_status IS NULL AND proposal_id IN (SELECT id FROM proposals WHERE status = 'Kickoff Meeting Set')",
        [],
    )?;

    // 2. Leads already live on as opportunities: archive the duplicate
    //    proposal rows (kept, not deleted) with a note saying where they went.
    let leads: Vec<(i64, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT p.id, (SELECT o.id FROM opportunities o WHERE o.company_id = p.company_id ORDER BY o.id LIMIT 1)
             FROM proposals p WHERE p.status = 'Lead' AND p.company_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM opportunities o WHERE o.company_id = p.company_id)",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (pid, opp_id) in leads {
        conn.execute(
            "UPDATE proposals SET archived = 1, archived_at = COALESCE(NULLIF(archived_at, ''), ?2) WHERE id = ?1",
            params![pid, today],
        )?;
        let next_note_id: i64 = conn.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM proposal_activity_notes", [], |r| r.get(0))?;
        conn.execute(
            "INSERT INTO proposal_activity_notes (id, proposal_id, note_date, text) VALUES (?1, ?2, ?3, ?4)",
            params![next_note_id, pid, today, format!("This was a lead, not a proposal yet. It is tracked as opportunity #{opp_id}, so this record was archived when proposal statuses were simplified.")],
        )?;
    }

    // 3. Statuses.
    let legacy: Vec<(i64, String)> = {
        let mut stmt = conn.prepare("SELECT id, status FROM proposals")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, status) in legacy {
        let Some(mapped) = map_legacy_proposal_status(&status) else { continue };
        if mapped == status {
            continue;
        }
        conn.execute("UPDATE proposals SET status = ?2 WHERE id = ?1", params![id, mapped])?;
        if mapped == STATUS_REVIEW {
            conn.execute(
                "UPDATE proposals SET reviewer_id = COALESCE(reviewer_id, ?2), review_status = COALESCE(review_status, 'pending'),
                    review_requested_at = COALESCE(review_requested_at, NULLIF(date_sent_to_hassan, ''))
                 WHERE id = ?1",
                params![id, hassan],
            )?;
        }
    }

    // 4. Agreement statuses named a person ("Under Process Hassan"); the
    //    person moves to "prepared by".
    let under_process: Vec<(i64, String, Option<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT id, status, prepared_by FROM agreements WHERE REPLACE(status, '_', ' ') LIKE 'Under Process%'",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, status, prepared_by) in under_process {
        let person = status.replace('_', " ").trim_start_matches("Under Process").trim().to_string();
        let prepared = prepared_by.filter(|p| !p.trim().is_empty()).or_else(|| (!person.is_empty()).then_some(person));
        conn.execute(
            "UPDATE agreements SET status = ?2, prepared_by = ?3 WHERE id = ?1",
            params![id, AGREEMENT_IN_PREPARATION, prepared],
        )?;
    }
    conn.execute(
        "UPDATE agreements SET prepared_by_id = (SELECT t.id FROM team_members t WHERE lower(t.name) = lower(trim(agreements.prepared_by))
                                                  OR lower(t.name) LIKE lower(trim(agreements.prepared_by)) || ' %' LIMIT 1)
         WHERE prepared_by_id IS NULL AND prepared_by IS NOT NULL AND trim(prepared_by) <> ''",
        [],
    )?;

    // 5. Agreement dates from the proposal they came from.
    conn.execute(
        "UPDATE agreements SET start_date = (SELECT NULLIF(p.kickoff_date, '') FROM proposals p WHERE p.id = agreements.proposal_id)
         WHERE (start_date IS NULL OR start_date = '') AND proposal_id IS NOT NULL",
        [],
    )?;
    conn.execute(
        "UPDATE agreements SET end_date = date(start_date, '+' || contract_months || ' months', '-1 day')
         WHERE (end_date IS NULL OR end_date = '') AND start_date IS NOT NULL AND start_date <> '' AND contract_months > 0",
        [],
    )?;

    // 6. One line per legacy proposal and agreement, so totals, MRR and the
    //    catalog work the same way for old and new records. Old records are
    //    not regrouped (owner decision): one row stays one proposal.
    conn.execute(
        "INSERT INTO proposal_lines (proposal_id, service_id, service_name, billing, quantity, unit_price, sort_order)
         SELECT p.id, (SELECT s.id FROM services s WHERE s.name = trim(p.type)), trim(p.type), 'monthly', 1, NULLIF(p.monthly_fee, 0), 0
         FROM proposals p
         WHERE p.type IS NOT NULL AND trim(p.type) NOT IN ('', '—')
           AND NOT EXISTS (SELECT 1 FROM proposal_lines l WHERE l.proposal_id = p.id)",
        [],
    )?;
    conn.execute(
        "INSERT INTO agreement_lines (agreement_id, service_id, service_name, billing, quantity, unit_price, sort_order)
         SELECT a.id,
                (SELECT s.id FROM services s WHERE s.name = trim(COALESCE(p.type, a.type))),
                trim(COALESCE(NULLIF(p.type, '—'), a.type)),
                'monthly', 1,
                COALESCE(NULLIF(a.monthly_fee, 0), NULLIF(p.monthly_fee, 0)), 0
         FROM agreements a LEFT JOIN proposals p ON p.id = a.proposal_id
         WHERE trim(COALESCE(NULLIF(p.type, '—'), a.type, '')) <> ''
           AND NOT EXISTS (SELECT 1 FROM agreement_lines l WHERE l.agreement_id = a.id)",
        [],
    )?;

    // 7. Everything so far was priced in SAR by MENA BIG KSA.
    if let Some(ksa) = ksa {
        conn.execute("UPDATE proposals SET business_entity_id = ?1 WHERE business_entity_id IS NULL", params![ksa])?;
        conn.execute("UPDATE proposals SET currency = 'SAR' WHERE currency IS NULL OR currency = ''", [])?;
        conn.execute("UPDATE agreements SET business_entity_id = ?1 WHERE business_entity_id IS NULL", params![ksa])?;
        conn.execute("UPDATE agreements SET currency = 'SAR' WHERE currency IS NULL OR currency = ''", [])?;
        conn.execute("UPDATE opportunities SET business_entity_id = ?1 WHERE business_entity_id IS NULL", params![ksa])?;
        conn.execute("UPDATE projects SET business_entity_id = ?1 WHERE business_entity_id IS NULL AND type = 'client'", params![ksa])?;
    }
    Ok(())
}

// ═══════════════════════════ Lines and totals ═══════════════════════════

/// `type`, monthly fee and one-time fee a proposal shows, derived from its lines.
pub fn derive_totals(lines: &[CommercialLine]) -> (Option<String>, Option<f64>, Option<f64>) {
    if lines.is_empty() {
        return (None, None, None);
    }
    let mut names: Vec<String> = Vec::new();
    for l in lines {
        let n = l.service_name.trim();
        if !n.is_empty() && !names.iter().any(|x| x == n) {
            names.push(n.to_string());
        }
    }
    let sum = |billing: &str| -> Option<f64> {
        let priced: Vec<f64> = lines
            .iter()
            .filter(|l| l.billing == billing)
            .filter_map(|l| l.unit_price.map(|p| p * l.quantity))
            .collect();
        if priced.is_empty() { None } else { Some(priced.iter().sum()) }
    };
    let type_name = if names.is_empty() { None } else { Some(names.join(" + ")) };
    (type_name, sum("monthly"), sum("one_time"))
}

const LINE_COLS: &str = "id, service_id, service_name, description, billing, quantity, unit_price, commission, sort_order, rates_json, employee_count, with_recruitment";

fn line_from_row(r: &rusqlite::Row, offset: usize) -> rusqlite::Result<CommercialLine> {
    Ok(CommercialLine {
        id: r.get(offset)?,
        service_id: r.get(offset + 1)?,
        service_name: r.get(offset + 2)?,
        description: r.get(offset + 3)?,
        billing: r.get(offset + 4)?,
        quantity: r.get(offset + 5)?,
        unit_price: r.get(offset + 6)?,
        commission: r.get::<_, i64>(offset + 7)? != 0,
        sort_order: r.get(offset + 8)?,
        rates: r.get::<_, Option<String>>(offset + 9)?.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default(),
        employee_count: r.get(offset + 10)?,
        with_recruitment: r.get::<_, Option<i64>>(offset + 11)?.unwrap_or(0) != 0,
    })
}

/// All lines of `table` grouped by their parent id.
pub fn read_lines(conn: &Connection, table: &str, parent_col: &str) -> rusqlite::Result<HashMap<i64, Vec<CommercialLine>>> {
    let mut stmt = conn.prepare(&format!("SELECT {parent_col}, {LINE_COLS} FROM {table} ORDER BY {parent_col}, sort_order, id"))?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, line_from_row(r, 1)?)))?;
    let mut map: HashMap<i64, Vec<CommercialLine>> = HashMap::new();
    for row in rows {
        let (pid, line) = row?;
        map.entry(pid).or_default().push(line);
    }
    Ok(map)
}

/// Replaces a parent's lines with `lines`: missing ones are deleted, the
/// rest inserted or updated in place (keeping their sync identity).
pub fn save_lines(conn: &Connection, table: &str, parent_col: &str, parent_id: i64, lines: &[CommercialLine]) -> rusqlite::Result<()> {
    let ids: Vec<i64> = lines.iter().map(|l| l.id).collect();
    conn.execute(
        &format!("DELETE FROM {table} WHERE {parent_col} = ?1 AND id NOT IN (SELECT value FROM json_each(?2))"),
        params![parent_id, serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())],
    )?;
    let sql = format!(
        "INSERT INTO {table} (id, {parent_col}, service_id, service_name, description, billing, quantity, unit_price, commission, sort_order, rates_json, employee_count, with_recruitment)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
         ON CONFLICT(id) DO UPDATE SET {parent_col} = excluded.{parent_col}, service_id = excluded.service_id,
           service_name = excluded.service_name, description = excluded.description, billing = excluded.billing,
           quantity = excluded.quantity, unit_price = excluded.unit_price, commission = excluded.commission, sort_order = excluded.sort_order,
           rates_json = excluded.rates_json, employee_count = excluded.employee_count, with_recruitment = excluded.with_recruitment
         WHERE {table}.{parent_col} IS NOT excluded.{parent_col} OR {table}.service_id IS NOT excluded.service_id
           OR {table}.service_name IS NOT excluded.service_name OR {table}.description IS NOT excluded.description
           OR {table}.billing IS NOT excluded.billing OR {table}.quantity IS NOT excluded.quantity
           OR {table}.unit_price IS NOT excluded.unit_price OR {table}.commission IS NOT excluded.commission
           OR {table}.sort_order IS NOT excluded.sort_order OR {table}.rates_json IS NOT excluded.rates_json
           OR {table}.employee_count IS NOT excluded.employee_count OR {table}.with_recruitment IS NOT excluded.with_recruitment"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    for (i, l) in lines.iter().enumerate() {
        let billing = if l.billing == "one_time" { "one_time" } else { "monthly" };
        let quantity = if l.quantity > 0.0 { l.quantity } else { 1.0 };
        stmt.execute(params![
            l.id, parent_id, l.service_id, l.service_name.trim(), l.description, billing, quantity, l.unit_price,
            l.commission as i64, i as i64,
            if l.rates.is_empty() { None } else { serde_json::to_string(&l.rates).ok() },
            l.employee_count, l.with_recruitment as i64,
        ])?;
    }
    Ok(())
}

pub fn read_documents(conn: &Connection) -> rusqlite::Result<HashMap<i64, Vec<ProposalDocument>>> {
    let mut stmt = conn.prepare(
        "SELECT proposal_id, id, kind, version, file_name, path, url, notes, created_at FROM proposal_documents ORDER BY proposal_id, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            ProposalDocument {
                id: r.get(1)?,
                kind: r.get(2)?,
                version: r.get(3)?,
                file_name: r.get(4)?,
                path: r.get(5)?,
                url: r.get(6)?,
                notes: r.get(7)?,
                created_at: r.get(8)?,
            },
        ))
    })?;
    let mut map: HashMap<i64, Vec<ProposalDocument>> = HashMap::new();
    for row in rows {
        let (pid, d) = row?;
        map.entry(pid).or_default().push(d);
    }
    Ok(map)
}

pub fn save_documents(conn: &Connection, proposal_id: i64, docs: &[ProposalDocument]) -> rusqlite::Result<()> {
    let ids: Vec<i64> = docs.iter().map(|d| d.id).collect();
    conn.execute(
        "DELETE FROM proposal_documents WHERE proposal_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))",
        params![proposal_id, serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())],
    )?;
    let mut stmt = conn.prepare_cached(
        "INSERT INTO proposal_documents (id, proposal_id, kind, version, file_name, path, url, notes, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET proposal_id = excluded.proposal_id, kind = excluded.kind, version = excluded.version,
           file_name = excluded.file_name, path = excluded.path, url = excluded.url, notes = excluded.notes, created_at = excluded.created_at
         WHERE proposal_documents.kind IS NOT excluded.kind OR proposal_documents.version IS NOT excluded.version
           OR proposal_documents.file_name IS NOT excluded.file_name OR proposal_documents.path IS NOT excluded.path
           OR proposal_documents.url IS NOT excluded.url OR proposal_documents.notes IS NOT excluded.notes
           OR proposal_documents.proposal_id IS NOT excluded.proposal_id",
    )?;
    for d in docs {
        let kind = if d.kind.is_empty() { "proposal" } else { d.kind.as_str() };
        stmt.execute(params![d.id, proposal_id, kind, d.version, d.file_name, d.path, d.url, d.notes, d.created_at])?;
    }
    Ok(())
}

/// Writes the derived `type`/fees when the proposal has lines.
pub fn apply_derived_proposal_totals(conn: &Connection, proposal_id: i64, lines: &[CommercialLine]) -> rusqlite::Result<()> {
    if lines.is_empty() {
        return Ok(());
    }
    let (type_name, monthly, one_time) = derive_totals(lines);
    conn.execute(
        "UPDATE proposals SET type = ?2, monthly_fee = ?3, one_time_fee = ?4
         WHERE id = ?1 AND (type IS NOT ?2 OR monthly_fee IS NOT ?3 OR one_time_fee IS NOT ?4)",
        params![proposal_id, type_name, monthly, one_time],
    )?;
    Ok(())
}

pub fn apply_derived_agreement_totals(conn: &Connection, agreement_id: i64, lines: &[CommercialLine]) -> rusqlite::Result<()> {
    if lines.is_empty() {
        return Ok(());
    }
    let (_, monthly, _) = derive_totals(lines);
    conn.execute(
        "UPDATE agreements SET monthly_fee = ?2 WHERE id = ?1 AND monthly_fee IS NOT ?2",
        params![agreement_id, monthly],
    )?;
    Ok(())
}

// ═══════════════════════════ Agreements from won proposals ═══════════════════════════

const AGREEMENT_QUALIFYING_STATUSES: &[&str] = &[
    STATUS_WON, "Double Signed Proposal sent to Client", "Proposal Signed by MENA", "Kickoff Meeting Set", "Service Started",
];

/// Creates an agreement, with the proposal's lines, for every won proposal
/// that has none. Returns the ids it created. Safe to repeat.
pub fn create_agreements_core(conn: &Connection) -> rusqlite::Result<Vec<i64>> {
    type Pending = (i64, String, Option<String>, Option<String>, Option<String>, Option<f64>, Option<i64>, Option<String>, Option<String>, Option<i64>, Option<String>, Option<i64>);
    let pending: Vec<Pending> = {
        let mut stmt = conn.prepare(
            "SELECT p.id, p.client, p.type, p.dbl_signed_date, p.sent_date, p.monthly_fee, p.contract_months, p.hubspot,
                    p.kickoff_date, p.business_entity_id, p.currency, p.company_id
             FROM proposals p
             WHERE p.status IN (SELECT value FROM json_each(?1))
               AND NOT EXISTS (SELECT 1 FROM agreements a WHERE a.proposal_id = p.id)
             ORDER BY p.id",
        )?;
        let statuses = serde_json::to_string(AGREEMENT_QUALIFYING_STATUSES).unwrap_or_else(|_| "[]".into());
        let rows = stmt.query_map(params![statuses], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?))
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let today = now_iso();
    let mut created = Vec::new();
    for (pid, client, ptype, dbl_signed, sent, fee, months, hubspot, kickoff, entity, currency, proposal_company) in pending {
        let catalog_type: Option<String> = conn
            .query_row(
                "SELECT s.agreement_type FROM proposal_lines l JOIN services s ON s.id = l.service_id
                 WHERE l.proposal_id = ?1 AND s.agreement_type IS NOT NULL ORDER BY l.sort_order, l.id LIMIT 1",
                params![pid],
                |r| r.get(0),
            )
            .optional()?;
        let agr_type = catalog_type.unwrap_or_else(|| crate::commands::proposal_type_to_agreement_type(ptype.as_deref()).to_string());
        let ref_date = dbl_signed.clone().filter(|d| !d.is_empty()).or(sent.filter(|d| !d.is_empty())).unwrap_or_else(|| today.clone());
        let agr_ref = crate::commands::next_agreement_ref(conn, &client, &agr_type, &ref_date)?;
        let company_id = crate::opportunities::resolve_company_ref(conn, proposal_company, Some(&client))?;
        let start = kickoff.filter(|d| !d.is_empty());
        conn.execute(
            "INSERT INTO agreements (agr_ref, client, type, status, prepared_by, date_prepared, date_sent_to_client,
                date_client_signed, date_mena_signed, date_filed, monthly_fee, contract_months, proposal_id, hubspot,
                doc_link, action_date, remarks, created_at, company_id, business_entity_id, currency, start_date, end_date)
             VALUES (?1,?2,?3,?4,'','','','','','',?5,?6,?7,?8,NULL,?9,?10,?11,?12,?13,?14,?15,
                     CASE WHEN ?15 IS NOT NULL AND ?6 > 0 THEN date(?15, '+' || ?6 || ' months', '-1 day') END)",
            params![
                agr_ref, client, agr_type, AGREEMENT_IN_PREPARATION,
                fee.filter(|f| *f != 0.0), months.filter(|m| *m != 0), pid, hubspot.unwrap_or_default(),
                dbl_signed.unwrap_or_default(),
                format!("Auto-created from proposal SL# {pid} ({})", ptype.unwrap_or_default()),
                today, company_id, entity, currency, start,
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO agreement_lines (agreement_id, service_id, service_name, description, billing, quantity, unit_price, commission, sort_order, rates_json, employee_count, with_recruitment)
             SELECT ?1, service_id, service_name, description, billing, quantity, unit_price, commission, sort_order, rates_json, employee_count, with_recruitment
             FROM proposal_lines WHERE proposal_id = ?2 ORDER BY sort_order, id",
            params![id, pid],
        )?;
        crate::v2_search::reindex_agreement(conn, id)?;
        created.push(id);
    }
    Ok(created)
}

// ═══════════════════════════ Reading and saving setup ═══════════════════════════

pub fn read_services(conn: &Connection) -> rusqlite::Result<Vec<Service>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, category, description, agreement_type, billing, default_price, rate_card_id, template_key, active, sort_order, merged_into
         FROM services ORDER BY COALESCE(sort_order, 1e9), name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Service {
            id: r.get(0)?,
            name: r.get(1)?,
            category: r.get(2)?,
            description: r.get(3)?,
            agreement_type: r.get(4)?,
            billing: r.get(5)?,
            default_price: r.get(6)?,
            rate_card_id: r.get(7)?,
            template_key: r.get(8)?,
            active: r.get::<_, i64>(9)? != 0,
            sort_order: r.get(10)?,
            merged_into: r.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn read_rate_cards(conn: &Connection) -> rusqlite::Result<Vec<RateCard>> {
    let mut stmt = conn.prepare("SELECT id, name, category, pricing_json, addons_json, sort_order FROM rate_cards ORDER BY COALESCE(sort_order, 1e9), name")?;
    let rows = stmt.query_map([], |r| {
        let pricing: String = r.get(3)?;
        let addons: String = r.get(4)?;
        Ok(RateCard {
            id: r.get(0)?,
            name: r.get(1)?,
            category: r.get(2)?,
            pricing: serde_json::from_str(&pricing).unwrap_or(serde_json::Value::Null),
            addons: serde_json::from_str(&addons).unwrap_or(serde_json::Value::Array(vec![])),
            sort_order: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn read_business_entities(conn: &Connection) -> rusqlite::Result<Vec<BusinessEntity>> {
    let mut stmt = conn.prepare("SELECT id, code, name, currency, vat_rate, country, active, sort_order FROM business_entities ORDER BY COALESCE(sort_order, 1e9), id")?;
    let rows = stmt.query_map([], |r| {
        Ok(BusinessEntity {
            id: r.get(0)?,
            code: r.get(1)?,
            name: r.get(2)?,
            currency: r.get(3)?,
            vat_rate: r.get(4)?,
            country: r.get(5)?,
            active: r.get::<_, i64>(6)? != 0,
            sort_order: r.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn read_team_members(conn: &Connection) -> rusqlite::Result<Vec<TeamMember>> {
    let mut stmt = conn.prepare("SELECT id, name, email, job_title, department, is_reviewer, active, notes FROM team_members ORDER BY active DESC, name")?;
    let rows = stmt.query_map([], |r| {
        Ok(TeamMember {
            id: r.get(0)?,
            name: r.get(1)?,
            email: r.get(2)?,
            job_title: r.get(3)?,
            department: r.get(4)?,
            is_reviewer: r.get::<_, i64>(5)? != 0,
            active: r.get::<_, i64>(6)? != 0,
            notes: r.get(7)?,
        })
    })?;
    rows.collect()
}

fn read_fx_rates(conn: &Connection) -> rusqlite::Result<HashMap<String, f64>> {
    let raw: Option<String> = conn.query_row("SELECT value FROM app_meta WHERE key = 'fx_rates'", [], |r| r.get(0)).optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn read_setup(conn: &Connection) -> rusqlite::Result<CommercialSetup> {
    let proposals_root: Option<String> = conn.query_row("SELECT value FROM app_meta WHERE key = 'proposals_root'", [], |r| r.get(0)).optional()?;
    Ok(CommercialSetup {
        services: read_services(conn)?,
        rate_cards: read_rate_cards(conn)?,
        business_entities: read_business_entities(conn)?,
        team_members: read_team_members(conn)?,
        fx_rates: read_fx_rates(conn)?,
        proposals_root: proposals_root.or_else(|| detect_proposals_root().map(|p| p.to_string_lossy().to_string())),
    })
}

/// Restores catalog, entities and team from a backup; empty lists (older
/// backups) leave the current ones untouched.
pub fn restore_setup(conn: &Connection, services: &[Service], entities: &[BusinessEntity], team: &[TeamMember]) -> rusqlite::Result<()> {
    for e in entities {
        upsert_business_entity(conn, e)?;
    }
    for t in team {
        upsert_team_member(conn, t)?;
    }
    for s in services {
        upsert_service(conn, s)?;
    }
    Ok(())
}

fn upsert_service(conn: &Connection, s: &Service) -> rusqlite::Result<i64> {
    let now = now_iso();
    let billing = if s.billing == "one_time" { "one_time" } else { "monthly" };
    let existing: Option<i64> = if s.id > 0 {
        conn.query_row("SELECT id FROM services WHERE id = ?1", params![s.id], |r| r.get(0)).optional()?
    } else {
        conn.query_row("SELECT id FROM services WHERE name = ?1", params![s.name.trim()], |r| r.get(0)).optional()?
    };
    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE services SET name=?2, category=?3, description=?4, agreement_type=?5, billing=?6, default_price=?7,
                   rate_card_id=?8, template_key=?9, active=?10, sort_order=?11, updated_at=?12 WHERE id=?1",
                params![id, s.name.trim(), s.category, s.description, s.agreement_type, billing, s.default_price, s.rate_card_id,
                        s.template_key, s.active as i64, s.sort_order, now],
            )?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO services (name, category, description, agreement_type, billing, default_price, rate_card_id, template_key, active, sort_order, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,COALESCE(?10,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM services)),?11,?11)",
                params![s.name.trim(), s.category, s.description, s.agreement_type, billing, s.default_price, s.rate_card_id,
                        s.template_key, s.active as i64, s.sort_order, now],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

fn upsert_business_entity(conn: &Connection, e: &BusinessEntity) -> rusqlite::Result<i64> {
    let now = now_iso();
    let existing: Option<i64> = if e.id > 0 {
        conn.query_row("SELECT id FROM business_entities WHERE id = ?1", params![e.id], |r| r.get(0)).optional()?
    } else {
        conn.query_row("SELECT id FROM business_entities WHERE code = ?1", params![e.code.trim()], |r| r.get(0)).optional()?
    };
    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE business_entities SET code=?2, name=?3, currency=?4, vat_rate=?5, country=?6, active=?7, sort_order=?8, updated_at=?9 WHERE id=?1",
                params![id, e.code.trim(), e.name.trim(), e.currency.trim().to_uppercase(), e.vat_rate, e.country, e.active as i64, e.sort_order, now],
            )?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO business_entities (code, name, currency, vat_rate, country, active, sort_order, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
                params![e.code.trim(), e.name.trim(), e.currency.trim().to_uppercase(), e.vat_rate, e.country, e.active as i64, e.sort_order, now],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

fn upsert_team_member(conn: &Connection, t: &TeamMember) -> rusqlite::Result<i64> {
    let now = now_iso();
    let existing: Option<i64> = if t.id > 0 {
        conn.query_row("SELECT id FROM team_members WHERE id = ?1", params![t.id], |r| r.get(0)).optional()?
    } else {
        None
    };
    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE team_members SET name=?2, email=?3, job_title=?4, department=?5, is_reviewer=?6, active=?7, notes=?8, updated_at=?9 WHERE id=?1",
                params![id, t.name.trim(), t.email, t.job_title, t.department, t.is_reviewer as i64, t.active as i64, t.notes, now],
            )?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO team_members (name, email, job_title, department, is_reviewer, active, notes, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
                params![t.name.trim(), t.email, t.job_title, t.department, t.is_reviewer as i64, t.active as i64, t.notes, now],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
pub fn get_commercial_setup(state: State<DbState>) -> CmdResult<CommercialSetup> {
    let conn = state.0.lock().map_err(err)?;
    read_setup(&conn).map_err(err)
}

#[tauri::command]
pub fn save_service(state: State<DbState>, service: Service) -> CmdResult<Service> {
    if service.name.trim().is_empty() {
        return Err("A service needs a name.".into());
    }
    let conn = state.0.lock().map_err(err)?;
    let clash: Option<i64> = conn
        .query_row("SELECT id FROM services WHERE lower(name) = lower(?1) AND id <> ?2", params![service.name.trim(), service.id], |r| r.get(0))
        .optional()
        .map_err(err)?;
    if clash.is_some() {
        return Err(format!("There is already a service called \"{}\".", service.name.trim()));
    }
    let id = upsert_service(&conn, &service).map_err(err)?;
    read_services(&conn).map_err(err)?.into_iter().find(|s| s.id == id).ok_or_else(|| "Service not found after saving.".into())
}

/// Saves a rate card's prices (Services → Rate cards). The pricing object is
/// kept as the app writes it; it must at least be a JSON object.
#[tauri::command]
pub fn save_rate_card(state: State<DbState>, card: RateCard) -> CmdResult<RateCard> {
    if !card.pricing.is_object() {
        return Err("The rate card's prices are not in the expected shape.".into());
    }
    let conn = state.0.lock().map_err(err)?;
    let changed = conn
        .execute(
            "UPDATE rate_cards SET pricing_json = ?1, addons_json = ?2, updated_at = ?3 WHERE id = ?4",
            params![card.pricing.to_string(), if card.addons.is_array() { card.addons.to_string() } else { "[]".into() }, now_iso(), card.id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err("Rate card not found.".into());
    }
    read_rate_cards(&conn).map_err(err)?.into_iter().find(|r| r.id == card.id).ok_or_else(|| "Rate card not found after saving.".into())
}

#[tauri::command]
pub fn save_business_entity(state: State<DbState>, entity: BusinessEntity) -> CmdResult<BusinessEntity> {
    if entity.name.trim().is_empty() || entity.code.trim().is_empty() || entity.currency.trim().len() != 3 {
        return Err("A business entity needs a code, a name and a three-letter currency.".into());
    }
    let conn = state.0.lock().map_err(err)?;
    let id = upsert_business_entity(&conn, &entity).map_err(err)?;
    read_business_entities(&conn).map_err(err)?.into_iter().find(|e| e.id == id).ok_or_else(|| "Entity not found after saving.".into())
}

#[tauri::command]
pub fn save_team_member(state: State<DbState>, member: TeamMember) -> CmdResult<TeamMember> {
    if member.name.trim().is_empty() {
        return Err("A team member needs a name.".into());
    }
    let conn = state.0.lock().map_err(err)?;
    let id = upsert_team_member(&conn, &member).map_err(err)?;
    read_team_members(&conn).map_err(err)?.into_iter().find(|t| t.id == id).ok_or_else(|| "Team member not found after saving.".into())
}

/// Removing someone keeps the records they're named on: owner/reviewer links
/// clear, the free-text name on older records stays.
#[tauri::command]
pub fn delete_team_member(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM team_members WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn set_fx_rate(state: State<DbState>, currency: String, rate: Option<f64>) -> CmdResult<HashMap<String, f64>> {
    let conn = state.0.lock().map_err(err)?;
    let mut rates = read_fx_rates(&conn).map_err(err)?;
    let code = currency.trim().to_uppercase();
    match rate.filter(|r| *r > 0.0) {
        Some(r) => { rates.insert(code, r); }
        None => { rates.remove(&code); }
    }
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('fx_rates', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(&rates).map_err(err)?],
    ).map_err(err)?;
    Ok(rates)
}

// ═══════════════════════════ Client proposal folders ═══════════════════════════

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProposalFolder {
    /// The "Proposals" folder that holds one subfolder per client.
    pub root: Option<String>,
    /// The client's folder — an existing match, or where it would be created.
    pub path: Option<String>,
    pub exists: bool,
    pub files: Vec<crate::localfiles::LocalFileItem>,
}

/// `MENA BD 2026/Proposals` (or the newest `MENA BD <year>/Proposals`) in a
/// synced OneDrive folder.
pub fn detect_proposals_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for dir in crate::localfiles::onedrive_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("MENA BD") {
                let p = e.path().join("Proposals");
                if p.is_dir() {
                    candidates.push(p);
                }
            }
        }
    }
    candidates.sort();
    candidates.pop()
}

pub(crate) fn proposals_root(conn: &Connection) -> rusqlite::Result<Option<PathBuf>> {
    let configured: Option<String> = conn.query_row("SELECT value FROM app_meta WHERE key = 'proposals_root'", [], |r| r.get(0)).optional()?;
    Ok(configured.map(PathBuf::from).filter(|p| p.is_dir()).or_else(detect_proposals_root))
}

/// Letters and digits only, lower case — "Al-Futtaim L.L.C." and
/// "al futtaim llc" compare equal.
fn folder_key(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// A folder name that is safe on macOS, Windows and OneDrive.
pub fn safe_folder_name(client: &str) -> String {
    let cleaned: String = client
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { ' ' } else { c })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ").trim_end_matches('.').trim().to_string()
}

pub fn find_client_folder(root: &Path, client: &str) -> Option<PathBuf> {
    let wanted = folder_key(client);
    if wanted.is_empty() {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .find(|e| folder_key(&e.file_name().to_string_lossy()) == wanted)
        .map(|e| e.path())
}

fn folder_info(root: Option<PathBuf>, client: &str, existing: Option<PathBuf>) -> ProposalFolder {
    let Some(root) = root else { return ProposalFolder::default() };
    let found = existing.filter(|p| p.is_dir()).or_else(|| find_client_folder(&root, client));
    let (path, exists) = match found {
        Some(p) => (Some(p), true),
        None => {
            let name = safe_folder_name(client);
            ((!name.is_empty()).then(|| root.join(name)), false)
        }
    };
    let files = if exists {
        path.as_ref()
            .and_then(|p| crate::localfiles::files_list_folder(p.to_string_lossy().to_string()).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    ProposalFolder {
        root: Some(root.to_string_lossy().to_string()),
        path: path.map(|p| p.to_string_lossy().to_string()),
        exists,
        files,
    }
}

#[tauri::command]
pub fn proposal_folder_lookup(state: State<DbState>, client: String, folder_path: Option<String>) -> CmdResult<ProposalFolder> {
    let root = {
        let conn = state.0.lock().map_err(err)?;
        proposals_root(&conn).map_err(err)?
    };
    Ok(folder_info(root, &client, folder_path.map(PathBuf::from)))
}

/// Creates the client's folder inside the Proposals folder. Only ever called
/// from an explicit "Create folder" action.
#[tauri::command]
pub fn proposal_folder_create(state: State<DbState>, client: String) -> CmdResult<ProposalFolder> {
    let root = {
        let conn = state.0.lock().map_err(err)?;
        proposals_root(&conn).map_err(err)?
    }
    .ok_or("No Proposals folder was found in OneDrive. Choose one in Settings first.")?;
    if let Some(existing) = find_client_folder(&root, &client) {
        return Ok(folder_info(Some(root), &client, Some(existing)));
    }
    let name = safe_folder_name(&client);
    if name.is_empty() {
        return Err("This client name can't be used as a folder name.".into());
    }
    let target = root.join(&name);
    if !crate::localfiles::is_within_onedrive(&root) {
        return Err("The Proposals folder is outside OneDrive.".into());
    }
    std::fs::create_dir(&target).map_err(|e| format!("Could not create the folder: {e}"))?;
    Ok(folder_info(Some(root), &client, Some(target)))
}

#[tauri::command]
pub fn set_proposals_root(state: State<DbState>, path: Option<String>) -> CmdResult<CommercialSetup> {
    let conn = state.0.lock().map_err(err)?;
    match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let pb = PathBuf::from(&p);
            if !pb.is_dir() || !crate::localfiles::is_within_onedrive(&pb) {
                return Err("Choose a folder inside OneDrive.".into());
            }
            conn.execute(
                "INSERT INTO app_meta (key, value) VALUES ('proposals_root', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![p],
            ).map_err(err)?;
        }
        None => {
            conn.execute("DELETE FROM app_meta WHERE key = 'proposals_root'", []).map_err(err)?;
        }
    }
    read_setup(&conn).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(name: &str, billing: &str, qty: f64, price: Option<f64>) -> CommercialLine {
        CommercialLine { service_name: name.into(), billing: billing.into(), quantity: qty, unit_price: price, ..Default::default() }
    }

    #[test]
    fn totals_come_from_lines() {
        let lines = vec![
            line("Payroll", "monthly", 1.0, Some(3000.0)),
            line("PRO", "monthly", 2.0, Some(1500.0)),
            line("Company Constitution", "one_time", 1.0, Some(55000.0)),
            line("Payroll", "monthly", 1.0, None),
        ];
        let (t, m, o) = derive_totals(&lines);
        assert_eq!(t.as_deref(), Some("Payroll + PRO + Company Constitution"));
        assert_eq!(m, Some(6000.0));
        assert_eq!(o, Some(55000.0));
        assert_eq!(derive_totals(&[line("PRO", "monthly", 1.0, None)]).1, None);
    }

    #[test]
    fn legacy_statuses_map_onto_the_new_list() {
        assert_eq!(map_legacy_proposal_status("Service Started"), Some(STATUS_WON));
        assert_eq!(map_legacy_proposal_status("Double Signed Proposal sent to Client"), Some(STATUS_WON));
        assert_eq!(map_legacy_proposal_status("Proposal sent to Hassan for review"), Some(STATUS_REVIEW));
        assert_eq!(map_legacy_proposal_status("Closed"), Some(STATUS_LOST));
        assert_eq!(map_legacy_proposal_status(STATUS_SENT), None);
        for s in PROPOSAL_STATUSES {
            assert!(map_legacy_proposal_status(s).is_none() || map_legacy_proposal_status(s) == Some(STATUS_REQUEST));
        }
    }

    #[test]
    fn folder_names_match_loosely_and_stay_safe() {
        assert_eq!(folder_key("Al-Futtaim L.L.C."), folder_key("al futtaim llc"));
        assert_eq!(safe_folder_name("A/B: Co."), "A B Co");
    }
}

// ═══════════════════ Merging services ═══════════════════
// The catalogue grew the same service under several names (Company
// Constitution / Business Setup, Workforce / Employer of Record, PRO / Admin
// PRO). Merging points every line at the surviving service while leaving the
// line's own `service_name` text alone, so a proposal sent two years ago still
// reads exactly as it was sent. The retired service keeps its row (marked
// inactive, pointing at the survivor) — nothing is deleted.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMergeResult {
    pub proposal_lines: usize,
    pub agreement_lines: usize,
    pub survivor: Service,
}

/// How many records still name a service — shown before a merge is confirmed.
#[tauri::command]
pub fn service_usage(state: State<DbState>, id: i64) -> CmdResult<(i64, i64)> {
    let conn = state.0.lock().map_err(err)?;
    let name: String = conn.query_row("SELECT name FROM services WHERE id = ?1", params![id], |r| r.get(0)).map_err(err)?;
    let proposals: i64 = conn
        .query_row("SELECT COUNT(*) FROM proposal_lines WHERE service_id = ?1 OR service_name = ?2", params![id, name], |r| r.get(0))
        .map_err(err)?;
    let agreements: i64 = conn
        .query_row("SELECT COUNT(*) FROM agreement_lines WHERE service_id = ?1 OR service_name = ?2", params![id, name], |r| r.get(0))
        .map_err(err)?;
    Ok((proposals, agreements))
}

#[tauri::command]
pub fn merge_services(state: State<DbState>, from_id: i64, to_id: i64) -> CmdResult<ServiceMergeResult> {
    if from_id == to_id {
        return Err("Pick a different service to merge into.".into());
    }
    let conn = state.0.lock().map_err(err)?;
    let from_name: String = conn
        .query_row("SELECT name FROM services WHERE id = ?1", params![from_id], |r| r.get(0))
        .map_err(|_| "That service no longer exists.".to_string())?;
    let to_name: String = conn
        .query_row("SELECT name FROM services WHERE id = ?1", params![to_id], |r| r.get(0))
        .map_err(|_| "The service to merge into no longer exists.".to_string())?;

    // Lines keep the name they were written with; only the link moves.
    let proposal_lines = conn
        .execute(
            "UPDATE proposal_lines SET service_id = ?1 WHERE service_id = ?2 OR (service_id IS NULL AND service_name = ?3)",
            params![to_id, from_id, from_name],
        )
        .map_err(err)?;
    let agreement_lines = conn
        .execute(
            "UPDATE agreement_lines SET service_id = ?1 WHERE service_id = ?2 OR (service_id IS NULL AND service_name = ?3)",
            params![to_id, from_id, from_name],
        )
        .map_err(err)?;
    conn.execute(
        "UPDATE services SET active = 0, merged_into = ?1, updated_at = ?2 WHERE id = ?3",
        params![to_id, now_iso(), from_id],
    )
    .map_err(err)?;

    let survivor = read_services(&conn)
        .map_err(err)?
        .into_iter()
        .find(|s| s.id == to_id)
        .ok_or_else(|| format!("\"{to_name}\" could not be read back after the merge."))?;
    Ok(ServiceMergeResult { proposal_lines, agreement_lines, survivor })
}
