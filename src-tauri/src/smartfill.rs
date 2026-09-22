//! Fills MENA BIG's existing proposal templates the way the team fills them
//! by hand, without `{{placeholders}}`. Learned by comparing the templates
//! with proposals actually sent (several real client decks):
//!
//! - `'Client Name'` is replaced everywhere (letter, scope, terms, acceptance).
//! - The cover and letter dates ("Sunday, 9th June 2024", "Date: 16th of May
//!   2024") become the proposal date, in the same style.
//! - The line under "Attn:" ("Kingdom of Saudi Arabia") follows the client's country.
//! - The "Logo" box becomes the client's logo; the "Photos" box is removed.
//! - Agenda page numbers ("04 · 12 · 16") are recounted after slides are removed.
//! - Fee table amounts are updated where a row matches a service line, and
//!   every other amount is listed for a manual check.

use crate::pptx::{fill_placeholders, Package};
use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS: [&str; 7] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

pub const CLIENT_PLACEHOLDERS: &[&str] = &["'Client Name'", "‘Client Name’", "“Client Name”", "\"Client Name\"", "[Client Name]", "'New Client'", "‘New Client’"];

/// The client placeholder in any case and quote style: 'Client Name', ‘NEW CLIENT’, [client name]…
pub fn client_placeholder_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?i)['‘“"](client name|new client)['’”"]|\[(client name)\]"#).expect("regex"))
}

/// The client's name for a placeholder, in its case style: an all-caps placeholder
/// ('CLIENT NAME') gets the name in capitals, any other the name as typed.
fn client_for(placeholder: &str, name: &str) -> String {
    let letters: Vec<char> = placeholder.chars().filter(|c| c.is_alphabetic()).collect();
    if !letters.is_empty() && letters.iter().all(|c| c.is_uppercase()) { name.to_uppercase() } else { name.to_string() }
}

/// Replaces every client placeholder in a piece of text; returns the text and how many.
pub fn replace_client(text: &str, name: &str) -> (String, usize) {
    let mut n = 0;
    let out = client_placeholder_regex().replace_all(text, |c: &regex::Captures| { n += 1; client_for(&c[0], name) }).to_string();
    (out, n)
}

/// (placeholder as written, replacement) for each distinct placeholder in these texts.
pub fn client_pairs(texts: &[String], name: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for t in texts {
        for m in client_placeholder_regex().find_iter(t) {
            if !out.iter().any(|(p, _)| p == m.as_str()) { out.push((m.as_str().to_string(), client_for(m.as_str(), name))); }
        }
    }
    out
}

pub(crate) fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

fn date_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?i)\b(?:(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+)?(\d{1,2})(st|nd|rd|th)?\s+(of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)(,?)\s+(\d{4})\b", &R)
}

pub(crate) fn money_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?i)(?:\b(?:SAR|USD|EUR|AED)\s*|[$€]\s*)\d[\d.,]*|\b\d[\d.,]*\s*(?:SAR|USD|EUR|AED)\b|\b\d{1,2}(?:[.,]\d+)?\s*%", &R)
}

// ═══════════════ Paragraph-level rewriting ═══════════════

/// Calls `edit` with each paragraph's joined text; a returned string becomes
/// the paragraph's text (kept in the first run, so its formatting stays).
pub(crate) fn rewrite_paragraphs(xml: &str, edit: impl FnMut(usize, &str) -> Option<String>) -> (String, usize) {
    rewrite_paragraphs_in_box(xml, None, edit)
}

/// Same, knowing the width of the text box (EMU) so a line that no longer
/// fits on one line can be shrunk.
fn rewrite_paragraphs_in_box(xml: &str, box_width: Option<i64>, mut edit: impl FnMut(usize, &str) -> Option<String>) -> (String, usize) {
    static PARA: OnceLock<Regex> = OnceLock::new();
    static T: OnceLock<Regex> = OnceLock::new();
    let mut index = 0;
    let mut changed = 0;
    let out = re(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>", &PARA).replace_all(xml, |pc: &regex::Captures| {
        let para = pc[0].to_string();
        let spans: Vec<(usize, usize, String)> = re(r"(?s)(?:<a:t>|<a:t [^>]*>)(.*?)</a:t>", &T)
            .captures_iter(&para)
            .map(|c| { let m = c.get(1).expect("group"); (m.start(), m.end(), unescape(m.as_str())) })
            .collect();
        if spans.is_empty() {
            return para;
        }
        let joined: String = spans.iter().map(|s| s.2.as_str()).collect();
        if joined.trim().is_empty() {
            return para;
        }
        let i = index;
        index += 1;
        let Some(new_text) = edit(i, &joined) else { return para };
        if new_text == joined {
            return para;
        }
        changed += 1;
        let mut rebuilt = para.clone();
        for (k, (s, e, _)) in spans.iter().enumerate().rev() {
            let text = if k == 0 { escape(&new_text) } else { String::new() };
            rebuilt.replace_range(*s..*e, &text);
        }
        let rebuilt = crate::pptx::clear_highlight(&rebuilt);
        match box_width {
            Some(w) => shrink_to_width(&rebuilt, joined.chars().count(), new_text.chars().count(), w),
            None => rebuilt,
        }
    });
    (out.to_string(), changed)
}

