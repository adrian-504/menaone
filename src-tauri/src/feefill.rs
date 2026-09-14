//! Fee tables and contract wording, written from the proposal the way the
//! team edits a template by hand (see the template study behind Sprint 7d):
//!
//! - **Row tables** list exactly the proposal's rows: employee tranches
//!   ("Tranche 2 (6–15 employees) | 3,750 SAR"), workforce categories,
//!   accountancy rows, recruitment staff types (percent of the annual package)
//!   and mobilization countries. Template rows the proposal doesn't use are
//!   removed; extra rows copy the style of the row above.
//! - **Contract term**: every wording of the contract length ("Service for 12
//!   months minimum", "1 year (12 months)", "twelve (12) month Term", "Minimum
//!   Period 12 Months", "Total Annual Cost"…) follows the proposal's term.
//!   How long the work takes ("Activity Duration ≈ 3 Months", "45 Days") and
//!   notice periods are left alone.
//! - **Sentences that repeat a price or a condition** follow the proposal:
//!   "Accountancy with Projects is 4,750 SAR minimum", the bundle's savings,
//!   "Fees are only for professional staff…", Business Setup's free constitution.

use crate::pricing::{self, RowKind};
use crate::smartfill::{format_like, money_regex, paragraph_texts, re, rewrite_paragraphs, SmartLine};
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Default)]
pub struct Outcome {
    pub filled: Vec<String>,
    pub checks: Vec<String>,
    /// Row texts written here, so the generic fill leaves them alone.
    pub handled: Vec<String>,
}

// ═══════════════ Table plumbing ═══════════════

#[derive(Clone, Copy)]
struct Span {
    start: usize,
    end: usize,
}

struct Table {
    span: Span,
    rows: Vec<Span>,
}

fn tables(xml: &str) -> Vec<Table> {
    static TBL: OnceLock<Regex> = OnceLock::new();
    static TR: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:tbl>.*?</a:tbl>", &TBL)
        .find_iter(xml)
        .map(|m| Table {
            span: Span { start: m.start(), end: m.end() },
            rows: re(r"(?s)<a:tr\b[^>]*>.*?</a:tr>", &TR).find_iter(m.as_str()).map(|r| Span { start: m.start() + r.start(), end: m.start() + r.end() }).collect(),
        })
        .collect()
}

fn text_of(xml: &str) -> String {
    paragraph_texts(xml).join(" ")
}

fn cells(row: &str) -> Vec<Span> {
    static TC: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:tc\b[^>]*>.*?</a:tc>", &TC).find_iter(row).map(|m| Span { start: m.start(), end: m.end() }).collect()
}

fn placeholder_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?i)(SAR|USD|EUR|\$|€)\s*_{2,}", &R)
}

fn percent_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(\d{1,2}(?:[.,]\d+)?)\s*%", &R)
}

fn is_data_row(text: &str) -> bool {
    money_regex().is_match(text) || placeholder_regex().is_match(text)
}

fn number_text(v: f64) -> String {
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
}

/// Replaces a table cell's text with one paragraph of `text`, keeping the
/// first paragraph's formatting (an empty cell gets a run styled like its end mark).
fn set_cell_text(cell: &str, text: &str) -> String {
    static PARA: OnceLock<Regex> = OnceLock::new();
    let paras: Vec<(usize, usize)> = re(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>", &PARA).find_iter(cell).map(|m| (m.start(), m.end())).collect();
    if paras.is_empty() {
        return cell.to_string();
    }
    let first = paras.iter().position(|(s, e)| !paragraph_texts(&cell[*s..*e]).is_empty()).unwrap_or(0);
    let mut out = String::with_capacity(cell.len());
    let mut cursor = 0;
    for (i, (s, e)) in paras.iter().enumerate() {
        out.push_str(&cell[cursor..*s]);
        if i == first {
            let para = &cell[*s..*e];
            if paragraph_texts(para).is_empty() {
                static END: OnceLock<Regex> = OnceLock::new();
                let rpr = re(r"<a:endParaRPr\b([^>]*?)/?>", &END).captures(para).map(|c| format!("<a:rPr{}/>", c[1].trim_end_matches('/'))).unwrap_or_default();
                let run = format!("<a:r>{rpr}<a:t>{}</a:t></a:r>", xml_escape(text));
                let at = para.find("<a:endParaRPr").or_else(|| para.rfind("</a:p>")).unwrap_or(para.len());
                out.push_str(&para[..at]);
                out.push_str(&run);
                out.push_str(&para[at..]);
            } else {
                out.push_str(&rewrite_paragraphs(para, |_, _| Some(text.to_string())).0);
            }
        }
        cursor = *e;
    }
    out.push_str(&cell[cursor..]);
    out
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Rewrites one cell of a row.
fn edit_cell(row: &str, index: usize, edit: impl FnOnce(&str) -> String) -> String {
    let cs = cells(row);
    let Some(c) = cs.get(index) else { return row.to_string() };
    format!("{}{}{}", &row[..c.start], edit(&row[c.start..c.end]), &row[c.end..])
}

fn cell_texts(row: &str) -> Vec<String> {
    cells(row).iter().map(|c| text_of(&row[c.start..c.end])).collect()
}

/// A row with its label and price (or percentage) replaced.
fn render_row(row: &str, label: Option<&str>, price: Option<f64>, percent: Option<f64>, currency: &str) -> String {
    let texts = cell_texts(row);
    let mut out = row.to_string();
    if let Some(label) = label {
        let at = texts.iter().position(|t| !t.trim().is_empty() && !is_data_row(t)).unwrap_or(0);
        out = edit_cell(&out, at, |c| set_cell_text(c, label));
    }
    if let Some(p) = percent {
        if let Some(at) = texts.iter().position(|t| percent_regex().is_match(t)) {
            out = edit_cell(&out, at, |c| {
                rewrite_paragraphs(c, |_, t| percent_regex().is_match(t).then(|| percent_regex().replacen(t, 1, format!("{}%", number_text(p)).as_str()).to_string())).0
            });
        }
    } else if let Some(p) = price {
        let at = texts.iter().position(|t| money_regex().find_iter(t).any(|m| !m.as_str().contains('%')) || placeholder_regex().is_match(t));
        if let Some(at) = at {
            out = edit_cell(&out, at, |c| {
                let mut done = false;
                rewrite_paragraphs(c, |_, t| {
                    if done {
                        return None;
                    }
                    if let Some(m) = money_regex().find_iter(t).find(|m| !m.as_str().contains('%')) {
                        done = true;
                        return Some(format!("{}{}{}", &t[..m.start()], format_like(m.as_str(), p, currency), &t[m.end()..]));
                    }
                    let m = placeholder_regex().find(t)?;
                    done = true;
                    let written = if m.as_str().starts_with('$') || m.as_str().starts_with('€') { format_like("$ 1", p, currency) } else { format_like("SAR 1", p, currency) };
                    Some(format!("{}{}{}", &t[..m.start()], written, &t[m.end()..]))
                })
                .0
            });
        }
    }
    out
}

fn remove_frame_of(xml: &str, table: Span) -> String {
    let before = &xml[..table.start];
    let Some(start) = before.rfind("<p:graphicFrame") else { return xml.to_string() };
    let Some(end_rel) = xml[table.end..].find("</p:graphicFrame>") else { return xml.to_string() };
    let end = table.end + end_rel + "</p:graphicFrame>".len();
    format!("{}{}", &xml[..start], &xml[end..])
}

// ═══════════════ Row tables ═══════════════

fn tranche_row_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?i)\d+\s*[-–]\s*\d+\s*employees|employees\s+and\s+below|^\s*tranche\s*\d", &R)
}

