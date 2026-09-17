//! Opportunities (Core Refinement & Product Maturity, Stage 2) — the app's
//! first proper Company entity backs `Opportunity.company_id` as a real FK,
//! but the frontend never deals with Company ids directly: it sends a plain
//! `companyName` string on save and this module resolves-or-creates the
//! matching `companies` row itself, mirroring the free-text-company UX every
//! other entity in the app already has. `stage` is the 11-value pipeline
//! position (including terminal Won/Lost/On Hold); `status` is a small
//! derived Open/Won/Lost/On Hold rollup recomputed here on every save so
//! there's no second field the caller has to keep in sync themselves.

use crate::db::DbState;
use crate::v2_models::{Company, Opportunity, OpportunityActivity};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const OPP_COLUMNS: &str = "o.id, o.name, o.company_id, c.name, o.owner, o.stage, o.status, o.estimated_value, \
    o.currency, o.probability, o.expected_close_date, o.description, o.next_action, o.proposal_id, o.project_id, \
    o.sort_order, o.archived, o.created_at, o.updated_at, o.business_entity_id, o.win_loss_reason";

fn row_to_opportunity(r: &rusqlite::Row) -> rusqlite::Result<Opportunity> {
    Ok(Opportunity {
        id: r.get(0)?, name: r.get(1)?, company_id: r.get(2)?, company_name: r.get(3)?,
        owner: r.get(4)?, stage: r.get(5)?, status: r.get(6)?, estimated_value: r.get(7)?,
        currency: r.get(8)?, probability: r.get(9)?, expected_close_date: r.get(10)?,
        description: r.get(11)?, next_action: r.get(12)?, proposal_id: r.get(13)?,
        project_id: r.get(14)?, sort_order: r.get(15)?, archived: r.get::<_, i64>(16)? != 0,
        created_at: r.get(17)?, updated_at: r.get(18)?, business_entity_id: r.get(19)?, win_loss_reason: r.get(20)?, tags: Vec::new(),
    })
}

fn stage_to_status(stage: &str) -> &'static str {
    match stage {
        "Won" => "Won",
        "Lost" => "Lost",
        "On Hold" => "On Hold",
        _ => "Open",
    }
}

// ═══════════════ Company identity ═══════════════
//
// IDs identify companies; names are attributes. A record's `company_id` is
// its company. Records also keep the company's name as text (typed in forms,
// shown in lists, used in exports and documents), and a save decides the
// company like this (`company_for_save`):
//
//   * Existing record, company text unchanged → it keeps its `company_id`,
//     whatever the text would match on its own. Links set by id (the review
//     queue, folder linking, a rename) are never undone by a later save.
//   * New record that already carries a `company_id` → that id.
//   * Company text edited, or a record with no usable link → the text is
//     resolved: the current company if the text is its name, legal name or a
//     former name; then an exact name, the same name ignoring capitals, a
//     unique legal name, a former name (`company_aliases`); else a new company.
//
// Former names are written by rename, merge and the review queue, so an old
// name arriving later finds the company instead of re-creating the one that
// was renamed or merged away. Similar-but-different names ("Acme" / "Acme
// LLC") are never joined: the integrity report and the Companies list flag
// them for a person to merge. A record whose text names a different company
// than its link is left as it is and reported, never silently re-pointed.

fn trimmed(name: Option<&str>) -> Option<&str> {
    name.map(str::trim).filter(|n| !n.is_empty())
}

fn same_text(a: Option<&str>, b: Option<&str>) -> bool {
    trimmed(a).map(str::to_lowercase) == trimmed(b).map(str::to_lowercase)
}

fn company_exists(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", params![id], |r| r.get(0))
}

/// Whether `name` is this company's name, legal name or one of its former names.
pub fn name_refers_to(conn: &Connection, company_id: i64, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1 AND (name = ?2 COLLATE NOCASE OR legal_name = ?2 COLLATE NOCASE))
             OR EXISTS(SELECT 1 FROM company_aliases WHERE company_id = ?1 AND alias = ?2)",
        params![company_id, name.trim()],
        |r| r.get(0),
    )
}