/// A short line that grew (a long client name where "'Client Name'" was, a
/// date with a long month) and would now wrap in its box gets a smaller font,
/// down to 60% of the template size. Width is estimated from the character
/// count and font size, which is close enough for these one-line labels.
fn shrink_to_width(para: &str, old_len: usize, new_len: usize, box_width: i64) -> String {
    static SZ: OnceLock<Regex> = OnceLock::new();
    if new_len > 60 || new_len <= old_len {
        return para.to_string();
    }
    let size = re(r#"\bsz="(\d+)""#, &SZ).captures(para).and_then(|c| c[1].parse::<f64>().ok()).unwrap_or(1800.0) / 100.0;
    let available = (box_width - 182_880) as f64; // default left and right insets
    let estimated = new_len as f64 * size * 0.62 * 12_700.0;
    if estimated <= available {
        return para.to_string();
    }
    let ratio = (available / estimated).clamp(0.6, 1.0);
    re(r#"\bsz="(\d+)""#, &SZ)
        .replace_all(para, |c: &regex::Captures| {
            let sz: f64 = c[1].parse().unwrap_or(1800.0);
            format!(r#"sz="{}""#, ((sz * ratio) / 50.0).round() as i64 * 50)
        })
        .to_string()
}

/// Runs a paragraph edit shape by shape, so each shape's width is known.
pub(crate) fn rewrite_shapes(xml: &str, mut edit: impl FnMut(&str) -> Option<String>) -> (String, usize) {
    static SP: OnceLock<Regex> = OnceLock::new();
    static EXT: OnceLock<Regex> = OnceLock::new();
    let mut total = 0;
    let out = re(r"(?s)<p:sp>.*?</p:sp>", &SP).replace_all(xml, |c: &regex::Captures| {
        let shape = &c[0];
        let width = re(r#"<a:ext cx="(\d+)""#, &EXT).captures(shape).and_then(|m| m[1].parse::<i64>().ok());
        let (new_shape, n) = rewrite_paragraphs_in_box(shape, width, |_, t| edit(t));
        total += n;
        new_shape
    }).to_string();
    (out, total)
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub(crate) fn paragraph_texts(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let _ = rewrite_paragraphs(xml, |_, t| { out.push(t.to_string()); None });
    out
}

// ═══════════════ Dates ═══════════════

fn ordinal(d: u32) -> String {
    let suffix = match (d % 10, d % 100) {
        (1, n) if n != 11 => "st",
        (2, n) if n != 12 => "nd",
        (3, n) if n != 13 => "rd",
        _ => "th",
    };
    format!("{d}{suffix}")
}

fn weekday(y: i64, m: u32, d: u32) -> &'static str {
    let (y2, m2) = if m <= 2 { (y - 1, m as i64 + 9) } else { (y, m as i64 - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + d as i64 - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    WEEKDAYS[(days + 3).rem_euclid(7) as usize]
}

/// Rewrites the dates in a short line in the style they were typed.
pub fn restyle_dates(text: &str, iso: &str) -> Option<String> {
    let (y, m, d) = {
        let mut it = iso.get(0..10)?.split('-');
        (it.next()?.parse::<i64>().ok()?, it.next()?.parse::<u32>().ok()?, it.next()?.parse::<u32>().ok()?)
    };
    if !(1..=12).contains(&m) {
        return None;
    }
    if date_regex().is_match(text) {
        return Some(date_regex().replace_all(text, |c: &regex::Captures| {
            let wd = c.get(1).map(|_| format!("{}, ", weekday(y, m, d))).unwrap_or_default();
            let day = if c.get(3).is_some() { ordinal(d) } else { d.to_string() };
            let of = if c.get(4).is_some() { "of " } else { "" };
            let comma = &c[6];
            format!("{wd}{day} {of}{}{comma} {y}", MONTHS[m as usize - 1])
        }).to_string());
    }
    // Month first: "June 28th 2026", "Sunday, September 7th, 2026".
    static MONTH_FIRST: OnceLock<Regex> = OnceLock::new();
    let r = re(r"(?i)\b(?:(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(st|nd|rd|th)?(,?)\s+(\d{4})\b", &MONTH_FIRST);
    if !r.is_match(text) {
        return None;
    }
    Some(r.replace_all(text, |c: &regex::Captures| {
        let wd = c.get(1).map(|_| format!("{}, ", weekday(y, m, d))).unwrap_or_default();
        let day = if c.get(4).is_some() { ordinal(d) } else { d.to_string() };
        format!("{wd}{} {day}{} {y}", MONTHS[m as usize - 1], &c[5])
    }).to_string())
}

// ═══════════════ Amounts ═══════════════

/// The proposal amount written the way the template wrote its amount:
/// "3.550 SAR", "SAR 1,500" or "$ 3,150".
pub fn format_like(original: &str, amount: f64, currency: &str) -> String {
    let o = original.trim();
    let digits: String = o.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect();
    let dot_thousands = Regex::new(r"^\d{1,3}(\.\d{3})+$").map(|r| r.is_match(&digits)).unwrap_or(false);
    let whole = amount.round() as i64;
    let s = whole.abs().to_string();
    let mut grouped = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            grouped.push(if dot_thousands { '.' } else { ',' });
        }
        grouped.push(ch);
    }
    let symbol = match currency { "USD" => "$", "EUR" => "€", _ => "" };
    let prefix = o.chars().next().map(|c| !c.is_ascii_digit()).unwrap_or(false);
    if prefix {
        if o.starts_with('$') || o.starts_with('€') {
            if symbol.is_empty() { format!("{currency} {grouped}") } else { format!("{symbol} {grouped}") }
        } else {
            format!("{currency} {grouped}")
        }
    } else {
        format!("{grouped} {currency}")
    }
}

// ═══════════════ Images ═══════════════

pub struct LogoImage {
    pub bytes: Vec<u8>,
    /// png | jpeg
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
}

pub fn read_logo(path: &std::path::Path) -> Result<LogoImage, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read the logo: {e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("The logo file is larger than 8 MB.".into());
    }
    if bytes.len() > 24 && bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        return Ok(LogoImage { bytes, ext: "png", width: w, height: h });
    }
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 9 < bytes.len() {
            if bytes[i] != 0xFF { i += 1; continue; }
            let marker = bytes[i + 1];
            let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            if (0xC0..=0xC3).contains(&marker) {
                let h = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
                let w = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
                return Ok(LogoImage { bytes, ext: "jpeg", width: w, height: h });
            }
            i += 2 + len;
        }
    }
    Err("Use a PNG or JPEG image for the logo.".into())
}

// ═══════════════ Applying ═══════════════

#[derive(Debug, Clone, Default)]
pub struct SmartLine {
    pub service: String,
    pub description: Option<String>,
    pub unit_price: Option<f64>,
    /// Template modules the line is for (proposal_library), to find its fee slide.
    pub modules: Vec<&'static str>,
    /// How its rate card prices it, when by rows (tranches, categories…).
    pub kind: Option<crate::pricing::RowKind>,
    /// The proposal's priced rows for it.
    pub rates: Vec<crate::models::LineRate>,
    /// The rate card's row labels, to recognise its fee table.
    pub preset_labels: Vec<String>,
    /// Contract months for a monthly line, to recompute totals.
    pub months: Option<f64>,
}

/// Whether a fee-table row is for this line: its scope or service name is in
/// the row ("Company Maintenance Fees"), or every meaningful word of the
/// service name is ("Business Setup and Maintenance Package" ↔ "Business
/// Setup and Company Maintenance").
fn row_names_line(row_text: &str, line: &SmartLine) -> bool {
    let lower = row_text.to_lowercase();
    let verbatim = [line.description.as_deref().unwrap_or(""), line.service.as_str()]
        .iter()
        .map(|x| x.trim().to_lowercase())
        // A one-word service ("Consultancy") only names a row that says just that.
        .any(|label| label.chars().count() >= 5 && lower.contains(&label) && (label.split_whitespace().count() >= 2 || row_label(row_text).trim().eq_ignore_ascii_case(&label)));
    if verbatim {
        return true;
    }
    const GENERIC: &[&str] = &["package", "services", "service", "fees", "fee", "monthly", "company"];
    let row_words = crate::pricing::words(row_text);
    let name_words: Vec<String> = crate::pricing::words(&line.service).into_iter().filter(|w| !GENERIC.contains(&w.as_str())).collect();
    name_words.len() >= 2 && name_words.iter().all(|w| row_words.contains(w))
}

fn row_label(row_text: &str) -> String {
    money_regex().replace_all(row_text, " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The row's label (its text without amounts) names one of the line's template modules.
fn row_module_matches(row_text: &str, line: &SmartLine) -> bool {
    let label = money_regex().replace_all(row_text, " ");
    crate::proposal_library::modules_in(&label).iter().any(|m| line.modules.contains(m))
}

fn total_row_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?i)\btotal\s+annual\b", &R)
}

/// Modules a fee slide is for: the line under its first "Project Fees" heading.
fn fee_slide_modules(texts: &[String]) -> Vec<&'static str> {
    texts
        .iter()
        .enumerate()
        .filter(|(_, t)| t.trim() == "Project Fees")
        .filter_map(|(i, _)| texts.get(i + 1))
        .find(|next| next.trim() != "Fees and Payment Terms")
        .map(|t| crate::proposal_library::modules_in(t))
        .unwrap_or_default()
}