fn rate_label(rate: &crate::models::LineRate) -> String {
    if rate.label.trim().is_empty() { pricing::tranche_label(rate.from, rate.to) } else { rate.label.trim().to_string() }
}

/// Employee tranches: the tranche rows become exactly the proposal's tranches.
fn fill_tranches(xml: &str, line: &SmartLine, currency: &str, out: &mut Outcome, position: usize) -> String {
    let mut rates: Vec<&crate::models::LineRate> = line.rates.iter().filter(|r| r.price.is_some() || r.to.is_some()).collect();
    rates.sort_by_key(|r| r.to.unwrap_or(i64::MAX));
    if rates.is_empty() {
        return xml.to_string();
    }
    for table in tables(xml) {
        let rows: Vec<Span> = table.rows.iter().copied().filter(|r| {
            let t = text_of(&xml[r.start..r.end]);
            tranche_row_regex().is_match(&t) && is_data_row(&t)
        }).collect();
        if rows.is_empty() {
            continue;
        }
        let template_ranges: Vec<Option<(i64, i64)>> = rows.iter().map(|r| pricing::parse_range(&text_of(&xml[r.start..r.end]))).collect();
        let mut built = String::new();
        for (k, rate) in rates.iter().enumerate() {
            let base = &xml[rows[k.min(rows.len() - 1)].start..rows[k.min(rows.len() - 1)].end];
            let label_cell = cell_texts(base).into_iter().find(|t| !t.trim().is_empty() && !is_data_row(t)).unwrap_or_default();
            let core = rate_label(rate);
            static TR: OnceLock<Regex> = OnceLock::new();
            let label = if re(r"(?i)^\s*tranche\s*\d", &TR).is_match(&label_cell) {
                let core = if core.to_lowercase().contains("employee") { core } else { format!("{core} employees") };
                format!("Tranche {} ({core})", k + 1)
            } else {
                core
            };
            let row = render_row(base, Some(&label), rate.price, None, currency);
            out.handled.push(text_of(&row));
            built.push_str(&row);
        }
        let first = rows[0];
        let last = rows[rows.len() - 1];
        let between: String = table.rows.iter().filter(|r| r.start > first.start && r.end < last.end && !rows.iter().any(|x| x.start == r.start)).map(|r| &xml[r.start..r.end]).collect();
        let changed_ranges = rates.len() != rows.len() || rates.iter().zip(template_ranges.iter()).any(|(r, t)| t.map(|(f, to)| r.from != Some(f) || r.to != Some(to)).unwrap_or(true));
        if changed_ranges {
            out.checks.push(format!("Slide {position}: the invoice examples still describe the template's tranches — check they match {}", rates.iter().map(|r| rate_label(r)).collect::<Vec<_>>().join(", ")));
        }
        out.filled.push(format!("Slide {position}: {} tranche{} for {}", rates.len(), if rates.len() == 1 { "" } else { "s" }, line.service));
        return format!("{}{}{}{}", &xml[..first.start], built, between, &xml[last.end..]);
    }
    xml.to_string()
}

fn excluded_table(header: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?i)governmental|renewals|yearly fees|premium|medical|\bclass\b|l\.c tax|iqama|annual limit|cost without package|visa issue|total days|^\s*description", &R).is_match(header)
}

struct Group {
    table: usize,
    rows: Vec<Span>,
    text: String,
}

enum Placement {
    Matched(usize),
    Paired(usize),
    Cloned(usize, usize),
}