/// What a company name matches.
#[derive(Debug, Clone, PartialEq)]
pub enum CompanyMatch {
    /// Exactly one company.
    One(i64),
    /// More than one company, with nothing to choose between them.
    Ambiguous(Vec<i64>),
    None,
}

/// The company a name refers to, without creating anything. Strongest first:
/// exact name; the same name ignoring capitals; legal name; former name. Two
/// companies matching at the same strength is ambiguous — never guessed.
pub fn match_company_name(conn: &Connection, name: &str) -> rusqlite::Result<CompanyMatch> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(CompanyMatch::None);
    }
    if let Some(id) = conn.query_row("SELECT id FROM companies WHERE name = ?1", params![name], |r| r.get(0)).optional()? {
        return Ok(CompanyMatch::One(id));
    }
    let ids = |sql: &str| -> rusqlite::Result<Vec<i64>> { conn.prepare(sql)?.query_map(params![name], |r| r.get(0))?.collect() };
    for sql in [
        "SELECT id FROM companies WHERE name = ?1 COLLATE NOCASE ORDER BY id",
        "SELECT id FROM companies WHERE legal_name = ?1 COLLATE NOCASE ORDER BY id",
        "SELECT company_id FROM company_aliases WHERE alias = ?1",
    ] {
        let found = ids(sql)?;
        match found.len() {
            0 => continue,
            1 => return Ok(CompanyMatch::One(found[0])),
            _ => return Ok(CompanyMatch::Ambiguous(found)),
        }
    }
    Ok(CompanyMatch::None)
}

/// The company a name refers to (preferring `hint` when the name is one of its
/// names), without creating anything. None when nothing or several match.
pub fn find_company(conn: &Connection, hint: Option<i64>, name: Option<&str>) -> rusqlite::Result<Option<i64>> {
    let Some(name) = trimmed(name) else { return Ok(None) };
    if let Some(id) = hint {
        if name_refers_to(conn, id, name)? {
            return Ok(Some(id));
        }
    }
    Ok(match match_company_name(conn, name)? {
        CompanyMatch::One(id) => Some(id),
        _ => None,
    })
}

fn insert_company(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    // Former names stay: records linked to the renamed company keep meaning it
    // (the link is checked first), while new text finds this company by its name.
    conn.execute("INSERT INTO companies (name, created_at) VALUES (?1, ?2)", params![name, crate::commands::now_iso()])?;
    Ok(conn.last_insert_rowid())
}

/// Resolves company text (see the rules above); `hint` is the company the
/// record is linked to now. Empty name => no company. An ambiguous name keeps
/// the current link; with no link it is queued for review and left unlinked.
pub fn resolve_company_ref(conn: &Connection, hint: Option<i64>, name: Option<&str>) -> rusqlite::Result<Option<i64>> {
    let Some(name) = trimmed(name) else { return Ok(None) };
    let hint = match hint {
        Some(id) if company_exists(conn, id)? => Some(id),
        _ => None,
    };
    if let Some(id) = hint {
        if name_refers_to(conn, id, name)? {
            return Ok(Some(id));
        }
    }
    match match_company_name(conn, name)? {
        CompanyMatch::One(id) => Ok(Some(id)),
        CompanyMatch::Ambiguous(candidates) => {
            if hint.is_some() {
                return Ok(hint);
            }
            crate::company_migration::queue_for_review(conn, name, candidates.first().copied(), &crate::commands::now_iso())?;
            Ok(None)
        }
        CompanyMatch::None => insert_company(conn, name).map(Some),
    }
}

/// Find-or-create by name alone, for records with no link at all (imports,
/// the folder-linking wizard).
pub(crate) fn resolve_company(conn: &Connection, name: Option<&str>) -> rusqlite::Result<Option<i64>> {
    resolve_company_ref(conn, None, name)
}