pub struct SmartInput<'a> {
    pub client_name: &'a str,
    pub date_iso: &'a str,
    pub country: Option<&'a str>,
    pub currency: &'a str,
    pub lines: &'a [SmartLine],
    pub logo: Option<LogoImage>,
    /// The proposal's contract term; the deck's contract wording follows it.
    pub contract_months: Option<i64>,
    /// Rate-card standards for prices the deck quotes without a line (constitution, maintenance).
    pub standards: crate::feefill::Standards,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmartReport {
    /// What was filled, in plain words.
    pub filled: Vec<String>,
    /// Amounts left as typed in the template, for a manual check.
    pub fees_to_check: Vec<String>,
    pub warnings: Vec<String>,
    /// Sentences that may no longer fit the proposal, for a read before sending.
    pub checks: Vec<String>,
}

fn shape_text(shape: &str) -> String {
    paragraph_texts(shape).join(" ").trim().to_string()
}

struct SlidePart {
    part: String,
    position: usize,
}

fn kept_slides(pkg: &Package) -> Vec<SlidePart> {
    crate::pptx::slide_parts_in_order(pkg).into_iter().enumerate().map(|(i, part)| SlidePart { part, position: i + 1 }).collect()
}

pub fn apply(pkg: &mut Package, input: SmartInput) -> SmartReport {
    let mut report = SmartReport::default();
    let slides = kept_slides(pkg);
    let mut client_count = 0;
    let mut date_slides = 0;
    let mut fee_updates = 0;
    let mut logo_done = false;
    let mut photos_removed = 0;
    let mut logo_boxes = 0;
    let mut term_slides = 0;

    for s in &slides {
        let mut xml = pkg.text_of(&s.part);

        // Client name (short lines shrink to fit when the name is long).
        let (x, _) = rewrite_shapes(&xml, |t| {
            if t.chars().count() > 60 { return None; }
            let (filled, hits) = replace_client(t, input.client_name);
            if hits == 0 { return None; }
            client_count += hits;
            Some(filled)
        });
        xml = x;
        // Longer text: the placeholders as this slide writes them, run by run.
        let client_pairs = client_pairs(&paragraph_texts(&xml), input.client_name);
        let (x, n) = fill_placeholders(&xml, &client_pairs);
        xml = x;
        client_count += n;

        // Dates on short lines (cover, letter) — not dates inside contract text.
        let (x, n) = rewrite_shapes(&xml, |t| if t.chars().count() <= 60 { restyle_dates(t, input.date_iso) } else { None });
        xml = x;
        if n > 0 { date_slides += 1; }

        // The country line under "Attn:".
        if let Some(country) = input.country.filter(|c| !c.trim().is_empty()) {
            let texts = paragraph_texts(&xml);
            if let Some(attn) = texts.iter().position(|t| t.trim_start().starts_with("Attn")) {
                let target = attn + 1;
                let wanted = if country.eq_ignore_ascii_case("Saudi Arabia") { "Kingdom of Saudi Arabia".to_string() } else { country.to_string() };
                let (x, n) = rewrite_paragraphs(&xml, |i, t| (i == target && t.trim().eq_ignore_ascii_case("Kingdom of Saudi Arabia")).then(|| wanted.clone()));
                xml = x;
                if n > 0 { report.filled.push(format!("Country under \"Attn\" set to {wanted}")); }
            }
        }

        // "Logo" and "Photos" boxes.
        static SP: OnceLock<Regex> = OnceLock::new();
        let shapes: Vec<String> = re(r"(?s)<p:sp>.*?</p:sp>", &SP).find_iter(&xml).map(|m| m.as_str().to_string()).collect();
        for shape in shapes {
            match shape_text(&shape).as_str() {
                "Photos" | "Photo" => { xml = xml.replacen(&shape, "", 1); photos_removed += 1; }
                "Logo" => {
                    logo_boxes += 1;
                    if let Some(logo) = &input.logo {
                        let pic = logo_picture(pkg, &s.part, &shape, logo);
                        xml = xml.replacen(&shape, &pic, 1);
                        logo_done = true;
                    } else {
                        xml = xml.replacen(&shape, "", 1);
                    }
                }
                _ => {}
            }
        }

        let before_fees = xml.clone();
        // The proposal's rows: tranches, categories, accountancy rows, staff types, countries.
        let fee_modules = fee_slide_modules(&paragraph_texts(&xml));
        let slide_lines: Vec<&SmartLine> = input.lines.iter().filter(|l| l.kind.is_some() && l.modules.iter().any(|m| fee_modules.contains(m))).collect();
        let (x, rows) = crate::feefill::fill_rows(&xml, s.position, &slide_lines, input.currency);
        xml = x;
        report.filled.extend(rows.filled);
        report.checks.extend(rows.checks);
        let typed_rows = rows.handled;

        // Fee tables: rows that name a service line get its price.
        static ROW: OnceLock<Regex> = OnceLock::new();
        let rows: Vec<String> = re(r"(?s)<a:tr\b[^>]*>.*?</a:tr>", &ROW).find_iter(&xml).map(|m| m.as_str().to_string()).collect();
        let priced_row_texts: Vec<String> = rows.iter().map(|r| paragraph_texts(r).join(" ")).filter(|t| money_regex().is_match(t) && !total_row_regex().is_match(t)).collect();
        let mut updated_lines: Vec<&SmartLine> = Vec::new();
        let mut total_rows: Vec<String> = Vec::new();
        for row in rows {
            let row_text = paragraph_texts(&row).join(" ");
            if !money_regex().is_match(&row_text) || typed_rows.contains(&row_text) {
                continue;
            }
            let single = |l: &&SmartLine| l.unit_price.is_some() && l.kind.is_none();
            let line = input.lines.iter().filter(single).find(|l| row_names_line(&row_text, l)).or_else(|| {
                // Otherwise the one priced row on the slide whose label names the line's service.
                input.lines.iter().filter(single).find(|l| {
                    row_module_matches(&row_text, l)
                        && priced_row_texts.iter().filter(|t| row_module_matches(t, l)).count() == 1
                })
            });
            if line.is_none() && total_row_regex().is_match(&row_text) && money_regex().find_iter(&row_text).count() == 1 {
                total_rows.push(row.clone());
                continue;
            }
            match line {
                Some(l) => {
                    let mut done = false;
                    let price = l.unit_price.unwrap_or(0.0);
                    let (new_row, _) = rewrite_paragraphs(&row, |_, t| {
                        if done { return None; }
                        let m = money_regex().find(t)?;
                        if m.as_str().contains('%') { return None; }
                        done = true;
                        Some(format!("{}{}{}", &t[..m.start()], format_like(m.as_str(), price, input.currency), &t[m.end()..]))
                    });
                    if done {
                        xml = xml.replacen(&row, &new_row, 1);
                        fee_updates += 1;
                        if !updated_lines.iter().any(|u: &&SmartLine| std::ptr::eq(*u, l)) {
                            updated_lines.push(l);
                        }
                    } else {
                        report.fees_to_check.push(format!("Slide {}: {} — a percentage; set it by hand", s.position, row_text.chars().take(80).collect::<String>().trim()));
                    }
                }
                None => {
                    let label = paragraph_texts(&row).into_iter().find(|t| !money_regex().is_match(t)).unwrap_or_default();
                    for cell in paragraph_texts(&row) {
                        for m in money_regex().find_iter(&cell) {
                            report.fees_to_check.push(format!("Slide {}: {}{}", s.position, m.as_str().trim(), if label.trim().is_empty() { String::new() } else { format!(" — {}", label.trim().chars().take(70).collect::<String>()) }));
                        }
                    }
                }
            }
        }
        // "Total Annual Cost" follows the one monthly fee updated on the slide.
        for row in total_rows {
            let row_text = paragraph_texts(&row).join(" ");
            let monthly: Vec<&&SmartLine> = updated_lines.iter().filter(|l| l.months.is_some()).collect();
            let total = match monthly.as_slice() {
                [l] => l.unit_price.zip(l.months).map(|(p, m)| p * m),
                _ => None,
            };
            let Some(total) = total else {
                if let Some(m) = money_regex().find(&row_text) {
                    report.fees_to_check.push(format!("Slide {}: {} — {}", s.position, m.as_str().trim(), row_text.chars().take(70).collect::<String>().trim()));
                }
                continue;
            };
            let (new_row, _) = rewrite_paragraphs(&row, |_, t| {
                let m = money_regex().find(t).filter(|m| !m.as_str().contains('%'))?;
                Some(format!("{}{}{}", &t[..m.start()], format_like(m.as_str(), total, input.currency), &t[m.end()..]))
            });
            xml = xml.replacen(&row, &new_row, 1);
            report.filled.push(format!("Slide {}: total annual cost recalculated", s.position));
        }
        // Sentences quoting prices or conditions, then the contract term.
        let months = input.contract_months.unwrap_or(12);
        let (x, sentences) = crate::feefill::price_sentences(&xml, s.position, &crate::feefill::SentenceInput { lines: input.lines, standards: &input.standards, months, currency: input.currency });
        xml = x;
        report.filled.extend(sentences.filled);
        report.checks.extend(sentences.checks);
        xml = crate::feefill::reflow(&before_fees, &xml);
        let (x, n) = crate::feefill::rewrite_term(&xml, months);
        xml = x;
        if n > 0 { term_slides += 1; }
        report.checks.extend(crate::feefill::term_leftovers(&xml, s.position, months));

        // Amounts outside tables are listed too.
        let outside = re(r"(?s)<a:tbl>.*?</a:tbl>", {
            static TBL: OnceLock<Regex> = OnceLock::new();
            &TBL
        }).replace_all(&xml, "").to_string();
        for t in paragraph_texts(&outside) {
            // Short lines only; percentages in contract wording aren't fees.
            if t.chars().count() > 120 { continue; }
            for m in money_regex().find_iter(&t).filter(|m| !m.as_str().contains('%')) {
                report.fees_to_check.push(format!("Slide {}: {} — {}", s.position, m.as_str().trim(), t.chars().take(80).collect::<String>().trim()));
            }
        }

        pkg.set_text(&s.part, xml);
    }

    // Agenda page numbers.
    if let Some(msg) = recount_agenda(pkg, &slides) {
        report.filled.push(msg);
    }

    if client_count > 0 { report.filled.insert(0, format!("Client name in {client_count} place{}", if client_count == 1 { "" } else { "s" })); }
    if date_slides > 0 { report.filled.push(format!("Date on {date_slides} slide{}", if date_slides == 1 { "" } else { "s" })); }
    if logo_done { report.filled.push("Client logo placed".into()); }
    if logo_boxes > 0 && !logo_done { report.warnings.push("No client logo was chosen, so the \"Logo\" box was removed.".into()); }
    if photos_removed > 0 { report.filled.push("Photo placeholder removed".into()); }
    if term_slides > 0 { report.filled.push(format!("Contract term set to {} months on {term_slides} slide{}", input.contract_months.unwrap_or(12), if term_slides == 1 { "" } else { "s" })); }
    report.checks.dedup();
    if fee_updates > 0 { report.filled.push(format!("{fee_updates} fee amount{} updated from the proposal's services", if fee_updates == 1 { "" } else { "s" })); }
    report.fees_to_check.dedup();
    report
}