/// Categories, accountancy rows, staff types and countries.
fn fill_named_rows(xml: &str, line: &SmartLine, kind: RowKind, currency: &str, out: &mut Outcome, position: usize) -> String {
    let rates: Vec<&crate::models::LineRate> = line.rates.iter().filter(|r| !r.label.trim().is_empty()).collect();
    if rates.is_empty() {
        return xml.to_string();
    }
    let all_tables = tables(xml);
    let row_matches = |text: &str| -> bool {
        match kind {
            RowKind::Country => text.contains("Embassy") || placeholder_regex().is_match(text) || rates.iter().any(|r| text.to_lowercase().contains(&r.label.trim().to_lowercase())),
            _ => rates.iter().map(|r| r.label.as_str()).chain(line.preset_labels.iter().map(|s| s.as_str())).any(|l| pricing::names_exactly(l, text)),
        }
    };
    // Tables that hold this service's rows, and their row groups.
    let mut groups: Vec<Group> = Vec::new();
    let mut owned: Vec<usize> = Vec::new();
    for (ti, t) in all_tables.iter().enumerate() {
        let header = t.rows.first().map(|r| text_of(&xml[r.start..r.end])).unwrap_or_default();
        if excluded_table(&header) {
            continue;
        }
        let mut table_groups: Vec<Group> = Vec::new();
        for r in &t.rows {
            let rx = &xml[r.start..r.end];
            let text = text_of(rx);
            let first_cell_empty = cell_texts(rx).first().map(|c| c.trim().is_empty()).unwrap_or(true);
            if is_data_row(&text) || (kind == RowKind::Percent && percent_regex().is_match(&text)) {
                table_groups.push(Group { table: ti, rows: vec![*r], text });
            } else if first_cell_empty && !table_groups.is_empty() {
                let g = table_groups.last_mut().expect("group");
                g.rows.push(*r);
            }
        }
        if table_groups.iter().any(|g| row_matches(&g.text)) {
            owned.push(ti);
            groups.extend(table_groups);
        }
    }
    if groups.is_empty() {
        return xml.to_string();
    }
    let group_label = |g: &Group| -> String { money_regex().replace_all(&placeholder_regex().replace_all(&g.text, " "), " ").to_string() };
    let mut used = vec![false; groups.len()];
    let mut placement: Vec<Option<Placement>> = rates.iter().map(|_| None).collect();
    // 1. Rows the template already has.
    for (ri, rate) in rates.iter().enumerate() {
        let label = rate.label.trim().to_lowercase();
        let best = (0..groups.len())
            .filter(|&g| !used[g])
            .filter(|&g| match kind {
                RowKind::Country => group_label(&groups[g]).to_lowercase().contains(&label),
                _ => pricing::names_exactly(&rate.label, &group_label(&groups[g])),
            })
            .max_by_key(|&g| pricing::words(&group_label(&groups[g])).len() as i64 * -1);
        if let Some(g) = best {
            used[g] = true;
            placement[ri] = Some(Placement::Matched(g));
        }
    }
    // 2. The rest take an unused row in the same table, else copy one.
    let mut current_table = groups[0].table;
    for ri in 0..rates.len() {
        match &placement[ri] {
            Some(Placement::Matched(g)) | Some(Placement::Paired(g)) => {
                current_table = groups[*g].table;
                continue;
            }
            Some(Placement::Cloned(t, _)) => {
                current_table = *t;
                continue;
            }
            None => {}
        }
        if let Some(g) = (0..groups.len()).find(|&g| !used[g] && groups[g].table == current_table) {
            used[g] = true;
            placement[ri] = Some(Placement::Paired(g));
        } else {
            let template = (0..groups.len()).filter(|&g| groups[g].table == current_table).last().unwrap_or(0);
            placement[ri] = Some(Placement::Cloned(current_table, template));
        }
    }
    // 3. Rebuild each owned table: header, the proposal's rows in order, trailing rows.
    let mut result = xml.to_string();
    let mut removed_tables = 0;
    for &ti in owned.iter().rev() {
        let t = &all_tables[ti];
        let table_groups: Vec<usize> = (0..groups.len()).filter(|&g| groups[g].table == ti).collect();
        let first = groups[table_groups[0]].rows[0].start;
        let last = groups[*table_groups.last().expect("groups")].rows.last().expect("row").end;
        let mut body = String::new();
        for (ri, rate) in rates.iter().enumerate() {
            let (g, keep_label) = match placement[ri] {
                Some(Placement::Matched(g)) if groups[g].table == ti => (g, !matches!(kind, RowKind::Percent)),
                Some(Placement::Paired(g)) if groups[g].table == ti => (g, false),
                Some(Placement::Cloned(tt, g)) if tt == ti => (g, false),
                _ => continue,
            };
            let spans = &groups[g].rows;
            let head = &xml[spans[0].start..spans[0].end];
            let label = if keep_label {
                None
            } else if kind == RowKind::Country {
                Some(country_label(head, rate.label.trim()))
            } else {
                Some(rate.label.trim().to_string())
            };
            let row = match (kind, label) {
                (RowKind::Country, Some(full)) => {
                    let texts = cell_texts(head);
                    let at = texts.iter().position(|t| !t.trim().is_empty() && !is_data_row(t)).unwrap_or(0);
                    let with_label = edit_cell(head, at, |c| replace_embassy_country(c, rate.label.trim()).unwrap_or_else(|| set_cell_text(c, &full)));
                    render_row(&with_label, None, rate.price, None, currency)
                }
                (_, label) => render_row(head, label.as_deref(), if kind == RowKind::Percent { None } else { rate.price }, if kind == RowKind::Percent { rate.percent } else { None }, currency),
            };
            out.handled.push(text_of(&row));
            body.push_str(&row);
            for extra in &spans[1..] {
                body.push_str(&xml[extra.start..extra.end]);
            }
        }
        if body.is_empty() {
            result = remove_frame_of(&result, t.span);
            removed_tables += 1;
            continue;
        }
        result = format!("{}{}{}", &result[..first], body, &result[last..]);
    }
    out.filled.push(format!("Slide {position}: {} {} for {}", rates.len(), match kind { RowKind::Category => "categories", RowKind::Percent => "staff types", RowKind::Country => "countries", _ => "fee rows" }, line.service));
    if removed_tables > 0 {
        out.checks.push(format!("Slide {position}: a fee table with no rows on this proposal was removed — check the heading above it"));
    }
    result
}

fn country_label(row: &str, country: &str) -> String {
    let label = cell_texts(row).into_iter().find(|t| !t.trim().is_empty() && !is_data_row(t)).unwrap_or_default();
    static EMB: OnceLock<Regex> = OnceLock::new();
    let r = re(r"(?i)(KSA Embassy in\s+)(the country of nationality\s*)?(.*)$", &EMB);
    if r.is_match(&label) { r.replace(&label, format!("${{1}}{country}").as_str()).to_string() } else { country.to_string() }
}

/// "Submission at the KSA Embassy in SPAIN" → "… in Kuwait", in the paragraph that says it.
fn replace_embassy_country(cell: &str, country: &str) -> Option<String> {
    static EMB: OnceLock<Regex> = OnceLock::new();
    let r = re(r"(?i)(KSA Embassy in\s+)(the country of nationality\s*)?(\([^)]*\)|[^/]*)$", &EMB);
    let mut hit = false;
    let (x, _) = rewrite_paragraphs(cell, |_, t| {
        if !r.is_match(t) {
            return None;
        }
        hit = true;
        Some(r.replace(t, format!("${{1}}{country}").as_str()).to_string())
    });
    hit.then_some(x)
}

/// Writes the proposal's rows into the fee tables of one slide.
pub fn fill_rows(xml: &str, position: usize, lines: &[&SmartLine], currency: &str) -> (String, Outcome) {
    let mut out = Outcome::default();
    let mut x = xml.to_string();
    for line in lines {
        let Some(kind) = line.kind else { continue };
        if line.rates.is_empty() {
            continue;
        }
        x = match kind {
            RowKind::Tranche => fill_tranches(&x, line, currency, &mut out, position),
            other => fill_named_rows(&x, line, other, currency, &mut out, position),
        };
    }
    (x, out)
}

// ═══════════════ Layout ═══════════════

struct Frame {
    x: i64,
    y: i64,
    cx: i64,
    cy: i64,
    rows_height: i64,
}