/// An explicit "new company": an existing company with that name (ignoring
/// case) is returned, but a former name doesn't count — the person means a
/// new company, not the one that used to be called that.
pub fn create_company_named(conn: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    let Some(name) = trimmed(Some(name)) else { return Ok(None) };
    if let Some(id) = conn.query_row("SELECT id FROM companies WHERE name = ?1", params![name], |r| r.get(0)).optional()? {
        return Ok(Some(id));
    }
    let same: Vec<i64> = conn.prepare("SELECT id FROM companies WHERE name = ?1 COLLATE NOCASE")?.query_map(params![name], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    match same.len() {
        0 => insert_company(conn, name).map(Some),
        1 => Ok(Some(same[0])),
        // Several companies differ from it only by capitals: don't pick one, don't add another.
        _ => Ok(None),
    }
}

/// A record's company as stored before a save.
#[derive(Debug, Clone, Default)]
pub struct PriorCompany {
    pub id: Option<i64>,
    pub text: Option<String>,
}

/// The stored company link and company text of a row, read before it is
/// written. `text_col` is None for opportunities, whose company text is the
/// linked company's name. None when the row doesn't exist yet.
pub fn prior_company(conn: &Connection, table: &str, text_col: Option<&str>, id: i64) -> rusqlite::Result<Option<PriorCompany>> {
    if id <= 0 {
        return Ok(None);
    }
    let sql = match text_col {
        Some(col) => format!("SELECT company_id, {col} FROM {table} WHERE id = ?1"),
        None => format!("SELECT t.company_id, c.name FROM {table} t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ?1"),
    };
    conn.query_row(&sql, params![id], |r| Ok(PriorCompany { id: r.get(0)?, text: r.get(1)? })).optional()
}

/// The company a record being saved belongs to (see the rules above).
/// `payload_id` is the `company_id` the record arrived with.
pub fn company_for_save(conn: &Connection, prior: Option<&PriorCompany>, payload_id: Option<i64>, text: Option<&str>) -> rusqlite::Result<Option<i64>> {
    match prior {
        Some(p) => {
            if same_text(p.text.as_deref(), text) {
                if let Some(id) = p.id {
                    if company_exists(conn, id)? {
                        return Ok(Some(id));
                    }
                }
            }
            resolve_company_ref(conn, p.id, text)
        }
        None => {
            if let (Some(id), Some(_)) = (payload_id, trimmed(text)) {
                if company_exists(conn, id)? {
                    return Ok(Some(id));
                }
            }
            resolve_company_ref(conn, None, text)
        }
    }
}

/// Sets `table.company_id` for a row just written, from its company as it was
/// before the write (`prior`). Leaves the row alone when the link is already
/// right, so an unchanged save doesn't count as an edit.
pub(crate) fn link_company(conn: &Connection, table: &str, id: i64, prior: Option<&PriorCompany>, payload_id: Option<i64>, name: Option<&str>) -> rusqlite::Result<()> {
    let company_id = company_for_save(conn, prior, payload_id, name)?;
    conn.execute(
        &format!("UPDATE {table} SET company_id = ?1 WHERE id = ?2 AND company_id IS NOT ?1"),
        params![company_id, id],
    )?;
    Ok(())
}

/// Remembers `alias` as a former name of `company_id`.
pub fn remember_company_alias(conn: &Connection, company_id: i64, alias: &str) -> rusqlite::Result<()> {
    let Some(alias) = trimmed(Some(alias)) else { return Ok(()) };
    let current: Option<String> = conn.query_row("SELECT name FROM companies WHERE id = ?1", params![company_id], |r| r.get(0)).optional()?;
    if current.as_deref().is_some_and(|n| n.eq_ignore_ascii_case(alias)) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO company_aliases (alias, company_id, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(alias) DO UPDATE SET company_id = excluded.company_id, created_at = excluded.created_at",
        params![alias, company_id, crate::commands::now_iso()],
    )?;
    Ok(())
}

fn log_activity(tx: &Connection, opportunity_id: i64, kind: &str, detail: Option<&str>) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO opportunity_activity (opportunity_id, kind, detail, created_at) VALUES (?1,?2,?3,?4)",
        params![opportunity_id, kind, detail, crate::commands::now_iso()],
    )?;
    Ok(())
}

const COMPANY_COLUMNS: &str = "id, name, legal_name, website, country, city, company_type, status, owner, \
    description, archived, created_at, updated_at";

