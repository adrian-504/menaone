//! Revise prices (generator, 1.66): the next version of a deck with only the
//! prices changed, so the edits made by hand in the version before are kept.
//!
//! It works on a copy of the deck in memory and changes nothing else:
//!
//! - **Amounts** in fee rows: a row is found by its label (the tranche's
//!   range, the category or row name, the service's name), never by the old
//!   figure. A total under one monthly fee follows it.
//! - **Sentences that repeat a price** (the projects minimum, the package
//!   comparison and its savings) — the same rewrite the generator uses.
//! - **The contract term**, where the deck still says 12 months and the
//!   proposal now has another term (decks from the service templates).
//! - **The two dates**: the cover's and the letter's.
//!
//! It is in place only when every price of the proposal finds its row. A price
//! with no row, a row that could be two services' row, a total that cannot be
//! recalculated, a sentence that would have to go, or a term it cannot reword
//! stops it before anything is saved: the caller names them and offers to
//! regenerate instead. A deck with no fee row it recognises is never saved as
//! revised, and neither is one whose prices already match.

use crate::feefill::{self, number_text, parse_amount, percent_regex, Standards};
use crate::models::LineRate;
use crate::pptx::{self, Package};
use crate::pricing::{self, RowKind};
use crate::sendcheck::slide_list;
use crate::smartfill::{self, format_like, money_regex, paragraph_texts, restyle_dates, rewrite_paragraphs, rewrite_shapes, SmartLine};
use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

pub struct RepriceInput<'a> {
    pub lines: &'a [SmartLine],
    pub currency: &'a str,
    /// The proposal's contract term in months.
    pub months: Option<i64>,
    /// YYYY-MM-DD: the day the new version is made.
    pub date_iso: &'a str,
    pub standards: &'a Standards,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepriceReport {
    /// Amounts that changed (a row whose figure was already right is not counted).
    pub amounts: usize,
    pub amount_slides: Vec<usize>,
    pub term_slides: Vec<usize>,
    pub date_slides: Vec<usize>,
    /// Fee rows recognised as a price of the proposal, changed or not. None: no fee table was recognised.
    pub rows_found: usize,
    /// Prices of the proposal with no row in the deck.
    pub unplaced: Vec<String>,
    /// Other reasons it cannot be done in place.
    pub blocked: Vec<String>,
    /// Worth a look in the new version; they do not stop it.
    pub checks: Vec<String>,
    /// The contract terms the deck states, in months.
    pub terms_stated: Vec<i64>,
}

impl RepriceReport {
    /// Can the revised deck be saved? Every price found its row, nothing else stands in the way, and something changed.
    pub fn can_save(&self) -> bool {
        self.rows_found > 0 && self.unplaced.is_empty() && self.blocked.is_empty() && (self.amounts > 0 || !self.term_slides.is_empty())
    }

    /// Why not, in one plain sentence. Empty when it can be saved.
    pub fn reason(&self, from: &str) -> String {
        if self.rows_found == 0 {
            return format!("No fee table was recognised in {from}, so nothing was changed.");
        }
        if !self.unplaced.is_empty() {
            return format!("{} in {from}: {}.", if self.unplaced.len() == 1 { "One price has no row" } else { "Some prices have no row" }, self.unplaced.join("; "));
        }
        if !self.blocked.is_empty() {
            return self.blocked.join(" ");
        }
        if !self.can_save() {
            return format!("The prices and the term in {from} already match the proposal.");
        }
        String::new()
    }

    /// The line kept in the new version's notes: "Prices revised from V1: 9 amounts updated on slides 14 and 15;
    /// term on slide 3; dates on slides 1 and 2".
    pub fn line(&self, from: &str) -> String {
        let mut bits = vec![if self.amounts == 0 { "no amounts changed".to_string() } else {
            format!("{} amount{} updated on {}", self.amounts, if self.amounts == 1 { "" } else { "s" }, slide_list(&self.amount_slides))
        }];
        if !self.term_slides.is_empty() { bits.push(format!("term on {}", slide_list(&self.term_slides))); }
        if !self.date_slides.is_empty() { bits.push(format!("date{} on {}", if self.date_slides.len() == 1 { "" } else { "s" }, slide_list(&self.date_slides))); }
        format!("Prices revised from {from}: {}", bits.join("; "))
    }
}

fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("regex"))
}

