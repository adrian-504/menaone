//! The agreements import (the agreements review's IMPORT_SPEC v1.1, §5).
//!
//! Reads the review's bundle (JSON files, client data — never in this repo)
//! and applies it in one transaction: companies and aliases, groups, library
//! folders, agreements (merge / absorb / remove / review / insert) with their
//! chains, price lines, documents, and monthly billing. It returns a report of
//! everything it did and everything that needs a decision, so the same code
//! produces the dry run (against a copy of the database) and, once the owner
//! has approved that report, the real import.
//!
//! Rules it rests on (owner rulings in the spec): a company is the entity we
//! invoice; live = service active and invoiced, even without countersignature;
//! an agreement whose term has ended but is still billed is exposure; the
//! monthly figure is the May–Jul 2026 invoicing average; absence of evidence
//! never blanks a field.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

type Res<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// What the import is allowed to decide by itself.
#[derive(Debug, Clone)]
pub struct ImportOptions {
    /// The local OneDrive root (document paths are relative to it); None skips folder links.
    pub onedrive_root: Option<PathBuf>,
    /// The agreements library, which clients' `libraryFolder` paths are relative to
    /// (relative to the OneDrive root).
    pub library_dir: Option<String>,
    /// "Today", for ended/expired checks.
    pub today: String,
    /// Owner decision: whether the removed clients' company records go too.
    pub remove_company_records: bool,
}

// ── Report ──────────────────────────────────────────────────────────────────

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyLine {
    pub company_key: String,
    pub name: String,
    pub company_id: Option<i64>,
    pub action: String,
    pub aliases_added: usize,
    pub note: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgreementLine {
    pub import_key: String,
    pub agr_ref: Option<String>,
    pub company: String,
    pub action: String,
    pub app_id: Option<i64>,
    pub status: String,
    pub service_status: Option<String>,
    pub monthly_fee: Option<f64>,
    pub fee_basis: String,
    pub end_date: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedLine {
    pub app_id: i64,
    pub client: String,
    pub agr_ref: Option<String>,
    pub proposal_id: Option<i64>,
    pub proposal_status: Option<String>,
    /// A proposal signed by both recreates the draft on the next "Draft from proposals".
    pub would_be_recreated: bool,
    pub company_other_records: i64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub companies: Vec<CompanyLine>,
    pub groups: Vec<(String, i64, usize)>,
    pub folders_linked: usize,
    pub folders_missing: Vec<String>,
    pub agreements: Vec<AgreementLine>,
    pub absorbed: Vec<(i64, String)>,
    pub removed: Vec<RemovedLine>,
    pub review: Vec<(i64, String, String)>,
    pub untouched_app_rows: Vec<(i64, Option<String>, String, Option<String>)>,
    /// Old-tracker rows duplicating a reviewed agreement: (row, reference, absorbed into).
    pub tracker_duplicates: Vec<(i64, String, i64)>,
    pub lines_written: usize,
    pub lines_unmapped_services: BTreeMap<String, usize>,
    pub documents_linked: usize,
    pub documents_company_only: usize,
    pub documents_unplaced: usize,
    pub documents_missing_files: Vec<String>,
    pub billing_rows: usize,
    pub billing_total: f64,
    pub billing_unmapped_services: BTreeMap<String, usize>,
    pub billing_future_months: Vec<(String, f64)>,
    pub mena_entities: BTreeMap<String, usize>,
    pub types_outside_list: BTreeMap<String, usize>,
    pub types_inferred: usize,
    pub notes: Vec<String>,
}

// ── Bundle ──────────────────────────────────────────────────────────────────

pub struct Bundle {
    pub clients: Vec<Value>,
    pub matches: Vec<Value>,
    pub groups: Vec<Value>,
    pub agreements: Vec<Value>,
    pub lines: Vec<Value>,
    pub documents: Vec<Value>,
    pub billing: Vec<Value>,
    pub services: Vec<Value>,
    pub collisions: Vec<Value>,
}

fn read_json(dir: &Path, name: &str) -> Res<Value> {
    let text = std::fs::read_to_string(dir.join(name)).map_err(|e| format!("{name}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{name}: {e}"))
}

fn list(v: Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a,
        _ => Vec::new(),
    }
}

impl Bundle {
    pub fn read(dir: &Path) -> Res<Bundle> {
        let matches = read_json(dir, "app_company_matches.json")?;
        Ok(Bundle {
            clients: list(read_json(dir, "clients.json")?),
            matches: list(matches.get("matches").cloned().unwrap_or(Value::Null)),
            groups: list(read_json(dir, "company_groups.json")?),
            agreements: list(read_json(dir, "agreements.json")?),
            lines: list(read_json(dir, "agreement_lines.json")?),
            documents: list(read_json(dir, "agreement_documents.json")?),
            billing: list(read_json(dir, "billing_monthly.json")?),
            services: list(read_json(dir, "company_services.json")?),
            collisions: list(read_json(dir, "app_row_collisions.json")?),
        })
    }
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty())
}
fn i(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(Value::as_i64)
}
fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}
fn b(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_bool).unwrap_or(false)
}
fn strs(v: &Value, k: &str) -> Vec<String> {
    v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.trim().to_string())).filter(|x| !x.is_empty()).collect()).unwrap_or_default()
}
/// References compare without punctuation or case ("ACME_001_0125" = "acme-001-0125").
fn norm(x: &str) -> String {
    x.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_uppercase()
}

