//! Proposal generator: master templates (a .pptx plus rules for which slides
//! each proposal needs) and building a client's deck into their OneDrive
//! folder. The deck engine itself is pptx.rs.
//!
//! Slide rules come from the template's speaker notes (`[always]`,
//! `[services: …]`, `[entity: KSA]`) and can be changed in the app; plain-text
//! replacements cover older templates that have no `{{tokens}}` yet.

use crate::commands::read_all_data;
use crate::db::DbState;
use crate::models::{CommercialLine, Proposal};
use crate::pptx::{self, BuildReport, Package, TemplateInspection};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ═══════════════ Templates ═══════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlideRule {
    pub slide_id: String,
    /// always | services | never
    pub include: String,
    #[serde(default)]
    pub services: Vec<String>,
    #[serde(default)]
    pub entity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Replacement {
    /// Text as typed in the template, e.g. "'Client Name'".
    pub find: String,
    /// Token whose value replaces it, e.g. "client_name".
    pub token: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateConfig {
    /// Fill client name, dates, logo, agenda numbers and fees the way the
    /// team does by hand, for templates without placeholders (smartfill.rs).
    #[serde(default = "default_true")]
    pub smart_fields: bool,
    #[serde(default)]
    pub slides: Vec<SlideRule>,
    #[serde(default)]
    pub replacements: Vec<Replacement>,
}

impl Default for TemplateConfig {
    fn default() -> Self {
        TemplateConfig { smart_fields: true, slides: Vec::new(), replacements: Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProposalTemplate {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub business_entity_id: Option<i64>,
    #[serde(default)]
    pub config: TemplateConfig,
    #[serde(default)]
    pub slide_count: Option<i64>,
    #[serde(default)]
    pub file_modified_at: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    /// Whether the file is still where it was.
    #[serde(default)]
    pub exists: bool,
}

fn modified_at(path: &Path) -> Option<String> {
    let secs = std::fs::metadata(path).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(secs.to_string())
}

fn read_templates(conn: &Connection) -> rusqlite::Result<Vec<ProposalTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, business_entity_id, config_json, slide_count, file_modified_at, is_default FROM proposal_templates ORDER BY is_default DESC, name",
    )?;
    let rows = stmt.query_map([], |r| {
        let path: String = r.get(2)?;
        let config: String = r.get(4)?;
        Ok(ProposalTemplate {
            id: r.get(0)?,
            name: r.get(1)?,
            exists: Path::new(&path).is_file(),
            path,
            business_entity_id: r.get(3)?,
            config: serde_json::from_str(&config).unwrap_or_default(),
            slide_count: r.get(5)?,
            file_modified_at: r.get(6)?,
            is_default: r.get::<_, i64>(7)? != 0,
        })
    })?;
    rows.collect()
}

/// Rules for every slide: saved ones kept by slide id, new slides get the
/// rule their speaker-note tags describe.
pub fn merged_rules(config: &TemplateConfig, inspection: &TemplateInspection) -> Vec<SlideRule> {
    inspection
        .slides
        .iter()
        .map(|s| {
            config.slides.iter().find(|r| r.slide_id == s.slide_id).cloned().unwrap_or_else(|| SlideRule {
                slide_id: s.slide_id.clone(),
                include: if s.tags.never { "never" } else if !s.tags.services.is_empty() { "services" } else { "always" }.into(),
                services: s.tags.services.clone(),
                entity: s.tags.entity.clone(),
            })
        })
        .collect()
}

fn inspect_path(path: &str) -> CmdResult<TemplateInspection> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err("The template file can't be found. It may have been moved or renamed.".into());
    }
    if !path.to_lowercase().ends_with(".pptx") {
        return Err("Choose a PowerPoint file (.pptx).".into());
    }
    Ok(pptx::inspect(&Package::read(p)?))
}

#[tauri::command]
pub fn templates_list(state: State<DbState>) -> CmdResult<Vec<ProposalTemplate>> {
    let conn = state.0.lock().map_err(err)?;
    read_templates(&conn).map_err(err)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDetail {
    pub template: ProposalTemplate,
    pub inspection: TemplateInspection,
    pub rules: Vec<SlideRule>,
}

/// Reads a .pptx that isn't saved as a template yet.
#[tauri::command]
pub fn template_inspect(path: String) -> CmdResult<TemplateInspection> {
    inspect_path(&path)
}

/// A saved template with its slides read fresh from the file.
#[tauri::command]
pub fn template_detail(state: State<DbState>, id: i64) -> CmdResult<TemplateDetail> {
    let template = {
        let conn = state.0.lock().map_err(err)?;
        read_templates(&conn).map_err(err)?.into_iter().find(|t| t.id == id).ok_or("Template not found.")?
    };
    let inspection = inspect_path(&template.path)?;
    let rules = merged_rules(&template.config, &inspection);
    Ok(TemplateDetail { template, inspection, rules })
}

#[tauri::command]
pub fn template_save(state: State<DbState>, template: ProposalTemplate) -> CmdResult<TemplateDetail> {
    if template.name.trim().is_empty() {
        return Err("Give the template a name.".into());
    }
    let inspection = inspect_path(&template.path)?;
    let mut config = template.config.clone();
    config.slides = merged_rules(&config, &inspection);
    config.replacements.retain(|r| !r.find.trim().is_empty() && !r.token.trim().is_empty());
    let config_json = serde_json::to_string(&config).map_err(err)?;
    let now = crate::commands::now_iso();
    let modified = modified_at(Path::new(&template.path));
    let conn = state.0.lock().map_err(err)?;
    let id = if template.id > 0 {
        conn.execute(
            "UPDATE proposal_templates SET name=?2, path=?3, business_entity_id=?4, config_json=?5, slide_count=?6, file_modified_at=?7, is_default=?8, updated_at=?9 WHERE id=?1",
            params![template.id, template.name.trim(), template.path, template.business_entity_id, config_json, inspection.slide_count as i64, modified, template.is_default as i64, now],
        ).map_err(err)?;
        template.id
    } else {
        conn.execute(
            "INSERT INTO proposal_templates (name, path, business_entity_id, config_json, slide_count, file_modified_at, is_default, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
            params![template.name.trim(), template.path, template.business_entity_id, config_json, inspection.slide_count as i64, modified, template.is_default as i64, now],
        ).map_err(err)?;
        conn.last_insert_rowid()
    };
    if template.is_default {
        conn.execute(
            "UPDATE proposal_templates SET is_default = 0 WHERE id <> ?1 AND business_entity_id IS ?2",
            params![id, template.business_entity_id],
        ).map_err(err)?;
    }
    let saved = read_templates(&conn).map_err(err)?.into_iter().find(|t| t.id == id).ok_or("Template not found after saving.")?;
    let rules = merged_rules(&saved.config, &inspection);
    Ok(TemplateDetail { template: saved, inspection, rules })
}

#[tauri::command]
pub fn template_delete(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM proposal_templates WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ═══════════════ Values a deck can use ═══════════════

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub token: &'static str,
    pub label: &'static str,
    pub example: &'static str,
}

pub const TOKENS: &[TokenInfo] = &[
    TokenInfo { token: "client_name", label: "Client name", example: "Acme Holdings" },
    TokenInfo { token: "client_legal_name", label: "Client legal name (falls back to the name)", example: "Acme Holdings Co. Ltd" },
    TokenInfo { token: "client_city", label: "Client city", example: "Riyadh" },
    TokenInfo { token: "client_country", label: "Client country", example: "Saudi Arabia" },
    TokenInfo { token: "contact_name", label: "Primary contact", example: "Jane Doe" },
    TokenInfo { token: "contact_title", label: "Contact's role", example: "HR Director" },
    TokenInfo { token: "contact_email", label: "Contact's email", example: "jane@acme.com" },
    TokenInfo { token: "proposal_ref", label: "Proposal reference", example: "SL# 214" },
    TokenInfo { token: "proposal_date", label: "Date", example: "13 September 2026" },
    TokenInfo { token: "proposal_date_ordinal", label: "Date with ordinal", example: "13th September 2026" },
    TokenInfo { token: "proposal_date_weekday", label: "Date with weekday", example: "Sunday, 13th September 2026" },
    TokenInfo { token: "proposal_date_short", label: "Short date", example: "13.09.2026" },
    TokenInfo { token: "valid_until", label: "Valid until", example: "13 October 2026" },
    TokenInfo { token: "services", label: "Services, as a sentence", example: "Payroll, PRO and Recruitment" },
    TokenInfo { token: "currency", label: "Currency", example: "SAR" },
    TokenInfo { token: "monthly_total", label: "Monthly total", example: "SAR 9,000" },
    TokenInfo { token: "one_time_total", label: "One-time total", example: "SAR 55,000" },
    TokenInfo { token: "contract_value", label: "Contract value", example: "SAR 163,000" },
    TokenInfo { token: "contract_term", label: "Contract term", example: "12 months" },
    TokenInfo { token: "vat_rate", label: "VAT rate", example: "15%" },
    TokenInfo { token: "entity_name", label: "MENA BIG entity", example: "MENA BIG KSA" },
    TokenInfo { token: "owner_name", label: "Proposal owner", example: "Ahmad Abdallah" },
    TokenInfo { token: "owner_title", label: "Owner's role", example: "Business Development" },
    TokenInfo { token: "owner_email", label: "Owner's email", example: "name@mena-big.com" },
    TokenInfo { token: "line.number", label: "Fee table row: number", example: "1" },
    TokenInfo { token: "line.service", label: "Fee table row: service", example: "Payroll" },
    TokenInfo { token: "line.description", label: "Fee table row: scope", example: "Up to 25 employees" },
    TokenInfo { token: "line.billing", label: "Fee table row: billing", example: "Monthly" },
    TokenInfo { token: "line.quantity", label: "Fee table row: quantity", example: "1" },
    TokenInfo { token: "line.unit_price", label: "Fee table row: price", example: "SAR 6,000" },
    TokenInfo { token: "line.amount", label: "Fee table row: amount", example: "SAR 6,000" },
];

#[tauri::command]
pub fn template_tokens() -> Vec<TokenInfo> {
    TOKENS.to_vec()
}

const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS: [&str; 7] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

fn parse_date(iso: &str) -> Option<(i64, usize, i64)> {
    let mut it = iso.get(0..10)?.split('-');
    let y = it.next()?.parse().ok()?;
    let m: usize = it.next()?.parse().ok()?;
    let d = it.next()?.parse().ok()?;
    (1..=12).contains(&m).then_some((y, m, d))
}

fn ordinal(d: i64) -> String {
    let suffix = match (d % 10, d % 100) {
        (1, n) if n != 11 => "st",
        (2, n) if n != 12 => "nd",
        (3, n) if n != 13 => "rd",
        _ => "th",
    };
    format!("{d}{suffix}")
}

/// Monday = 0, from days since 1970-01-01 (a Thursday).
fn weekday(y: i64, m: usize, d: i64) -> usize {
    let (y2, m2) = if m <= 2 { (y - 1, m as i64 + 9) } else { (y, m as i64 - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    ((days + 3).rem_euclid(7)) as usize
}

pub fn long_date(iso: &str) -> String {
    parse_date(iso).map(|(y, m, d)| format!("{d} {} {y}", MONTHS[m - 1])).unwrap_or_default()
}

pub fn money(amount: Option<f64>, currency: &str) -> String {
    let Some(v) = amount else { return String::new() };
    let rounded = (v * 100.0).round() / 100.0;
    let whole = rounded.trunc() as i64;
    let cents = ((rounded.fract()).abs() * 100.0).round() as i64;
    let digits = whole.abs().to_string();
    let mut grouped = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    let sign = if whole < 0 { "-" } else { "" };
    if cents > 0 { format!("{currency} {sign}{grouped}.{cents:02}") } else { format!("{currency} {sign}{grouped}") }
}

fn sentence(items: &[String]) -> String {
    match items.len() {
        0 => String::new(),
        1 => items[0].clone(),
        n => format!("{} and {}", items[..n - 1].join(", "), items[n - 1]),
    }
}

fn num(v: f64) -> String {
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
}

pub struct DeckValues {
    pub values: HashMap<String, String>,
    pub lines: Vec<HashMap<String, String>>,
    pub service_names: Vec<String>,
    pub entity_code: Option<String>,
}

pub fn deck_values(conn: &Connection, p: &Proposal, date_iso: &str) -> rusqlite::Result<DeckValues> {
    let data = read_all_data(conn)?;
    let currency = p.currency.clone().unwrap_or_else(|| "SAR".into());
    let company: Option<(Option<String>, Option<String>, Option<String>)> = match p.company_id {
        Some(id) => conn.query_row("SELECT legal_name, city, country FROM companies WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?,
        None => None,
    };
    let contact = p.primary_contact_id.and_then(|id| data.contacts.iter().find(|c| c.id == id));
    let owner = p.owner_id.and_then(|id| data.team_members.iter().find(|t| t.id == id));
    let entity = p.business_entity_id.and_then(|id| data.business_entities.iter().find(|e| e.id == id));
    let lines: &[CommercialLine] = &p.lines;
    let mut names: Vec<String> = Vec::new();
    for l in lines {
        if !l.service_name.trim().is_empty() && !names.contains(&l.service_name) {
            names.push(l.service_name.clone());
        }
    }
    let (_, monthly, one_time) = crate::commercial::derive_totals(lines);
    let months = p.contract_months.filter(|m| *m > 0);
    let contract_value = if monthly.is_none() && one_time.is_none() { None } else { Some(monthly.unwrap_or(0.0) * months.unwrap_or(1) as f64 + one_time.unwrap_or(0.0)) };

    let mut v: HashMap<String, String> = HashMap::new();
    let mut set = |k: &str, val: String| { v.insert(k.to_string(), val); };
    set("client_name", p.client.clone());
    set("client_legal_name", company.as_ref().and_then(|c| c.0.clone()).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| p.client.clone()));
    set("client_city", company.as_ref().and_then(|c| c.1.clone()).unwrap_or_default());
    set("client_country", company.as_ref().and_then(|c| c.2.clone()).unwrap_or_default());
    set("contact_name", contact.and_then(|c| c.name.clone()).unwrap_or_default());
    set("contact_title", contact.and_then(|c| c.role.clone()).unwrap_or_default());
    set("contact_email", contact.and_then(|c| c.email.clone()).unwrap_or_default());
    set("proposal_ref", format!("SL# {}", p.id));
    if let Some((y, m, d)) = parse_date(date_iso) {
        set("proposal_date", format!("{d} {} {y}", MONTHS[m - 1]));
        set("proposal_date_ordinal", format!("{} {} {y}", ordinal(d), MONTHS[m - 1]));
        set("proposal_date_weekday", format!("{}, {} {} {y}", WEEKDAYS[weekday(y, m, d)], ordinal(d), MONTHS[m - 1]));
        set("proposal_date_short", format!("{d:02}.{m:02}.{y}"));
    }
    set("valid_until", p.valid_until.as_deref().map(long_date).unwrap_or_default());
    set("services", sentence(&names));
    set("currency", currency.clone());
    set("monthly_total", money(monthly, &currency));
    set("one_time_total", money(one_time, &currency));
    set("contract_value", money(contract_value, &currency));
    set("contract_term", months.map(|m| format!("{m} months")).unwrap_or_default());
    set("vat_rate", entity.and_then(|e| e.vat_rate).map(|r| format!("{}%", num(r))).unwrap_or_default());
    set("entity_name", entity.map(|e| e.name.clone()).unwrap_or_default());
    set("owner_name", owner.map(|o| o.name.clone()).or_else(|| p.owner.clone()).unwrap_or_default());
    set("owner_title", owner.and_then(|o| o.job_title.clone()).unwrap_or_default());
    set("owner_email", owner.and_then(|o| o.email.clone()).unwrap_or_default());

    let line_values = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let amount = l.unit_price.map(|p| p * if l.quantity > 0.0 { l.quantity } else { 1.0 });
            [
                ("number", (i + 1).to_string()),
                ("service", l.service_name.clone()),
                ("description", l.description.clone().unwrap_or_default()),
                ("billing", if l.billing == "one_time" { "One-time" } else { "Monthly" }.to_string()),
                ("quantity", num(l.quantity)),
                ("unit_price", money(l.unit_price, &currency)),
                ("amount", money(amount, &currency)),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect()
        })
        .collect();
    Ok(DeckValues { values: v, lines: line_values, service_names: names, entity_code: entity.map(|e| e.code.clone()) })
}

// ═══════════════ Choosing slides and building ═══════════════

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideChoice {
    pub index: usize,
    pub slide_id: String,
    pub title: String,
    pub included: bool,
    /// Why it's in or out, for the preview.
    pub reason: String,
    /// Template the slide comes from, when built from the template library.
    pub source: String,
}

/// Which slides a proposal gets under the template's rules. Services match
/// by name or by the catalog category they belong to, case-insensitively.
pub fn choose_slides(inspection: &TemplateInspection, rules: &[SlideRule], services: &[String], categories: &[String], entity: Option<&str>) -> Vec<SlideChoice> {
    let norm = |s: &str| s.trim().to_lowercase();
    let wanted: Vec<String> = services.iter().chain(categories.iter()).map(|s| norm(s)).collect();
    inspection
        .slides
        .iter()
        .zip(rules.iter())
        .map(|(s, r)| {
            let entity_ok = r.entity.as_deref().map(|e| entity.map(|x| norm(x) == norm(e)).unwrap_or(false)).unwrap_or(true);
            let (included, reason) = match r.include.as_str() {
                "never" => (false, "Never included".to_string()),
                "services" => {
                    let hit = r.services.iter().find(|x| wanted.contains(&norm(x)));
                    match hit {
                        Some(h) if entity_ok => (true, format!("For {h}")),
                        Some(_) => (false, format!("Only for {}", r.entity.clone().unwrap_or_default())),
                        None => (false, if r.services.is_empty() { "No services tagged".into() } else { format!("Only for {}", r.services.join(", ")) }),
                    }
                }
                _ if !entity_ok => (false, format!("Only for {}", r.entity.clone().unwrap_or_default())),
                _ => (true, "Always included".to_string()),
            };
            SlideChoice { index: s.index, slide_id: s.slide_id.clone(), title: s.title.clone(), included, reason, source: String::new() }
        })
        .collect()
}

// ═══════════════ Template library ═══════════════

/// The folder of service templates: set in Settings, or "Proposals Templates/
/// Proposals New Logo" next to the Proposals folder.
pub fn library_dir(conn: &Connection) -> rusqlite::Result<Option<PathBuf>> {
    let configured: Option<String> = conn.query_row("SELECT value FROM app_meta WHERE key = 'proposal_library_dir'", [], |r| r.get(0)).optional()?;
    if let Some(dir) = configured.map(PathBuf::from).filter(|p| p.is_dir()) {
        return Ok(Some(dir));
    }
    let root = crate::commercial::proposals_root(conn)?;
    Ok(root.and_then(|r| r.parent().map(|p| p.join("Proposals Templates").join("Proposals New Logo"))).filter(|p| p.is_dir()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTemplateInfo {
    pub name: String,
    pub path: String,
    pub slide_count: usize,
    pub services: Vec<String>,
    /// A sent proposal kept as a template; its client's name is swapped out.
    pub sent_to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub dir: Option<String>,
    pub templates: Vec<LibraryTemplateInfo>,
    /// The 2026 proposal master, when found.
    pub master: Option<String>,
}

#[tauri::command]
pub fn proposal_library(state: State<DbState>) -> CmdResult<LibraryInfo> {
    let (dir, configured) = {
        let conn = state.0.lock().map_err(err)?;
        let configured: Option<String> = conn.query_row("SELECT value FROM app_meta WHERE key = 'proposal_master_path'", [], |r| r.get(0)).optional().map_err(err)?;
        (library_dir(&conn).map_err(err)?, configured)
    };
    let master = crate::master::locate(dir.as_deref(), configured).map(|p| p.to_string_lossy().to_string());
    let Some(dir) = dir else { return Ok(LibraryInfo { dir: None, templates: vec![], master }) };
    let templates = crate::proposal_library::load_library(&dir)?
        .into_iter()
        .map(|t| LibraryTemplateInfo {
            services: crate::proposal_library::covered(&t.slides).into_iter().map(|k| crate::proposal_library::module_name(k).to_string()).collect(),
            slide_count: t.slides.len(),
            sent_to: t.client_on_cover.clone(),
            name: t.name,
            path: t.path,
        })
        .collect();
    Ok(LibraryInfo { dir: Some(dir.to_string_lossy().to_string()), templates, master })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub proposal_id: i64,
    pub template_id: i64,
    /// YYYY-MM-DD in the user's time zone.
    pub date: String,
    pub file_name: String,
    /// Slide positions chosen in the preview; None uses the rules.
    #[serde(default)]
    pub keep: Option<Vec<usize>>,
    /// PNG or JPEG placed in the template's "Logo" box.
    #[serde(default)]
    pub logo_path: Option<String>,
    #[serde(default)]
    pub dry_run: bool,
    /// Build from the folder of service templates instead of one saved template.
    #[serde(default)]
    pub from_library: bool,
    /// Build from the 2026 proposal master (tagged slides and fields).
    #[serde(default)]
    pub from_master: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub slides: Vec<SlideChoice>,
    pub values: HashMap<String, String>,
    pub report: Option<BuildReport>,
    pub folder: Option<String>,
    pub folder_exists: bool,
    pub path: Option<String>,
    pub file_name: String,
    pub warnings: Vec<String>,
    /// Library builds: the template the deck starts from and the services line on its cover.
    pub base_template: Option<String>,
    pub services_title: Option<String>,
}

fn safe_file_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { ' ' } else { c }).collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.to_lowercase().ends_with(".pptx") { trimmed } else { format!("{trimmed}.pptx") }
}

/// A proposal line as the fee tables need it: its band priced across the rate card.
pub fn smart_line(l: &CommercialLine, card: Option<&crate::pricing::Card>, category: Option<&str>) -> crate::smartfill::SmartLine {
    crate::smartfill::SmartLine {
        service: l.service_name.clone(),
        description: l.description.clone(),
        unit_price: l.unit_price,
        modules: crate::proposal_library::modules_for_service(&l.service_name, category),
        kind: card.and_then(crate::pricing::row_kind).filter(|_| !l.rates.is_empty()),
        rates: l.rates.clone(),
        preset_labels: card.map(|c| c.preset_labels()).unwrap_or_default(),
        months: None,
        with_recruitment: l.with_recruitment,
    }
}

/// Slides a proposal leaves out on its own: Workforce's recruitment process
/// slides when recruitment isn't included, and the free Business Setup
/// reasoning when the term is under the 12 months that make setup free.
fn automatic_exclusion(text: &str, lines: &[CommercialLine], categories: &[Option<String>], months: Option<i64>) -> Option<&'static str> {
    let modules = |i: usize| crate::proposal_library::modules_for_service(&lines[i].service_name, categories.get(i).and_then(|c| c.as_deref()));
    if text.contains("Only if recruitment required") {
        let workforce: Vec<usize> = (0..lines.len()).filter(|&i| modules(i).contains(&"workforce")).collect();
        if !workforce.is_empty() && !workforce.iter().any(|&i| lines[i].with_recruitment) {
            return Some("Workforce without recruitment");
        }
    }
    let lower = text.to_lowercase();
    if months.map(|m| m > 0 && m < 12).unwrap_or(false) && lower.contains("free business setup offer") && (0..lines.len()).any(|i| modules(i).contains(&"business_setup")) {
        return Some("Setup is only free with a 12-month term");
    }
    None
}

#[tauri::command]
pub fn proposal_generate(state: State<DbState>, request: GenerateRequest) -> CmdResult<GenerateResult> {
    let (template, proposal, deck, categories, root, library, line_cards, standards, master) = {
        let conn = state.0.lock().map_err(err)?;
        let master = if request.from_master {
            let configured: Option<String> = conn.query_row("SELECT value FROM app_meta WHERE key = 'proposal_master_path'", [], |r| r.get(0)).optional().map_err(err)?;
            Some(crate::master::locate(library_dir(&conn).map_err(err)?.as_deref(), configured).ok_or("The 2026 proposal master (MENA BIG Proposal Master 2026.pptx) wasn't found in Proposals Templates.")?)
        } else {
            None
        };
        let template = if request.from_library || request.from_master {
            None
        } else {
            Some(read_templates(&conn).map_err(err)?.into_iter().find(|t| t.id == request.template_id).ok_or("Template not found.")?)
        };
        let library = if request.from_library && !request.from_master {
            Some(library_dir(&conn).map_err(err)?.ok_or("The proposal templates folder (Proposals Templates/Proposals New Logo) wasn't found. Choose it in Settings.")?)
        } else {
            None
        };
        let data = read_all_data(&conn).map_err(err)?;
        let proposal = data.proposals.into_iter().find(|p| p.id == request.proposal_id).ok_or("Proposal not found.")?;
        let deck = deck_values(&conn, &proposal, &request.date).map_err(err)?;
        let categories: Vec<Option<String>> = proposal
            .lines
            .iter()
            .map(|l| l.service_id.and_then(|id| data.services.iter().find(|s| s.id == id)).and_then(|s| s.category.clone()))
            .collect();
        let rate_cards = crate::commercial::read_rate_cards(&conn).map_err(err)?;
        let line_cards: Vec<Option<crate::pricing::Card>> = proposal
            .lines
            .iter()
            .map(|l| {
                let service = l.service_id.and_then(|id| data.services.iter().find(|s| s.id == id)).or_else(|| data.services.iter().find(|s| s.name.eq_ignore_ascii_case(l.service_name.trim())));
                service.and_then(|s| s.rate_card_id).and_then(|id| rate_cards.iter().find(|r| r.id == id)).and_then(|r| crate::pricing::Card::from_json(&r.pricing))
            })
            .collect();
        let standard_of = |service: &str| {
            data.services.iter().find(|s| s.name.eq_ignore_ascii_case(service)).and_then(|s| s.rate_card_id).and_then(|id| rate_cards.iter().find(|r| r.id == id)).and_then(|r| crate::pricing::Card::from_json(&r.pricing)).and_then(|c| c.standard_price())
        };
        let standards = crate::feefill::Standards { constitution: standard_of("Company Constitution"), maintenance: standard_of("Company Maintenance") };
        let root = crate::commercial::proposals_root(&conn).map_err(err)?;
        (template, proposal, deck, categories, root, library, line_cards, standards, master)
    };
    let mut warnings = Vec::new();
    let mut base_template = None;
    let mut services_title = None;
    let master_lines: Vec<crate::master::MasterLine> = proposal
        .lines
        .iter()
        .zip(line_cards.iter())
        .zip(categories.iter())
        .map(|((l, card), category)| crate::master::MasterLine {
            service: l.service_name.clone(),
            modules: crate::proposal_library::modules_for_service(&l.service_name, category.as_deref()),
            kind: card.as_ref().and_then(crate::pricing::row_kind).filter(|_| !l.rates.is_empty()),
            rates: l.rates.clone(),
            unit_price: l.unit_price,
            with_recruitment: l.with_recruitment,
        })
        .collect();
    let (mut pkg, inspection, mut slides) = match (&template, &library) {
        _ if master.is_some() => {
            let pkg = Package::read(master.as_deref().expect("master"))?;
            let inspection = pptx::inspect(&pkg);
            if !crate::master::is_master(&inspection) {
                return Err("The 2026 proposal master has no tagged slides.".into());
            }
            let mut wanted: Vec<&'static str> = Vec::new();
            for (line, ml) in proposal.lines.iter().zip(master_lines.iter()) {
                if ml.modules.is_empty() && !line.service_name.trim().is_empty() {
                    warnings.push(format!("No slides are known for \"{}\"; add its scope and fees by hand.", line.service_name.trim()));
                }
                for m in &ml.modules {
                    if !wanted.contains(m) {
                        wanted.push(m);
                    }
                }
            }
            let choices = crate::master::choose(&inspection, &master_lines, proposal.contract_months);
            for m in &wanted {
                if !choices.iter().any(|c| c.module.as_deref() == Some(*m)) {
                    warnings.push(format!("The 2026 master has no slides for {}; add them by hand.", crate::proposal_library::module_name(m)));
                }
            }
            let slides = choices
                .iter()
                .zip(inspection.slides.iter())
                .map(|(c, s)| SlideChoice { index: s.index, slide_id: s.slide_id.clone(), title: s.title.clone(), included: c.included, reason: c.reason.clone(), source: String::new() })
                .collect();
            base_template = Some("MENA BIG Proposal Master 2026".into());
            services_title = Some(crate::proposal_library::services_title(&wanted));
            (pkg, inspection, slides)
        }
        (Some(template), _) => {
            let pkg = Package::read(Path::new(&template.path))?;
            let inspection = pptx::inspect(&pkg);
            let rules = merged_rules(&template.config, &inspection);
            let cats: Vec<String> = categories.iter().flatten().cloned().collect();
            let slides = choose_slides(&inspection, &rules, &deck.service_names, &cats, deck.entity_code.as_deref());
            (pkg, inspection, slides)
        }
        (None, Some(dir)) => {
            use crate::proposal_library as lib;
            let mut wanted: Vec<&'static str> = Vec::new();
            for (line, category) in proposal.lines.iter().zip(categories.iter()) {
                let modules = lib::modules_for_service(&line.service_name, category.as_deref());
                if modules.is_empty() && !line.service_name.trim().is_empty() {
                    warnings.push(format!("No template slides are known for \"{}\"; add its scope and fees by hand.", line.service_name.trim()));
                }
                for m in modules {
                    if !wanted.contains(&m) {
                        wanted.push(m);
                    }
                }
            }
            let library = lib::load_library(dir)?;
            let composed = lib::compose(&library, &wanted)?;
            for m in &composed.missing {
                warnings.push(format!("None of the templates has slides for {}; add them by hand.", lib::module_name(m)));
            }
            let inspection = pptx::inspect(&composed.package);
            let slides = composed
                .slides
                .iter()
                .zip(inspection.slides.iter())
                .map(|(c, s)| SlideChoice {
                    index: s.index,
                    slide_id: s.slide_id.clone(),
                    title: s.title.clone(),
                    included: true,
                    reason: if c.modules.is_empty() { "Standard slide".into() } else { format!("For {}", c.modules.iter().map(|m| lib::module_name(m)).collect::<Vec<_>>().join(", ")) },
                    source: c.source.clone(),
                })
                .collect();
            base_template = Some(composed.base.clone());
            services_title = Some(composed.title.clone());
            (composed.package, inspection, slides)
        }
        (None, None) => return Err("Choose a template.".into()),
    };
    let months = proposal.contract_months.filter(|m| *m > 0);
    for (s, info) in slides.iter_mut().zip(inspection.slides.iter()).filter(|_| master.is_none()) {
        if let Some(reason) = automatic_exclusion(&info.text, &proposal.lines, &categories, months) {
            s.included = false;
            s.reason = reason.into();
        }
    }
    if let Some(keep) = &request.keep {
        for s in slides.iter_mut() {
            let chosen = keep.contains(&s.index);
            if chosen != s.included {
                s.included = chosen;
                s.reason = if chosen { "Added by you".into() } else { "Removed by you".into() };
            }
        }
    }

    let business_setup = proposal.lines.iter().zip(categories.iter()).any(|(l, c)| crate::proposal_library::modules_for_service(&l.service_name, c.as_deref()).contains(&"business_setup"));
    if business_setup && months.map(|m| m < 12).unwrap_or(false) {
        warnings.push(format!(
            "Business Setup is free only with a 12-month term. This proposal is for {} months, so the deck charges the constitution fee ({}) and drops the free-setup wording.",
            months.unwrap_or(0),
            standards.constitution.map(|c| money(Some(c), "SAR")).unwrap_or_else(|| "set it on the rate card".into())
        ));
    }
    if proposal.lines.iter().any(|l| l.rates.iter().any(|r| r.price.is_none() && r.percent.is_none())) {
        warnings.push("Some service rows have no price yet; their fee cells keep the template's figure.".into());
    }
    if proposal.lines.is_empty() {
        warnings.push("This proposal has no services yet, so service slides and the fee table will be empty.".into());
    }
    if deck.values.get("contact_name").map(|v| v.is_empty()).unwrap_or(true) && inspection.tokens.iter().any(|t| t.starts_with("contact_")) {
        warnings.push("No primary contact is set; contact fields will be blank.".into());
    }
    if proposal.client.chars().count() > 40 {
        warnings.push("The client name is long and may not fit on the cover.".into());
    }
    for token in inspection.tokens.iter().filter(|_| master.is_none()) {
        if !token.starts_with("line.") && !TOKENS.iter().any(|t| t.token == token) {
            warnings.push(format!("The template uses {{{{{token}}}}}, which MENA One doesn't know."));
        }
    }

    let folder = proposal
        .folder_path
        .clone()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| root.as_ref().and_then(|r| crate::commercial::find_client_folder(r, &proposal.client)));
    let planned_folder = folder.clone().or_else(|| root.as_ref().map(|r| r.join(crate::commercial::safe_folder_name(&proposal.client))));
    let file_name = safe_file_name(&request.file_name);

    let mut result = GenerateResult {
        slides: slides.clone(),
        values: deck.values.clone(),
        folder: planned_folder.as_ref().map(|p| p.to_string_lossy().to_string()),
        folder_exists: folder.is_some(),
        file_name: file_name.clone(),
        warnings,
        base_template,
        services_title,
        ..Default::default()
    };
    let keep: BTreeSet<usize> = slides.iter().filter(|s| s.included).map(|s| s.index).collect();
    let replacements: Vec<(String, String)> = template
        .iter()
        .flat_map(|t| t.config.replacements.iter())
        .filter_map(|r| deck.values.get(r.token.trim()).map(|v| (r.find.clone(), v.clone())))
        .collect();
    let logo = match request.logo_path.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => match crate::smartfill::read_logo(Path::new(p)) {
            Ok(l) => Some(l),
            Err(e) => { result.warnings.push(e); None }
        },
        None => None,
    };
    let smart_lines: Vec<crate::smartfill::SmartLine> = proposal
        .lines
        .iter()
        .zip(line_cards.iter())
        .zip(categories.iter())
        .map(|((l, card), category)| crate::smartfill::SmartLine {
            months: (l.billing != "one_time").then(|| months.unwrap_or(12) as f64),
            ..smart_line(l, card.as_ref(), category.as_deref())
        })
        .collect();
    let currency = proposal.currency.clone().unwrap_or_else(|| "SAR".into());
    let country = deck.values.get("client_country").cloned().unwrap_or_default();
    let smart = template.as_ref().map(|t| t.config.smart_fields).unwrap_or(true).then(|| crate::smartfill::SmartInput {
        client_name: &proposal.client, date_iso: &request.date, country: Some(country.as_str()).filter(|c| !c.is_empty()),
        currency: &currency, lines: &smart_lines, logo, contract_months: months, standards: standards.clone(),
    });
    if keep.is_empty() {
        return Err("No slides are selected.".into());
    }
    let report = if master.is_some() {
        if result.warnings.iter().all(|w| !w.contains("logo")) && request.logo_path.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false) {
            result.warnings.push("The 2026 design has no client logo box yet, so the logo isn't placed.".into());
        }
        let empty = HashMap::new();
        let mut built = pptx::build(&mut pkg, &pptx::BuildInput { keep: &keep, values: &empty, lines: &[], replacements: &[] })?;
        let tags: Vec<crate::master::MasterTags> = inspection.slides.iter().filter(|s| keep.contains(&s.index)).map(|s| crate::master::parse(&s.notes)).collect();
        let mut values = deck.values.clone();
        values.insert("services_title".into(), result.services_title.clone().unwrap_or_default());
        values.insert("entity_region".into(), deck.entity_code.clone().unwrap_or_else(|| "KSA".into()));
        let country_line = match country.trim() {
            "" | "Saudi Arabia" | "KSA" => "Kingdom of Saudi Arabia".to_string(),
            other => other.to_string(),
        };
        values.insert("client_country_line".into(), country_line);
        let filled = crate::master::fill(&mut pkg, &tags, &crate::master::FillInput {
            values, lines: &master_lines, months, currency: &currency, constitution_standard: standards.constitution, maintenance_standard: standards.maintenance,
        });
        built.missing_tokens = filled.missing_tokens.clone();
        built.smart = Some(crate::smartfill::SmartReport { filled: filled.filled, fees_to_check: vec![], warnings: vec![], checks: filled.checks });
        built
    } else {
        pptx::build_with_smart_fields(&mut pkg, &pptx::BuildInput { keep: &keep, values: &deck.values, lines: &deck.lines, replacements: &replacements }, smart)?
    };
    if request.dry_run {
        result.report = Some(report);
        return Ok(result);
    }

    let root = root.ok_or("No Proposals folder was found in OneDrive. Choose one in Settings first.")?;
    let folder = match folder {
        Some(f) => f,
        None => {
            let name = crate::commercial::safe_folder_name(&proposal.client);
            if name.is_empty() || !crate::localfiles::is_within_onedrive(&root) {
                return Err("The client folder couldn't be created.".into());
            }
            let target = root.join(name);
            std::fs::create_dir_all(&target).map_err(|e| format!("Could not create the client folder: {e}"))?;
            target
        }
    };
    let out = folder.join(&file_name);
    if out.exists() {
        return Err(format!("{file_name} already exists in the client folder. Choose another name."));
    }
    let tmp = folder.join(format!(".{file_name}.partial"));
    pkg.write(&tmp)?;
    std::fs::rename(&tmp, &out).map_err(|e| format!("Could not save the proposal: {e}"))?;
    result.folder = Some(folder.to_string_lossy().to_string());
    result.folder_exists = true;
    result.path = Some(out.to_string_lossy().to_string());
    result.report = Some(report);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_dates_and_money_for_decks() {
        assert_eq!(long_date("2026-09-13"), "13 September 2026");
        assert_eq!(ordinal(1), "1st");
        assert_eq!(ordinal(12), "12th");
        assert_eq!(ordinal(23), "23rd");
        assert_eq!(WEEKDAYS[weekday(2026, 9, 13)], "Sunday");
        assert_eq!(WEEKDAYS[weekday(2024, 2, 29)], "Thursday");
        assert_eq!(money(Some(163000.0), "SAR"), "SAR 163,000");
        assert_eq!(money(Some(1234.5), "EUR"), "EUR 1,234.50");
        assert_eq!(sentence(&["Payroll".into(), "PRO".into(), "Recruitment".into()]), "Payroll, PRO and Recruitment");
        assert_eq!(safe_file_name("Acme/Co_Payroll Proposal_13.09.2026"), "Acme Co_Payroll Proposal_13.09.2026.pptx");
    }

    #[test]
    fn chooses_slides_by_rules_services_and_entity() {
        let slide = |i: usize| pptx::SlideInfo { index: i, slide_id: format!("{}", 255 + i), title: format!("S{i}"), ..Default::default() };
        let inspection = TemplateInspection { slide_count: 4, slides: (1..=4).map(slide).collect(), tokens: vec![] };
        let rule = |id: usize, include: &str, services: &[&str], entity: Option<&str>| SlideRule {
            slide_id: format!("{}", 255 + id), include: include.into(), services: services.iter().map(|s| s.to_string()).collect(), entity: entity.map(str::to_string),
        };
        let rules = vec![rule(1, "always", &[], None), rule(2, "services", &["Payroll"], None), rule(3, "services", &["Workforce Services"], None), rule(4, "always", &[], Some("EU"))];
        let chosen = choose_slides(&inspection, &rules, &["payroll".into()], &["GOSI & Payroll".into()], Some("KSA"));
        assert_eq!(chosen.iter().map(|c| c.included).collect::<Vec<_>>(), vec![true, true, false, false]);
        let by_category = choose_slides(&inspection, &rules, &["Mobilization".into()], &["Workforce Services".into()], Some("EU"));
        assert_eq!(by_category.iter().map(|c| c.included).collect::<Vec<_>>(), vec![true, false, true, true]);
    }
}