fn row_to_company_base(r: &rusqlite::Row) -> rusqlite::Result<Company> {
    Ok(Company {
        id: r.get(0)?, name: r.get(1)?, legal_name: r.get(2)?, industries: Vec::new(),
        website: r.get(3)?, country: r.get(4)?, city: r.get(5)?, company_type: r.get(6)?,
        status: r.get(7)?, owner: r.get(8)?, description: r.get(9)?,
        archived: r.get::<_, i64>(10)? != 0, created_at: r.get(11)?, updated_at: r.get(12)?,
    })
}

/// Fills in `industries` for a batch of companies with exactly 2 queries
/// total regardless of how many companies are passed — same shape as
/// get_opportunities' entity_tags join below, not a per-row N+1.
fn hydrate_industries(conn: &Connection, companies: &mut [Company]) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("SELECT company_id, industry FROM company_industries ORDER BY industry")?;
    let mut by_company: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, industry) = row?;
        by_company.entry(id).or_default().push(industry);
    }
    for c in companies.iter_mut() {
        if let Some(list) = by_company.remove(&c.id) { c.industries = list; }
    }
    Ok(())
}

pub(crate) fn read_company(conn: &Connection, id: i64) -> rusqlite::Result<Company> {
    let sql = format!("SELECT {COMPANY_COLUMNS} FROM companies WHERE id = ?1");
    let mut c = conn.query_row(&sql, params![id], row_to_company_base)?;
    hydrate_industries(conn, std::slice::from_mut(&mut c))?;
    Ok(c)
}

#[tauri::command]
pub fn get_companies(state: State<DbState>) -> CmdResult<Vec<Company>> {
    let conn = state.0.lock().map_err(err)?;
    let sql = format!("SELECT {COMPANY_COLUMNS} FROM companies ORDER BY name");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let mut companies: Vec<Company> = stmt.query_map([], row_to_company_base).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;
    hydrate_industries(&conn, &mut companies).map_err(err)?;
    Ok(companies)
}

/// Explicit "create a company" entry point for the New-item menu — every
/// other place a Company "appears" is implicit (typing a new name into a
/// free-text company field on a Proposal/Contact/etc.), which only shows up
/// in the Companies list once something else references it. This is the one
/// path that creates a bare company with nothing else attached yet, reusing
/// resolve_company's exact find-or-create semantics (so re-submitting an
/// existing name is a harmless no-op, not a duplicate).
#[tauri::command]
pub fn create_company(state: State<DbState>, name: String) -> CmdResult<Company> {
    let conn = state.0.lock().map_err(err)?;
    let id = create_company_named(&conn, &name)
        .map_err(err)?
        .ok_or_else(|| if name.trim().is_empty() { "Company name cannot be empty.".to_string() } else { "More than one company already has that name (ignoring capitals) — open the existing one instead.".to_string() })?;
    let sql = format!("SELECT {COMPANY_COLUMNS} FROM companies WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_company_base).map_err(err)
}

/// Full Company edit — the canonical entity's own fields (name change goes
/// through the existing rename/merge flow, not this command, since renaming
/// has to reconcile every free-text mirror column too; this only touches
/// columns that live solely on the `companies` row itself).
#[tauri::command]
pub fn save_company(state: State<DbState>, company: Company) -> CmdResult<Company> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let now = crate::commands::now_iso();
    tx.execute(
        &format!(
            "UPDATE companies SET legal_name=?2, website=?3, country=?4, city=?5, company_type=?6, status=?7, \
                owner=?8, owner_id={owner_id}, description=?9, archived=?10, updated_at=?11 WHERE id=?1",
            owner_id = crate::identity::owner_id_for_name_sql(8)
        ),
        params![
            company.id, company.legal_name, company.website, company.country, company.city,
            company.company_type, company.status, company.owner, company.description,
            company.archived as i64, now,
        ],
    ).map_err(err)?;
    tx.execute("DELETE FROM company_industries WHERE company_id = ?1", params![company.id]).map_err(err)?;
    for industry in &company.industries {
        tx.execute(
            "INSERT OR IGNORE INTO company_industries (company_id, industry) VALUES (?1, ?2)",
            params![company.id, industry],
        ).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    drop(conn);
    let conn2 = state.0.lock().map_err(err)?;
    let sql = format!("SELECT {COMPANY_COLUMNS} FROM companies WHERE id = ?1");
    let mut c = conn2.query_row(&sql, params![company.id], row_to_company_base).map_err(err)?;
    hydrate_industries(&conn2, std::slice::from_mut(&mut c)).map_err(err)?;
    Ok(c)
}

/// Reconciles the numeric `companies` table (and everything that references
/// it by id — `entity_links` rows of to_type='company', and every entity's
/// `company_id` column: opportunities, and since the Company Master Data
/// migration, contacts/proposals/agreements/projects too) after a free-text
/// company rename or merge (see companies.ts's reassignCompanyName/
/// confirmMergeCompanies, which handle every OTHER free-text company column
/// — this command only owns the numeric-id side). Three cases:
///  - Neither `old_name` nor `new_name` has a `companies` row: nothing to do.
///  - Only `old_name` has a row: rename it in place (UPDATE, not delete+
///    recreate) so its id and every existing reference to it keeps
///    resolving correctly under the new name.
///  - Both exist: repoint every id-based reference from the old row's id to
///    the new row's id, then delete the now-orphaned old row (and its
///    industries, which would otherwise dangle). UPDATE OR IGNORE on
///    entity_links/company_industries guards their UNIQUE constraints in the
///    rare case the same link/industry already exists on both companies;
///    leftover duplicate rows still pointing at old_id afterward are deleted
///    explicitly (safe — their non-duplicate counterpart already points at
///    new_id).
#[tauri::command]
pub fn merge_company_links(state: State<DbState>, old_name: String, new_name: String) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    merge_company_links_core(&mut conn, &old_name, &new_name)
}

