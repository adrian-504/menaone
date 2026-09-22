//! The proposal template library: the folder of service templates the team
//! already uses ("Proposals New Logo"), read the way the team reads them.
//!
//! Every template has the same shape — cover, letter, agenda, then per
//! service a "PART 1" divider, approach slides, a "FEES BREAKDOWN" divider and
//! fee slides, then Terms, acceptance, About MENA BIG and the back cover.
//! `classify` labels each slide; `plan` picks the template that covers most of
//! a proposal's services, removes the modules it doesn't need and brings the
//! missing ones (and their service-specific terms) in from other templates.

use crate::pptx::{self, Package, TemplateInspection};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/// Service modules as the templates split them.
pub const MODULES: &[(&str, &str)] = &[
    ("admin_pro", "Administration & PRO"),
    ("gosi_payroll", "Payroll & GOSI"),
    ("accountancy", "Accountancy & VAT"),
    ("labor_law", "Labor Law Consultancy"),
    ("hr_consultancy", "HR Consultancy"),
    ("manpower", "Manpower & Recruitment Consultancy"),
    ("recruitment", "Recruitment Advisory"),
    // Names as the services are called since the 16-Sep-2026 renames.
    ("workforce", "Employer of Record"),
    ("constitution", "Business Setup"),
    ("maintenance", "Company Maintenance"),
    ("constitution_maintenance", "Company Constitution & Maintenance"),
    ("business_setup", "Business Setup & Maintenance"),
    ("mobilization", "Mobilization"),
    ("liquidation", "Company Liquidation"),
    ("gm_representative", "GM Representative"),
];

pub fn module_name(key: &str) -> &str {
    MODULES.iter().find(|(k, _)| *k == key).map(|(_, n)| *n).unwrap_or(key)
}

fn has_word(text: &str, word: &str) -> bool {
    text.split(|c: char| !c.is_alphanumeric()).any(|w| w == word)
}

/// Which modules a piece of text is about ("Admin PRO and Payroll" → both).
pub fn modules_in(text: &str) -> Vec<&'static str> {
    let t = text.to_lowercase();
    let mut out: Vec<&'static str> = Vec::new();
    let mut add = |k: &'static str| if !out.contains(&k) { out.push(k) };
    // Since the 16-Sep renames "Business Setup" is the one-time company setup (was Company
    // Constitution); with maintenance or "package" it is the Business Setup and Maintenance Package.
    if t.contains("business setup") && (t.contains("maintenance") || t.contains("package")) {
        add("business_setup");
    } else if t.contains("business setup") {
        add("constitution");
    } else if t.contains("constitution") && (t.contains("+ maintenance") || t.contains("& maintenance") || t.contains("and maintenance") || t.contains("maintenance package") || t.contains("maintenance bundle")) {
        add("constitution_maintenance");
    } else {
        if t.contains("constitution") { add("constitution"); }
        if t.contains("maintenance") { add("maintenance"); }
    }
    if t.contains("liquidation") { add("liquidation"); }
    let gm = t.contains("gm representative") || t.contains("temporary gm") || t.contains("general manager representative");
    if gm { add("gm_representative"); }
    if t.contains("mobili") { add("mobilization"); }
    if t.contains("workforce") || t.contains("employer of record") { add("workforce"); }
    if t.contains("manpower") { add("manpower"); } else if t.contains("recruit") { add("recruitment"); }
    if t.contains("hr consultancy") || t.contains("human resources consultancy") { add("hr_consultancy"); }
    if t.contains("labor law") || t.contains("labour law") { add("labor_law"); }
    if t.contains("gosi") || t.contains("payroll") { add("gosi_payroll"); }
    if !gm && (t.contains("admin") || t.contains("adminstration") || t.contains("government services") || has_word(&t, "pro")) { add("admin_pro"); }
    if t.contains("accountancy") || t.contains("bookkeeping") || has_word(&t, "vat") { add("accountancy"); }
    out
}

/// Modules for a proposal line: its service name first, then its catalog category.
pub fn modules_for_service(name: &str, category: Option<&str>) -> Vec<&'static str> {
    let by_name = modules_in(name);
    if !by_name.is_empty() {
        return by_name;
    }
    let by_category = category.map(modules_in).unwrap_or_default();
    if !by_category.is_empty() {
        return by_category;
    }
    if name.to_lowercase().contains("consultancy") { vec!["labor_law"] } else { vec![] }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Cover,
    Letter,
    Agenda,
    /// "Detailed Approach & Project Fees | 1", "Terms & Conditions | 2", "About MENA BIG | 3".
    Section,
    ServiceDivider,
    Approach,
    FeesDivider,
    Fees,
    /// Terms and conditions; `modules` is empty for the general ones.
    Terms,
    Acceptance,
    About,
    References,
    BackCover,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifiedSlide {
    pub index: usize,
    pub title: String,
    pub role: Role,
    pub modules: Vec<&'static str>,
}

impl ClassifiedSlide {
    pub fn is_module(&self) -> bool {
        matches!(self.role, Role::ServiceDivider | Role::Approach | Role::FeesDivider | Role::Fees) || (self.role == Role::Terms && !self.modules.is_empty())
    }
}

fn lines(text: &str) -> Vec<String> {
    text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

/// Labels every slide of a template.
pub fn classify(inspection: &TemplateInspection) -> Vec<ClassifiedSlide> {
    #[derive(PartialEq)]
    enum Zone { Front, Modules, Terms, About }
    let mut zone = Zone::Front;
    let mut current: Vec<&'static str> = Vec::new();
    let mut out = Vec::new();
    for s in &inspection.slides {
        // The whole slide: a terms slide's service subtitle can sit past the first 400 characters.
        let l = lines(if s.full_text.is_empty() { &s.text } else { &s.full_text });
        let first = l.first().cloned().unwrap_or_default();
        let joined = l.join(" | ");
        let lower = joined.to_lowercase();
        let short_numbered = l.len() <= 3 && l.iter().any(|x| x.chars().all(|c| c.is_ascii_digit()));
        let (role, modules): (Role, Vec<&'static str>) = if short_numbered && first.starts_with("Detailed Approach & Project Fees") {
            zone = Zone::Modules;
            (Role::Section, vec![])
        } else if short_numbered && first.starts_with("Terms & Conditions") {
            zone = Zone::Terms;
            (Role::Section, vec![])
        } else if short_numbered && first.starts_with("About MENA BIG") {
            zone = Zone::About;
            (Role::Section, vec![])
        } else if s.index == 1 && lower.contains("proposal for providing") {
            (Role::Cover, vec![])
        } else if first.starts_with("Attn:") {
            (Role::Letter, vec![])
        } else if first.eq_ignore_ascii_case("agenda") {
            (Role::Agenda, vec![])
        } else if lower.contains("@mena_big") || lower.contains("www.mena-big.com") {
            (Role::BackCover, vec![])
        } else if l.len() <= 7 && l.iter().any(|x| x == "PART" || x.starts_with("PART ")) {
            let label: String = l.iter().filter(|x| !x.starts_with("PART") && !x.chars().all(|c| c.is_ascii_digit())).cloned().collect::<Vec<_>>().join(" ");
            let found = modules_in(&label);
            zone = Zone::Modules;
            if lower.contains("breakdown") {
                // The Business Setup deck calls its fees "Company Maintenance Package".
                let m = if found.is_empty() || current.contains(&"business_setup") { current.clone() } else { found };
                (Role::FeesDivider, m)
            } else {
                current = found.clone();
                (Role::ServiceDivider, found)
            }
        } else if zone == Zone::About || lower.starts_with("50+") {
            if lower.contains("selected references") { (Role::References, vec![]) } else { (Role::About, vec![]) }
        } else if lower.starts_with("we believe that this proposal") || lower.contains("| acceptance | we believe") {
            (Role::Acceptance, vec![])
        } else if zone == Zone::Terms {
            // "Assumptions and Limitations – Workforce Services" marks terms for one service.
            let subject = l.iter().find(|x| x.to_lowercase().starts_with("assumptions and limitations")).map(|x| modules_in(x)).unwrap_or_default();
            (Role::Terms, subject)
        } else if first.starts_with("Detailed Approach") || first.starts_with("Why Company Maintenance") {
            let subtitle = l.get(1).cloned().unwrap_or_default();
            // "Recruitment Process" inside the Workforce module belongs to Workforce.
            let found = if subtitle.to_lowercase().contains("process") { vec![] } else { modules_in(&subtitle) };
            (Role::Approach, if found.is_empty() { current.clone() } else { found })
        } else if matches!(first.as_str(), "Value Based" | "Project Fees" | "Package Deal") {
            let subtitle = l.iter().position(|x| x == "Project Fees").and_then(|i| l.get(i + 1)).cloned().filter(|x| x != "Fees and Payment Terms");
            let found = if first == "Package Deal" { modules_in(&joined).into_iter().filter(|k| *k == "constitution_maintenance" || *k == "business_setup").collect() } else { subtitle.map(|x| modules_in(&x)).unwrap_or_default() };
            (Role::Fees, if found.is_empty() { current.clone() } else { found })
        } else if zone == Zone::Modules {
            (Role::Approach, current.clone())
        } else {
            (Role::Other, vec![])
        };
        out.push(ClassifiedSlide { index: s.index, title: s.title.clone(), role, modules });
    }
    // A package deck (cover: "Business Setup & Maintenance Services") explains the package on
    // its own slides, even where a slide names only the setup or only the maintenance.
    if cover_services(inspection).map(|c| modules_in(&c) == vec!["business_setup"]).unwrap_or(false) {
        for s in out.iter_mut().filter(|s| s.is_module()) {
            s.modules = vec!["business_setup"];
        }
    }
    out
}

/// Modules a template has content for (approach or fee slides).
pub fn covered(slides: &[ClassifiedSlide]) -> BTreeSet<&'static str> {
    slides.iter().filter(|s| matches!(s.role, Role::Approach | Role::Fees)).flat_map(|s| s.modules.iter().copied()).collect()
}