/// Replaces a "Logo" rectangle with the client's logo, fitted inside it.
fn logo_picture(pkg: &mut Package, slide_part: &str, shape: &str, logo: &LogoImage) -> String {
    static XFRM: OnceLock<Regex> = OnceLock::new();
    static ID: OnceLock<Regex> = OnceLock::new();
    let caps = re(r#"<a:off x="(-?\d+)" y="(-?\d+)"\s*/>\s*<a:ext cx="(\d+)" cy="(\d+)"\s*/>"#, &XFRM).captures(shape);
    let (x, y, cx, cy) = caps
        .map(|c| (c[1].parse::<i64>().unwrap_or(0), c[2].parse::<i64>().unwrap_or(0), c[3].parse::<i64>().unwrap_or(1), c[4].parse::<i64>().unwrap_or(1)))
        .unwrap_or((0, 0, 1_828_800, 914_400));
    let id = re(r#"<p:cNvPr[^>]*\bid="(\d+)""#, &ID).captures(shape).map(|c| c[1].to_string()).unwrap_or_else(|| "900".into());
    let (w, h) = (logo.width.max(1) as f64, logo.height.max(1) as f64);
    let scale = (cx as f64 / w).min(cy as f64 / h);
    let (pw, ph) = ((w * scale) as i64, (h * scale) as i64);
    let (px, py) = (x + (cx - pw) / 2, y + (cy - ph) / 2);

    let media = format!("ppt/media/mena-client-logo.{}", logo.ext);
    pkg.parts.insert(media.clone(), logo.bytes.clone());
    pkg.remember_part(&media);
    let content_type = if logo.ext == "png" { "image/png" } else { "image/jpeg" };
    let mut ct = pkg.text_of("[Content_Types].xml");
    if !ct.contains(&format!(r#"Extension="{}""#, logo.ext)) {
        ct = ct.replacen("<Default ", &format!(r#"<Default Extension="{}" ContentType="{content_type}"/><Default "#, logo.ext), 1);
        pkg.set_text("[Content_Types].xml", ct);
    }
    let (dir, file) = slide_part.rsplit_once('/').unwrap_or(("", slide_part));
    let rels_path = format!("{dir}/_rels/{file}.rels");
    let rel_id = "rIdMenaClientLogo";
    let mut rels = pkg.text_of(&rels_path);
    if rels.is_empty() {
        rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.into();
        pkg.remember_part(&rels_path);
    }
    if !rels.contains(rel_id) {
        rels = rels.replace("</Relationships>", &format!(r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/mena-client-logo.{}"/></Relationships>"#, logo.ext));
        pkg.set_text(&rels_path, rels);
    }
    format!(
        r#"<p:pic><p:nvPicPr><p:cNvPr id="{id}" name="Client logo"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="{px}" y="{py}"/><a:ext cx="{pw}" cy="{ph}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#
    )
}

/// The agenda lists section names and the slide each starts on; after slides
/// are removed those numbers are recounted from the section divider slides.
fn recount_agenda(pkg: &mut Package, slides: &[SlidePart]) -> Option<String> {
    let texts: Vec<Vec<String>> = slides.iter().map(|s| paragraph_texts(&pkg.text_of(&s.part))).collect();
    let agenda_idx = texts.iter().position(|t| t.iter().any(|p| p.trim().eq_ignore_ascii_case("agenda")))?;
    let number = Regex::new(r"^\s*\d{1,2}\s*$").ok()?;
    let labels: Vec<String> = texts[agenda_idx].iter().filter(|p| !p.trim().eq_ignore_ascii_case("agenda") && !number.is_match(p)).map(|p| p.trim().to_lowercase()).collect();
    let numbers = texts[agenda_idx].iter().filter(|p| number.is_match(p)).count();
    if labels.is_empty() || labels.len() != numbers {
        return None;
    }
    let pages: Vec<Option<usize>> = labels
        .iter()
        .map(|label| {
            texts.iter().enumerate().find(|(i, t)| *i != agenda_idx && t.len() <= 3 && t.first().map(|f| f.trim().to_lowercase() == *label).unwrap_or(false)).map(|(i, _)| slides[i].position)
        })
        .collect();
    let mut k = 0;
    let xml = pkg.text_of(&slides[agenda_idx].part);
    let (new_xml, changed) = rewrite_paragraphs(&xml, |_, t| {
        if !number.is_match(t) { return None; }
        let page = pages.get(k).copied().flatten();
        k += 1;
        page.map(|p| format!("{p:02}"))
    });
    pkg.set_text(&slides[agenda_idx].part, new_xml);
    (changed > 0).then(|| "Agenda page numbers recounted".to_string())
}

/// What the automatic fields would change on a slide, for the template screen.
pub fn detect_slide(xml: &str) -> Vec<String> {
    let texts = paragraph_texts(xml);
    let mut out = Vec::new();
    let clients: usize = texts.iter().map(|t| client_placeholder_regex().find_iter(t).count()).sum();
    if clients > 0 { out.push(format!("Client name ×{clients}")); }
    if texts.iter().any(|t| t.chars().count() <= 60 && date_regex().is_match(t)) { out.push("Date".into()); }
    if texts.iter().any(|t| t.trim() == "Logo") { out.push("Logo box".into()); }
    if texts.iter().any(|t| t.trim() == "Photos") { out.push("Photos box".into()); }
    if texts.iter().any(|t| t.trim().eq_ignore_ascii_case("agenda")) { out.push("Agenda numbers".into()); }
    let amounts: usize = texts.iter().map(|t| money_regex().find_iter(t).count()).sum();
    if amounts > 0 { out.push(format!("{amounts} amount{}", if amounts == 1 { "" } else { "s" })); }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_client_placeholders_in_any_case() {
        assert_eq!(replace_client("ACCEPTED BY 'CLIENT NAME'", "Logitech"), ("ACCEPTED BY LOGITECH".to_string(), 1));
        assert_eq!(replace_client("Accepted by 'Client Name'", "Logitech"), ("Accepted by Logitech".to_string(), 1));
        assert_eq!(replace_client("Attn: ‘NEW CLIENT’ and [client name]", "Acme Test Co"), ("Attn: ACME TEST CO and Acme Test Co".to_string(), 2));
        assert_eq!(replace_client("No placeholder here", "Acme").1, 0);
        // Long text keeps its runs: the caps placeholder is found and filled run by run.
        let para = r#"<a:p><a:r><a:rPr b="1"/><a:t>ACCEPTED BY 'CLIENT </a:t></a:r><a:r><a:rPr b="1"/><a:t>NAME'</a:t></a:r></a:p>"#;
        let pairs = client_pairs(&paragraph_texts(para), "Logitech");
        let (out, n) = crate::pptx::fill_placeholders(para, &pairs);
        assert_eq!((crate::pptx::paragraphs(&out).join(""), n), ("ACCEPTED BY LOGITECH".to_string(), 1));
    }

    #[test]
    fn restyles_dates_like_the_template() {
        assert_eq!(restyle_dates("Sunday, 9th June 2024", "2026-09-13").as_deref(), Some("Sunday, 13th September 2026"));
        assert_eq!(restyle_dates("Date: 16th of May 2024", "2026-09-01").as_deref(), Some("Date: 1st of September 2026"));
        assert_eq!(restyle_dates("Sunday, 16th of February, 2025", "2026-08-27").as_deref(), Some("Thursday, 27th of August, 2026"));
        assert_eq!(restyle_dates("June 28th 2026", "2026-09-14").as_deref(), Some("September 14th 2026"));
        assert_eq!(restyle_dates("Sunday, September 7th, 2026", "2026-09-14").as_deref(), Some("Monday, September 14th, 2026"));
        assert_eq!(restyle_dates("No date here", "2026-09-13"), None);
    }

    #[test]
    fn writes_amounts_in_the_template_style() {
        assert_eq!(format_like("3.550 SAR ", 3350.0, "SAR"), "3.350 SAR");
        assert_eq!(format_like("SAR 1,500", 2000.0, "SAR"), "SAR 2,000");
        assert_eq!(format_like("$ 3,150", 3000.0, "USD"), "$ 3,000");
        assert_eq!(format_like("4,750 SAR", 12500.0, "EUR"), "12,500 EUR");
    }

    #[test]
    fn shrinks_only_lines_that_no_longer_fit() {
        let shape = |cx: i64| format!(r#"<p:sp><a:ext cx="{cx}" cy="900000"/><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>'Client Name'</a:t></a:r></a:p></p:sp>"#);
        let edit = |t: &str| Some(t.replace("'Client Name'", "Acme Holdings Trading Company"));
        let (narrow, _) = rewrite_shapes(&shape(3_655_167), edit);
        assert!(!narrow.contains(r#"sz="3200""#), "{narrow}");
        let (wide, _) = rewrite_shapes(&shape(11_000_000), edit);
        assert!(wide.contains(r#"sz="3200""#), "{wide}");
    }

    #[test]
    fn fills_a_package_price_named_differently_and_its_annual_total() {
        let cell = |t: &str| format!("<a:tc><a:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></a:txBody></a:tc>");
        let row = |a: &str, b: &str| format!(r#"<a:tr h="370840">{}{}</a:tr>"#, cell(a), cell(b));
        let body = format!(
            "<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Package Deal</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:tbl>{}{}{}</a:tbl></p:graphicFrame></p:spTree></p:cSld></p:sld>",
            row("Category", "Cost"), row("Business Setup and Company Maintenance", "8,000 SAR/month"), row("Total Annual Cost", "90,000 SAR")
        );
        let mut parts = crate::pptx::Parts::new();
        for (name, xml) in [
            ("ppt/presentation.xml", r#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>"#.to_string()),
            ("ppt/_rels/presentation.xml.rels", r#"<Relationships><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/></Relationships>"#.to_string()),
            ("ppt/slides/slide1.xml", body.clone()),
        ] {
            parts.insert(name.to_string(), xml.into_bytes());
        }
        let mut pkg = crate::pptx::Package { order: parts.keys().cloned().collect(), parts };
        let line = SmartLine { service: "Business Setup and Maintenance Package".into(), unit_price: Some(7000.0), modules: vec!["business_setup"], months: Some(12.0), ..Default::default() };
        let report = apply(&mut pkg, SmartInput { client_name: "Test Client", date_iso: "2026-09-14", country: None, currency: "SAR", lines: &[line], logo: None, contract_months: None, standards: Default::default() });
        let texts = paragraph_texts(&pkg.text_of(&crate::pptx::slide_parts_in_order(&pkg)[0]));
        assert!(texts.contains(&"7,000 SAR/month".to_string()), "{texts:?}");
        assert!(texts.contains(&"84,000 SAR".to_string()), "{texts:?}");
        assert!(report.fees_to_check.is_empty(), "{:?}", report.fees_to_check);
        // Two rows for the same service (Accountancy with / without projects) aren't guessed.
        let two = SmartLine { service: "Accountancy".into(), unit_price: Some(3000.0), modules: vec!["accountancy"], ..Default::default() };
        assert!(!row_names_line("Accountancy (No Projects) 2,750 SAR", &SmartLine { service: "Accountancy and VAT".into(), ..Default::default() }));
        assert!(!row_names_line("Accountancy (No Projects) 2,750 SAR", &two), "a one-word service doesn't claim a longer row");
        // A one-word service: "Consultancy" must not price "Optional Auditing and Management Consultancy".
        let consultancy = SmartLine { service: "Consultancy".into(), unit_price: Some(7000.0), ..Default::default() };
        assert!(!row_names_line("“Optional” Auditing and Management Consultancy 759 SAR", &consultancy));
        assert!(row_names_line("Consultancy 6,750 SAR", &consultancy));
    }

    #[test]
    fn rewrites_split_paragraphs_into_the_first_run() {
        let xml = "<a:p><a:r><a:rPr b=\"1\"/><a:t>Date: 16</a:t></a:r><a:r><a:rPr baseline=\"30000\"/><a:t>th</a:t></a:r><a:r><a:t> of May 2024</a:t></a:r></a:p>";
        let (out, n) = rewrite_paragraphs(xml, |_, t| restyle_dates(t, "2026-09-02"));
        assert_eq!(n, 1);
        assert!(out.contains("<a:t>Date: 2nd of September 2026</a:t>"));
        assert!(out.contains("<a:t></a:t>"));
    }
}
