//! The 2026 proposal master ("MENA BIG Proposal Master 2026.pptx", built by
//! tools/proposal-master): one deck with every service's slides, each tagged
//! in its speaker notes — `[always]`, `[module: workforce]`, `[role: fees]`,
//! `[when: recruitment | term12 | term_short]` — and fields written as
//! `{{tokens}}`. A proposal keeps the shared slides and its services' slides,
//! fee tables repeat their `{{row.…}}` row once per priced row, and every
//! field is filled from the proposal. No wording is guessed.

use crate::models::LineRate;
use crate::pptx::{self, fill_placeholders, find_tokens, paragraphs, re, Package, TemplateInspection};
use crate::pricing::{self, RowKind};
use regex::Regex;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const MASTER_FILE: &str = "MENA BIG Proposal Master 2026.pptx";

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MasterTags {
    pub always: bool,
    pub module: Option<String>,
    pub role: Option<String>,
    pub when: Option<String>,
}

pub fn parse(notes: &str) -> MasterTags {
    static TAG: OnceLock<Regex> = OnceLock::new();
    let mut t = MasterTags::default();
    for c in re(r"\[\s*([A-Za-z]+)\s*(?::\s*([^\]]*))?\]", &TAG).captures_iter(notes) {
        let value = c.get(2).map(|m| m.as_str().trim().to_string()).filter(|v| !v.is_empty());
        match c[1].to_lowercase().as_str() {
            "always" => t.always = true,
            "module" => t.module = value,
            "role" => t.role = value,
            "when" => t.when = value,
            _ => {}
        }
    }
    t
}

/// Whether a deck is a tagged master (rather than a service template).
pub fn is_master(inspection: &TemplateInspection) -> bool {
    inspection.slides.iter().filter(|s| parse(&s.notes).module.is_some()).count() >= 3
}

/// The master next to the service templates folder, or chosen in Settings.
pub fn locate(library_dir: Option<&Path>, configured: Option<String>) -> Option<PathBuf> {
    if let Some(p) = configured.map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    let dir = library_dir?;
    [dir.join(MASTER_FILE), dir.parent()?.join(MASTER_FILE)].into_iter().find(|p| p.is_file())
}