#[derive(Debug, Clone)]
pub struct LibraryTemplate {
    pub path: String,
    pub name: String,
    pub slides: Vec<ClassifiedSlide>,
    /// The cover shows a real client instead of 'Client Name': a sent proposal kept as a template.
    pub client_on_cover: Option<String>,
}

pub fn client_on_cover(inspection: &TemplateInspection) -> Option<String> {
    let cover = inspection.slides.first()?;
    let l = lines(&cover.text);
    let i = l.iter().position(|x| x == "Proposal for Providing")?;
    let candidate = l[..i].iter().rev().find(|x| *x != "Photos" && *x != "Logo")?.clone();
    let placeholder = candidate.contains("Client Name") || candidate.contains("New Client") || candidate.starts_with('\'');
    (!placeholder).then_some(candidate)
}

/// The services line on the cover ("Accountancy Services").
pub fn cover_services(inspection: &TemplateInspection) -> Option<String> {
    let l = lines(&inspection.slides.first()?.text);
    let i = l.iter().position(|x| x == "Proposal for Providing")?;
    l.get(i + 1).cloned()
}

#[derive(Debug, Clone)]
pub struct Import {
    pub template: usize,
    pub positions: Vec<usize>,
    pub terms: bool,
    pub module: &'static str,
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub base: usize,
    /// 1-based slides of the base template to keep.
    pub keep: BTreeSet<usize>,
    pub imports: Vec<Import>,
    /// Requested modules no template has slides for.
    pub missing: Vec<&'static str>,
}

/// A bundle's deck explains each of its services on its own slides.
fn parts_of(key: &str) -> &'static [&'static str] {
    match key {
        "constitution_maintenance" => &["constitution", "maintenance"],
        _ => &[],
    }
}

/// Chooses the base template and what to bring in from the others.
pub fn plan(library: &[LibraryTemplate], wanted: &[&'static str]) -> Result<Plan, String> {
    if library.is_empty() {
        return Err("No proposal templates were found.".into());
    }
    let wanted_set: BTreeSet<&str> = wanted.iter().flat_map(|k| std::iter::once(*k).chain(parts_of(k).iter().copied())).collect();
    let bases: Vec<usize> = (0..library.len()).filter(|&i| library[i].slides.iter().any(|s| s.role == Role::Cover) && library[i].slides.iter().any(|s| s.role == Role::Letter)).collect();
    if bases.is_empty() {
        return Err("None of the templates has a cover and letter to start from.".into());
    }
    let score = |i: usize| {
        let cov = covered(&library[i].slides);
        let hits = wanted_set.iter().filter(|k| cov.contains(*k)).count() as i64;
        let extra = cov.iter().filter(|k| !wanted_set.contains(*k)).count() as i64;
        let client_penalty = if library[i].client_on_cover.is_some() { 1 } else { 0 };
        (hits * 100 - extra * 10 - client_penalty * 1000, std::cmp::Reverse(library[i].slides.len()))
    };
    // The deck of the proposal's first line leads: its general terms are the proposal's
    // general terms. The score only chooses among the decks that carry that first service.
    let leads: Vec<usize> = bases.iter().copied().filter(|&i| wanted.first().map(|m| covered(&library[i].slides).contains(m)).unwrap_or(false)).collect();
    let base = *if leads.is_empty() { &bases } else { &leads }.iter().max_by_key(|&&i| score(i)).expect("non-empty");
    let base_cov = covered(&library[base].slides);
    let base_slides = &library[base].slides;
    let wanted_slide = |s: &ClassifiedSlide| !s.is_module() || s.modules.is_empty() && s.role != Role::Terms || s.modules.iter().any(|m| wanted_set.contains(m));
    let keep: BTreeSet<usize> = base_slides
        .iter()
        .enumerate()
        .filter(|(i, s)| {
            if !matches!(s.role, Role::ServiceDivider | Role::FeesDivider) {
                return wanted_slide(s);
            }
            // A divider stays when a slide it introduces stays ("ADMINISTRATION SERVICES" also opens GOSI).
            let section: Vec<&ClassifiedSlide> = base_slides[i + 1..].iter().take_while(|n| matches!(n.role, Role::Approach | Role::Fees)).collect();
            if section.is_empty() { wanted_slide(s) } else { section.iter().any(|n| wanted_slide(n)) }
        })
        .map(|(_, s)| s.index)
        .collect();
    let mut imports = Vec::new();
    let mut missing = Vec::new();
    // The Business Setup and Maintenance Package also shows Company Maintenance's detailed
    // approach (its main tasks) beside its own scope; the package's pricing stays its own.
    if wanted.contains(&"business_setup") && !wanted.contains(&"maintenance") && !base_cov.contains("maintenance") {
        let source = (0..library.len())
            .filter(|&i| i != base && covered(&library[i].slides) == BTreeSet::from(["maintenance"]))
            .min_by_key(|&i| (library[i].client_on_cover.is_some(), library[i].slides.len()));
        if let Some(src) = source {
            let approach: Vec<usize> = library[src].slides.iter().filter(|s| s.role == Role::Approach && s.modules == ["maintenance"]).map(|s| s.index).collect();
            if !approach.is_empty() {
                imports.push(Import { template: src, positions: approach, terms: false, module: "business_setup" });
            }
        }
    }
    for &key in wanted {
        if base_cov.contains(key) || imports.iter().any(|x: &Import| x.module == key) {
            continue;
        }
        // The template most focused on this service, sent-proposal copies last.
        let source = (0..library.len())
            .filter(|&i| i != base && covered(&library[i].slides).contains(key))
            .min_by_key(|&i| (library[i].client_on_cover.is_some(), covered(&library[i].slides).len(), library[i].slides.len()));
        let Some(src) = source else {
            missing.push(key);
            continue;
        };
        let slides = &library[src].slides;
        let module: Vec<usize> = slides
            .iter()
            .filter(|s| matches!(s.role, Role::ServiceDivider | Role::Approach | Role::FeesDivider | Role::Fees) && s.modules.iter().any(|m| *m == key || parts_of(key).contains(m)))
            .map(|s| s.index)
            .collect();
        imports.push(Import { template: src, positions: module, terms: false, module: key });
        // Its own terms; a deck whose terms are one merged general slide (Admin & PRO,
        // Maintenance, Labour Law) offers that, and composition keeps only the clauses it adds.
        let mut terms: Vec<usize> = slides.iter().filter(|s| s.role == Role::Terms && s.modules.contains(&key)).map(|s| s.index).collect();
        if terms.is_empty() {
            terms = slides.iter().filter(|s| s.role == Role::Terms && s.modules.is_empty()).map(|s| s.index).collect();
        }
        if !terms.is_empty() {
            imports.push(Import { template: src, positions: terms, terms: true, module: key });
        }
    }
    Ok(Plan { base, keep, imports, missing })
}

/// "Accountancy & VAT and Labor Law Consultancy Services".
pub fn services_title(modules: &[&str]) -> String {
    let names: Vec<&str> = modules.iter().map(|m| module_name(m)).collect();
    let joined = match names.len() {
        0 => String::new(),
        1 => names[0].to_string(),
        n => format!("{} and {}", names[..n - 1].join(", "), names[n - 1]),
    };
    format!("{joined} Services")
}

// ═══════════════ Reading the folder ═══════════════

type CacheEntry = (Option<SystemTime>, u64, LibraryTemplate);

/// A service template: "… Template.pptx" (any separator before "Template"). The All Services
/// deck is a reference copy of the service templates, not a source; other decks saved in the
/// folder (sent proposals) are not templates.
pub fn is_template_file(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let lower = name.to_lowercase();
    p.is_file() && !name.starts_with("~$") && !name.starts_with('.') && lower.ends_with("template.pptx") && !lower.starts_with("all services")
}

/// PowerPoint files in the folder that are not read as templates, for the Generate report.
pub fn ignored_files(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<String> = entries.filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| { let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(); let l = n.to_lowercase(); l.ends_with(".pptx") && !n.starts_with("~$") && !n.starts_with('.') && !l.starts_with("all services") && !is_template_file(p) })
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .collect();
    out.sort();
    out
}