/// One price of the proposal: a priced row of a line, or the line's own price.
struct Point<'a> {
    line: &'a SmartLine,
    rate: Option<&'a LineRate>,
    /// As it is named when it cannot be placed: "Payroll: 6–15 employees".
    name: String,
    price: Option<f64>,
    percent: Option<f64>,
    placed: usize,
    /// Where it was written over another figure: (slide, the figure before).
    changes: Vec<(usize, f64)>,
    /// Where its row was found, and the figure that was there.
    seen: Vec<(usize, f64)>,
}

impl Point<'_> {
    fn value(&self) -> Option<f64> { self.price.or(self.percent) }
}

fn rate_name(rate: &LineRate) -> String {
    if rate.label.trim().is_empty() { pricing::tranche_label(rate.from, rate.to) } else { rate.label.trim().to_string() }
}

/// A point for a line: its priced row `rate`, or the line itself priced by `by` (its one row) or its own price.
fn point<'a>(line: &'a SmartLine, rate: Option<&'a LineRate>, by: Option<&LineRate>) -> Point<'a> {
    let (price, percent) = match rate.or(by) { Some(r) => (r.price, r.percent.filter(|_| r.price.is_none())), None => (line.unit_price, None) };
    let name = match rate { Some(r) => format!("{}: {}", line.service.trim(), rate_name(r)), None => line.service.trim().to_string() };
    Point { line, rate, name, price, percent, placed: 0, changes: vec![], seen: vec![] }
}

fn points(lines: &[SmartLine]) -> Vec<Point<'_>> {
    let priced = |r: &LineRate| r.price.is_some() || r.percent.is_some();
    let mut out = Vec::new();
    for line in lines {
        if line.kind.is_some() {
            out.extend(line.rates.iter().filter(|r| priced(r)).map(|r| point(line, Some(r), None)));
        } else if line.unit_price.is_some() {
            out.push(point(line, None, None));
        } else if let [r] = line.rates.as_slice() {
            // A line priced by its one row (a custom line per visa, or a percentage): the row speaks for the line.
            if priced(r) { out.push(point(line, None, Some(r))); }
        }
    }
    out
}

/// The employee band a rate is for: its limits, or the range its label states.
fn rate_range(rate: &LineRate) -> Option<(i64, i64)> {
    match rate.to {
        Some(to) => Some((rate.from.unwrap_or(1), to)),
        None => pricing::parse_range(&rate.label),
    }
}

/// Is this fee row (its text without the amounts) the row of this priced rate?
fn rate_matches(line: &SmartLine, rate: &LineRate, label: &str) -> bool {
    if line.kind == Some(RowKind::Tranche) || (rate.label.trim().is_empty() && rate.to.is_some()) {
        return rate_range(rate).is_some() && pricing::parse_range(label) == rate_range(rate);
    }
    let name = rate.label.trim();
    if name.is_empty() { return false; }
    if line.kind == Some(RowKind::Country) {
        return label.to_lowercase().contains(&name.to_lowercase());
    }
    pricing::names_exactly(name, label)
}

fn total_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?i)\btotal\s+(annual\s+cost|cost)\b", &R)
}

fn close(a: f64, b: f64) -> bool { (a - b).abs() < 0.005 }

/// The modules a slide is for: its tag in a deck from the 2026 master, else the line under "Project Fees".
fn slide_modules(notes: &str, texts: &[String]) -> Vec<String> {
    match crate::master::parse(notes).module {
        Some(m) => vec![m],
        None => smartfill::fee_slide_modules(texts).into_iter().map(str::to_string).collect(),
    }
}

/// Writes a point's figure into its row; the figure that was there, when the row has one of the right kind.
fn write_row(row: &str, price: Option<f64>, percent: Option<f64>, currency: &str) -> (String, Option<f64>) {
    let mut old = None;
    let (new_row, _) = rewrite_paragraphs(row, |_, t| {
        if old.is_some() { return None; }
        if let Some(p) = price {
            let m = money_regex().find_iter(t).find(|m| !m.as_str().contains('%'))?;
            old = parse_amount(m.as_str());
            old?;
            return Some(format!("{}{}{}", &t[..m.start()], format_like(m.as_str(), p, currency), &t[m.end()..]));
        }
        let pc = percent?;
        let c = percent_regex().captures(t)?;
        let m = c.get(1)?;
        old = m.as_str().replace(',', ".").parse().ok();
        old?;
        Some(format!("{}{}{}", &t[..m.start()], number_text(pc), &t[m.end()..]))
    });
    (new_row, old)
}