pub fn merge_company_links_core(conn: &mut Connection, old_name: &str, new_name: &str) -> CmdResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let old_id: Option<i64> = tx
        .query_row("SELECT id FROM companies WHERE name = ?1", params![old_name], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let new_id: Option<i64> = tx
        .query_row("SELECT id FROM companies WHERE name = ?1", params![new_name], |r| r.get(0))
        .optional()
        .map_err(err)?;

    match (old_id, new_id) {
        (None, _) => {}
        (Some(oid), None) => {
            tx.execute("UPDATE companies SET name = ?1 WHERE id = ?2", params![new_name, oid]).map_err(err)?;
            tx.execute("DELETE FROM company_aliases WHERE alias = ?1", params![new_name]).map_err(err)?;
            remember_company_alias(&tx, oid, &old_name).map_err(err)?;
        }
        (Some(oid), Some(nid)) => {
            tx.execute(
                "UPDATE OR IGNORE entity_links SET to_id = ?1 WHERE to_type = 'company' AND to_id = ?2",
                params![nid, oid],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM entity_links WHERE to_type = 'company' AND to_id = ?1", params![oid]).map_err(err)?;
            tx.execute("UPDATE opportunities SET company_id = ?1 WHERE company_id = ?2", params![nid, oid]).map_err(err)?;
            tx.execute("UPDATE contacts SET company_id = ?1 WHERE company_id = ?2", params![nid, oid]).map_err(err)?;
            tx.execute("UPDATE proposals SET company_id = ?1 WHERE company_id = ?2", params![nid, oid]).map_err(err)?;
            tx.execute("UPDATE agreements SET company_id = ?1 WHERE company_id = ?2", params![nid, oid]).map_err(err)?;
            tx.execute("UPDATE projects SET company_id = ?1 WHERE company_id = ?2", params![nid, oid]).map_err(err)?;
            for table in ["meetings", "notes", "todos", "intelligence_items", "emails", "documents", "activity"] {
                tx.execute(&format!("UPDATE {table} SET company_id = ?1 WHERE company_id = ?2"), params![nid, oid]).map_err(err)?;
            }
            tx.execute(
                "INSERT OR IGNORE INTO company_industries (company_id, industry) SELECT ?1, industry FROM company_industries WHERE company_id = ?2",
                params![nid, oid],
            ).map_err(err)?;
            tx.execute("DELETE FROM company_industries WHERE company_id = ?1", params![oid]).map_err(err)?;
            tx.execute("UPDATE OR IGNORE company_list_members SET company_id = ?1 WHERE company_id = ?2", params![nid, oid]).map_err(err)?;
            // The merged-away name (and its own former names) now mean the company it went into.
            tx.execute("UPDATE company_aliases SET company_id = ?1 WHERE company_id = ?2", params![nid, oid]).map_err(err)?;
            // Notes of the merged-away company move over unless the surviving one has its own
            // (the Merge dialog has already combined the text into it).
            tx.execute(
                "UPDATE company_notes SET company_id = ?1 WHERE company_id = ?2 AND NOT EXISTS (SELECT 1 FROM company_notes WHERE company_id = ?1)",
                params![nid, oid],
            ).map_err(err)?;
            tx.execute("DELETE FROM company_list_members WHERE company_id = ?1", params![oid]).map_err(err)?;
            tx.execute("DELETE FROM companies WHERE id = ?1", params![oid]).map_err(err)?;
            remember_company_alias(&tx, nid, &old_name).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn get_opportunities(state: State<DbState>) -> CmdResult<Vec<Opportunity>> {
    let conn = state.0.lock().map_err(err)?;
    let sql = format!(
        "SELECT {OPP_COLUMNS} FROM opportunities o LEFT JOIN companies c ON c.id = o.company_id \
         WHERE o.archived = 0 ORDER BY COALESCE(o.sort_order, o.id)"
    );
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let mut opps: Vec<Opportunity> = stmt.query_map([], row_to_opportunity).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;

    let mut tstmt = conn.prepare("SELECT entity_id, tag FROM entity_tags WHERE entity_type = 'opportunity' ORDER BY tag").map_err(err)?;
    let mut by_opp: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    let trows = tstmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(err)?;
    for row in trows {
        let (id, tag) = row.map_err(err)?;
        by_opp.entry(id).or_default().push(tag);
    }
    for o in opps.iter_mut() {
        if let Some(tags) = by_opp.remove(&o.id) { o.tags = tags; }
    }
    Ok(opps)
}

#[tauri::command]
pub fn save_opportunity(state: State<DbState>, opportunity: Opportunity) -> CmdResult<Opportunity> {
    let mut conn = state.0.lock().map_err(err)?;
    save_opportunity_row(&mut conn, &opportunity)
}

pub fn save_opportunity_row(conn: &mut Connection, opportunity: &Opportunity) -> CmdResult<Opportunity> {
    let tx = conn.transaction().map_err(err)?;
    let now = crate::commands::now_iso();
    let prior = prior_company(&tx, "opportunities", None, opportunity.id).map_err(err)?;
    let company_id = company_for_save(&tx, prior.as_ref(), opportunity.company_id, opportunity.company_name.as_deref()).map_err(err)?;
    let status = stage_to_status(&opportunity.stage);

    let prev: Option<(String, Option<i64>, Option<i64>)> = if opportunity.id > 0 {
        tx.query_row(
            "SELECT stage, proposal_id, project_id FROM opportunities WHERE id = ?1",
            params![opportunity.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional().map_err(err)?
    } else {
        None
    };
    let is_new = opportunity.id == 0;
    let prev_stage = prev.as_ref().map(|p| p.0.clone());
    let proposal_newly_linked = matches!(prev, Some((_, None, _))) && opportunity.proposal_id.is_some();
    let project_newly_linked = matches!(prev, Some((_, _, None))) && opportunity.project_id.is_some();

    let id = if opportunity.id > 0 {
        tx.execute(
            &format!(
                "UPDATE opportunities SET name=?2, company_id=?3, owner=?4, owner_id={owner_id}, stage=?5, status=?6, estimated_value=?7,
                    currency=?8, probability=?9, expected_close_date=?10, description=?11, next_action=?12,
                    proposal_id=?13, project_id=?14, sort_order=?15, archived=?16, updated_at=?17, business_entity_id=?18, win_loss_reason=?19 WHERE id=?1",
                owner_id = crate::identity::owner_id_for_name_sql(4)
            ),
            params![
                opportunity.id, opportunity.name, company_id, opportunity.owner, opportunity.stage, status,
                opportunity.estimated_value, opportunity.currency, opportunity.probability, opportunity.expected_close_date,
                opportunity.description, opportunity.next_action, opportunity.proposal_id, opportunity.project_id,
                opportunity.sort_order, opportunity.archived as i64, now, opportunity.business_entity_id, opportunity.win_loss_reason,
            ],
        ).map_err(err)?;
        opportunity.id
    } else {
        tx.execute(
            &format!(
                "INSERT INTO opportunities (name, company_id, owner, owner_id, stage, status, estimated_value, currency, probability,
                    expected_close_date, description, next_action, proposal_id, project_id, sort_order, archived, created_at, updated_at, business_entity_id, win_loss_reason)
                 VALUES (?1,?2,?3,{owner_id},?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16,COALESCE(?17,(SELECT id FROM business_entities WHERE code = 'KSA')),?18)",
                owner_id = crate::identity::owner_id_for_name_sql(3)
            ),
            params![
                opportunity.name, company_id, opportunity.owner, opportunity.stage, status, opportunity.estimated_value,
                opportunity.currency, opportunity.probability, opportunity.expected_close_date, opportunity.description,
                opportunity.next_action, opportunity.proposal_id, opportunity.project_id, opportunity.sort_order,
                opportunity.archived as i64, now, opportunity.business_entity_id, opportunity.win_loss_reason,
            ],
        ).map_err(err)?;
        tx.last_insert_rowid()
    };

    tx.execute("DELETE FROM entity_tags WHERE entity_type='opportunity' AND entity_id=?1", params![id]).map_err(err)?;
    for tag in &opportunity.tags {
        tx.execute("INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag) VALUES ('opportunity', ?1, ?2)", params![id, tag]).map_err(err)?;
    }

    if is_new {
        log_activity(&tx, id, "created", None).map_err(err)?;
    } else if prev_stage.as_deref() != Some(opportunity.stage.as_str()) {
        let detail = format!("{} → {}", prev_stage.unwrap_or_default(), opportunity.stage);
        log_activity(&tx, id, "stage_changed", Some(&detail)).map_err(err)?;
    }
    if !is_new && proposal_newly_linked {
        log_activity(&tx, id, "proposal_linked", None).map_err(err)?;
    }
    if !is_new && project_newly_linked {
        log_activity(&tx, id, "project_created", None).map_err(err)?;
    }

    crate::v2_search::reindex_opportunity(&tx, id).map_err(err)?;
    tx.commit().map_err(err)?;

    let conn2 = &*conn;
    let sql = format!(
        "SELECT {OPP_COLUMNS} FROM opportunities o LEFT JOIN companies c ON c.id = o.company_id WHERE o.id = ?1"
    );
    conn2.query_row(&sql, params![id], row_to_opportunity).map_err(err)
}

#[tauri::command]
pub fn delete_opportunity(state: State<DbState>, id: i64) -> CmdResult<()> {
    let mut conn = state.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM opportunities WHERE id = ?1", params![id]).map_err(err)?;
    tx.execute("DELETE FROM opportunity_activity WHERE opportunity_id = ?1", params![id]).map_err(err)?;
    tx.execute("DELETE FROM entity_tags WHERE entity_type='opportunity' AND entity_id=?1", params![id]).map_err(err)?;
    tx.execute("DELETE FROM entity_links WHERE (from_type='opportunity' AND from_id=?1) OR (to_type='opportunity' AND to_id=?1)", params![id]).map_err(err)?;
    tx.execute("DELETE FROM search_index WHERE entity_type='opportunity' AND entity_id=?1", params![id]).map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn get_opportunity_activity(state: State<DbState>, opportunity_id: i64) -> CmdResult<Vec<OpportunityActivity>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(
        "SELECT id, opportunity_id, kind, detail, created_at FROM opportunity_activity WHERE opportunity_id = ?1 ORDER BY id DESC",
    ).map_err(err)?;
    let rows = stmt.query_map(params![opportunity_id], |r| {
        Ok(OpportunityActivity { id: r.get(0)?, opportunity_id: r.get(1)?, kind: r.get(2)?, detail: r.get(3)?, created_at: r.get(4)? })
    }).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}