/// Every template in the folder, classified. Files are only re-read when they change.
pub fn load_library(dir: &Path) -> Result<Vec<LibraryTemplate>, String> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Could not open the templates folder: {e}"))?;
    let mut paths: Vec<std::path::PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_template_file(p))
        .collect();
    paths.sort();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut out = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().to_string();
        let meta = std::fs::metadata(&path).ok();
        let (modified, size) = (meta.as_ref().and_then(|m| m.modified().ok()), meta.as_ref().map(|m| m.len()).unwrap_or(0));
        if let Some((m, sz, t)) = cache.lock().map_err(|e| e.to_string())?.get(&key) {
            if *m == modified && *sz == size {
                out.push(t.clone());
                continue;
            }
        }
        // A file OneDrive hasn't downloaded yet, or a broken one, is skipped.
        let Ok(pkg) = Package::read(&path) else { continue };
        let inspection = pptx::inspect(&pkg);
        let template = LibraryTemplate {
            path: key.clone(),
            name: path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
            slides: classify(&inspection),
            client_on_cover: client_on_cover(&inspection),
        };
        cache.lock().map_err(|e| e.to_string())?.insert(key, (modified, size, template.clone()));
        out.push(template);
    }
    Ok(out)
}

// ═══════════════ Putting a deck together ═══════════════

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposedSlide {
    pub title: String,
    pub role: Role,
    pub modules: Vec<&'static str>,
    /// Template the slide comes from.
    pub source: String,
    pub source_index: usize,
}

pub struct Composition {
    pub package: Package,
    pub slides: Vec<ComposedSlide>,
    pub base: String,
    pub missing: Vec<&'static str>,
    /// The services line written on the cover and letter.
    pub title: String,
}

fn is_service_content(role: Role) -> bool {
    matches!(role, Role::ServiceDivider | Role::Approach | Role::FeesDivider | Role::Fees)
}

/// Where imported service slides go: after the last service slide, else
/// after the "Detailed Approach & Project Fees" section slide.
fn modules_insert_at(slides: &[ComposedSlide]) -> usize {
    if let Some(last) = slides.iter().rposition(|s| is_service_content(s.role)) {
        return last + 1;
    }
    if let Some(first_section) = slides.iter().position(|s| s.role == Role::Section) {
        return first_section + 1;
    }
    slides.iter().position(|s| matches!(s.role, Role::Terms | Role::Acceptance | Role::About | Role::BackCover)).unwrap_or(slides.len())
}

/// Service terms go just before the acceptance slide.
fn terms_insert_at(slides: &[ComposedSlide]) -> usize {
    if let Some(i) = slides.iter().position(|s| s.role == Role::Acceptance) {
        return i;
    }
    match slides.iter().rposition(|s| s.role == Role::Terms) {
        Some(i) => i + 1,
        None => modules_insert_at(slides),
    }
}

/// A sent proposal used as a template: its client's name goes back to the placeholder.
fn neutralise_client(pkg: &mut Package, parts: &[String], client: &str) {
    // The client's name in any case: "MAC GROUP" goes back to 'CLIENT NAME', "Mac Group" to 'Client Name'.
    let caps = |s: &str| s.chars().any(|c| c.is_alphabetic()) && s.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_uppercase());
    let named = regex::Regex::new(&format!("(?i){}", regex::escape(client))).ok();
    let mut pairs: Vec<(String, String)> = Vec::new();
    for part in parts {
        for p in pptx::paragraphs(&pkg.text_of(part)) {
            for m in named.iter().flat_map(|r| r.find_iter(&p)) {
                let written = m.as_str().to_string();
                if !pairs.iter().any(|(w, _)| *w == written) {
                    let placeholder = if caps(&written) && !caps(client) { "'CLIENT NAME'" } else { "'Client Name'" };
                    pairs.push((written, placeholder.to_string()));
                }
            }
        }
    }
    for part in parts {
        let (xml, n) = pptx::fill_placeholders(&pkg.text_of(part), &pairs);
        if n > 0 {
            pkg.set_text(part, xml);
        }
    }
}

