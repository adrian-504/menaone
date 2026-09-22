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
use std::collections::{BTreeSet, HashMap};
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
    ("workforce", "Workforce"),
    ("constitution", "Company Constitution"),
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
        let l = lines(&s.text);
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
    let base = *bases.iter().max_by_key(|&&i| score(i)).expect("non-empty");
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
        let terms: Vec<usize> = slides.iter().filter(|s| s.role == Role::Terms && s.modules.contains(&key)).map(|s| s.index).collect();
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

/// Every template in the folder, classified. Files are only re-read when they change.
pub fn load_library(dir: &Path) -> Result<Vec<LibraryTemplate>, String> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Could not open the templates folder: {e}"))?;
    let mut paths: Vec<std::path::PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            p.is_file() && name.to_lowercase().ends_with(".pptx") && !name.starts_with("~$") && !name.starts_with('.')
        })
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
    let pairs = vec![(client.to_string(), "'Client Name'".to_string())];
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

    let mut sources: HashMap<usize, Package> = HashMap::new();
    for import in &plan.imports {
        let src_template = &library[import.template];
        if !sources.contains_key(&import.template) {
            sources.insert(import.template, Package::read(Path::new(&src_template.path))?);
        }
        let src = &sources[&import.template];
        let at = if import.terms { terms_insert_at(&slides) } else { modules_insert_at(&slides) };
        let added = crate::pptx_import::import_slides(&mut pkg, src, &import.positions, at)?;
        let new_slides: Vec<ComposedSlide> = import
            .positions
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

    // Cover and letter name the services this proposal is for.
    let base_cov = covered(&base.slides);
    let wanted_present: Vec<&'static str> = wanted.iter().copied().filter(|m| !plan.missing.contains(m)).collect();
    let old_title = cover_services(&base_inspection);
    let title = match &old_title {
        Some(old) if base_cov.iter().copied().collect::<BTreeSet<_>>() == wanted_present.iter().copied().collect::<BTreeSet<_>>() => old.clone(),
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
    Ok(Composition { package: pkg, slides, base: base.name.clone(), missing: plan.missing, title })
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
            "WORKFORCE\nSERVICES\nPART\n1", "Detailed Approach\nWorkforce Services", "Detailed Approach\nRecruitment Process", "WORKFORCE\nSERVICES FEES BREAKDOWN\nPART\n2",
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
        assert_eq!(mixed.imports[0].positions, vec![5, 6, 7, 8, 9], "workforce module incl. its recruitment process slide");
        assert_eq!((mixed.imports[1].terms, mixed.imports[1].positions.clone()), (true, vec![11]));
        assert_eq!(services_title(&["accountancy", "workforce"]), "Accountancy & VAT and Workforce Services");

        let unknown = plan(&library, &["liquidation"]).unwrap();
        assert_eq!(unknown.missing, vec!["liquidation"]);
    }
}