const RENEWAL_RULES: &[&str] = &["auto", "client_must_request", "mutual", "extension_by_notice", "fixed", "project", "open_ended"];
/// The agreement type a free-text service label points to ("Admin PRO", "Accountancy-VAT",
/// "Labour-Law"), by its leading words; None when the label doesn't say (e.g. "Multi").
fn type_from_label(label: &str) -> Option<&'static str> {
    let l = label.to_lowercase();
    const RULES: &[(&[&str], &str)] = &[
        (&["company maintenance", "maintenance"], "Company Maintenance"),
        (&["company constitution", "business setup"], "Company Constitution"),
        (&["accountancy", "e-invoicing", "vat", "wht"], "Accountancy"),
        (&["workforce", "mobilization", "national staffing"], "Workforce"),
        (&["admin", "pro", "iqama", "visa", "block visa"], "Administration"),
        (&["labour", "labor", "consultancy", "advisory", "hr consultancy", "regulatory"], "Consultancy"),
    ];
    RULES.iter().find(|(words, _)| words.iter().any(|w| l == *w || l.starts_with(&format!("{w} ")) || l.starts_with(&format!("{w}-")) || l.starts_with(&format!("{w}/")) || l.starts_with(&format!("{w}s")) || l.starts_with(&format!("{w} (")))).map(|(_, t)| *t)
}

const AGR_TYPES: &[&str] = &["Workforce", "Administration", "Accountancy", "Company Maintenance", "Company Constitution", "Consultancy", "Other"];
const MAY_JUL: &[&str] = &["2026-05", "2026-06", "2026-07"];

// ── The import ──────────────────────────────────────────────────────────────

pub fn run(conn: &mut Connection, bundle: &Bundle, opts: &ImportOptions) -> Res<ImportReport> {
    crate::activity::with_activity_muted(conn, |conn| {
        let tx = conn.transaction()?;
        let report = apply(&tx, bundle, opts).map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
        tx.commit()?;
        Ok(report)
    })
    .map_err(err)
}

fn now() -> String {
    crate::commands::now_iso()
}