/// Does the deck still speak of a 12-month term? Asked of the generator's own term rewrite: wording it would
/// change is 12-month wording. (Its early-termination example is left out of the question: that sentence is
/// rescaled whatever it says, so it proves nothing.)
pub fn says_twelve_months(texts: &[Vec<String>]) -> bool {
    static EXAMPLE: OnceLock<Regex> = OnceLock::new();
    let example = re(r"(?i)month number\s*\d+\s*,\s*Calculation:\s*\(Monthly fee\s*[×x*]\s*\d+\s*Months?\)", &EXAMPLE);
    texts.iter().flatten().any(|t| feefill::term_sentence(&example.replace_all(t, ""), 7).is_some())
}

/// The contract terms other than 12 months that the deck states: read from its totals and its "minimum of …
/// months" wording. Usually one or none. How long the work takes and notice periods are not the term.
pub fn stated_terms(texts: &[Vec<String>]) -> Vec<i64> {
    static FORMS: OnceLock<Vec<Regex>> = OnceLock::new();
    let forms = FORMS.get_or_init(|| [
        r"(?i)total cost\s*(?:over|\()\s*(\d{1,2})\s*months?",
        r"(?i)minimum(?:\s+(?:contract|period|duration))?\s+of\s+(\d{1,2})\s*months?",
        r"(?i)\b(\d{1,2})\s*months?\s+(?:agreement\s+)?minimum",
        r"(?i)minimum\s+period\s+(\d{1,2})\s*months?",
        r"(?i)period of [a-z-]+\s*\((\d{1,2})\)\s*months?",
        r"(?i)[a-z-]+\s*\((\d{1,2})\)\s*-?\s*months?\s+term",
        r"(?i)contract lasts (?:for )?(\d{1,2})\s*months?",
        r"(?i)duration of (\d{1,2})\s*months?",
        r"(?i)runs for (?:an initial minimum duration of )?(\d{1,2})\s*months?",
        r"(?i)payments over (\d{1,2})\s*months?",
        r"(?i)^\s*(\d{1,2})\s*months\s*$",
    ].iter().map(|p| Regex::new(p).expect("regex")).collect());
    let mut found: Vec<i64> = Vec::new();
    for t in texts.iter().flatten() {
        for f in forms {
            found.extend(f.captures_iter(t).filter_map(|c| c[1].parse::<i64>().ok()).filter(|n| *n > 0 && *n != 12));
        }
    }
    found.sort_unstable();
    found.dedup();
    found
}