/// Builds the deck for these services from the library: the best-fitting
/// template with the other services' slides brought in, cover and letter
/// retitled. Client name, date, logo and fees are filled afterwards.
pub fn compose(library: &[LibraryTemplate], wanted: &[&'static str]) -> Result<Composition, String> {
    if wanted.is_empty() {
        return Err("Add the proposal's services first, so MENA One knows which templates to use.".into());
    }
    let plan = plan(library, wanted)?;
    let base = &library[plan.base];
    let mut pkg = Package::read(Path::new(&base.path))?;
    let base_inspection = pptx::inspect(&pkg);
    let empty = HashMap::new();
    pptx::build(&mut pkg, &pptx::BuildInput { keep: &plan.keep, values: &empty, lines: &[], replacements: &[] })?;
    let mut slides: Vec<ComposedSlide> = base
        .slides
        .iter()
        .filter(|s| plan.keep.contains(&s.index))
        .map(|s| ComposedSlide { title: s.title.clone(), role: s.role, modules: s.modules.clone(), source: base.name.clone(), source_index: s.index })
        .collect();
    if let Some(client) = &base.client_on_cover {
        let parts = pptx::slide_parts_in_order(&pkg);
        neutralise_client(&mut pkg, &parts, client);
    }
    // The base deck's own terms slides say each clause once too.
    {
        let parts = pptx::slide_parts_in_order(&pkg);
        let mut seen = HashSet::new();
        for (s, part) in slides.iter().zip(parts.iter()) {
            if s.role != Role::Terms { continue; }
            let xml = pkg.text_of(part);
            let cleaned = without_clauses(&xml, &seen);
            seen.extend(clause_keys(&cleaned));
            if cleaned != xml { pkg.set_text(part, cleaned); }
        }
    }

    let mut sources: HashMap<usize, Package> = HashMap::new();
    // Terms: the general block is in the deck once (from the base). Other services' clauses that
    // aren't there yet are gathered into one service-terms section, grouped by service.
    let mut seen = terms_clauses(&pkg, &slides);
    let mut service_terms: Vec<TermsGroup> = Vec::new();
    let mut vessel: Option<(usize, usize)> = None;
    for import in &plan.imports {
        let src_template = &library[import.template];
        if !sources.contains_key(&import.template) {
            sources.insert(import.template, Package::read(Path::new(&src_template.path))?);
        }
        let src = &sources[&import.template];
        let positions: Vec<usize> = if import.terms {
            let src_parts = pptx::slide_parts_in_order(src);
            let mut whole = Vec::new();
            for &p in &import.positions {
                let Some(part) = src_parts.get(p - 1) else { continue };
                let xml = src.text_of(part);
                if xml.contains("name=\"Terms Card") {
                    // Card-style terms: their new clauses join the service-terms section.
                    if collect_service_terms(&xml, import.module, &mut seen, &mut service_terms) && vessel.is_none() {
                        vessel = Some((import.template, p));
                    }
                } else if pptx::paragraphs(&xml).iter().any(|t| !clause_sentences(t).is_empty() && !repeats(t, &seen)) {
                    // Other terms slides (Employer of Record's own) come in whole, without repeated clauses.
                    whole.push(p);
                }
            }
            whole
        } else {
            import.positions.clone()
        };
        if positions.is_empty() {
            continue;
        }
        let approach_only = !import.terms && positions.iter().all(|p| src_template.slides.iter().any(|s| s.index == *p && s.role == Role::Approach));
        let at = if import.terms {
            terms_insert_at(&slides)
        } else if approach_only {
            // Beside the module's own approach slides, before its fees.
            slides.iter().rposition(|s| s.role == Role::Approach && s.modules.contains(&import.module)).map(|i| i + 1).unwrap_or_else(|| modules_insert_at(&slides))
        } else {
            modules_insert_at(&slides)
        };
        let added = crate::pptx_import::import_slides(&mut pkg, src, &positions, at)?;
        if import.terms {
            for part in pptx::slide_parts_in_order(&pkg)[at..at + added].to_vec() {
                let xml = without_clauses(&pkg.text_of(&part), &seen);
                seen.extend(clause_keys(&xml));
                pkg.set_text(&part, xml);
            }
        }
        let new_slides: Vec<ComposedSlide> = positions
            .iter()
            .filter_map(|p| src_template.slides.iter().find(|s| s.index == *p))
            .map(|s| ComposedSlide { title: s.title.clone(), role: s.role, modules: s.modules.clone(), source: src_template.name.clone(), source_index: s.index })
            .collect();
        if new_slides.len() != added {
            return Err(format!("Slides from {} could not all be copied.", src_template.name));
        }
        if let Some(client) = &src_template.client_on_cover {
            let parts: Vec<String> = pptx::slide_parts_in_order(&pkg)[at..at + added].to_vec();
            neutralise_client(&mut pkg, &parts, client);
        }
        slides.splice(at..at, new_slides);
    }
    if let (Some((template, position)), false) = (vessel, service_terms.is_empty()) {
        let pages = layout_service_terms(&service_terms);
        let src = &sources[&template];
        let modules: Vec<&'static str> = wanted.iter().copied().filter(|m| service_terms.iter().any(|g| g.module == *m)).collect();
        let subtitle = format!("Assumptions and Limitations – {}", services_title(&modules));
        for page in pages {
            let at = terms_insert_at(&slides);
            crate::pptx_import::import_slides(&mut pkg, src, &[position], at)?;
            let part = pptx::slide_parts_in_order(&pkg)[at].clone();
            let xml = service_terms_slide(&pkg.text_of(&part), &page, &service_terms, &subtitle);
            pkg.set_text(&part, xml);
            if let Some(client) = &library[template].client_on_cover {
                neutralise_client(&mut pkg, &[part.clone()], client);
            }
            slides.insert(at, ComposedSlide { title: "Terms & Conditions, and Acceptance".into(), role: Role::Terms, modules: modules.clone(), source: "service terms".into(), source_index: 0 });
        }
    }
    // Service sections follow the order of the proposal's lines.
    order_sections(&mut pkg, &mut slides, wanted);

    // Cover and letter name the services this proposal is for.
    let base_cov = covered(&base.slides);
    let wanted_present: Vec<&'static str> = wanted.iter().copied().filter(|m| !plan.missing.contains(m)).collect();
    let old_title = cover_services(&base_inspection);
    let title = match &old_title {
        // One service on its own template keeps the template's wording; more than one are all named.
        Some(old) if wanted_present.len() == 1 && base_cov.iter().copied().collect::<BTreeSet<_>>() == wanted_present.iter().copied().collect::<BTreeSet<_>>() => old.clone(),
        _ => services_title(&wanted_present),
    };
    if let Some(old) = old_title.filter(|o| *o != title && !wanted_present.is_empty()) {
        let parts = pptx::slide_parts_in_order(&pkg);
        for (i, s) in slides.iter().enumerate() {
            let Some(part) = parts.get(i) else { continue };
            let xml = pkg.text_of(part);
            let edited = match s.role {
                Role::Cover => crate::smartfill::rewrite_shapes(&xml, |t| (t.trim() == old).then(|| title.clone())).0,
                Role::Letter => pptx::fill_placeholders(&xml, &[(format!("Proposal for Providing {old}"), format!("Proposal for Providing {title}"))]).0,
                _ => continue,
            };
            pkg.set_text(part, edited);
        }
    }
    renumber_parts(&mut pkg, &slides);
    Ok(Composition { package: pkg, slides, base: base.name.clone(), missing: plan.missing, title })
}

/// One service's clauses under one of its headings, for the service-terms section.
struct TermsGroup {
    module: &'static str,
    heading: String,
    /// (bullet level, the paragraph's runs, its text)
    clauses: Vec<(usize, String, String)>,
}

/// Adds a card-style terms slide's new clauses to the service-terms section, keeping each
/// card's heading. Returns whether anything was added.
fn collect_service_terms(xml: &str, module: &'static str, seen: &mut HashSet<String>, groups: &mut Vec<TermsGroup>) -> bool {
    static CARD: OnceLock<regex::Regex> = OnceLock::new();
    static PARA: OnceLock<regex::Regex> = OnceLock::new();
    static RUN: OnceLock<regex::Regex> = OnceLock::new();
    let card = CARD.get_or_init(|| regex::Regex::new(r#"(?s)<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="Terms Card (\d+)"/>.*?</p:sp>"#).expect("regex"));
    let para = PARA.get_or_init(|| regex::Regex::new(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>").expect("regex"));
    let run = RUN.get_or_init(|| regex::Regex::new(r"(?s)<a:r>.*?</a:r>").expect("regex"));
    let mut cards: Vec<(usize, &str)> = card.captures_iter(xml).filter_map(|c| Some((c[1].parse().ok()?, c.get(0)?.as_str()))).collect();
    cards.sort_by_key(|c| c.0);
    let mut added = false;
    for (_, shape) in cards {
        let mut heading = String::new();
        let mut clauses = Vec::new();
        for p in para.find_iter(shape).map(|m| m.as_str()) {
            let text = pptx::paragraphs(p).join(" ");
            if text.trim().is_empty() { continue; }
            if !p.contains("<a:buChar") {
                if heading.is_empty() { heading = text.trim().to_string(); }
                continue;
            }
            if repeats(&text, seen) { continue; }
            let level = pptx::attr(p, "marL").and_then(|m| m.parse::<i64>().ok()).map(|m| (m / 187200).max(1) as usize).unwrap_or(1);
            seen.extend(clause_sentences(&text));
            clauses.push((level, run.find_iter(p).map(|m| m.as_str()).collect::<String>(), text.trim().to_string()));
        }
        // A heading with only sub-headings left (no clause) says nothing.
        if clauses.iter().all(|c| clause_sentences(&c.2).is_empty()) { continue; }
        groups.push(TermsGroup { module, heading, clauses });
        added = true;
    }
    added
}

const COL_LEFT: i64 = 152400;
const COL_GAP: i64 = 203200;
const COL_W: i64 = (12192000 - 2 * 152400 - 203200) / 2;
const CARDS_TOP: i64 = 838200;
const CARDS_BOTTOM: i64 = 6480000;

/// A card's height at 10.5 pt (Calibri, about half an em per character).
fn group_height(g: &TermsGroup) -> i64 {
    let line = 10.5 * 1.22 * 12700.0;
    let usable = (COL_W - 2 * 91440) as f64;
    let mut h = 2.0 * 45720.0 + 4.0 * 12700.0 + line * 1.15 + 3.0 * 12700.0;
    for (level, _, text) in &g.clauses {
        let cpl = (((usable - 187200.0 * *level as f64) / 12700.0) / (10.5 * 0.5)).max(20.0);
        h += line * (text.chars().count() as f64 / cpl).ceil().max(1.0) + 5.0 * 12700.0;
    }
    h as i64
}

/// Pages of cards: each group goes to the shorter column; a new page when neither fits.
fn layout_service_terms(groups: &[TermsGroup]) -> Vec<Vec<(usize, i64, i64, i64)>> {
    let mut pages = Vec::new();
    let mut page: Vec<(usize, i64, i64, i64)> = Vec::new();
    let mut bottoms = [CARDS_TOP, CARDS_TOP];
    for (i, g) in groups.iter().enumerate() {
        let h = group_height(g);
        let c = if bottoms[0] <= bottoms[1] { 0 } else { 1 };
        if bottoms[c] + h > CARDS_BOTTOM && !page.is_empty() {
            pages.push(std::mem::take(&mut page));
            bottoms = [CARDS_TOP, CARDS_TOP];
        }
        let c = if bottoms[0] <= bottoms[1] { 0 } else { 1 };
        page.push((i, COL_LEFT + c as i64 * (COL_W + COL_GAP), bottoms[c], h));
        bottoms[c] += h + COL_GAP;
    }
    if !page.is_empty() { pages.push(page); }
    pages
}

/// A service-terms page: the vessel slide's title stays, its cards and lead-in go, the
/// subtitle names the services, and one card per service heading is drawn.
fn service_terms_slide(xml: &str, page: &[(usize, i64, i64, i64)], groups: &[TermsGroup], subtitle: &str) -> String {
    static SP: OnceLock<regex::Regex> = OnceLock::new();
    let sp = SP.get_or_init(|| regex::Regex::new(r"(?s)<p:sp>.*?</p:sp>").expect("regex"));
    let mut out = xml.to_string();
    for shape in sp.find_iter(xml).map(|m| m.as_str().to_string()).collect::<Vec<_>>() {
        if shape.contains("name=\"Terms Card") || shape.contains("name=\"LeadIn Bar\"") {
            out = out.replacen(&shape, "", 1);
        }
    }
    let (titled, _) = crate::smartfill::rewrite_paragraphs(&out, |_, t| t.trim().starts_with("Assumptions and Limitations").then(|| subtitle.to_string()));
    let mut next_id = regex::Regex::new(r#"<p:cNvPr id="(\d+)""#).expect("regex").captures_iter(&titled).filter_map(|c| c[1].parse::<u32>().ok()).max().unwrap_or(1) + 1;
    let mut cards = String::new();
    for (i, x, y, h) in page {
        let g = &groups[*i];
        let heading = if g.heading.is_empty() { format!("{} Services", module_name(g.module)) } else { format!("{} · {}", module_name(g.module), g.heading) };
        let mut body = format!(r#"<a:p><a:pPr marL="0" indent="0"><a:spcAft><a:spcPts val="300"/></a:spcAft><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" sz="1100" b="1" dirty="0"><a:solidFill><a:srgbClr val="004C8E"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>{}</a:t></a:r></a:p>"#, xml_escape(&heading));
        for (level, runs, _) in &g.clauses {
            body.push_str(&format!(r#"<a:p><a:pPr marL="{}" indent="-187200" algn="l"><a:spcAft><a:spcPts val="500"/></a:spcAft><a:buClr><a:srgbClr val="005DA5"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="{}"/></a:pPr>{}</a:p>"#, 187200 * *level as i64, if *level <= 1 { "●" } else { "–" }, runs));
        }
        cards.push_str(&format!(r#"<p:sp><p:nvSpPr><p:cNvPr id="{next_id}" name="Terms Card {}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{COL_W}" cy="{h}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 6000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="F7FAFC"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>{body}</p:txBody></p:sp>"#, i + 1));
        next_id += 1;
    }
    // Cards first in shape order, as on the other terms slides.
    match titled.find("</p:grpSpPr>") {
        Some(k) => format!("{}{}{}", &titled[..k + "</p:grpSpPr>".len()], cards, &titled[k + "</p:grpSpPr>".len()..]),
        None => titled,
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Service sections (a service divider and the slides up to the next one) in the order of the
/// proposal's lines; the rest of the deck stays where it is. Dividers are renumbered after.
fn order_sections(pkg: &mut Package, slides: &mut Vec<ComposedSlide>, wanted: &[&'static str]) {
    let rank = |m: &&'static str| wanted.iter().position(|w| w == m).unwrap_or(usize::MAX);
    let Some(first) = slides.iter().position(|s| s.role == Role::ServiceDivider) else { return };
    let last = slides.iter().rposition(|s| is_service_content(s.role)).unwrap_or(first);
    if slides[first..=last].iter().any(|s| !is_service_content(s.role)) { return; }
    let mut groups: Vec<(usize, Vec<usize>)> = Vec::new();
    for i in first..=last {
        if slides[i].role == Role::ServiceDivider || groups.is_empty() { groups.push((usize::MAX, Vec::new())); }
        let g = groups.last_mut().expect("group");
        g.1.push(i);
        g.0 = g.0.min(slides[i].modules.iter().map(rank).min().unwrap_or(usize::MAX));
    }
    let mut sorted = groups.clone();
    sorted.sort_by_key(|g| g.0);
    if sorted.iter().map(|g| g.1[0]).eq(groups.iter().map(|g| g.1[0])) { return; }
    let mut order: Vec<usize> = (0..first).collect();
    order.extend(sorted.iter().flat_map(|g| g.1.iter().copied()));
    order.extend(last + 1..slides.len());
    reorder_slides(pkg, &order);
    *slides = order.iter().map(|&i| slides[i].clone()).collect();
}

/// Puts the deck's slides in this order (indexes into the current order).
pub(crate) fn reorder_slides(pkg: &mut Package, order: &[usize]) {
    let pres = pkg.text_of("ppt/presentation.xml");
    let ids: Vec<String> = regex::Regex::new(r"<p:sldId\b[^>]*/>").expect("regex").find_iter(&pres).map(|m| m.as_str().to_string()).collect();
    if ids.len() != order.len() { return; }
    let Some(start) = pres.find("<p:sldIdLst>") else { return };
    let Some(end) = pres.find("</p:sldIdLst>") else { return };
    let list: String = order.iter().map(|&i| ids[i].clone()).collect();
    pkg.set_text("ppt/presentation.xml", format!("{}<p:sldIdLst>{}{}", &pres[..start], list, &pres[end..]));
}

/// Service dividers ("… PART 1") numbered in deck order: a mixed deck reads 1, 2, 3, not 1, 2, 1.
fn renumber_parts(pkg: &mut Package, slides: &[ComposedSlide]) {
    let parts = pptx::slide_parts_in_order(pkg);
    let mut n = 0;
    for (i, s) in slides.iter().enumerate() {
        if !matches!(s.role, Role::ServiceDivider | Role::FeesDivider) { continue; }
        let Some(part) = parts.get(i) else { continue };
        let xml = pkg.text_of(part);
        n += 1;
        let (edited, changed) = renumber_part_xml(&xml, n);
        if changed { pkg.set_text(part, edited); }
    }
}

/// Sets the number after "PART" (its own paragraph, or "PART 1" in one).
fn renumber_part_xml(xml: &str, n: usize) -> (String, bool) {
    let mut after_part = false;
    let (out, changed) = crate::smartfill::rewrite_paragraphs(xml, |_, t| {
        let t = t.trim();
        if t.eq_ignore_ascii_case("part") { after_part = true; return None; }
        if after_part && !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) { after_part = false; return (t != n.to_string()).then(|| n.to_string()); }
        if let Some(rest) = t.strip_prefix("PART ").filter(|r| r.chars().all(|c| c.is_ascii_digit())) { return (rest != n.to_string()).then(|| format!("PART {n}")); }
        None
    });
    (out, changed > 0)
}

/// A clause's sentences as compared across decks: lower case, single spaces, the client
/// placeholder as "client". Titles, subtitles and short headings are not clauses.
fn clause_sentences(text: &str) -> Vec<String> {
    let t = crate::smartfill::client_placeholder_regex().replace_all(text, "client").to_lowercase();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let heading = ["terms & conditions", "assumptions and limitations"];
    if t.chars().count() < 30 || heading.iter().any(|h| t.starts_with(h)) {
        return vec![];
    }
    // The decks word some clauses several ways; each family is one clause (the first wording wins).
    if let Some(family) = clause_family(&t) {
        return vec![family.to_string()];
    }
    t.split(". ").map(|s| s.trim().trim_end_matches(['.', ';', ':', ',']).to_string()).filter(|s| s.chars().count() >= 15).collect()
}

/// Clauses every deck carries in its own words.
fn clause_family(t: &str) -> Option<&'static str> {
    let money = t.contains("fee") || t.contains("price") || t.contains("rate");
    if t.contains("vat") && t.contains("exclud") {
        Some("§ prices exclude vat")
    } else if t.contains("as per the current governmental expenses") {
        Some("§ changes in governmental expenses invoiced at cost")
    } else if money && t.contains("exclud") && (t.contains("governmental") || t.contains("any costs")) {
        Some("§ fees exclude governmental expenses and taxes")
    } else if t.contains("last purchase order") {
        Some("§ services finalised against the last purchase orders")
    } else if t.contains("non-refundable") && t.contains("payment") {
        Some("§ payments are non-refundable")
    } else {
        None
    }
}

fn clause_keys(xml: &str) -> HashSet<String> {
    pptx::paragraphs(xml).iter().flat_map(|p| clause_sentences(p)).collect()
}

/// Every sentence of this paragraph is already in the deck.
fn repeats(text: &str, seen: &HashSet<String>) -> bool {
    let s = clause_sentences(text);
    !s.is_empty() && s.iter().all(|k| seen.contains(k))
}

/// Clauses on the deck's terms slides so far.
fn terms_clauses(pkg: &Package, slides: &[ComposedSlide]) -> HashSet<String> {
    let parts = pptx::slide_parts_in_order(pkg);
    slides.iter().zip(parts.iter()).filter(|(s, _)| s.role == Role::Terms).flat_map(|(_, p)| clause_keys(&pkg.text_of(p))).collect()
}

/// A terms slide without the clauses already in the deck: shapes left without text go, a terms
/// card left with only its heading goes, and the remaining cards close up in their columns.
fn without_clauses(xml: &str, seen: &HashSet<String>) -> String {
    static PARA: OnceLock<regex::Regex> = OnceLock::new();
    static SP: OnceLock<regex::Regex> = OnceLock::new();
    let para = PARA.get_or_init(|| regex::Regex::new(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>").expect("regex"));
    let sp = SP.get_or_init(|| regex::Regex::new(r"(?s)<p:sp>.*?</p:sp>").expect("regex"));
    let mut out = xml.to_string();
    let mut top = cards_top(xml);
    // Clauses count as seen as the slide is read, so a repeat on the same slide goes too.
    let mut seen = seen.clone();
    for shape in sp.find_iter(xml).map(|m| m.as_str().to_string()).collect::<Vec<_>>() {
        let mut edited = shape.clone();
        let mut removed = 0;
        for p in para.find_iter(&shape).map(|m| m.as_str().to_string()).collect::<Vec<_>>() {
            let text = pptx::paragraphs(&p).join(" ");
            if repeats(&text, &seen) {
                edited = edited.replacen(&p, "", 1);
                removed += 1;
            } else {
                seen.extend(clause_sentences(&text));
            }
        }
        if removed == 0 { continue; }
        edited = without_empty_subheadings(&edited);
        let empty = pptx::paragraphs(&edited).is_empty();
        // A card left without a clause (only its heading or sub-headings) goes.
        let heading_only = shape.contains("name=\"Terms Card") && pptx::paragraphs(&edited).iter().all(|t| clause_sentences(t).is_empty());
        if empty && shape.contains("name=\"LeadIn Bar\"") {
            // The cards move up into the lead-in band's place.
            top = regex::Regex::new(r#"<a:off x="\d+" y="(\d+)"/>"#).expect("regex").captures(&shape).and_then(|c| c[1].parse().ok()).or(top);
        }
        out = out.replacen(&shape, if empty || heading_only { "" } else { &edited }, 1);
    }
    restack_cards(&out, top)
}

/// Drops a short bullet line ("Terms", "Duration of this agreement") left with no deeper line under it.
fn without_empty_subheadings(shape: &str) -> String {
    let para = regex::Regex::new(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>").expect("regex");
    let level = |p: &str| pptx::attr(p, "marL").and_then(|m| m.parse::<i64>().ok()).unwrap_or(0);
    let paras: Vec<String> = para.find_iter(shape).map(|m| m.as_str().to_string()).collect();
    let mut out = shape.to_string();
    for (i, p) in paras.iter().enumerate() {
        let text = pptx::paragraphs(p).join(" ");
        if !p.contains("<a:buChar") || text.trim().is_empty() || !clause_sentences(&text).is_empty() { continue; }
        let has_child = paras.get(i + 1).map(|n| level(n) > level(p) && !pptx::paragraphs(n).is_empty()).unwrap_or(false);
        if !has_child { out = out.replacen(p.as_str(), "", 1); }
    }
    out
}

fn cards_top(xml: &str) -> Option<i64> {
    let card = regex::Regex::new(r#"(?s)name="Terms Card[^"]*"/>.*?<a:off x="\d+" y="(\d+)"/>"#).expect("regex");
    card.captures_iter(xml).filter_map(|c| c[1].parse().ok()).min()
}

/// Terms cards stacked top-down in their column again, after some were removed.
fn restack_cards(xml: &str, top: Option<i64>) -> String {
    static CARD: OnceLock<regex::Regex> = OnceLock::new();
    let card = CARD.get_or_init(|| regex::Regex::new(r#"(?s)<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="Terms Card[^"]*"/>.*?</p:sp>"#).expect("regex"));
    let off = regex::Regex::new(r#"<a:off x="(\d+)" y="(\d+)"/><a:ext cx="\d+" cy="(\d+)"/>"#).expect("regex");
    let mut cards: Vec<(String, i64, i64, i64)> = card.find_iter(xml).filter_map(|m| {
        let c = off.captures(m.as_str())?;
        Some((m.as_str().to_string(), c[1].parse().ok()?, c[2].parse().ok()?, c[3].parse().ok()?))
    }).collect();
    if cards.is_empty() { return xml.to_string(); }
    let top = top.unwrap_or_else(|| cards.iter().map(|c| c.2).min().unwrap_or(0));
    cards.sort_by_key(|c| (c.1, c.2));
    let mut out = xml.to_string();
    let mut column: Option<i64> = None;
    let mut y = top;
    for (shape, x, old_y, h) in cards {
        if column != Some(x) { column = Some(x); y = top; }
        if old_y != y {
            let moved = shape.replacen(&format!(r#"<a:off x="{x}" y="{old_y}"/>"#), &format!(r#"<a:off x="{x}" y="{y}"/>"#), 1);
            out = out.replacen(&shape, &moved, 1);
        }
        y += h + 203200;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pptx::SlideInfo;

    fn deck(texts: &[&str]) -> TemplateInspection {
        TemplateInspection {
            slide_count: texts.len(),
            slides: texts.iter().enumerate().map(|(i, t)| SlideInfo { index: i + 1, slide_id: format!("{}", 256 + i), title: t.lines().next().unwrap_or("").into(), text: t.to_string(), ..Default::default() }).collect(),
            tokens: vec![],
        }
    }

    fn admin_template() -> TemplateInspection {
        deck(&[
            "'New Client'\nProposal for Providing\nAdministration & PRO Services\nTuesday, 3rd September 2024",
            "Attn: 'New Client'\nKingdom of Saudi Arabia",
            "AGENDA\nDetailed Approach & Project Fees\n04",
            "Detailed Approach & Project Fees\n1",
            "ADMINISTRATION\nSERVICES\nPART\n1",
            "Detailed Approach\nAdmin and PRO Services\nObjective",
            "Detailed Approach\nGOSI and Payroll Services\nObjective",
            "ADMINISTRATION\nSERVICES FEES BREAKDOWN\nPART\n2",
            "Value Based\nValue and Cost Dimensions\nProject Fees\nAdminstration and Government Services",
            "Value Based\nValue and Cost Dimensions\nProject Fees\nGOSI and Payroll Services\nFee Structure:\nPRO Services",
            "Terms & Conditions, and Acceptance\n2",
            "The stated scope of work consists of the following assumptions & limitations:",
            "We believe that this proposal is in accordance with your expectations",
            "About MENA BIG\n3",
            "50+\nClients",
            "About MENA BIG\nSelected References",
            "MENA - BIG\n@mena_big\nwww.mena-big.com",
        ])
    }

    #[test]
    fn reads_modules_from_names() {
        assert_eq!(modules_for_service("Admin PRO and Payroll", Some("Administration & PRO")), vec!["gosi_payroll", "admin_pro"]);
        assert_eq!(modules_for_service("Payroll and GOSI", None), vec!["gosi_payroll"]);
        assert_eq!(modules_for_service("Consultancy", Some("Labor Law Consultancy")), vec!["labor_law"]);
        assert_eq!(modules_for_service("National Staffing", Some("Manpower & Recruitment")), vec!["manpower"]);
        assert_eq!(modules_for_service("Recruitment", Some("Manpower & Recruitment")), vec!["recruitment"]);
        assert_eq!(modules_for_service("Business Setup and Maintenance Package", Some("Company Maintenance")), vec!["business_setup"]);
        // Renamed 16-Sep: Business Setup is the one-time setup (Company Constitution); Employer of Record is Workforce.
        assert_eq!(modules_for_service("Business Setup", Some("Company Constitution")), vec!["constitution"]);
        assert_eq!(modules_for_service("Employer of Record", Some("Workforce Services")), vec!["workforce"]);
        assert_eq!(modules_in("EMPLOYER OF RECORD SERVICES"), vec!["workforce"]);
        assert_eq!(modules_for_service("GM Representative", Some("Administration & PRO")), vec!["gm_representative"]);
        assert_eq!(modules_in("GM REPRESENTATIVE SERVICES"), vec!["gm_representative"]);
    }

    #[test]
    fn classifies_the_template_shape() {
        let c = classify(&admin_template());
        let roles: Vec<Role> = c.iter().map(|s| s.role).collect();
        use Role::*;
        assert_eq!(roles, vec![Cover, Letter, Agenda, Section, ServiceDivider, Approach, Approach, FeesDivider, Fees, Fees, Section, Terms, Acceptance, Section, About, References, BackCover]);
        assert_eq!(c[5].modules, vec!["admin_pro"]);
        assert_eq!(c[6].modules, vec!["gosi_payroll"]);
        assert_eq!(c[8].modules, vec!["admin_pro"]);
        assert_eq!(c[9].modules, vec!["gosi_payroll"]);
        assert_eq!(cover_services(&admin_template()).as_deref(), Some("Administration & PRO Services"));
        assert_eq!(client_on_cover(&admin_template()), None);
    }

    #[test]
    fn plans_a_mixed_proposal() {
        let accountancy = deck(&[
            "'Client Name'\nProposal for Providing\nAccountancy Services", "Attn: 'Client Name'", "AGENDA", "Detailed Approach & Project Fees\n1",
            "ACCOUNTANCY\nSERVICES\nPART\n1", "Detailed Approach\nAccountancy Services", "ACCOUNTANCY\nSERVICES FEES BREAKDOWN\nPART\n2",
            "Value Based\nProject Fees\nAccountancy and VAT Services", "Terms & Conditions, and Acceptance\n2", "General Terms", "We believe that this proposal", "About MENA BIG\n3", "MENA - BIG\n@mena_big",
        ]);
        let workforce = deck(&[
            "'Client Name'\nProposal for Providing\nWorkforce Services", "Attn: 'Client Name'", "AGENDA", "Detailed Approach & Project Fees\n1",
            "WORKFORCE\nSERVICES\nPART\n1", "Detailed Approach\nWorkforce Services", "Detailed Approach\nWorkforce Services\nAdvantages", "WORKFORCE\nSERVICES FEES BREAKDOWN\nPART\n2",
            "Value Based\nProject Fees\nWorkforce Services", "Terms & Conditions, and Acceptance\n2", "Terms & Conditions, and Acceptance\nAssumptions and Limitations – Workforce Services",
            "Terms & Conditions, and Acceptance\nAcceptance\nWe believe that this proposal", "About MENA BIG\n3", "MENA - BIG\n@mena_big",
        ]);
        let lib = |t: &TemplateInspection, name: &str| LibraryTemplate { path: name.into(), name: name.into(), slides: classify(t), client_on_cover: client_on_cover(t) };
        let library = vec![lib(&admin_template(), "admin"), lib(&accountancy, "acc"), lib(&workforce, "wf")];

        let only_admin = plan(&library, &["admin_pro"]).unwrap();
        assert_eq!(only_admin.base, 0);
        assert!(!only_admin.keep.contains(&7) && !only_admin.keep.contains(&10), "GOSI slides removed");
        assert!(only_admin.keep.contains(&5) && only_admin.keep.contains(&8), "shared dividers stay");
        assert!(only_admin.imports.is_empty());

        let mixed = plan(&library, &["accountancy", "workforce"]).unwrap();
        assert_eq!(mixed.base, 1);
        assert_eq!(mixed.imports.len(), 2);
        assert_eq!(mixed.imports[0].positions, vec![5, 6, 7, 8, 9], "workforce module (recruitment is a separate proposal)");
        assert_eq!((mixed.imports[1].terms, mixed.imports[1].positions.clone()), (true, vec![11]));
        assert_eq!(services_title(&["accountancy", "workforce"]), "Accountancy & VAT and Employer of Record Services");

        let unknown = plan(&library, &["liquidation"]).unwrap();
        assert_eq!(unknown.missing, vec!["liquidation"]);
    }

    #[test]
    fn numbers_service_dividers_in_deck_order() {
        let p = |t: &str| format!("<a:p><a:r><a:t>{t}</a:t></a:r></a:p>");
        let divider = format!("{}{}{}{}", p("LABOR LAW &amp; EMPLOYMENT"), p("CONSULTANCY SERVICES"), p("PART"), p("1"));
        let (out, changed) = renumber_part_xml(&divider, 3);
        assert!(changed);
        assert_eq!(pptx::paragraphs(&out), vec!["LABOR LAW & EMPLOYMENT", "CONSULTANCY SERVICES", "PART", "3"]);
        assert!(!renumber_part_xml(&divider, 1).1, "already right: unchanged");
        let (one_line, _) = renumber_part_xml(&p("PART 2"), 4);
        assert_eq!(pptx::paragraphs(&one_line), vec!["PART 4"]);
    }

    #[test]
    fn a_second_terms_slide_brings_only_new_clauses() {
        let p = |t: &str, bullet: bool| format!("<a:p>{}<a:r><a:t>{t}</a:t></a:r></a:p>", if bullet { "<a:pPr><a:buChar char=\"●\"/></a:pPr>" } else { "" });
        let card = |id: u32, y: i64, h: i64, body: &str| format!(r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Terms Card {id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="152400" y="{y}"/><a:ext cx="5000000" cy="{h}"/></a:xfrm></p:spPr><p:txBody>{body}</p:txBody></p:sp>"#);
        let general = "All Agreement fees excluding all Governmental Expenses and/or Taxes.";
        let law = "This Subcontract shall be governed in accordance with the laws of The Kingdom of Saudi Arabia.";
        let own = "MENA commits to replace the candidate once within the first 90 days.";
        let slide = format!("<p:spTree>{}{}{}</p:spTree>",
            card(2, 1000000, 800000, &format!("{}{}", p("General Terms", false), p(general, true))),
            card(3, 2003200, 800000, &format!("{}{}", p("Applicable Law", false), p(law, true))),
            card(4, 3006400, 900000, &format!("{}{}", p("Employee Termination Terms", false), p(&own.replace("MENA", "'Client Name' and MENA"), true))));
        // The deck already has the general and law clauses (with another client placeholder).
        let seen: HashSet<String> = [general, law].iter().flat_map(|t| clause_sentences(t)).collect();
        let out = without_clauses(&slide, &seen);
        assert_eq!(pptx::paragraphs(&out), vec!["Employee Termination Terms".to_string(), own.replace("MENA", "'Client Name' and MENA")], "only the new clause and its heading stay");
        assert!(out.contains(r#"<a:off x="152400" y="1000000"/>"#), "the remaining card moves up to the top");
        assert!(clause_keys(&slide).iter().any(|k| !seen.contains(k)), "the slide adds a clause, so it is imported");
        let dup = format!("<p:spTree>{}</p:spTree>", card(2, 1000000, 800000, &format!("{}{}", p("General Terms", false), p(&general.replace("All", "all"), true))));
        assert!(clause_keys(&dup).iter().all(|k| seen.contains(k)), "a slide of known clauses adds nothing and is skipped");
    }
}
#[cfg(test)]
mod clause_tests {
    use super::*;
    #[test]
    fn headings_are_not_clauses_and_sentences_count_one_by_one() {
        assert!(clause_sentences("Terminations & Conditions").is_empty());
        assert!(clause_sentences("Assumptions and Limitations – Consultancy Services").is_empty());
        let seen: HashSet<String> = clause_sentences("Unless previously terminated, this Agreement will initially to complete duration of 1 year minimum. The client may terminate this agreement for convenience at any time with a notice period to the Agent of (3) Three months.").into_iter().collect();
        assert!(repeats("The client may terminate this agreement for convenience at any time with a notice period to the Agent of (3) Three months.", &seen));
        assert!(!repeats("'Client Name' may terminate this agreement for convenience at any time with a notice period to MENA of (1) one months.", &seen));
    }
}

#[cfg(test)]
mod vat_tests {
    use super::*;
    #[test]
    fn every_wording_of_the_vat_exclusion_is_one_clause() {
        let a = clause_sentences("All our prices exclude VAT and WHT; they are added to our invoices according to the applicable law.");
        let b = clause_sentences("All Fees are excluding VAT or WHT and will be added according to the country laws.");
        let c = clause_sentences("All our prices are excluding VAT, it will be added in our invoices according to the VAT Law.");
        assert_eq!(a, b); assert_eq!(b, c);
    }
}

#[cfg(test)]
mod family_tests {
    use super::*;
    #[test]
    fn the_same_clause_in_other_words_is_one_clause() {
        let fees = ["All fees excluding governmental taxes, expenses and any cost and shall be borne by the Client.",
            "All Agreement fees excluding all Governmental Expenses and/or Taxes. All taxes as per the current country laws and regulation",
            "All fees, monthly rates are excluding any costs, expenses or taxes and shall be borne by the 'Client Name'.",
            "All prices excluding any governmental expenses."];
        for f in fees { assert_eq!(clause_sentences(f), vec!["§ fees exclude governmental expenses and taxes".to_string()], "{f}"); }
        assert_eq!(clause_sentences("The above all Rates as per the current governmental expenses and any changing in all the governmental or other expenses will be invoiced to Client at cost as per the payment receipt."), vec!["§ changes in governmental expenses invoiced at cost".to_string()]);
        assert_eq!(clause_sentences("In case of termination, unless otherwise agreed by the Parties, MENA may be entitled to finalize all the Services agreed by last purchase orders."), vec!["§ services finalised against the last purchase orders".to_string()]);
        // Different obligations stay separate.
        assert!(clause_family("all fees excluding employee and company taxes and expenses").is_none());
        assert!(clause_family("client may terminate this agreement for convenience at any time with a notice period to mena of (1) one months").is_none());
    }
}

#[cfg(test)]
mod naming_tests {
    use super::*;
    #[test]
    fn only_templates_are_read() {
        let dir = std::env::temp_dir().join(format!("menabig_tpl_names_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for n in ["Company Liquidation Proposal Template.pptx", "Business_Setup_Package_Proposal_V1_Template.pptx", "All Services Proposal Template.pptx", "Acme Holdings Liquidation Proposal.pptx", "~$Company Liquidation Proposal Template.pptx"] {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
        assert!(is_template_file(&dir.join("Company Liquidation Proposal Template.pptx")));
        assert!(is_template_file(&dir.join("Business_Setup_Package_Proposal_V1_Template.pptx")));
        assert!(!is_template_file(&dir.join("All Services Proposal Template.pptx")), "a reference copy, not a source");
        assert!(!is_template_file(&dir.join("Acme Holdings Liquidation Proposal.pptx")), "a sent proposal");
        assert_eq!(ignored_files(&dir), vec!["Acme Holdings Liquidation Proposal.pptx".to_string()], "the All Services copy is skipped on purpose, not reported");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