fn apply(tx: &Connection, bundle: &Bundle, opts: &ImportOptions) -> Res<ImportReport> {
    let mut report = ImportReport::default();
    let clients: HashMap<String, &Value> = bundle.clients.iter().filter_map(|c| s(c, "key").map(|k| (k.to_string(), c))).collect();

    // 1. Companies ------------------------------------------------------------
    let mut company_of: HashMap<String, i64> = HashMap::new();
    for (n, m) in bundle.matches.iter().enumerate() {
        let key = s(m, "companyKey").unwrap_or_default().to_string();
        let name = s(m, "displayName").unwrap_or(&key).to_string();
        let action = s(m, "action").unwrap_or("SKIP").to_string();
        let mut line = CompanyLine { company_key: key.clone(), name: name.clone(), action: action.clone(), ..Default::default() };
        match action.as_str() {
            "MATCH" => {
                let id = i(m, "appId");
                let exists = match id {
                    Some(id) => tx.query_row("SELECT 1 FROM companies WHERE id = ?1", params![id], |_| Ok(())).optional().map_err(err)?.is_some(),
                    None => false,
                };
                if exists {
                    line.company_id = id;
                    company_of.insert(key.clone(), id.unwrap());
                } else {
                    line.note = Some(format!("app company #{} not found — not linked", id.map(|x| x.to_string()).unwrap_or_default()));
                }
            }
            a if a.starts_with("CREATE") => {
                let existed: Option<i64> = tx.query_row("SELECT id FROM companies WHERE name = ?1 COLLATE NOCASE", params![name], |r| r.get(0)).optional().map_err(err)?;
                let id = crate::opportunities::create_company_named(tx, &name).map_err(err)?;
                if let Some(id) = id {
                    if existed.is_some() { line.note = Some("a company with this name already existed — used it".into()); }
                    line.company_id = Some(id);
                    company_of.insert(key.clone(), id);
                } else {
                    line.note = Some("several companies differ from this name only by capitals — not created".into());
                }
            }
            "REVIEW" => {
                tx.execute(
                    "INSERT INTO company_review_queue (source_table, source_id, raw_name, suggested_company_id, status, created_at) VALUES ('agreements_import', ?1, ?2, ?3, 'pending', ?4)",
                    params![n as i64, name, i(m, "appId"), now()],
                ).map_err(err)?;
                line.note = s(m, "why").map(|w| w.chars().take(160).collect());
            }
            _ => {}
        }
        // Aliases: every other name and invoice name the review found for this client.
        if let (Some(id), Some(c)) = (line.company_id, clients.get(&key)) {
            let company_name: String = tx.query_row("SELECT name FROM companies WHERE id = ?1", params![id], |r| r.get(0)).map_err(err)?;
            let mut names: Vec<String> = strs(c, "aliases");
            names.extend(strs(c, "invoiceNames"));
            if let Some(d) = s(c, "displayName") { names.push(d.to_string()); }
            let mut seen = HashSet::new();
            for alias in names {
                if alias.eq_ignore_ascii_case(&company_name) || !seen.insert(alias.to_lowercase()) { continue; }
                let other: Option<i64> = tx.query_row("SELECT company_id FROM company_aliases WHERE alias = ?1", params![alias], |r| r.get(0)).optional().map_err(err)?;
                match other {
                    None => {
                        tx.execute("INSERT INTO company_aliases (alias, company_id, created_at) VALUES (?1, ?2, ?3)", params![alias, id, now()]).map_err(err)?;
                        line.aliases_added += 1;
                    }
                    Some(o) if o != id => report.notes.push(format!("Alias \"{alias}\" already belongs to company #{o}; not given to #{id} ({name})")),
                    _ => {}
                }
            }
        }
        report.companies.push(line);
    }

    // Groups: separately-invoiced entities under one parent record.
    for g in &bundle.groups {
        let group = s(g, "group").unwrap_or("Group").to_string();
        let members: Vec<i64> = strs(g, "members").iter().filter_map(|k| company_of.get(k).copied()).collect();
        if members.is_empty() { continue; }
        let parent = crate::opportunities::create_company_named(tx, &group).map_err(err)?
            .ok_or_else(|| format!("could not create the group record {group}"))?;
        tx.execute("UPDATE companies SET company_type = COALESCE(company_type, 'Group') WHERE id = ?1", params![parent]).map_err(err)?;
        for id in &members {
            tx.execute("UPDATE companies SET parent_company_id = ?1 WHERE id = ?2", params![parent, id]).map_err(err)?;
        }
        report.groups.push((group, parent, members.len()));
    }

    // 2. Library folders (the Files "Match a folder…" link: msfile → company) -
    if let Some(root) = &opts.onedrive_root {
        for (key, id) in &company_of {
            let Some(rel) = clients.get(key).and_then(|c| s(c, "libraryFolder")) else { continue };
            // libraryFolder is relative to the library; fall back to the OneDrive root.
            let in_library = opts.library_dir.as_ref().map(|l| root.join(l).join(rel));
            let path = in_library.filter(|p| p.is_dir()).unwrap_or_else(|| root.join(rel));
            if !path.is_dir() {
                report.folders_missing.push(rel.to_string());
                continue;
            }
            let p = path.to_string_lossy().to_string();
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            tx.execute("INSERT OR IGNORE INTO microsoft_files (path, name, item_type, created_at) VALUES (?1, ?2, 'folder', ?3)", params![p, name, now()]).map_err(err)?;
            let file_id: i64 = tx.query_row("SELECT id FROM microsoft_files WHERE path = ?1", params![p], |r| r.get(0)).map_err(err)?;
            let linked: Option<i64> = tx.query_row(
                "SELECT id FROM entity_links WHERE from_type = 'msfile' AND from_id = ?1 AND to_type = 'company' AND to_id = ?2",
                params![file_id, id], |r| r.get(0)).optional().map_err(err)?;
            if linked.is_none() {
                tx.execute("INSERT INTO entity_links (from_type, from_id, to_type, to_id, created_at) VALUES ('msfile', ?1, 'company', ?2, ?3)", params![file_id, id, now()]).map_err(err)?;
            }
            report.folders_linked += 1;
        }
    }

    // 3. Agreements -----------------------------------------------------------
    // Coverage from the review: which agreements cover billed services, which ended ones are still billed.
    let mut covering: HashMap<String, f64> = HashMap::new(); // agreement ref → May–Jul average it covers
    let mut ended_billed: HashSet<String> = HashSet::new();
    // A service covered by several agreements (an agreement and its amendment) is
    // counted once, on the one carrying current terms — never twice.
    let current_refs: HashSet<String> = bundle.agreements.iter().filter(|a| b(a, "carriesCurrentTerms"))
        .flat_map(|a| [s(a, "agrRef"), s(a, "refStem")].into_iter().flatten().map(norm).collect::<Vec<_>>()).collect();
    let mut live_refs: HashSet<String> = HashSet::new();
    for sv in &bundle.services {
        // One-time work isn't a monthly fee.
        let avg = if s(sv, "coverage") == Some("one-time work") { 0.0 } else { f(sv, "monthlyAvgMayJul").unwrap_or(0.0) };
        let refs: Vec<String> = strs(sv, "coveredBy").iter().map(|r| norm(r)).collect();
        live_refs.extend(refs.iter().cloned());
        if let Some(target) = refs.iter().find(|r| current_refs.contains(*r)).or(refs.first()) {
            *covering.entry(target.clone()).or_default() += avg;
        }
        // Exposure only where nothing live covers the billed service; an earlier contract
        // listed beside a live successor (an amendment) is simply superseded.
        if s(sv, "coverage") == Some("agreement ended") {
            for r in strs(sv, "endedAgreements") { ended_billed.insert(norm(&r)); }
        }
    }
    // Exposure follows the chain: the review may name an earlier link as the ended
    // agreement still being billed; it belongs on the link carrying current terms.
    let chain_of_ref: HashMap<String, String> = bundle.agreements.iter()
        .flat_map(|a| {
            let chain = s(a, "chainId").or(s(a, "sourceId")).unwrap_or_default().to_string();
            [s(a, "agrRef"), s(a, "refStem")].into_iter().flatten().map(move |r| (norm(r), chain.clone())).collect::<Vec<_>>()
        }).collect();
    let exposed_chains: HashSet<String> = ended_billed.iter().filter_map(|r| chain_of_ref.get(r).cloned()).collect();
    let collision_by_target: HashMap<String, Vec<&Value>> = {
        let mut m: HashMap<String, Vec<&Value>> = HashMap::new();
        for c in &bundle.collisions {
            if let Some(t) = s(c, "targetAgreement") { m.entry(norm(t)).or_default().push(c); }
        }
        m
    };
    let collided_app_ids: HashSet<i64> = bundle.collisions.iter().filter_map(|c| i(c, "appId")).collect();
    // App rows outside the collision list whose reference is a reviewed agreement's: update them rather than duplicate.
    let app_rows: Vec<(i64, Option<String>, String, Option<String>)> = tx
        .prepare("SELECT id, agr_ref, COALESCE(client, ''), status FROM agreements").map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(err)?
        .collect::<rusqlite::Result<_>>().map_err(err)?;
    let mut by_ref: HashMap<String, i64> = HashMap::new();
    for (id, r, _, _) in &app_rows {
        if collided_app_ids.contains(id) { continue; }
        if let Some(r) = r { if !r.trim().is_empty() { by_ref.entry(norm(r)).or_insert(*id); } }
    }
    let mut matched_by_ref: HashSet<i64> = HashSet::new();

    let mut id_of: HashMap<String, i64> = HashMap::new(); // sourceId → agreement id
    let mut ref_to_id: HashMap<String, i64> = HashMap::new(); // normalised agrRef/refStem → id
    for a in &bundle.agreements {
        let source_id = s(a, "sourceId").unwrap_or_default().to_string();
        let import_key = s(a, "importKey").unwrap_or(&source_id).to_string();
        // No reference on the document: keep the review's stem so the agreement can be found.
        let agr_ref = s(a, "agrRef").or(s(a, "refStem")).map(str::to_string);
        let ref_key = agr_ref.as_deref().map(norm).unwrap_or_else(|| norm(s(a, "refStem").unwrap_or_default()));
        let company_key = s(a, "companyKey").unwrap_or_default().to_string();
        let company_id = company_of.get(&company_key).copied();
        let company_name: Option<String> = match company_id {
            Some(id) => tx.query_row("SELECT name FROM companies WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(err)?,
            None => None,
        };
        let client = company_name.clone().or_else(|| s(a, "client").map(str::to_string)).unwrap_or_default();

        // Status (spec §5.4, the seven statuses unchanged).
        let signature = s(a, "signatureStatus").map(str::to_string);
        let evidence = s(a, "evidenceState").unwrap_or("");
        let current = b(a, "carriesCurrentTerms");
        let end = s(a, "currentTermEndDate").map(str::to_string);
        let ended = end.as_deref().is_some_and(|e| e < opts.today.as_str());
        // A superseded link listed beside its successor isn't live itself; the successor carries it.
        let billed_live = live_refs.contains(&ref_key) && evidence != "superseded";
        // Exposure sits on the link carrying current terms; a superseded link in the same chain has ended.
        let chain = s(a, "chainId").unwrap_or(&source_id).to_string();
        let billed_ended = current && (ended_billed.contains(&ref_key) || exposed_chains.contains(&chain));
        // An additive addendum (it adds services; the parent stays current) is in force with its parent.
        let adds_to_parent = !current && s(a, "documentRole").is_some_and(|r| r == "addendum")
            && s(a, "notes").is_some_and(|n| { let n = n.to_lowercase(); n.contains("adding") || n.contains(" adds ") });
        let status = match signature.as_deref() {
            Some("MENA-SIGNED") => "Client Signature",
            Some("CLIENT-SIGNED") => "MENA Signature",
            _ => "Signed",
        };
        let service_status: Option<&str> = if billed_live || billed_ended || adds_to_parent {
            Some("Active") // invoiced: live, or exposure when the term has ended
        } else if evidence == "superseded" || !current || ended || evidence == "expired" {
            Some("Ended")
        } else {
            None // in term, not invoiced May–Jul: left for the owner (not counted as MRR)
        };
        let renewal = s(a, "renewalType").filter(|r| RENEWAL_RULES.contains(r)).map(str::to_string);
        let terms_evidence = match (b(a, "documentHeld"), s(a, "sourceOfTruth").unwrap_or("")) {
            (true, _) => "signed_document",
            (false, src) if src.contains("finance_register") || src.contains("tracker") => "register_only",
            _ => "unknown",
        };
        // Monthly fee: what is invoiced for the services this agreement covers (May–Jul average).
        // Live agreements are measured by invoicing; one whose services' invoicing sits on
        // its partner agreement (an amendment, a parallel contract) carries 0, so nothing counts twice.
        let invoiced = if billed_live || adds_to_parent { Some(covering.get(&ref_key).copied().unwrap_or(0.0)) } else { None };
        let agr_lines: Vec<&Value> = bundle.lines.iter().filter(|l| s(l, "agreementSourceId") == Some(source_id.as_str())).collect();
        let fee_basis = if invoiced.is_some() {
            "invoiced"
        } else if agr_lines.iter().any(|l| s(l, "billing") == Some("monthly") && f(l, "unitPrice").is_some()) {
            "lines"
        } else if !agr_lines.is_empty() {
            "per_action"
        } else {
            "unknown"
        };
        let currency = s(a, "currency").map(|c| c.split('/').next().unwrap_or(c).trim().to_string()).unwrap_or_else(|| "SAR".into());
        if let Some(c) = s(a, "currency").filter(|c| c.contains('/')) { report.notes.push(format!("{}: currency \"{c}\" — stored as {currency}", agr_ref.clone().unwrap_or(import_key.clone()))); }
        let mut agr_type = s(a, "agreementType").filter(|t| *t != "Agreement").map(str::to_string);
        if agr_type.is_none() {
            // Missing type: what its services are (a service named like a type, or the catalogue's agreement type).
            for sv in strs(a, "services") {
                if AGR_TYPES.contains(&sv.as_str()) { agr_type = Some(sv); break; }
                if let Some(t) = type_from_label(&sv) { agr_type = Some(t.to_string()); break; }
                let t: Option<String> = tx.query_row("SELECT agreement_type FROM services WHERE name = ?1 COLLATE NOCASE AND agreement_type IS NOT NULL LIMIT 1", params![sv], |r| r.get(0)).optional().map_err(err)?;
                if let Some(t) = t { agr_type = Some(t); break; }
            }
            if agr_type.is_some() { report.types_inferred += 1; }
        }
        if let Some(t) = &agr_type { if !AGR_TYPES.contains(&t.as_str()) { *report.types_outside_list.entry(t.clone()).or_default() += 1; } }
        *report.mena_entities.entry(s(a, "menaEntity").unwrap_or("(not stated)").to_string()).or_default() += 1;

        // Where it goes: an app row the review merged into, one with the same reference, or a new row.
        let merge_target: Option<i64> = collision_by_target.get(&ref_key)
            .and_then(|cs| cs.iter().find(|c| s(c, "action") == Some("MERGE")).and_then(|c| i(c, "appId")))
            .filter(|id| !id_of.values().any(|v| v == id));
        let existing_by_key: Option<i64> = tx.query_row("SELECT id FROM agreements WHERE import_key = ?1", params![import_key], |r| r.get(0)).optional().map_err(err)?;
        let by_reference = if merge_target.is_none() && existing_by_key.is_none() { by_ref.get(&ref_key).copied().filter(|id| !matched_by_ref.contains(id)) } else { None };
        let (action, id) = if let Some(id) = existing_by_key {
            ("updated (re-run)", id)
        } else if let Some(id) = merge_target {
            ("merged", id)
        } else if let Some(id) = by_reference {
            matched_by_ref.insert(id);
            ("matched by reference", id)
        } else {
            tx.execute("INSERT INTO agreements (agr_ref, client, status, created_at) VALUES (?1, ?2, ?3, ?4)", params![agr_ref, client, status, now()]).map_err(err)?;
            ("inserted", tx.last_insert_rowid())
        };
        // The reviewed data wins; evidence never blanks a field that has a value (COALESCE).
        tx.execute(
            "UPDATE agreements SET
               agr_ref = COALESCE(?2, agr_ref), client = ?3, company_id = COALESCE(?4, company_id), type = COALESCE(?5, type),
               status = ?6, service_status = ?7, start_date = COALESCE(?8, start_date), end_date = COALESCE(?9, end_date),
               contract_months = COALESCE(?10, contract_months), notice_days = COALESCE(?11, notice_days),
               renewal_rule = ?12, auto_renew = COALESCE(?12 = 'auto', 0),
               date_client_signed = COALESCE(?13, date_client_signed), date_mena_signed = COALESCE(?14, date_mena_signed),
               currency = ?15, monthly_fee = COALESCE(?16, monthly_fee), fee_basis = ?17, terms_evidence = ?18,
               signature_status = ?19, carries_current_terms = ?20, adds_to_parent = ?21, import_key = ?22,
               remarks = COALESCE(?23, remarks)
             WHERE id = ?1",
            params![
                id, agr_ref, client, company_id, agr_type, status, service_status, s(a, "effectiveDate"), end,
                i(a, "termMonths"), i(a, "nonRenewalNoticeDays"), renewal, s(a, "signedClient"), s(a, "signedMena"),
                currency, invoiced.map(|v| (v * 100.0).round() / 100.0), fee_basis, terms_evidence, signature,
                current as i64, adds_to_parent as i64, import_key, s(a, "notes"),
            ],
        ).map_err(err)?;
        id_of.insert(source_id.clone(), id);
        ref_to_id.insert(ref_key.clone(), id);
        if let Some(stem) = s(a, "refStem") { ref_to_id.entry(norm(stem)).or_insert(id); }

        // 5. Price lines: the contract's structure, replaced by the reviewed ones.
        if !agr_lines.is_empty() {
            tx.execute("DELETE FROM agreement_lines WHERE agreement_id = ?1", params![id]).map_err(err)?;
            for (n, l) in agr_lines.iter().enumerate() {
                let name = s(l, "serviceName").unwrap_or("Service").to_string();
                let service_id = service_id_for(tx, &name).map_err(err)?;
                if service_id.is_none() { *report.lines_unmapped_services.entry(name.clone()).or_default() += 1; }
                let billing = match s(l, "billing") { Some("monthly") => "monthly", Some("one_time") => "one_time", Some(other) => other, None => "monthly" };
                tx.execute(
                    "INSERT INTO agreement_lines (agreement_id, service_id, service_name, description, billing, quantity, unit_price, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
                    params![id, service_id, name, s(l, "note").or(s(l, "unit")), billing, f(l, "unitPrice"), n as i64],
                ).map_err(err)?;
                report.lines_written += 1;
            }
        }

        report.agreements.push(AgreementLine {
            import_key, agr_ref, company: client, action: action.into(), app_id: Some(id), status: status.into(),
            service_status: service_status.map(str::to_string), monthly_fee: invoiced, fee_basis: fee_basis.into(), end_date: end,
            note: if billed_ended && ended { Some("term ended, still invoiced — exposure".into()) } else if adds_to_parent { Some("addendum adding to its parent".into()) } else { None },
        });
    }
    // Chains, once every agreement has an id.
    for a in &bundle.agreements {
        let Some(id) = s(a, "sourceId").and_then(|k| id_of.get(k)).copied() else { continue };
        let parent = s(a, "parentSourceId").and_then(|k| id_of.get(k)).copied();
        let root = s(a, "chainId").and_then(|k| id_of.get(k)).copied();
        if parent.is_some() || root.is_some() {
            tx.execute("UPDATE agreements SET parent_agreement_id = ?2, chain_root_id = ?3 WHERE id = ?1", params![id, parent, root]).map_err(err)?;
        }
    }

    // Collisions: absorb, remove, review.
    for c in &bundle.collisions {
        let Some(app_id) = i(c, "appId") else { continue };
        let target = s(c, "targetAgreement").and_then(|t| ref_to_id.get(&norm(t))).copied();
        match s(c, "action") {
            Some("ABSORB") => {
                if let Some(t) = target {
                    tx.execute("UPDATE agreements SET absorbed_into_id = ?2 WHERE id = ?1", params![app_id, t]).map_err(err)?;
                    report.absorbed.push((app_id, s(c, "targetAgreement").unwrap_or_default().to_string()));
                } else {
                    report.notes.push(format!("ABSORB #{app_id}: target {} not found", s(c, "targetAgreement").unwrap_or("?")));
                }
            }
            Some("REMOVE") => {
                let row: Option<(Option<String>, String, Option<i64>, Option<i64>)> = tx.query_row(
                    "SELECT agr_ref, COALESCE(client, ''), proposal_id, company_id FROM agreements WHERE id = ?1", params![app_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional().map_err(err)?;
                let Some((agr_ref, client, proposal_id, company_id)) = row else { continue };
                let proposal_status: Option<String> = match proposal_id {
                    Some(p) => tx.query_row("SELECT status FROM proposals WHERE id = ?1", params![p], |r| r.get(0)).optional().map_err(err)?,
                    None => None,
                };
                let others: i64 = match company_id {
                    Some(cid) => tx.query_row(
                        "SELECT (SELECT COUNT(*) FROM proposals WHERE company_id = ?1) + (SELECT COUNT(*) FROM contacts WHERE company_id = ?1)
                          + (SELECT COUNT(*) FROM agreements WHERE company_id = ?1 AND id != ?2) + (SELECT COUNT(*) FROM meetings WHERE company_id = ?1)",
                        params![cid, app_id], |r| r.get(0)).map_err(err)?,
                    None => 0,
                };
                tx.execute("DELETE FROM agreements WHERE id = ?1", params![app_id]).map_err(err)?;
                if opts.remove_company_records { report.notes.push(format!("Company records of removed clients were NOT deleted in this build (#{app_id}): needs its own confirmation step")); }
                report.removed.push(RemovedLine {
                    app_id, client, agr_ref, proposal_id,
                    would_be_recreated: proposal_status.as_deref() == Some("Signed by Both Parties"),
                    proposal_status, company_other_records: others,
                });
            }
            Some("REVIEW") => {
                report.review.push((app_id, s(c, "appRef").unwrap_or_default().to_string(), s(c, "actionNote").or(s(c, "why")).unwrap_or_default().to_string()));
            }
            _ => {}
        }
    }
    // App rows no one touched. An old-tracker row with the same reference as a reviewed
    // agreement (whose data went into the app's proposal-linked draft) is a duplicate:
    // absorbed into it, like the review's ABSORB rows. The rest are listed for the owner.
    let touched: HashSet<i64> = report.agreements.iter().filter_map(|a| a.app_id).chain(collided_app_ids.iter().copied()).collect();
    for (id, r, client, status) in app_rows {
        if touched.contains(&id) { continue; }
        let target = r.as_deref().map(norm).and_then(|k| ref_to_id.get(&k).copied()).filter(|t| *t != id);
        if let Some(t) = target {
            tx.execute("UPDATE agreements SET absorbed_into_id = ?2 WHERE id = ?1", params![id, t]).map_err(err)?;
            report.tracker_duplicates.push((id, r.unwrap_or_default(), t));
        } else {
            report.untouched_app_rows.push((id, r, client, status));
        }
    }
    if !report.review.is_empty() {
        let items: Vec<Value> = report.review.iter().map(|(id, r, why)| serde_json::json!({ "agreementId": id, "ref": r, "why": why })).collect();
        tx.execute("INSERT INTO app_meta (key, value) VALUES ('agreements_import_review', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![Value::Array(items).to_string()]).map_err(err)?;
    }

    // 7. Documents: the existing documents table, paths relative to OneDrive.
    for d in &bundle.documents {
        let Some(rel) = s(d, "pathRelativeToOneDrive") else { report.documents_unplaced += 1; continue };
        if let Some(root) = &opts.onedrive_root { if !root.join(rel).exists() { report.documents_missing_files.push(rel.to_string()); } }
        let agreement_id = s(d, "agrRef").and_then(|r| ref_to_id.get(&norm(r))).copied();
        let company_id = agreement_id
            .and_then(|a| tx.query_row("SELECT company_id FROM agreements WHERE id = ?1", params![a], |r| r.get::<_, Option<i64>>(0)).ok().flatten())
            .or_else(|| s(d, "client").and_then(|c| crate::opportunities::resolve_company(tx, Some(c)).ok().flatten()));
        if agreement_id.is_none() && company_id.is_none() { report.documents_unplaced += 1; continue; }
        let exists: Option<i64> = tx.query_row("SELECT id FROM documents WHERE link = ?1", params![rel], |r| r.get(0)).optional().map_err(err)?;
        if exists.is_some() { continue; }
        let title = Path::new(rel).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| rel.to_string());
        tx.execute(
            "INSERT INTO documents (title, link, doc_type, agreement_id, company_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![title, rel, s(d, "kind"), agreement_id, company_id, now()],
        ).map_err(err)?;
        if agreement_id.is_some() { report.documents_linked += 1 } else { report.documents_company_only += 1 }
    }

    // 8. Billing: one row per Finance row (company × department × service × sales type × month).
    let loaded = now();
    for row in &bundle.billing {
        let key = s(row, "companyKey").unwrap_or_default();
        let Some(company_id) = company_of.get(key).copied().or_else(|| i(row, "appCompanyId")) else {
            report.notes.push(format!("Billing for {key} has no company in the app — skipped"));
            continue;
        };
        let month = s(row, "month").unwrap_or_default().to_string();
        let amount = f(row, "amount").unwrap_or(0.0);
        let service = s(row, "service").unwrap_or_default().to_string();
        let service_id = service_id_for(tx, &service).map_err(err)?;
        if service_id.is_none() { *report.billing_unmapped_services.entry(service.clone()).or_default() += 1; }
        let n = tx.execute(
            "INSERT OR IGNORE INTO billing (company_id, service_id, finance_department, finance_service, sales_type, month, amount, currency, invoice_lines, source, loaded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'SAR', ?8, ?9, ?10)",
            params![company_id, service_id, s(row, "financeDepartment"), s(row, "financeService"), s(row, "salesType"), month, amount, i(row, "invoiceLines"), s(row, "source").unwrap_or("Finance sales report"), loaded],
        ).map_err(err)?;
        if n > 0 {
            report.billing_rows += 1;
            report.billing_total += amount;
            if month.as_str() > MAY_JUL[2] { report.billing_future_months.push((month, amount)); }
        }
    }
    Ok(report)
}

/// The catalogue service with this name (or a merged one's survivor), if any.
fn service_id_for(tx: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    let id: Option<(i64, Option<i64>)> = tx.query_row(
        "SELECT id, merged_into FROM services WHERE name = ?1 COLLATE NOCASE ORDER BY active DESC LIMIT 1", params![name.trim()],
        |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    Ok(id.map(|(id, merged)| merged.unwrap_or(id)))
}

// ── MRR, as each surface computes it ────────────────────────────────────────

/// Active MRR (SAR) the way the app computes it today (lines win over the
/// stored fee) and after spec §5.6 (the stored fee wins when fee_basis =
/// invoiced). Active = not cancelled, service Active, end date not passed.
pub fn active_mrr(conn: &Connection, today: &str) -> rusqlite::Result<(f64, f64)> {
    let has_basis = crate::db::schema_version(conn).unwrap_or(0) >= 38;
    let sql = format!(
        "SELECT a.id, COALESCE(a.monthly_fee, 0), {basis},
                (SELECT COUNT(*) FROM agreement_lines l WHERE l.agreement_id = a.id),
                (SELECT COALESCE(SUM(COALESCE(l.quantity, 1) * l.unit_price), 0) FROM agreement_lines l WHERE l.agreement_id = a.id AND l.billing = 'monthly' AND l.unit_price IS NOT NULL)
         FROM agreements a
         WHERE COALESCE(a.status, '') != 'Canceled' AND a.service_status = 'Active' AND (a.end_date IS NULL OR a.end_date >= ?1)
           AND COALESCE(a.currency, 'SAR') = 'SAR'",
        basis = if has_basis { "COALESCE(a.fee_basis, '')" } else { "''" }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![today], |r| Ok((r.get::<_, f64>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, f64>(4)?)))?;
    let (mut today_rule, mut new_rule) = (0.0, 0.0);
    for row in rows {
        let (fee, basis, n_lines, lines_monthly) = row?;
        let app = if n_lines > 0 { lines_monthly } else { fee };
        today_rule += app;
        new_rule += if basis == "invoiced" { fee } else { app };
    }
    Ok((today_rule, new_rule))
}

/// Active MRR per company (today's rule, after §5.6) — the Company 360 state line.
pub fn company_mrr(conn: &Connection, today: &str) -> rusqlite::Result<HashMap<i64, (f64, f64)>> {
    let has_basis = crate::db::schema_version(conn).unwrap_or(0) >= 38;
    let sql = format!(
        "SELECT a.company_id, COALESCE(a.monthly_fee, 0), {basis},
                (SELECT COUNT(*) FROM agreement_lines l WHERE l.agreement_id = a.id),
                (SELECT COALESCE(SUM(COALESCE(l.quantity, 1) * l.unit_price), 0) FROM agreement_lines l WHERE l.agreement_id = a.id AND l.billing = 'monthly' AND l.unit_price IS NOT NULL)
         FROM agreements a
         WHERE a.company_id IS NOT NULL AND COALESCE(a.status, '') != 'Canceled' AND a.service_status = 'Active' AND (a.end_date IS NULL OR a.end_date >= ?1)",
        basis = if has_basis { "COALESCE(a.fee_basis, '')" } else { "''" }
    );
    let mut out: HashMap<i64, (f64, f64)> = HashMap::new();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![today], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, f64>(4)?)))?;
    for row in rows {
        let (company, fee, basis, n_lines, lines_monthly) = row?;
        let app = if n_lines > 0 { lines_monthly } else { fee };
        let e = out.entry(company).or_default();
        e.0 += app;
        e.1 += if basis == "invoiced" { fee } else { app };
    }
    Ok(out)
}

#[cfg(test)]
mod label_tests {
    use super::type_from_label;
    #[test]
    fn service_labels_map_to_agreement_types() {
        assert_eq!(type_from_label("Admin PRO"), Some("Administration"));
        assert_eq!(type_from_label("Admin-PRO"), Some("Administration"));
        assert_eq!(type_from_label("Accountancy-VAT"), Some("Accountancy"));
        assert_eq!(type_from_label("Labour-Law"), Some("Consultancy"));
        assert_eq!(type_from_label("Workforce (EoR)"), Some("Workforce"));
        assert_eq!(type_from_label("Visas"), Some("Administration"));
        assert_eq!(type_from_label("Multi"), None);
        assert_eq!(type_from_label("Migration"), None);
        assert_eq!(type_from_label("Payroll"), None);
    }
}