/// Revises the deck in memory. Nothing is written; the caller saves it only when `can_save()`.
pub fn reprice(pkg: &mut Package, input: &RepriceInput) -> RepriceReport {
    let mut report = RepriceReport::default();
    let parts = pptx::slide_parts_in_order(pkg);
    let notes: Vec<String> = pptx::inspect(pkg).slides.into_iter().map(|s| s.notes).collect();
    let from_master = notes.iter().filter(|n| crate::master::parse(n).module.is_some()).count() >= 1;
    let mut pts = points(input.lines);
    let new_months = input.months.filter(|m| *m > 0).unwrap_or(12);
    let all_texts: Vec<Vec<String>> = parts.iter().map(|p| paragraph_texts(&pkg.text_of(p))).collect();
    // The term. A deck that still speaks of 12 months, built from the service templates, is reworded by the
    // generator's own rewrite (which only knows 12-month wording). A deck that says nothing about the term, or
    // already speaks of the proposal's, is left as it is. Anything else is not something to patch: which slides
    // a deck has can depend on the term.
    let twelve = says_twelve_months(&all_texts);
    let others = stated_terms(&all_texts);
    report.terms_stated = others.iter().copied().chain(twelve.then_some(12)).collect();
    report.terms_stated.sort_unstable();
    let was = if twelve && new_months != 12 { Some(12) } else if others.contains(&new_months) { None } else { others.first().copied() };
    let term_changed = was.is_some();
    let mut reword_term = false;
    if let Some(old) = was {
        let setup = input.lines.iter().any(|l| l.modules.iter().any(|m| *m == "business_setup" || *m == "constitution_maintenance"));
        if old == 12 && !from_master && !setup {
            reword_term = true;
        } else {
            report.blocked.push(format!("The contract term changed from {old} to {new_months} months, and that wording cannot be changed in place."));
        }
    }
    let old_months = Some(was.unwrap_or(new_months));
    let total_months = if term_changed && !reword_term { was.unwrap_or(12) } else { new_months };

    for (i, part) in parts.iter().enumerate() {
        let position = i + 1;
        let original = pkg.text_of(part);
        let texts = &all_texts[i];
        let modules = slide_modules(notes.get(i).map(String::as_str).unwrap_or(""), texts);
        let for_slide = |line: &SmartLine| modules.is_empty() || line.modules.is_empty() || line.modules.iter().any(|m| modules.iter().any(|x| x == m));

        static ROW: OnceLock<Regex> = OnceLock::new();
        let row_re = re(r"(?s)<a:tr\b[^>]*>.*?</a:tr>", &ROW);
        let priced: Vec<String> = row_re.find_iter(&original).map(|m| paragraph_texts(m.as_str()).join(" ")).filter(|t| money_regex().is_match(t) && !total_regex().is_match(t)).collect();
        // Single-price lines whose row on this slide was found, with the figure that was there.
        let mut singles_here: Vec<(usize, f64)> = Vec::new();
        let mut changed_here = false;

        // Fee rows: a priced row of a line by its label, else the row that names a single-price line.
        let mut xml = row_re.replace_all(&original, |c: &regex::Captures| {
            let row = &c[0];
            let row_text = paragraph_texts(row).join(" ");
            if !money_regex().is_match(&row_text) { return row.to_string(); }
            let label = smartfill::row_label(&row_text);
            if total_regex().is_match(&label) { return row.to_string(); }
            let mut hits: Vec<usize> = pts.iter().enumerate().filter(|(_, p)| p.rate.map(|r| for_slide(p.line) && rate_matches(p.line, r, &label)).unwrap_or(false)).map(|(k, _)| k).collect();
            if hits.len() > 1 {
                // The row that says exactly the rate's label wins ("Projects" over "No Projects").
                let exact: Vec<usize> = hits.iter().copied().filter(|k| pricing::words(&rate_name(pts[*k].rate.expect("rate"))) == pricing::words(&label)).collect();
                if exact.len() == 1 { hits = exact; }
            }
            if hits.len() > 1 {
                report.blocked.push(format!("Slide {position}: the row \"{}\" could be the row of {}.", label.trim().chars().take(60).collect::<String>(), hits.iter().map(|k| pts[*k].name.clone()).collect::<Vec<_>>().join(" or ")));
                return row.to_string();
            }
            let single = || {
                let is_single = |p: &Point| p.rate.is_none();
                pts.iter().position(|p| is_single(p) && smartfill::row_names_line(&row_text, p.line)).or_else(|| {
                    pts.iter().position(|p| is_single(p) && smartfill::row_module_matches(&row_text, p.line) && priced.iter().filter(|t| smartfill::row_module_matches(t, p.line)).count() == 1)
                })
            };
            let Some(k) = hits.first().copied().or_else(single) else { return row.to_string() };
            let (new_row, old) = write_row(row, pts[k].price, pts[k].percent, input.currency);
            let Some(old) = old else { return row.to_string() };
            let p = &mut pts[k];
            p.placed += 1;
            p.seen.push((position, old));
            report.rows_found += 1;
            if p.rate.is_none() { singles_here.push((k, old)); }
            if !close(old, p.value().unwrap_or(old)) {
                p.changes.push((position, old));
                report.amounts += 1;
                changed_here = true;
            }
            new_row
        }).to_string();

        // A total under one monthly fee follows it; any other total on a slide whose prices changed cannot be recalculated here.
        let monthly: Vec<(usize, f64)> = singles_here.iter().copied().filter(|(k, _)| pts[*k].line.months.is_some()).collect();
        let term_moves = term_changed && reword_term;
        xml = row_re.replace_all(&xml, |c: &regex::Captures| {
            let row = &c[0];
            let row_text = paragraph_texts(row).join(" ");
            let amounts: Vec<f64> = money_regex().find_iter(&row_text).filter(|m| !m.as_str().contains('%')).filter_map(|m| parse_amount(m.as_str())).collect();
            if !total_regex().is_match(&smartfill::row_label(&row_text)) || amounts.len() != 1 { return row.to_string(); }
            if !changed_here && !term_moves { return row.to_string(); }
            let cannot = |report: &mut RepriceReport| report.blocked.push(format!("Slide {position}: the total ({}) cannot be recalculated in place.", format_like("1 SAR", amounts[0], input.currency)));
            let [(k, old_unit)] = monthly.as_slice() else { if changed_here { cannot(&mut report); } return row.to_string() };
            let was = old_months.unwrap_or(12) as f64;
            if !close(amounts[0], old_unit * was) { cannot(&mut report); return row.to_string(); }
            let total = pts[*k].price.unwrap_or(*old_unit) * total_months as f64;
            let (new_row, _) = write_row(row, Some(total), None, input.currency);
            if !close(total, amounts[0]) { report.amounts += 1; changed_here = true; }
            new_row
        }).to_string();

        // Sentences that repeat a price: the generator's own rewrite. It may only change figures here.
        let before = paragraph_texts(&xml);
        let (y, _) = feefill::price_sentences(&xml, position, &feefill::SentenceInput { lines: input.lines, standards: input.standards, months: total_months, currency: input.currency });
        let after = paragraph_texts(&y);
        if after.len() != before.len() {
            report.blocked.push(format!("Slide {position}: a sentence no longer fits the proposal's rows, and removing it is not a price change."));
        } else {
            let moved = before.iter().zip(after.iter()).filter(|(a, b)| a != b).count();
            if moved > 0 { report.amounts += moved; changed_here = true; xml = y; }
        }
        // Prices that rewrite places itself are found where it places them: the accountancy packages' cards, and
        // the package deal's comparison table.
        let cards = original.contains("STARTUP") && original.contains("ACTIVE") && original.contains("SAR / month");
        let comparison = original.to_lowercase().contains("cost without package");
        for p in pts.iter_mut() {
            let card = cards && p.line.modules.contains(&"accountancy") && p.rate.map(|r| { let l = r.label.to_lowercase(); l.starts_with("startup") || l.starts_with("active") }).unwrap_or(false);
            let package = comparison && p.rate.is_none() && p.line.modules.contains(&"constitution_maintenance");
            if card || package { p.placed += 1; report.rows_found += 1; }
        }
        if changed_here { report.amount_slides.push(position); }

        if reword_term {
            let (y, n) = feefill::rewrite_term(&xml, new_months);
            if n > 0 { report.term_slides.push(position); xml = y; }
        }

        // The two dates: the cover's, and the letter's (the first dated slide after it, among the next three).
        if position == 1 || (position <= 4 && report.date_slides.iter().all(|s| *s == 1)) {
            let (y, n) = rewrite_shapes(&xml, |t| if t.chars().count() <= 60 { restyle_dates(t, input.date_iso) } else { None });
            let dated = paragraph_texts(&xml).iter().any(|t| t.chars().count() <= 60 && restyle_dates(t, input.date_iso).is_some());
            if n > 0 { xml = y; }
            if dated { report.date_slides.push(position); }
        }

        if xml != original {
            pkg.set_text(part, xml);
        }
    }

    // Every price must have found its row.
    for p in pts.iter().filter(|p| p.placed == 0) {
        report.unplaced.push(p.name.clone());
    }
    // A figure that was replaced and still stands elsewhere on the same slide is worth a look.
    for (k, p) in pts.iter().enumerate() {
        if p.percent.is_some() && p.price.is_none() { continue; }
        for (slide, old) in &p.changes {
            let kept = pts.iter().enumerate().any(|(j, q)| j != k && q.seen.iter().any(|(s, _)| s == slide) && q.value().map(|v| close(v, *old)).unwrap_or(false));
            if kept { continue; }
            let texts = paragraph_texts(&pkg.text_of(&parts[slide - 1]));
            if texts.iter().any(|t| money_regex().find_iter(t).filter(|m| !m.as_str().contains('%')).filter_map(|m| parse_amount(m.as_str())).any(|v| close(v, *old))) {
                let note = format!("Slide {slide} still shows {} somewhere: check it.", format_like("1 SAR", *old, input.currency));
                if !report.checks.contains(&note) { report.checks.push(note); }
            }
        }
    }
    report.amount_slides.dedup();
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pptx::Parts;

    fn cell(t: &str) -> String { format!("<a:tc><a:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></a:txBody></a:tc>") }
    fn row(cells: &[&str]) -> String { format!("<a:tr h=\"1\">{}</a:tr>", cells.iter().map(|c| cell(c)).collect::<String>()) }
    fn table(rows: &[String]) -> String { format!("<a:tbl>{}</a:tbl>", rows.concat()) }
    fn shape(lines: &[&str]) -> String { format!("<p:sp><p:spPr><a:xfrm><a:ext cx=\"9000000\" cy=\"400000\"/></a:xfrm></p:spPr><p:txBody>{}</p:txBody></p:sp>", lines.iter().map(|t| format!("<a:p><a:r><a:t>{t}</a:t></a:r></a:p>")).collect::<String>()) }

    fn deck(slides: &[String]) -> Package {
        let mut parts = Parts::new();
        let ids: String = (0..slides.len()).map(|i| format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 256 + i, i + 2)).collect();
        let rels: String = (0..slides.len()).map(|i| format!("<Relationship Id=\"rId{}\" Type=\"x/slide\" Target=\"slides/slide{}.xml\"/>", i + 2, i + 1)).collect();
        parts.insert("ppt/presentation.xml".into(), format!("<p:presentation><p:sldIdLst>{ids}</p:sldIdLst></p:presentation>").into_bytes());
        parts.insert("ppt/_rels/presentation.xml.rels".into(), format!("<Relationships>{rels}</Relationships>").into_bytes());
        for (i, s) in slides.iter().enumerate() {
            parts.insert(format!("ppt/slides/slide{}.xml", i + 1), format!("<p:sld><p:cSld><p:spTree>{s}</p:spTree></p:cSld></p:sld>").into_bytes());
        }
        Package { order: parts.keys().cloned().collect(), parts }
    }

    fn texts(pkg: &Package, slide: usize) -> Vec<String> {
        paragraph_texts(&pkg.text_of(&format!("ppt/slides/slide{slide}.xml")))
    }

    fn single(service: &str, module: &'static str, price: f64) -> SmartLine {
        SmartLine { service: service.into(), unit_price: Some(price), modules: vec![module], months: Some(12.0), ..Default::default() }
    }

    fn band(from: i64, to: i64, price: f64) -> LineRate { LineRate { from: Some(from), to: Some(to), price: Some(price), ..Default::default() } }

    fn input<'a>(lines: &'a [SmartLine], months: Option<i64>, standards: &'a Standards) -> RepriceInput<'a> {
        RepriceInput { lines, currency: "SAR", months, date_iso: "2026-10-01", standards }
    }

    fn sample() -> Package {
        deck(&[
            shape(&["Proposal for Contoso", "Sunday, 13th September 2026"]),
            shape(&["Date: 13th of September 2026", "Dear Sir, thank you for the meeting on 2nd September 2026 and for the long conversation that followed it."]),
            format!("{}{}", shape(&["Project Fees", "Admin PRO Services", "A note written by hand: the first invoice is in November."]),
                table(&[row(&["Category", "Monthly fees"]), row(&["Tranche 1 (1–5 employees)", "2,000 SAR"]), row(&["Tranche 2 (6–15 employees)", "3,750 SAR"])])),
            format!("{}{}", shape(&["Project Fees", "GM Representative Services", "Service for 12 months minimum."]),
                table(&[row(&["GM Representative services", "6,500 SAR"]), row(&["Total Annual Cost", "78,000 SAR"])])),
        ])
    }

    fn sample_lines(tranche_two: f64, gm: f64) -> Vec<SmartLine> {
        vec![
            SmartLine { service: "Admin PRO".into(), modules: vec!["admin_pro"], kind: Some(RowKind::Tranche), rates: vec![band(1, 5, 2000.0), band(6, 15, tranche_two)], ..Default::default() },
            single("GM Representative", "gm_representative", gm),
        ]
    }

    #[test]
    fn changes_only_the_amounts_and_the_two_dates_and_keeps_what_was_written_by_hand() {
        let mut pkg = sample();
        let lines = sample_lines(3500.0, 7200.0);
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(12), &st));
        assert!(r.can_save(), "{r:?}");
        // The changed tranche, the GM fee and the total under it; the tranche that did not move is not counted.
        assert_eq!((r.amounts, r.amount_slides.clone(), r.rows_found), (3, vec![3, 4], 3));
        assert_eq!(texts(&pkg, 3), vec!["Project Fees", "Admin PRO Services", "A note written by hand: the first invoice is in November.", "Category", "Monthly fees", "Tranche 1 (1–5 employees)", "2,000 SAR", "Tranche 2 (6–15 employees)", "3,500 SAR"]);
        assert_eq!(texts(&pkg, 4), vec!["Project Fees", "GM Representative Services", "Service for 12 months minimum.", "GM Representative services", "7,200 SAR", "Total Annual Cost", "86,400 SAR"]);
        // The cover's date and the letter's; a date inside the letter's text is the letter's own.
        assert_eq!(r.date_slides, vec![1, 2]);
        assert_eq!(texts(&pkg, 1)[1], "Thursday, 1st October 2026");
        assert_eq!(texts(&pkg, 2), vec!["Date: 1st of October 2026", "Dear Sir, thank you for the meeting on 2nd September 2026 and for the long conversation that followed it."]);
        assert!(r.term_slides.is_empty());
        assert_eq!(r.line("V1"), "Prices revised from V1: 3 amounts updated on slides 3 and 4; dates on slides 1 and 2");
    }

    #[test]
    fn a_price_with_no_row_stops_it_and_is_named() {
        let mut pkg = sample();
        let mut lines = sample_lines(3500.0, 7200.0);
        lines[0].rates.push(band(16, 30, 5200.0));
        lines.push(single("Payroll", "payroll", 4000.0));
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(12), &st));
        assert!(!r.can_save());
        assert_eq!(r.unplaced, vec!["Admin PRO: 16–30 employees", "Payroll"]);
        assert_eq!(r.reason("V1"), "Some prices have no row in V1: Admin PRO: 16–30 employees; Payroll.");
    }

    #[test]
    fn a_deck_whose_prices_already_match_is_not_saved_as_revised() {
        let mut pkg = sample();
        let before = pkg.text_of("ppt/slides/slide3.xml");
        let lines = sample_lines(3750.0, 6500.0);
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(12), &st));
        assert_eq!((r.amounts, r.rows_found, r.can_save()), (0, 3, false));
        assert_eq!(r.reason("V1"), "The prices and the term in V1 already match the proposal.");
        assert_eq!(pkg.text_of("ppt/slides/slide3.xml"), before);
    }

    #[test]
    fn a_deck_with_no_fee_table_it_recognises_says_so() {
        let mut pkg = deck(&[shape(&["A deck made elsewhere"]), table(&[row(&["Our fee", "9,000 SAR"])])]);
        let lines = vec![single("Payroll", "payroll", 4000.0)];
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(12), &st));
        assert_eq!((r.rows_found, r.can_save()), (0, false));
        assert_eq!(r.reason("V2"), "No fee table was recognised in V2, so nothing was changed.");
        assert_eq!(texts(&pkg, 2), vec!["Our fee", "9,000 SAR"]);
    }

    #[test]
    fn the_term_is_reworded_from_twelve_months_and_the_total_follows() {
        let mut pkg = sample();
        let mut lines = sample_lines(3750.0, 6500.0);
        lines[1].months = Some(6.0);
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(6), &st));
        assert!(r.can_save(), "{r:?}");
        assert_eq!(r.term_slides, vec![4]);
        assert_eq!(texts(&pkg, 4), vec!["Project Fees", "GM Representative Services", "Service for 6 months minimum.", "GM Representative services", "6,500 SAR", "Total Cost (6 Months)", "39,000 SAR"]);
        assert_eq!(r.line("V1"), "Prices revised from V1: 1 amount updated on slide 4; term on slide 4; dates on slides 1 and 2");
        // A deck already at another term: that wording is not patched.
        let mut again = pkg.clone();
        let r = reprice(&mut again, &input(&lines, Some(9), &st));
        assert_eq!(r.blocked, vec!["The contract term changed from 6 to 9 months, and that wording cannot be changed in place."]);
        assert!(!r.can_save());
    }

    #[test]
    fn a_total_it_cannot_recalculate_stops_it() {
        let mut pkg = deck(&[
            shape(&["Cover"]),
            format!("{}{}", shape(&["Project Fees", "GM Representative Services"]), table(&[row(&["GM Representative services", "6,500 SAR"]), row(&["Total Annual Cost", "80,000 SAR"])])),
        ]);
        let lines = vec![single("GM Representative", "gm_representative", 7000.0)];
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(12), &st));
        assert_eq!(r.blocked, vec!["Slide 2: the total (80,000 SAR) cannot be recalculated in place."]);
        assert!(!r.can_save());
    }

    #[test]
    fn percentages_and_named_rows_find_their_rows() {
        let mut pkg = deck(&[
            shape(&["Cover"]),
            format!("{}{}", shape(&["Project Fees", "Recruitment Services"]), table(&[row(&["Professional Staff", "Any package", "15% of the annual package"]), row(&["Blue Collar", "Any package", "8% of the annual package"])])),
            format!("{}{}", shape(&["Project Fees", "Workforce Services"]), table(&[row(&["Professional Nationalized Employee (Engineers and Managers)", "3,000 SAR"]), row(&["Professional Non-Nationalized Employee (Engineers)", "2,500 SAR"])])),
        ]);
        let pct = |l: &str, p: f64| LineRate { label: l.into(), percent: Some(p), ..Default::default() };
        let cat = |l: &str, p: f64| LineRate { label: l.into(), price: Some(p), ..Default::default() };
        let lines = vec![
            SmartLine { service: "Recruitment".into(), modules: vec!["recruitment"], kind: Some(RowKind::Percent), rates: vec![pct("Professional Staff", 12.5), pct("Blue Collar", 8.0)], ..Default::default() },
            SmartLine { service: "Employer of Record".into(), modules: vec!["workforce"], kind: Some(RowKind::Category), rates: vec![cat("Nationalized (Engineers & Managers)", 3200.0), cat("Non-Nationalized (Engineers)", 2500.0)], ..Default::default() },
        ];
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(12), &st));
        assert!(r.can_save(), "{r:?}");
        assert_eq!((r.amounts, r.rows_found, r.amount_slides.clone()), (2, 4, vec![2, 3]));
        assert_eq!(texts(&pkg, 2)[4], "12.5% of the annual package");
        assert_eq!(texts(&pkg, 3), vec!["Project Fees", "Workforce Services", "Professional Nationalized Employee (Engineers and Managers)", "3,200 SAR", "Professional Non-Nationalized Employee (Engineers)", "2,500 SAR"]);
    }

    #[test]
    fn reads_the_term_a_deck_states() {
        let t = |s: &str| vec![vec![s.to_string()]];
        assert_eq!(stated_terms(&t("Service is for a minimum of 6 months.")), vec![6]);
        assert_eq!(stated_terms(&t("Total cost over 9 months")), vec![9]);
        assert_eq!(stated_terms(&t("a fixed and non-cancellable period of nine (9) months from the effective date")), vec![9]);
        assert_eq!(stated_terms(&t("The contract lasts for 6 months.")), vec![6]);
        assert_eq!(stated_terms(&t("6 Months")), vec![6]);
        // How long the work takes and notice periods are not the term.
        assert!(stated_terms(&t("Activity Duration ≈ 3 Months; two (2) months notice")).is_empty());
        // Twelve months is asked of the generator's own rewrite, in every wording it knows.
        for s in ["Total Annual Cost", "Total cost over 12 months", "Service is for 1 year agreement minimum.", "12 Months", "twelve (12) month Term", "this Agreement will initially to complete duration of 1 year"] {
            assert!(says_twelve_months(&t(s)), "{s}");
            assert!(stated_terms(&t(s)).is_empty(), "{s}");
        }
        assert!(!says_twelve_months(&t("Service for 6 months minimum.")));
        assert!(!says_twelve_months(&t("Employee terminated by CLIENT in the month number 2, Calculation: (Monthly fee × 4 Months)")));
        assert!(!says_twelve_months(&t("The setup is free for the first 12 months.")));
    }

    #[test]
    fn a_deck_already_at_the_proposals_term_is_not_reworded_again() {
        // "month number 2 … × 4 Months" is the six-month wording; rewording it again would move it.
        let mut pkg = deck(&[
            shape(&["Cover"]),
            format!("{}{}", shape(&["Project Fees", "GM Representative Services", "Service for 6 months minimum.", "Employee terminated by CLIENT in the month number 2, Calculation: (Monthly fee × 4 Months)"]),
                table(&[row(&["GM Representative services", "6,500 SAR"])])),
        ]);
        let mut lines = vec![single("GM Representative", "gm_representative", 7000.0)];
        lines[0].months = Some(6.0);
        let st = Standards::default();
        let r = reprice(&mut pkg, &input(&lines, Some(6), &st));
        assert!(r.can_save() && r.term_slides.is_empty(), "{r:?}");
        assert_eq!(texts(&pkg, 2)[3], "Employee terminated by CLIENT in the month number 2, Calculation: (Monthly fee × 4 Months)");
        // A deck that says nothing about the term is left alone too.
        let mut silent = deck(&[shape(&["Cover"]), table(&[row(&["GM Representative services", "6,500 SAR"])])]);
        let r = reprice(&mut silent, &input(&lines, Some(6), &st));
        assert!(r.can_save() && r.term_slides.is_empty(), "{r:?}");
    }
}