/// A proposal line as the master needs it.
#[derive(Debug, Clone, Default)]
pub struct MasterLine {
    pub service: String,
    pub modules: Vec<&'static str>,
    pub kind: Option<RowKind>,
    pub rates: Vec<LineRate>,
    pub unit_price: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct Choice {
    pub index: usize,
    pub included: bool,
    pub reason: String,
    pub module: Option<String>,
}

/// The master's service sections (each module's divider, approach and fee slides) in the
/// order of the proposal's lines; the rest of the deck (terms included) keeps the master's order.
pub fn order_modules(pkg: &mut Package, wanted: &[&str]) {
    let inspection = pptx::inspect(pkg);
    let tags: Vec<MasterTags> = inspection.slides.iter().map(|s| parse(&s.notes)).collect();
    let service = |t: &MasterTags| t.module.is_some() && !matches!(t.role.as_deref(), Some("terms"));
    let Some(first) = tags.iter().position(service) else { return };
    let last = tags.iter().rposition(service).unwrap_or(first);
    if tags[first..=last].iter().any(|t| !service(t)) { return; }
    let rank = |m: &str| wanted.iter().position(|w| *w == m).unwrap_or(usize::MAX);
    let mut groups: Vec<(usize, Vec<usize>)> = Vec::new();
    for i in first..=last {
        let m = tags[i].module.as_deref().unwrap_or_default();
        if groups.last().map(|g| tags[g.1[0]].module.as_deref() != Some(m)).unwrap_or(true) { groups.push((rank(m), Vec::new())); }
        groups.last_mut().expect("group").1.push(i);
    }
    let mut sorted = groups.clone();
    sorted.sort_by_key(|g| g.0);
    if sorted.iter().map(|g| g.1[0]).eq(groups.iter().map(|g| g.1[0])) { return; }
    let mut order: Vec<usize> = (0..first).collect();
    order.extend(sorted.iter().flat_map(|g| g.1.iter().copied()));
    order.extend(last + 1..tags.len());
    crate::proposal_library::reorder_slides(pkg, &order);
}

/// Which master slides a proposal keeps.
pub fn choose(inspection: &TemplateInspection, lines: &[MasterLine], months: Option<i64>) -> Vec<Choice> {
    let wanted: BTreeSet<&str> = lines.iter().flat_map(|l| l.modules.iter().copied()).collect();
    let term = months.filter(|m| *m > 0).unwrap_or(12);
    inspection
        .slides
        .iter()
        .map(|s| {
            let t = parse(&s.notes);
            let (included, reason) = match (&t.module, t.always) {
                (_, true) => (true, "Standard slide".to_string()),
                (Some(m), _) if wanted.contains(m.as_str()) => match t.when.as_deref() {
                    Some("term12") if term < 12 => (false, "Only with a 12-month term".into()),
                    Some("term_short") if term >= 12 => (false, "Only for terms under 12 months".into()),
                    Some("term12") | Some("term_short") | None => (true, format!("For {}", crate::proposal_library::module_name(m))),
                    // A condition the generator doesn't know leaves the slide out.
                    Some(other) => (false, format!("Only when \"{other}\"")),
                },
                (Some(m), _) => (false, format!("Only for {}", crate::proposal_library::module_name(m))),
                (None, false) => (false, "Not tagged".into()),
            };
            Choice { index: s.index, included, reason, module: t.module }
        })
        .collect()
}

/// "2,000 SAR" — amounts as the proposals write them.
pub fn amount(v: f64, currency: &str) -> String {
    let rounded = v.round() as i64;
    let digits = rounded.abs().to_string();
    let mut grouped = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    format!("{}{grouped} {currency}", if rounded < 0 { "-" } else { "" })
}

const WORDS: [&str; 25] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four"];

pub fn term_text(months: i64) -> String {
    if months % 12 == 0 && months >= 12 {
        let y = months / 12;
        return if y == 1 { "12 months".into() } else { format!("{months} months") };
    }
    format!("{months} {}", if months == 1 { "month" } else { "months" })
}

pub fn term_words(months: i64) -> String {
    let w = WORDS.get(months as usize).copied().map(str::to_string).unwrap_or_else(|| months.to_string());
    format!("{w} ({months}) {}", if months == 1 { "month" } else { "months" })
}

pub struct FillInput<'a> {
    pub values: HashMap<String, String>,
    pub lines: &'a [MasterLine],
    pub months: Option<i64>,
    pub currency: &'a str,
    /// Rate-card standards for figures a proposal quotes without a line.
    pub constitution_standard: Option<f64>,
    pub maintenance_standard: Option<f64>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FillReport {
    pub filled: Vec<String>,
    pub checks: Vec<String>,
    pub missing_tokens: Vec<String>,
}

fn rate_label(kind: Option<RowKind>, rate: &LineRate, n: usize) -> String {
    let label = rate.label.trim();
    if kind == Some(RowKind::Tranche) {
        let range = if label.is_empty() || pricing::parse_range(label).is_some() && label.to_lowercase().ends_with("employees") && !label.to_lowercase().contains("and below") {
            pricing::tranche_label(rate.from, rate.to)
        } else {
            label.to_string()
        };
        return format!("Tranche {n} · {range}");
    }
    label.to_string()
}

/// Rows of a line on a fee slide: its priced rows, or the line itself.
fn rows_for(line: &MasterLine, currency: &str) -> Vec<HashMap<&'static str, String>> {
    if line.rates.is_empty() {
        return vec![HashMap::from([("row.label", line.service.clone()), ("row.price", line.unit_price.map(|p| amount(p, currency)).unwrap_or_default()), ("row.percent", String::new())])];
    }
    let mut rates: Vec<&LineRate> = line.rates.iter().collect();
    if line.kind == Some(RowKind::Tranche) {
        rates.sort_by_key(|r| r.to.unwrap_or(i64::MAX));
    }
    rates
        .iter()
        .enumerate()
        .map(|(i, r)| {
            HashMap::from([
                ("row.label", rate_label(line.kind, r, i + 1)),
                ("row.price", r.price.map(|p| amount(p, currency)).unwrap_or_default()),
                ("row.percent", r.percent.map(|p| if p.fract() == 0.0 { format!("{}%", p as i64) } else { format!("{p}%") }).unwrap_or_default()),
            ])
        })
        .collect()
}

fn pairs(map: &HashMap<&'static str, String>) -> Vec<(String, String)> {
    map.iter().map(|(k, v)| (format!("{{{{{k}}}}}"), v.clone())).collect()
}