fn table_frames(xml: &str) -> Vec<Frame> {
    static GF: OnceLock<Regex> = OnceLock::new();
    static OFF: OnceLock<Regex> = OnceLock::new();
    static TRH: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<p:graphicFrame>.*?</p:graphicFrame>", &GF)
        .find_iter(xml)
        .filter(|m| m.as_str().contains("<a:tbl>"))
        .filter_map(|m| {
            let c = re(r#"<a:off x="(-?\d+)" y="(-?\d+)"\s*/>\s*<a:ext cx="(\d+)" cy="(\d+)""#, &OFF).captures(m.as_str())?;
            let rows_height = re(r#"<a:tr h="(\d+)""#, &TRH).captures_iter(m.as_str()).filter_map(|h| h[1].parse::<i64>().ok()).sum();
            Some(Frame { x: c[1].parse().ok()?, y: c[2].parse().ok()?, cx: c[3].parse().ok()?, cy: c[4].parse().ok()?, rows_height })
        })
        .collect()
}

/// When fee tables grew or shrank, moves what sits below them by the same
/// height (and resizes the table's frame), so rows never run into the text
/// underneath. Shapes inside groups are left where they are.
pub fn reflow(before: &str, after: &str) -> String {
    let old = table_frames(before);
    let new = table_frames(after);
    // Frames keep their position while filling, so match them by it.
    let changes: Vec<(i64, i64, i64, i64, i64)> = old
        .iter()
        .filter_map(|o| {
            let n = new.iter().find(|n| n.x == o.x && n.y == o.y && n.cx == o.cx)?;
            let delta = n.rows_height - o.rows_height;
            (delta != 0).then_some((o.x, o.x + o.cx, o.y, o.y + o.cy, delta))
        })
        .collect();
    if changes.is_empty() {
        return after.to_string();
    }
    static SHAPE: OnceLock<Regex> = OnceLock::new();
    static GRP: OnceLock<Regex> = OnceLock::new();
    static OFF: OnceLock<Regex> = OnceLock::new();
    let groups: Vec<(usize, usize)> = re(r"(?s)<p:grpSp>.*?</p:grpSp>", &GRP).find_iter(after).map(|m| (m.start(), m.end())).collect();
    let mut out = String::with_capacity(after.len());
    let mut cursor = 0;
    for m in re(r"(?s)<p:graphicFrame>.*?</p:graphicFrame>|<p:sp>.*?</p:sp>|<p:pic>.*?</p:pic>|<p:cxnSp>.*?</p:cxnSp>", &SHAPE).find_iter(after) {
        if groups.iter().any(|(s, e)| m.start() > *s && m.end() <= *e) {
            continue;
        }
        let shape = m.as_str();
        let Some(c) = re(r#"<a:off x="(-?\d+)" y="(-?\d+)"\s*/>\s*<a:ext cx="(\d+)" cy="(\d+)""#, &OFF).captures(shape) else { continue };
        let (x, y, cx, cy): (i64, i64, i64, i64) = (c[1].parse().unwrap_or(0), c[2].parse().unwrap_or(0), c[3].parse().unwrap_or(0), c[4].parse().unwrap_or(0));
        let mut dy = 0;
        let mut dcy = 0;
        for (left, right, top, bottom, delta) in &changes {
            if x == *left && y == *top && shape.contains("<a:tbl>") {
                dcy += delta;
            } else if y >= bottom - 45_720 && x < *right && x + cx > *left {
                dy += delta;
            }
        }
        if dy == 0 && dcy == 0 {
            continue;
        }
        let moved = format!(r#"<a:off x="{x}" y="{}"/><a:ext cx="{cx}" cy="{}""#, (y + dy).max(0), (cy + dcy).max(0));
        let whole = c.get(0).expect("match");
        out.push_str(&after[cursor..m.start()]);
        out.push_str(&shape[..whole.start()]);
        out.push_str(&moved);
        out.push_str(&shape[whole.end()..]);
        cursor = m.end();
    }
    out.push_str(&after[cursor..]);
    out
}

// ═══════════════ Contract term ═══════════════

const NUMBER_WORDS: [&str; 25] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four"];

fn word(n: i64, capital: bool) -> String {
    let w = NUMBER_WORDS.get(n as usize).map(|w| w.to_string()).unwrap_or_else(|| n.to_string());
    if capital { w[..1].to_uppercase() + &w[1..] } else { w }
}

fn plural(n: i64, one: &str, many: &str) -> String {
    if n == 1 { one.to_string() } else { many.to_string() }
}

/// One paragraph's contract-length wording for a term of `n` months.
pub fn term_sentence(t: &str, n: i64) -> Option<String> {
    static FIRST: OnceLock<Regex> = OnceLock::new();
    if n == 12 || re(r"(?i)first\s+12\s+months", &FIRST).is_match(t) {
        return None;
    }
    let years = (n % 12 == 0).then_some(n / 12);
    let mut s = t.to_string();
    static R1: OnceLock<Regex> = OnceLock::new();
    s = re(r"(?i)\b1\s*year\s*\(\s*12\s*months?\s*\)", &R1)
        .replace_all(&s, match years { Some(y) => format!("{y} {} ({n} months)", plural(y, "year", "years")), None => format!("{n} {}", plural(n, "month", "months")) }.as_str())
        .to_string();
    static R2: OnceLock<Regex> = OnceLock::new();
    s = re(r"(?i)\b1-year\s*\(\s*12-month\s*\)", &R2).replace_all(&s, match years { Some(y) => format!("{y}-year ({n}-month)"), None => format!("{n}-month") }.as_str()).to_string();
    static R3: OnceLock<Regex> = OnceLock::new();
    s = re(r"(?i)\b(twelve)\s*\(12\)\s*(months?)\b", &R3)
        .replace_all(&s, |c: &regex::Captures| {
            let capital = c[1].starts_with('T');
            let unit = if c[2].ends_with('s') || c[2].ends_with('S') { plural(n, "month", "months") } else { "month".to_string() };
            format!("{} ({n}) {unit}", word(n, capital))
        })
        .to_string();
    static CONTEXT: OnceLock<Regex> = OnceLock::new();
    if re(r"(?i)agreement|contract|service|duration|minimum|\bterm\b|renewal|period", &CONTEXT).is_match(&s) {
        static R4: OnceLock<Regex> = OnceLock::new();
        s = re(r"(?i)\b(one\s*\(1\)|1)\s+(year)s?\b", &R4)
            .replace_all(&s, |c: &regex::Captures| {
                if c[1].to_lowercase().starts_with("one") {
                    format!("{} ({n}) {}", word(n, c[1].starts_with('O')), plural(n, "month", "months"))
                } else {
                    format!("{n} {}", plural(n, "month", "months"))
                }
            })
            .to_string();
    }
    static R5: OnceLock<Regex> = OnceLock::new();
    s = re(r"\b12\s*(Months|months|month|Month|MONTHS)\b", &R5)
        .replace_all(&s, |c: &regex::Captures| {
            let unit = &c[1];
            let unit = if n == 1 { unit.trim_end_matches(['s', 'S']).to_string() } else if unit.ends_with(['s', 'S']) { unit.to_string() } else { unit.to_string() };
            format!("{n} {unit}")
        })
        .to_string();
    static R6: OnceLock<Regex> = OnceLock::new();
    s = re(r"(?i)\b12-month\b", &R6).replace_all(&s, format!("{n}-month").as_str()).to_string();
    static R7: OnceLock<Regex> = OnceLock::new();
    s = re(r"(?i)\bTotal\s+Annual\s+Cost\b", &R7).replace_all(&s, format!("Total Cost ({n} Months)").as_str()).to_string();
    static R8: OnceLock<Regex> = OnceLock::new();
    s = re(r"(?i)(month number\s*)(\d+)(\s*,\s*Calculation:\s*\(Monthly fee\s*[×x*]\s*)(\d+)(\s*Months?\))", &R8)
        .replace_all(&s, |c: &regex::Captures| {
            let orig: i64 = c[2].parse().unwrap_or(5);
            let month = ((orig as f64) * n as f64 / 12.0).round().clamp(1.0, (n - 1).max(1) as f64) as i64;
            let remaining = (n - month).max(1);
            format!("{}{month}{}{remaining}{}", &c[1], &c[3], if remaining == 1 { " Month)" } else { " Months)" })
        })
        .to_string();
    static R9: OnceLock<Regex> = OnceLock::new();
    s = re(r"(?i)(save\s+[\d.,]+\s*SAR)\s*/\s*year", &R9).replace_all(&s, format!("$1 over {n} months").as_str()).to_string();
    (s != t).then_some(s)
}

/// Rewrites the contract length on a slide.
pub fn rewrite_term(xml: &str, months: i64) -> (String, usize) {
    if months <= 0 || months == 12 {
        return (xml.to_string(), 0);
    }
    rewrite_paragraphs(xml, |_, t| term_sentence(t, months))
}

/// Sentences still mentioning a year or twelve months after the rewrite.
pub fn term_leftovers(xml: &str, position: usize, months: i64) -> Vec<String> {
    if months <= 0 || months == 12 {
        return vec![];
    }
    static HIT: OnceLock<Regex> = OnceLock::new();
    static SKIP: OnceLock<Regex> = OnceLock::new();
    let hit = re(r"(?i)\b12\s*-?\s*months?\b|\btwelve\b|\b1\s*-?\s*year\b|\bone\s*\(1\)\s*year|\bannual(ly)?\b|per year|/\s*year", &HIT);
    let skip = re(r"(?i)annual package|yearly fees|annual limit|financial statements?|first 12 months|annual tax|annual.*returns|zakat|tax\s*/\s*year|fees\s*/\s*year|one time\s*/\s*year|insurance", &SKIP);
    paragraph_texts(xml)
        .into_iter()
        .filter(|t| hit.is_match(t) && !skip.is_match(t))
        .map(|t| format!("Slide {position}: \"{}\" — still mentions a year; the proposal is for {months} months", t.chars().take(110).collect::<String>().trim()))
        .collect()
}

// ═══════════════ Sentences that repeat prices or conditions ═══════════════

/// Prices the generator knows even without a line: the rate cards' standards.
#[derive(Debug, Clone, Default)]
pub struct Standards {
    pub constitution: Option<f64>,
    pub maintenance: Option<f64>,
}

fn remove_paragraphs(xml: &str, pred: impl Fn(&str) -> bool) -> (String, usize) {
    static PARA: OnceLock<Regex> = OnceLock::new();
    let mut n = 0;
    let out = re(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>", &PARA)
        .replace_all(xml, |c: &regex::Captures| {
            let t = text_of(&c[0]);
            if !t.trim().is_empty() && pred(&t) {
                n += 1;
                String::new()
            } else {
                c[0].to_string()
            }
        })
        .to_string();
    (out, n)
}

/// "45,000 SAR" → 45000; "3.550 SAR" (dot thousands) → 3550.
fn parse_amount(s: &str) -> Option<f64> {
    let digits: String = s.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect();
    static DOT: OnceLock<Regex> = OnceLock::new();
    let normal = if re(r"^\d{1,3}(\.\d{3})+$", &DOT).is_match(&digits) { digits.replace('.', "") } else { digits.replace(',', "") };
    normal.parse().ok()
}

fn money_in(t: &str, amount: f64, currency: &str, pattern: &Regex) -> Option<String> {
    let c = pattern.captures(t)?;
    let m = c.get(2)?;
    Some(format!("{}{}{}", &t[..m.start()], format_like(m.as_str(), amount, currency), &t[m.end()..]))
}

fn line_where<'a>(lines: &'a [SmartLine], pred: impl Fn(&SmartLine) -> bool) -> Option<&'a SmartLine> {
    lines.iter().find(|l| pred(l))
}

pub struct SentenceInput<'a> {
    pub lines: &'a [SmartLine],
    pub standards: &'a Standards,
    pub months: i64,
    pub currency: &'a str,
}

pub fn price_sentences(xml: &str, position: usize, input: &SentenceInput) -> (String, Outcome) {
    let mut out = Outcome::default();
    let mut x = xml.to_string();
    let lower = |l: &SmartLine| l.service.to_lowercase();

    // "15\ employees" — a typo in the Admin template.
    static TYPO: OnceLock<Regex> = OnceLock::new();
    let (y, _) = rewrite_paragraphs(&x, |_, t| re(r"(\d+)\\\s*employees", &TYPO).is_match(t).then(|| re(r"(\d+)\\\s*employees", &TYPO).replace_all(t, "$1 employees").to_string()));
    x = y;

    // Accountancy: "Accountancy with Projects is 4,750 SAR minimum amount…"
    if let Some(acc) = line_where(input.lines, |l| l.kind == Some(RowKind::Row) && l.modules.contains(&"accountancy")) {
        static PROJ: OnceLock<Regex> = OnceLock::new();
        let r = re(r"(?i)(accountancy with projects is\s*)([\d.,]+\s*SAR|SAR\s*[\d.,]+)", &PROJ);
        let projects = acc.rates.iter().find(|r| { let l = r.label.to_lowercase(); l.contains("project") && !l.contains("no project") }).and_then(|r| r.price);
        match projects {
            Some(p) => {
                let (y, n) = rewrite_paragraphs(&x, |_, t| money_in(t, p, input.currency, r));
                if n > 0 { out.filled.push(format!("Slide {position}: projects minimum set to {}", format_like("1 SAR", p, input.currency))); }
                x = y;
            }
            None => {
                let (y, n) = remove_paragraphs(&x, |t| r.is_match(t));
                if n > 0 { out.filled.push(format!("Slide {position}: removed the projects minimum (no Projects row on this proposal)")); }
                x = y;
            }
        }
    }

    // Recruitment: "Fees are only for professional staff and not for Labors or Skilled Employees"
    if let Some(rec) = line_where(input.lines, |l| l.kind == Some(RowKind::Percent)) {
        let blue = rec.rates.iter().any(|r| { let l = r.label.to_lowercase(); l.contains("blue") || l.contains("labo") || l.contains("skilled") || l.contains("worker") });
        if blue {
            static ONLY: OnceLock<Regex> = OnceLock::new();
            let (y, n) = remove_paragraphs(&x, |t| re(r"(?i)only for professional staff", &ONLY).is_match(t));
            if n > 0 { out.filled.push(format!("Slide {position}: removed \"only for professional staff\" (Blue Collar staff included)")); }
            x = y;
        }
    }

    // Constitution & Maintenance package: table, savings and the sentences quoting them.
    let package = line_where(input.lines, |l| l.modules.contains(&"constitution_maintenance") && l.unit_price.is_some()).and_then(|l| l.unit_price);
    if let Some(p) = package {
        let n = input.months.max(1) as f64;
        let c_line = line_where(input.lines, |l| lower(l).contains("constitution") && !lower(l).contains("package") && !lower(l).contains("maintenance")).and_then(|l| l.unit_price);
        let m_line = line_where(input.lines, |l| lower(l).contains("maintenance") && !lower(l).contains("package") && !lower(l).contains("constitution")).and_then(|l| l.unit_price);
        // Without their own lines, the comparison keeps the figures the template quotes.
        let quoted = |needle: &str| -> Option<f64> {
            tables(&x).into_iter().filter(|t| t.rows.first().map(|r| text_of(&x[r.start..r.end]).to_lowercase().contains("cost without package")).unwrap_or(false)).flat_map(|t| t.rows).find_map(|r| {
                let row = &x[r.start..r.end];
                let label = cell_texts(row).first().cloned().unwrap_or_default().to_lowercase();
                if !label.contains(needle) { return None; }
                money_regex().find_iter(&text_of(row)).find(|mm| !mm.as_str().contains('%')).and_then(|mm| parse_amount(mm.as_str()))
            })
        };
        let c = c_line.or_else(|| quoted("constitution")).or(input.standards.constitution);
        let m = m_line.or_else(|| quoted("maintenance")).or(input.standards.maintenance);
        static MONTHLY: OnceLock<Regex> = OnceLock::new();
        static FIXED: OnceLock<Regex> = OnceLock::new();
        let (y, k) = rewrite_paragraphs(&x, |_, t| {
            money_in(t, p, input.currency, re(r"(?i)(monthly payments of\s*)([\d.,]+\s*SAR)", &MONTHLY)).or_else(|| money_in(t, p, input.currency, re(r"(?i)(fixed monthly fee of\s*)([\d.,]+\s*SAR)", &FIXED)))
        });
        x = y;
        if let Some(m) = m {
            static RENEW: OnceLock<Regex> = OnceLock::new();
            let (y, _) = rewrite_paragraphs(&x, |_, t| money_in(t, m, input.currency, re(r"(?i)(will be only\s*)([\d.,]+\s*SAR)", &RENEW)));
            x = y;
        }
        if let (Some(c), Some(m)) = (c, m) {
            for table in tables(&x).into_iter().rev() {
                let header = table.rows.first().map(|r| text_of(&x[r.start..r.end])).unwrap_or_default();
                if !header.to_lowercase().contains("cost without package") {
                    continue;
                }
                let without = c + m * n;
                let with = p * n;
                let savings = without - with;
                let mut rebuilt = x[table.span.start..table.rows[0].end].to_string();
                for (i, r) in table.rows.iter().enumerate().skip(1) {
                    let row = &x[r.start..r.end];
                    let label = cell_texts(row).first().cloned().unwrap_or_default().to_lowercase();
                    let amounts: Vec<Option<f64>> = if label.contains("constitution") {
                        vec![Some(c), Some(p)]
                    } else if label.contains("maintenance") {
                        vec![Some(m)]
                    } else if label.contains("total") {
                        vec![Some(without), Some(with)]
                    } else if label.contains("saving") {
                        vec![Some(savings)]
                    } else {
                        vec![]
                    };
                    let mut k = 0;
                    let (new_row, _) = rewrite_paragraphs(row, |_, t| {
                        let mm = money_regex().find_iter(t).find(|mm| !mm.as_str().contains('%'))?;
                        let v = amounts.get(k).copied().flatten()?;
                        k += 1;
                        Some(format!("{}{}{}", &t[..mm.start()], format_like(mm.as_str(), v, input.currency), &t[mm.end()..]))
                    });
                    rebuilt.push_str(&new_row);
                    let next = table.rows.get(i + 1).map(|n| n.start).unwrap_or(table.span.end);
                    rebuilt.push_str(&x[r.end..next]);
                }
                x = format!("{}{}{}", &x[..table.span.start], rebuilt, &x[table.span.end..]);
                static SAVE: OnceLock<Regex> = OnceLock::new();
                let (y, _) = rewrite_paragraphs(&x, |_, t| money_in(t, savings.max(0.0), input.currency, re(r"(?i)(save\s+)([\d.,]+\s*SAR)", &SAVE)));
                x = y;
                if savings <= 0.0 {
                    out.checks.push(format!("Slide {position}: the package costs more than constitution plus maintenance — the savings figures don't make sense"));
                }
                out.filled.push(format!("Slide {position}: package comparison recalculated"));
                break;
            }
        } else if k > 0 {
            out.checks.push(format!("Slide {position}: the package comparison needs the constitution and maintenance prices"));
        }
    }

    // Business Setup offered on a term under 12 months: the constitution is no longer free.
    if input.months > 0 && input.months < 12 {
        if let Some(bs) = line_where(input.lines, |l| l.modules.contains(&"business_setup")) {
            static FREE: OnceLock<Regex> = OnceLock::new();
            let free = re(r"(?i)free constitution|free of charge|at no cost|free\s*[—–-]\s*conditional|free business setup", &FREE);
            let (y, removed) = remove_paragraphs(&x, |t| free.is_match(t));
            x = y;
            let constitution = input.standards.constitution;
            let mut added = false;
            if let (Some(c), Some(p)) = (constitution, bs.unit_price) {
                for table in tables(&x).into_iter().rev() {
                    let data: Vec<Span> = table.rows.iter().copied().filter(|r| is_data_row(&text_of(&x[r.start..r.end]))).collect();
                    let Some(pkg_row) = data.iter().find(|r| { let t = text_of(&x[r.start..r.end]).to_lowercase(); t.contains("business setup") && !t.contains("total") }) else { continue };
                    let base = &x[pkg_row.start..pkg_row.end];
                    let constitution_row = render_row(base, Some("Company Constitution (One Time)"), Some(c), None, input.currency);
                    let constitution_row = rewrite_paragraphs(&constitution_row, |_, t| t.contains("/month").then(|| t.replace(" /month", "").replace("/month", ""))).0;
                    let mut y = format!("{}{}{}", &x[..pkg_row.end], constitution_row, &x[pkg_row.end..]);
                    // The total covers the term plus the constitution fee.
                    let total = p * input.months as f64 + c;
                    static TOTAL: OnceLock<Regex> = OnceLock::new();
                    if let Some(tr) = tables(&y).into_iter().flat_map(|t| t.rows).find(|r| re(r"(?i)\btotal\b", &TOTAL).is_match(&text_of(&y[r.start..r.end]))) {
                        let row = y[tr.start..tr.end].to_string();
                        let new_row = render_row(&row, None, Some(total), None, input.currency);
                        y = format!("{}{}{}", &y[..tr.start], new_row, &y[tr.end..]);
                    }
                    x = y;
                    added = true;
                    break;
                }
            }
            if removed > 0 || added {
                out.filled.push(format!("Slide {position}: constitution charged (free only with a 12-month term)"));
            }
        }
    }
    (x, out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LineRate;

    fn cell(t: &str) -> String {
        if t.is_empty() {
            "<a:tc><a:txBody><a:p><a:endParaRPr lang=\"en-US\" sz=\"1000\"/></a:p></a:txBody></a:tc>".into()
        } else {
            format!("<a:tc><a:txBody><a:p><a:r><a:rPr sz=\"1000\"/><a:t>{t}</a:t></a:r></a:p></a:txBody></a:tc>")
        }
    }
    fn row(cells: &[&str]) -> String {
        format!("<a:tr h=\"370840\">{}</a:tr>", cells.iter().map(|c| cell(c)).collect::<String>())
    }
    fn table(rows: &[Vec<&str>]) -> String {
        format!("<p:graphicFrame><a:graphic><a:graphicData><a:tbl>{}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>", rows.iter().map(|r| row(r)).collect::<String>())
    }
    fn rows_of(xml: &str) -> Vec<String> {
        tables(xml).into_iter().flat_map(|t| t.rows.into_iter().map(|r| cell_texts(&xml[r.start..r.end]).join(" | ")).collect::<Vec<_>>()).collect()
    }
    fn rate(label: &str, price: Option<f64>) -> LineRate {
        LineRate { label: label.into(), price, ..Default::default() }
    }

    #[test]
    fn writes_exactly_the_proposals_tranches() {
        let xml = table(&[vec!["Category (Tranches)", "Package"], vec!["Tranche 1 (1–5 employees)", "2,000 SAR"], vec!["Tranche 2 (6–15 employees)", "3,750 SAR"], vec!["Tranche 3 (16–25 employees)", "5,000 SAR"]]);
        let line = SmartLine {
            service: "Admin PRO".into(),
            kind: Some(RowKind::Tranche),
            rates: vec![LineRate { label: "25 employees and below".into(), from: Some(1), to: Some(25), price: Some(4625.0), ..Default::default() }, LineRate { label: String::new(), from: Some(26), to: Some(35), price: Some(6075.0), ..Default::default() }],
            ..Default::default()
        };
        let (out, o) = fill_rows(&xml, 9, &[&line], "SAR");
        assert_eq!(rows_of(&out), vec!["Category (Tranches) | Package", "Tranche 1 (25 employees and below) | 4,625 SAR", "Tranche 2 (26–35 employees) | 6,075 SAR"]);
        assert_eq!(o.checks.len(), 1, "examples no longer match: {:?}", o.checks);
    }

    #[test]
    fn keeps_chosen_categories_and_adds_custom_ones() {
        let xml = table(&[
            vec!["Category", "Monthly Fees per Person", "Minimum Period"],
            vec!["Professional Nationalized Employee (Engineers & Managers)", "3.550 SAR", "12 Months"],
            vec!["Professional Nationalized Employee (Technicians and Supervisors)", "2.650 SAR", "12 Months"],
            vec!["Professional Non-Nationalized Employee (Unskilled)", "1.650 SAR", "12 Months"],
        ]);
        let line = SmartLine {
            service: "Workforce".into(),
            kind: Some(RowKind::Category),
            preset_labels: vec!["Nationalized (Engineers & Managers)".into(), "Nationalized (Technicians & Supervisors)".into(), "Non-Nationalized (Unskilled)".into()],
            rates: vec![rate("Non-Nationalized (Unskilled)", Some(1450.0)), rate("Nationalized (Engineers & Managers)", Some(3350.0)), rate("Drivers", Some(1900.0))],
            ..Default::default()
        };
        let (out, _) = fill_rows(&xml, 11, &[&line], "SAR");
        assert_eq!(rows_of(&out), vec![
            "Category | Monthly Fees per Person | Minimum Period",
            "Professional Non-Nationalized Employee (Unskilled) | 1.450 SAR | 12 Months",
            "Professional Nationalized Employee (Engineers & Managers) | 3.350 SAR | 12 Months",
            "Drivers | 1.900 SAR | 12 Months",
        ]);
    }

    #[test]
    fn fills_accountancy_rows_across_both_tables() {
        let xml = format!(
            "{}{}",
            table(&[vec!["Category", "Monthly Fees"], vec!["Acct – bookkeeping + E-Invoicing 10/mo (Startup)", "2,250 SAR"], vec!["Accountancy (Projects)", "4,750 SAR"]]),
            table(&[vec!["Category", "Monthly Fees"], vec!["VAT Return – Monthly Preparation & Declaration", "900 SAR"], vec!["VAT Return – Quarterly Preparation & Declaration", "2,150 SAR"], vec!["“Optional” Auditing and Management Consultancy", "759 SAR"]])
        );
        let line = SmartLine {
            service: "Accountancy and VAT".into(),
            kind: Some(RowKind::Row),
            modules: vec!["accountancy"],
            preset_labels: vec!["Accountancy (No Projects)".into(), "Accountancy (Projects)".into(), "VAT Return – Monthly Preparation & Declaration".into(), "VAT Return – Quarterly Preparation & Declaration".into(), "“Optional” Auditing and Management Consultancy".into()],
            rates: vec![rate("Accountancy (No Projects)", Some(2500.0)), rate("Accountancy (Projects)", Some(5000.0)), rate("VAT Return – Monthly Preparation & Declaration", Some(1000.0))],
            ..Default::default()
        };
        let (out, _) = fill_rows(&xml, 10, &[&line], "SAR");
        assert_eq!(rows_of(&out), vec![
            "Category | Monthly Fees", "Accountancy (No Projects) | 2,500 SAR", "Accountancy (Projects) | 5,000 SAR",
            "Category | Monthly Fees", "VAT Return – Monthly Preparation & Declaration | 1,000 SAR",
        ]);
    }

    #[test]
    fn staff_types_and_countries() {
        let rec = table(&[vec!["Category", "Package", "Invoice %"], vec!["Professional Staff Only", "Any Package", "9% of the Annual Package"]]);
        let line = SmartLine { service: "Recruitment".into(), kind: Some(RowKind::Percent), rates: vec![LineRate { label: "Professional Staff".into(), percent: Some(10.0), ..Default::default() }, LineRate { label: "Blue Collar Staff".into(), percent: Some(12.0), ..Default::default() }], ..Default::default() };
        let (out, _) = fill_rows(&rec, 9, &[&line], "SAR");
        assert_eq!(rows_of(&out), vec!["Category | Package | Invoice %", "Professional Staff | Any Package | 10% of the Annual Package", "Blue Collar Staff | Any Package | 12% of the Annual Package"]);

        let mob = table(&[
            vec!["Category", "Fess Per Visa Per Employees", "Payment Terms"],
            vec!["Principal Initial: Submission at the KSA Embassy in SPAIN", "SAR ___", "Including Stamping Expenses"],
            vec!["", "", "Excluding Medical Test"],
            vec!["Principal Initial: Submission at the KSA Embassy in the country of nationality (UK & US)", "$ 3,150", "Including Stamping Expenses"],
            vec!["", "", "Excluding Medical Test"],
        ]);
        let line = SmartLine { service: "Mobilization".into(), kind: Some(RowKind::Country), rates: vec![rate("Kuwait", Some(3800.0)), rate("Spain", Some(2500.0))], ..Default::default() };
        let (out, _) = fill_rows(&mob, 9, &[&line], "SAR");
        assert_eq!(rows_of(&out), vec![
            "Category | Fess Per Visa Per Employees | Payment Terms",
            "Principal Initial: Submission at the KSA Embassy in Kuwait | SAR 3,800 | Including Stamping Expenses", " |  | Excluding Medical Test",
            "Principal Initial: Submission at the KSA Embassy in SPAIN | SAR 2,500 | Including Stamping Expenses", " |  | Excluding Medical Test",
        ]);
    }

    #[test]
    fn moves_text_below_a_table_that_grew() {
        let frame = format!(r#"<p:graphicFrame><p:xfrm><a:off x="100" y="1000"/><a:ext cx="5000" cy="740"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr h="370">{}</a:tr><a:tr h="370">{}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#, cell("Category"), cell("Professional Staff Only"));
        let below = r#"<p:sp><p:spPr><a:xfrm><a:off x="200" y="1800"/><a:ext cx="4000" cy="500"/></a:xfrm></p:spPr></p:sp>"#;
        let beside = r#"<p:sp><p:spPr><a:xfrm><a:off x="9000" y="1800"/><a:ext cx="400" cy="500"/></a:xfrm></p:spPr></p:sp>"#;
        let before = format!("{frame}{below}{beside}");
        let after = before.replacen("</a:tbl>", &format!(r#"<a:tr h="370">{}</a:tr></a:tbl>"#, cell("Blue Collar Staff")), 1);
        let out = reflow(&before, &after);
        assert!(out.contains(r#"<a:off x="100" y="1000"/><a:ext cx="5000" cy="1110""#), "frame grows");
        assert!(out.contains(r#"<a:off x="200" y="2170"/>"#), "text below moves down");
        assert!(out.contains(r#"<a:off x="9000" y="1800"/>"#), "a box beside the table stays");
    }

    #[test]
    fn rewrites_the_contract_term_only() {
        let t = |s: &str| term_sentence(s, 3).unwrap_or_else(|| s.to_string());
        assert_eq!(t("Service for 12 months minimum."), "Service for 3 months minimum.");
        assert_eq!(t("The fees are calculated for 1 year (12 months) contract minimum starting from the date of signature of this proposal."), "The fees are calculated for 3 months contract minimum starting from the date of signature of this proposal.");
        assert_eq!(t("Unless previously terminated, this Agreement will initially to complete duration of 1 year minimum."), "Unless previously terminated, this Agreement will initially to complete duration of 3 months minimum.");
        assert_eq!(t("This Agreement shall be effective for a fixed and non-cancellable period of twelve (12) months from the Effective Date"), "This Agreement shall be effective for a fixed and non-cancellable period of three (3) months from the Effective Date");
        assert_eq!(t("The Client may not terminate this Agreement for convenience during the initial twelve (12) month Term."), "The Client may not terminate this Agreement for convenience during the initial three (3) month Term.");
        assert_eq!(t("12 Months"), "3 Months");
        assert_eq!(t("Total Annual Cost"), "Total Cost (3 Months)");
        assert_eq!(t("Billed monthly for a 1-year (12-month) minimum contract"), "Billed monthly for a 3-month minimum contract");
        assert_eq!(t("Employee terminated by CLIENT in the month number 5, Calculation: (Monthly fee × 7 Months)."), "Employee terminated by CLIENT in the month number 1, Calculation: (Monthly fee × 2 Months).");
        assert_eq!(term_sentence("Activity Duration: ≈ 3 Months", 3), None);
        assert_eq!(term_sentence("The client may terminate this agreement for convenience at any time with a notice period to the Agent of (3) Three months.", 6), None);
        assert_eq!(term_sentence("In the first 12 months, one missed renewal can freeze a brand-new CR", 3), None);
        assert_eq!(term_sentence("Service for 12 months minimum.", 12), None);
        assert_eq!(term_sentence("The fees are calculated for 1 year (12 months) contract minimum", 24).as_deref(), Some("The fees are calculated for 2 years (24 months) contract minimum"));
    }

    #[test]
    fn repeats_prices_in_sentences() {
        let para = |t: &str| format!("<p:sp><p:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:txBody></p:sp>");
        let xml = format!("{}{}{}", para("Accountancy with Projects is 4,750 SAR minimum amount and to be defined according to the number of the transaction."), para("To avoid any doubt: 15\\ employees invoice with rate of Tranche 2"), para("Fees are only for professional staff and not for Labors or Skilled Employees"));
        let acc = SmartLine { service: "Accountancy and VAT".into(), kind: Some(RowKind::Row), modules: vec!["accountancy"], rates: vec![rate("Accountancy (Projects)", Some(5250.0))], ..Default::default() };
        let rec = SmartLine { service: "Recruitment".into(), kind: Some(RowKind::Percent), rates: vec![rate("Blue Collar Staff", None)], ..Default::default() };
        let lines = vec![acc, rec];
        let (out, _) = price_sentences(&xml, 10, &SentenceInput { lines: &lines, standards: &Standards::default(), months: 12, currency: "SAR" });
        let texts = paragraph_texts(&out);
        assert_eq!(texts, vec!["Accountancy with Projects is 5,250 SAR minimum amount and to be defined according to the number of the transaction.", "To avoid any doubt: 15 employees invoice with rate of Tranche 2"]);

        let bundle = format!(
            "{}{}{}",
            table(&[vec!["Category", "Cost without Package", "Package Deal (Constitution + Maintenance)"], vec!["Company Constitution", "45,000 SAR (One Time)", "8,250 SAR/month"], vec!["Company Maintenance", "7,500 SAR/month", ""], vec!["Total Annual Cost", "135,000 SAR", "99,000 SAR"], vec!["Savings", "-", "36,000 SAR"]]),
            para("Save 36,000 SAR/year by opting for the package."),
            para("The package allows for manageable monthly payments of 11,500 SAR, avoiding the burden of a single large payment.")
        );
        let pkg = SmartLine { service: "Company Constitution & Maintenance Package".into(), modules: vec!["constitution_maintenance"], unit_price: Some(9000.0), ..Default::default() };
        let lines = vec![pkg];
        let (out, _) = price_sentences(&bundle, 17, &SentenceInput { lines: &lines, standards: &Standards { constitution: Some(55000.0), maintenance: Some(7250.0) }, months: 12, currency: "SAR" });
        assert_eq!(rows_of(&out)[1..].to_vec(), vec!["Company Constitution | 45,000 SAR (One Time) | 9,000 SAR/month", "Company Maintenance | 7,500 SAR/month | ", "Total Annual Cost | 135,000 SAR | 108,000 SAR", "Savings | - | 27,000 SAR"]);
        let texts = paragraph_texts(&out);
        assert!(texts.contains(&"Save 27,000 SAR/year by opting for the package.".to_string()), "{texts:?}");
        assert_eq!(parse_amount("3.550 SAR"), Some(3550.0));
        assert!(texts.iter().any(|t| t.contains("monthly payments of 9,000 SAR")), "{texts:?}");
    }

    #[test]
    fn business_setup_under_twelve_months_charges_the_constitution() {
        let para = |t: &str| format!("<p:sp><p:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:txBody></p:sp>");
        let xml = format!("{}{}{}", table(&[vec!["Category", "Cost"], vec!["Business Setup and Company Maintenance", "8,000 SAR/month"], vec!["Total Annual Cost", "90,000 SAR"]]), para("Free Constitution – Conditional Benefit"), para("The company constitution service is provided free of charge strictly conditional upon full completion of the twelve (12) month Company  Maintenance term."));
        let bs = SmartLine { service: "Business Setup and Maintenance Package".into(), modules: vec!["business_setup"], unit_price: Some(8000.0), ..Default::default() };
        let lines = vec![bs];
        let (out, o) = price_sentences(&xml, 10, &SentenceInput { lines: &lines, standards: &Standards { constitution: Some(55000.0), maintenance: None }, months: 6, currency: "SAR" });
        assert_eq!(rows_of(&out), vec!["Category | Cost", "Business Setup and Company Maintenance | 8,000 SAR/month", "Company Constitution (One Time) | 55,000 SAR", "Total Annual Cost | 103,000 SAR"]);
        assert!(paragraph_texts(&out).iter().all(|t| !t.to_lowercase().contains("free")));
        assert_eq!(o.filled.len(), 1);
    }
}