fn expand_rows(xml: &str, rows: &[HashMap<&'static str, String>]) -> String {
    static ROW: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:tr\b[^>]*>.*?</a:tr>", &ROW)
        .replace_all(xml, |c: &regex::Captures| {
            let row = &c[0];
            if !row.contains("{{row.") {
                return row.to_string();
            }
            rows.iter().map(|r| fill_placeholders(row, &pairs(r)).0).collect::<String>()
        })
        .to_string()
}

/// Paragraphs whose only content is a field left empty are dropped (optional notes).
fn drop_empty_token_paragraphs(xml: &str, values: &HashMap<String, String>) -> String {
    static PARA: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>", &PARA)
        .replace_all(xml, |c: &regex::Captures| {
            let text = paragraphs(&c[0]).join("");
            let t = text.trim();
            if t.starts_with("{{") && t.ends_with("}}") && t.matches("{{").count() == 1 {
                let key = t.trim_start_matches("{{").trim_end_matches("}}").trim();
                if values.get(key).map(|v| v.is_empty()).unwrap_or(false) {
                    return String::new();
                }
            }
            c[0].to_string()
        })
        .to_string()
}

/// Fills a deck already reduced to the proposal's slides (`tags` in slide order).
pub fn fill(pkg: &mut Package, tags: &[MasterTags], input: &FillInput) -> FillReport {
    let mut report = FillReport::default();
    let months = input.months.filter(|m| *m > 0).unwrap_or(12);
    let parts = pptx::slide_parts_in_order(pkg);
    let mut values = input.values.clone();
    values.insert("term".into(), term_text(months));
    values.insert("term.words".into(), term_words(months));

    // Page numbers for the agenda.
    for (role, key) in [("section-approach", "page.approach"), ("section-terms", "page.terms"), ("section-about", "page.about")] {
        if let Some(i) = tags.iter().position(|t| t.role.as_deref() == Some(role)) {
            values.insert(key.into(), format!("{:02}", i + 1));
        }
    }
    // Workforce early-termination examples scale with the term (5 → ×7 and 8 → ×4 at 12 months).
    for (n, orig) in [(1, 5.0), (2, 8.0)] {
        let month = ((orig * months as f64 / 12.0).round() as i64).clamp(1, (months - 1).max(1));
        values.insert(format!("wf.m{n}"), month.to_string());
        values.insert(format!("wf.r{n}"), (months - month).max(1).to_string());
    }
    let line_for = |module: &str| input.lines.iter().find(|l| l.modules.iter().any(|m| *m == module));
    // Accountancy projects minimum.
    let projects = line_for("accountancy").and_then(|l| l.rates.iter().find(|r| { let x = r.label.to_lowercase(); x.contains("project") && !x.contains("no project") })).and_then(|r| r.price);
    values.insert("accountancy.projects_note".into(), projects.map(|p| format!("Accountancy with projects is {} minimum, defined according to the number of transactions.", amount(p, input.currency))).unwrap_or_default());
    // Recruitment staff types.
    let blue = line_for("recruitment").map(|l| l.rates.iter().any(|r| { let x = r.label.to_lowercase(); x.contains("blue") || x.contains("labo") || x.contains("skilled") || x.contains("worker") })).unwrap_or(false);
    values.insert("recruitment.staff_note".into(), if blue { String::new() } else { "Fees are only for professional staff and not for labors or skilled employees.".into() });
    // Constitution & maintenance package.
    let lower = |l: &MasterLine| l.service.to_lowercase();
    let package = line_for("constitution_maintenance").and_then(|l| l.unit_price);
    let c = input.lines.iter().find(|l| lower(l).contains("constitution") && !lower(l).contains("package") && !lower(l).contains("maintenance")).and_then(|l| l.unit_price).or(input.constitution_standard);
    let m = input.lines.iter().find(|l| lower(l).contains("maintenance") && !lower(l).contains("package") && !lower(l).contains("constitution") && !lower(l).contains("setup")).and_then(|l| l.unit_price).or(input.maintenance_standard);
    if let (Some(p), Some(c), Some(m)) = (package, c, m) {
        let without = c + m * months as f64;
        let with = p * months as f64;
        for (k, v) in [("bundle.package", p), ("bundle.constitution", c), ("bundle.maintenance", m), ("bundle.without", without), ("bundle.with", with), ("bundle.savings", without - with)] {
            values.insert(k.into(), amount(v, input.currency));
        }
        if without - with <= 0.0 {
            report.checks.push("The package costs more than constitution plus maintenance over the term — the savings figures don't make sense.".into());
        }
    }
    values.insert("constitution.price".into(), c.map(|v| amount(v, input.currency)).unwrap_or_default());

    for (i, part) in parts.iter().enumerate() {
        let tag = tags.get(i).cloned().unwrap_or_default();
        let original = pkg.text_of(part);
        let mut xml = original.clone();
        let mut slide_values = values.clone();
        if let Some(module) = tag.module.as_deref() {
            if let Some(line) = line_for(module) {
                if xml.contains("{{row.") {
                    xml = expand_rows(&xml, &rows_for(line, input.currency));
                    report.filled.push(format!("Slide {}: fee rows for {}", i + 1, line.service));
                }
                if let Some(p) = line.unit_price {
                    slide_values.insert("fee.price".into(), amount(p, input.currency));
                    let total = p * months as f64 + if module == "business_setup" && months < 12 { c.unwrap_or(0.0) } else { 0.0 };
                    slide_values.insert("fee.total".into(), amount(total, input.currency));
                }
            }
        }
        xml = drop_empty_token_paragraphs(&xml, &slide_values);
        let pairs: Vec<(String, String)> = slide_values.iter().map(|(k, v)| (format!("{{{{{k}}}}}"), v.clone())).collect();
        let (x, _) = fill_placeholders(&xml, &pairs);
        // Tables that gained rows push the text below them down.
        let x = crate::feefill::reflow(&original, &x);
        for t in find_tokens(&paragraphs(&x).join("\n")) {
            if !report.missing_tokens.contains(&t) {
                report.missing_tokens.push(t);
            }
        }
        pkg.set_text(part, x);
    }
    if months < 12 && input.lines.iter().any(|l| l.modules.contains(&"business_setup")) {
        report.checks.push(format!("Business Setup is free only with a 12-month term; this deck charges the constitution ({}).", c.map(|v| amount(v, input.currency)).unwrap_or_else(|| "price not set".into())));
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pptx::SlideInfo;

    #[test]
    fn reads_tags_and_chooses_slides() {
        let slide = |i: usize, notes: &str| SlideInfo { index: i, notes: notes.into(), ..Default::default() };
        let insp = TemplateInspection {
            slide_count: 6,
            slides: vec![
                slide(1, "[always] [role: cover]"),
                slide(2, "[module: workforce] [role: fees]"),
                slide(3, "[module: workforce] [role: approach] [when: recruitment]"),
                slide(4, "[module: business_setup] [role: fees] [when: term12]"),
                slide(5, "[module: business_setup] [role: fees] [when: term_short]"),
                slide(6, "[module: accountancy] [role: fees]"),
            ],
            tokens: vec![],
        };
        assert_eq!(parse("[module: workforce] [role: fees] [when: recruitment]"), MasterTags { always: false, module: Some("workforce".into()), role: Some("fees".into()), when: Some("recruitment".into()) });
        let lines = vec![MasterLine { modules: vec!["workforce"], ..Default::default() }, MasterLine { modules: vec!["business_setup"], ..Default::default() }];
        let kept = |months| choose(&insp, &lines, months).into_iter().filter(|c| c.included).map(|c| c.index).collect::<Vec<_>>();
        assert_eq!(kept(None), vec![1, 2, 4]);
        assert_eq!(kept(Some(6)), vec![1, 2, 5]);
        assert!(is_master(&TemplateInspection { slides: insp.slides.clone(), ..Default::default() }));
        assert_eq!(term_words(3), "three (3) months");
        assert_eq!(amount(3550.0, "SAR"), "3,550 SAR");
    }

    #[test]
    fn repeats_fee_rows_and_fills_fields() {
        let cell = |t: &str| format!("<a:tc><a:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></a:txBody></a:tc>");
        let slide = format!(
            "<p:sld><a:tbl><a:tr h=\"1\">{}{}</a:tr><a:tr h=\"2\">{}{}</a:tr></a:tbl><p:sp><a:p><a:r><a:t>Service is for a {{{{term}}}} minimum.</a:t></a:r></a:p><a:p><a:r><a:t>{{{{accountancy.projects_note}}}}</a:t></a:r></a:p></p:sp></p:sld>",
            cell("Category"), cell("Package"), cell("{{row.label}}"), cell("{{row.price}}")
        );
        let mut parts = pptx::Parts::new();
        parts.insert("ppt/presentation.xml".into(), br#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>"#.to_vec());
        parts.insert("ppt/_rels/presentation.xml.rels".into(), br#"<Relationships><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/></Relationships>"#.to_vec());
        parts.insert("ppt/slides/slide1.xml".into(), slide.into_bytes());
        let mut pkg = Package { order: parts.keys().cloned().collect(), parts };
        let band = |from, to, price| LineRate { from: Some(from), to: Some(to), price: Some(price), ..Default::default() };
        let lines = vec![MasterLine { service: "Admin PRO".into(), modules: vec!["admin_pro"], kind: Some(RowKind::Tranche), rates: vec![band(6, 15, 3750.0), band(1, 5, 2000.0), LineRate { label: "25 employees and below".into(), ..band(1, 25, 4625.0) }], unit_price: Some(2000.0), ..Default::default() }];
        let tags = vec![MasterTags { module: Some("admin_pro".into()), role: Some("fees".into()), ..Default::default() }];
        let report = fill(&mut pkg, &tags, &FillInput { values: HashMap::new(), lines: &lines, months: Some(6), currency: "SAR", constitution_standard: None, maintenance_standard: None });
        let texts = paragraphs(&pkg.text_of("ppt/slides/slide1.xml"));
        assert_eq!(texts, vec!["Category", "Package", "Tranche 1 · 1–5 employees", "2,000 SAR", "Tranche 2 · 6–15 employees", "3,750 SAR", "Tranche 3 · 25 employees and below", "4,625 SAR", "Service is for a 6 months minimum."]);
        assert!(report.missing_tokens.is_empty(), "{:?}", report.missing_tokens);
    }
}
