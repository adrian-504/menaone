//! Slides MENA One adds to a deck itself (generator, 1.66):
//!
//! - a plain **scope-and-fee slide for a custom line** — a named service
//!   outside the catalogue, with its price, its unit and a short scope text;
//! - a **summary of fees** for a deck with two or more services: one row per
//!   service, the monthly total, and the total over the term.
//!
//! Both are made in the deck's own design. In a deck from the 2026 master, a
//! copy of one of the master's own fee slides is rewritten (its eyebrow, title,
//! table and bullets keep their styling). In a deck from the service templates,
//! a copy of the deck's fee slide keeps its "Project Fees" title box and gets a
//! plain scope list and a plain table in the theme's fonts.
//!
//! The table of each carries a name that PowerPoint keeps and nobody sees, so
//! "Revise prices" finds the summary again and brings it up to date.

use crate::pptx::{self, Package};
use crate::smartfill::{paragraph_texts, rewrite_paragraphs, SmartLine};
use regex::Regex;
use std::sync::OnceLock;

/// The name of the summary's table (the mark "Revise prices" looks for).
pub const SUMMARY_MARK: &str = "Summary of fees (MENA One)";
/// The name of a custom line's fee table.
pub const CUSTOM_MARK: &str = "Custom fee (MENA One)";
/// A scope text is short: this many lines go on the slide.
pub const SCOPE_LINES: usize = 6;

fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("regex"))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub label: String,
    pub value: String,
    /// A total: said in bold.
    pub strong: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExtraSlide {
    pub eyebrow: String,
    pub title: String,
    pub header: (String, String),
    pub rows: Vec<Row>,
    /// The heading over the bullets ("Scope"); none when there are no bullets.
    pub label: String,
    pub bullets: Vec<String>,
    pub mark: &'static str,
}

// ═══════════════ What the slides say ═══════════════

/// "4,000 SAR": amounts as the decks write them.
fn amount(v: f64, currency: &str) -> String {
    crate::master::amount(v, currency)
}

fn percent(p: f64) -> String {
    if p.fract() == 0.0 { format!("{}%", p as i64) } else { format!("{p}%") }
}

/// How a line's fee reads on the summary, and what it adds to the monthly and one-time totals. A fee that is not
/// a sum (per person, per visa, a percentage, a table of tranches) is said as it is priced and adds nothing.
pub fn fee_of(line: &SmartLine, currency: &str) -> (String, f64, f64) {
    let row = line.rates.first();
    let unit_text = |text: &str| row.and_then(|r| r.price).map(|p| format!("{} {text}", amount(p, currency))).unwrap_or_else(|| text.to_string());
    match line.unit.as_deref() {
        Some("per_person_per_month") => return (unit_text("per person per month"), 0.0, 0.0),
        Some("per_visa") => return (unit_text("per visa"), 0.0, 0.0),
        Some("percent_of_annual_package") => return (row.and_then(|r| r.percent).map(|p| format!("{} of annual package", percent(p))).unwrap_or_else(|| "% of annual package".into()), 0.0, 0.0),
        _ => {}
    }
    if let Some(price) = line.unit_price {
        let sum = price * if line.quantity > 0.0 { line.quantity } else { 1.0 };
        return if line.months.is_some() { (format!("{} per month", amount(sum, currency)), sum, 0.0) } else { (format!("{} one-time", amount(sum, currency)), 0.0, sum) };
    }
    if let [r] = line.rates.as_slice() {
        if let (None, Some(p)) = (r.price, r.percent) {
            return (format!("{} of the annual package", percent(p)), 0.0, 0.0);
        }
    }
    ("As per its fee table".into(), 0.0, 0.0)
}

/// The summary's rows: one per service, then the monthly total and the total over the term (one-time fees
/// included, and said on their own when there are any). None for a deck with fewer than two services.
pub fn summary_rows(lines: &[SmartLine], months: Option<i64>, currency: &str) -> Option<Vec<Row>> {
    let named: Vec<&SmartLine> = lines.iter().filter(|l| !l.service.trim().is_empty()).collect();
    if named.len() < 2 {
        return None;
    }
    let mut rows = Vec::new();
    let (mut monthly, mut once) = (0.0, 0.0);
    for l in &named {
        let (value, m, o) = fee_of(l, currency);
        monthly += m;
        once += o;
        rows.push(Row { label: l.service.trim().to_string(), value, strong: false });
    }
    let term = months.filter(|m| *m > 0).unwrap_or(12);
    if monthly > 0.0 {
        rows.push(Row { label: "Monthly total".into(), value: amount(monthly, currency), strong: true });
    }
    if once > 0.0 {
        rows.push(Row { label: "One-time fees".into(), value: amount(once, currency), strong: true });
    }
    if monthly > 0.0 {
        rows.push(Row { label: format!("{term}-month total"), value: amount(monthly * term as f64 + once, currency), strong: true });
    }
    Some(rows)
}

pub fn summary_slide(lines: &[SmartLine], months: Option<i64>, currency: &str) -> Option<ExtraSlide> {
    let rows = summary_rows(lines, months, currency)?;
    // Fees that are not a sum are on the list and not in the totals: said once, under the table.
    let apart = lines.iter().filter(|l| !l.service.trim().is_empty()).any(|l| { let (_, m, o) = fee_of(l, currency); m == 0.0 && o == 0.0 });
    let totals = rows.iter().any(|r| r.strong);
    Some(ExtraSlide {
        eyebrow: "Project fees · Summary".into(),
        title: "Summary of fees".into(),
        header: ("Service".into(), "Fees".into()),
        rows,
        label: if apart && totals { "Totals".into() } else { String::new() },
        bullets: if apart && totals { vec!["Fees charged per person, per visa, as a percentage or by a fee table are not part of the totals.".into()] } else { vec![] },
        mark: SUMMARY_MARK,
    })
}

/// Is this line a custom one (a service outside the catalogue, with a unit)?
pub fn is_custom(line: &SmartLine) -> bool {
    line.unit.as_deref().map(|u| !u.is_empty()).unwrap_or(false)
}

/// The scope-and-fee slide of a custom line.
pub fn custom_slide(line: &SmartLine, currency: &str) -> ExtraSlide {
    let name = line.service.trim().to_string();
    let row = line.rates.first();
    let (header, value) = match line.unit.as_deref() {
        Some("one_time") => ("One-time fee", line.unit_price.map(|p| amount(p, currency))),
        Some("per_person_per_month") => ("Fee per person per month", row.and_then(|r| r.price).map(|p| amount(p, currency))),
        Some("per_visa") => ("Fee per visa", row.and_then(|r| r.price).map(|p| amount(p, currency))),
        Some("percent_of_annual_package") => ("Fee", row.and_then(|r| r.percent).map(|p| format!("{} of annual package", percent(p)))),
        _ => ("Monthly fees", line.unit_price.map(|p| amount(p, currency))),
    };
    let bullets: Vec<String> = line.description.as_deref().unwrap_or("").lines().map(|l| l.trim().trim_start_matches(['•', '-', '–', '*']).trim().to_string()).filter(|l| !l.is_empty()).take(SCOPE_LINES).collect();
    ExtraSlide {
        eyebrow: format!("Project fees · {name}"),
        title: name.clone(),
        header: ("Category".into(), header.into()),
        rows: vec![Row { label: name, value: value.unwrap_or_else(|| "To be agreed".into()), strong: false }],
        label: if bullets.is_empty() { String::new() } else { "Scope".into() },
        bullets,
        mark: CUSTOM_MARK,
    }
}

// ═══════════════ Shapes ═══════════════

fn shape_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<p:sp>.*?</p:sp>|<p:graphicFrame>.*?</p:graphicFrame>|<p:pic>.*?</p:pic>|<p:grpSp>.*?</p:grpSp>|<p:cxnSp>.*?</p:cxnSp>", &R)
}

fn shape_name(shape: &str) -> String {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r#"<p:cNvPr id="\d+" name="([^"]*)""#, &R).captures(shape).map(|c| c[1].to_string()).unwrap_or_default()
}

fn offset(shape: &str) -> Option<(i64, i64, i64, i64)> {
    static R: OnceLock<Regex> = OnceLock::new();
    let c = re(r#"<a:off x="(-?\d+)" y="(-?\d+)"\s*/>\s*<a:ext cx="(\d+)" cy="(\d+)""#, &R).captures(shape)?;
    Some((c[1].parse().ok()?, c[2].parse().ok()?, c[3].parse().ok()?, c[4].parse().ok()?))
}

fn moved(shape: &str, y: i64) -> String {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r#"(<a:off x="-?\d+" y=")(-?\d+)(")"#, &R).replacen(shape, 1, |c: &regex::Captures| format!("{}{y}{}", &c[1], &c[3])).to_string()
}

/// The shape's text becomes these lines: one per paragraph it already has (the rest are emptied).
fn with_text(shape: &str, lines: &[&str]) -> String {
    rewrite_paragraphs(shape, |i, _| Some(lines.get(i).map(|l| l.to_string()).unwrap_or_default())).0
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn rows_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:tr\b[^>]*>.*?</a:tr>", &R)
}

fn cells_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:tc\b[^>]*>.*?</a:tc>", &R)
}

/// A table row with its first two cells saying `label` and `value` (bold when `strong`).
fn row_with(row: &str, label: &str, value: &str, strong: bool) -> String {
    static RPR: OnceLock<Regex> = OnceLock::new();
    let mut k = 0;
    cells_regex().replace_all(row, |c: &regex::Captures| {
        let text = match k { 0 => label, 1 => value, _ => "" };
        k += 1;
        let cell = with_text(&c[0], &[text]);
        if strong && k == 1 {
            return re(r"<a:rPr\b([^>]*)>", &RPR).replace(&cell, |r: &regex::Captures| if r[1].contains(" b=\"1\"") { r[0].to_string() } else { format!("<a:rPr{} b=\"1\">", &r[1]) }).to_string();
        }
        cell
    }).to_string()
}

/// A table with the slide's header and rows, made from the header row and the first body row of `frame`, and
/// carrying the slide's mark as its name. Row heights are kept, so the frame's height follows the rows.
fn table_with(frame: &str, slide: &ExtraSlide) -> Option<String> {
    static NAME: OnceLock<Regex> = OnceLock::new();
    let rows: Vec<regex::Match> = rows_regex().find_iter(frame).collect();
    let (head, body) = (rows.first()?, rows.get(1)?);
    let mut built = row_with(head.as_str(), &slide.header.0, &slide.header.1, false);
    for r in &slide.rows {
        built.push_str(&row_with(body.as_str(), &r.label, &r.value, r.strong));
    }
    let out = format!("{}{}{}", &frame[..head.start()], built, &frame[rows.last()?.end()..]);
    // A fee said in words ("4,000 SAR per month") needs more of the width than a figure does.
    static GRID: OnceLock<Regex> = OnceLock::new();
    let widths: Vec<i64> = re(r#"<a:gridCol w="(\d+)"\s*/>"#, &GRID).captures_iter(&out).filter_map(|c| c[1].parse().ok()).collect();
    let wordy = slide.rows.iter().any(|r| r.value.chars().count() > 14);
    let out = match widths.as_slice() {
        [a, b] if wordy && *b * 100 < (*a + *b) * 45 => {
            let second = (*a + *b) * 45 / 100;
            let mut k = 0;
            re(r#"<a:gridCol w="(\d+)"\s*/>"#, &GRID).replace_all(&out, |_: &regex::Captures| { k += 1; format!(r#"<a:gridCol w="{}"/>"#, if k == 1 { *a + *b - second } else { second }) }).to_string()
        }
        _ => out,
    };
    Some(re(r#"(<p:cNvPr id="\d+" name=")[^"]*(")"#, &NAME).replacen(&out, 1, |c: &regex::Captures| format!("{}{}{}", &c[1], xml_escape(slide.mark), &c[2])).to_string())
}

/// Every shape gets its own id again (shapes were dropped and copied).
fn renumbered(xml: &str) -> String {
    static ID: OnceLock<Regex> = OnceLock::new();
    let mut next = 1;
    // The slide's own group is id 1; the shapes follow.
    re(r#"<p:cNvPr id="\d+""#, &ID).replace_all(xml, |_: &regex::Captures| { let id = next; next += 1; format!("<p:cNvPr id=\"{id}\"") }).to_string()
}

fn tree_bounds(xml: &str) -> Option<(usize, usize)> {
    let first = shape_regex().find(xml)?.start();
    let end = xml.rfind("</p:spTree>")?;
    Some((first, end))
}

// ═══════════════ A deck from the 2026 master ═══════════════

fn two_column_table(shape: &str) -> bool {
    shape.contains("<a:tbl>") && shape.matches("<a:gridCol ").count() == 2 && rows_regex().find_iter(shape).count() >= 2
}

/// Is this slide one of the master's plain fee slides — an eyebrow, a title, a two-column table, a label and bullets?
pub fn is_master_fee_slide(xml: &str) -> bool {
    let shapes: Vec<&str> = shape_regex().find_iter(xml).map(|m| m.as_str()).collect();
    let named = |prefix: &str| shapes.iter().any(|s| shape_name(s).starts_with(prefix));
    named("Eyebrow") && named("Title") && named("Label") && named("Bullet") && shapes.iter().filter(|s| s.contains("<a:tbl>")).count() == 1 && shapes.iter().any(|s| shape_name(s).starts_with("Table") && two_column_table(s))
}

/// The master's fee slide rewritten for `slide`: its bars, eyebrow, title, table, label and bullets, nothing else.
fn rewrite_master(xml: &str, slide: &ExtraSlide) -> Option<String> {
    let (first, end) = tree_bounds(xml)?;
    let shapes: Vec<&str> = shape_regex().find_iter(&xml[first..end]).map(|m| m.as_str()).collect();
    let bullets: Vec<&str> = shapes.iter().copied().filter(|s| shape_name(s).starts_with("Bullet")).collect();
    let bullet = bullets.first()?;
    let (_, top, _, height) = offset(bullet)?;
    let step = bullets.get(1).and_then(|b| offset(b)).map(|o| o.1 - top).filter(|s| *s > 0).unwrap_or(height + 57_150);
    let mut kept = String::new();
    for s in &shapes {
        let name = shape_name(s);
        if name.starts_with("Bar") {
            kept.push_str(s);
        } else if name.starts_with("Eyebrow") {
            kept.push_str(&with_text(s, &[&slide.eyebrow]));
        } else if name.starts_with("Title") {
            kept.push_str(&with_text(s, &[&slide.title]));
        } else if name.starts_with("Table") {
            kept.push_str(&table_with(s, slide)?);
        } else if name.starts_with("Label") && !slide.bullets.is_empty() {
            kept.push_str(&with_text(s, &[&slide.label]));
        }
    }
    for (i, text) in slide.bullets.iter().enumerate() {
        kept.push_str(&moved(&with_text(bullet, &[text]), top + step * i as i64));
    }
    let after = format!("{}{}{}", &xml[..first], kept, &xml[end..]);
    // The table grew or shrank: what sits under it follows.
    Some(renumbered(&crate::feefill::reflow(xml, &after)))
}

// ═══════════════ A deck from the service templates ═══════════════

fn slide_size(pkg: &Package) -> (i64, i64) {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r#"<p:sldSz cx="(\d+)" cy="(\d+)""#, &R)
        .captures(&pkg.text_of("ppt/presentation.xml"))
        .and_then(|c| Some((c[1].parse().ok()?, c[2].parse().ok()?)))
        .unwrap_or((12_192_000, 6_858_000))
}

/// The templates' title box: "Project Fees" over the service's name.
fn is_title_box(shape: &str) -> bool {
    shape.starts_with("<p:sp>") && paragraph_texts(shape).first().map(|t| t.trim().eq_ignore_ascii_case("Project Fees")).unwrap_or(false)
}

fn run(text: &str, size: i64, bold: bool, colour: &str) -> String {
    format!(r#"<a:r><a:rPr lang="en-US" sz="{size}"{} dirty="0">{colour}</a:rPr><a:t>{}</a:t></a:r>"#, if bold { " b=\"1\"" } else { "" }, xml_escape(text))
}

fn text_box(name: &str, x: i64, y: i64, cx: i64, cy: i64, paragraphs: &str) -> String {
    format!(r#"<p:sp><p:nvSpPr><p:cNvPr id="0" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>{paragraphs}</p:txBody></p:sp>"#)
}

const INK: &str = r#"<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>"#;
const MUTED: &str = r#"<a:solidFill><a:schemeClr val="tx1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr></a:solidFill>"#;

const WHITE: &str = r#"<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>"#;

/// A table cell; `fill` is the header's colour in the deck's own tables, when it has one.
fn plain_cell(text: &str, size: i64, bold: bool, right: bool, colour: &str, pad: i64, fill: Option<&str>) -> String {
    let fill = fill.map(|c| format!(r#"<a:solidFill><a:srgbClr val="{c}"/></a:solidFill>"#)).unwrap_or_else(|| "<a:noFill/>".into());
    format!(
        r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="{}"><a:buNone/></a:pPr>{}</a:p></a:txBody><a:tcPr marL="{pad}" marR="{pad}" marT="{}" marB="{}" anchor="ctr"><a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR><a:lnT w="0"><a:noFill/></a:lnT><a:lnB w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:lnB>{fill}</a:tcPr></a:tc>"#,
        if right { "r" } else { "l" }, run(text, size, bold, colour), pad / 2, pad / 2
    )
}

/// The colour the deck's own fee tables give their header row, when they fill it.
fn header_fill(xml: &str) -> Option<String> {
    static TCPR: OnceLock<Regex> = OnceLock::new();
    static LINE: OnceLock<Regex> = OnceLock::new();
    static FILL: OnceLock<Regex> = OnceLock::new();
    let table = shape_regex().find_iter(xml).map(|m| m.as_str()).find(|s| s.contains("<a:tbl>"))?;
    let head = rows_regex().find(table)?;
    let props = re(r"(?s)<a:tcPr\b[^>]*>(.*?)</a:tcPr>", &TCPR).captures(head.as_str())?;
    let own = re(r"(?s)<a:ln[LRTB]\b.*?</a:ln[LRTB]>|<a:ln[LRTB]\b[^>]*/>", &LINE).replace_all(&props[1], "");
    re(r#"<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})""#, &FILL).captures(&own).map(|c| c[1].to_uppercase()).filter(|c| c != "FFFFFF")
}

/// A plain slide for a deck from the service templates: the deck's own "Project Fees" title box with the slide's
/// title under it, then the table and the bullets in the theme's fonts, laid out on the slide's width.
fn rewrite_plain(xml: &str, slide: &ExtraSlide, size: (i64, i64)) -> Option<String> {
    let (first, end) = tree_bounds(xml)?;
    let (w, h) = size;
    // Sizes are the 2026 design's, scaled to this deck's slide.
    let scale = |v: i64| v * w / 18_288_000;
    let font = |sz: i64| (sz * w / 18_288_000 / 50 * 50).max(1000);
    // The deck's title boxes stay: the band's ("Project Fees / Fees and Payment Terms") as it is, the one naming
    // the service with this slide's title.
    let titles: Vec<&str> = shape_regex().find_iter(&xml[first..end]).map(|m| m.as_str()).filter(|s| is_title_box(s)).collect();
    let band = |s: &str| paragraph_texts(s).get(1).map(|t| t.trim().eq_ignore_ascii_case("Fees and Payment Terms")).unwrap_or(false);
    let fill = header_fill(&xml[first..end]);
    let margin = w * 8 / 100;
    let width = w - 2 * margin;
    let mut kept = String::new();
    let mut y = h * 12 / 100;
    for t in &titles {
        kept.push_str(&if band(t) { t.to_string() } else { with_text(t, &["Project Fees", &slide.title]) });
        if let Some((_, top, _, cy)) = offset(t) { y = y.max(top + cy + scale(285_750)); }
    }
    if titles.is_empty() {
        // A deck whose fee slide has no "Project Fees" boxes (the GM Representative template titles it its own way):
        // the two are drawn where the other templates have them — the band's at the top left, the service's centred.
        let (band_x, band_y) = (w * 298_174 / 12_192_000, h * 220_010 / 6_858_000);
        let title_y = h * 890_731 / 6_858_000;
        let title_h = h * 569_387 / 6_858_000;
        let lines = |second: &str, align: &str| format!(
            r#"<a:p><a:pPr algn="{align}"/>{}</a:p><a:p><a:pPr algn="{align}"/><a:r><a:rPr lang="en-US" sz="{}" i="1" dirty="0">{INK}</a:rPr><a:t>{}</a:t></a:r></a:p>"#,
            run("Project Fees", font(2700), true, INK), font(2100), xml_escape(second)
        );
        kept.push_str(&text_box("Band title", band_x, band_y, w * 9_652_071 / 12_192_000, title_h, &lines("Fees and Payment Terms", "l")));
        kept.push_str(&text_box("Title", margin, title_y, width, title_h, &lines(&slide.title, "ctr")));
        y = title_y + title_h + scale(285_750);
    } else if titles.iter().all(|t| band(t)) {
        kept.push_str(&text_box("Title", margin, y, width, scale(600_000), &format!("<a:p>{}</a:p>", run(&slide.title, font(3200), true, INK))));
        y += scale(800_000);
    }
    let (head_h, row_h, pad) = (scale(457_200), scale(600_000), scale(190_500));
    let cols = (width * 64 / 100, width - width * 64 / 100);
    let head_colour = if fill.is_some() { WHITE } else { MUTED };
    let mut rows = format!(r#"<a:tr h="{head_h}">{}{}</a:tr>"#, plain_cell(&slide.header.0, font(1400), true, false, head_colour, pad, fill.as_deref()), plain_cell(&slide.header.1, font(1400), true, true, head_colour, pad, fill.as_deref()));
    for r in &slide.rows {
        rows.push_str(&format!(r#"<a:tr h="{row_h}">{}{}</a:tr>"#, plain_cell(&r.label, font(2000), r.strong, false, INK, pad, None), plain_cell(&r.value, font(2000), true, true, INK, pad, None)));
    }
    let table_h = head_h + row_h * slide.rows.len() as i64;
    kept.push_str(&format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="0" name="{}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="{margin}" y="{y}"/><a:ext cx="{width}" cy="{table_h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"/><a:tblGrid><a:gridCol w="{}"/><a:gridCol w="{}"/></a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#,
        xml_escape(slide.mark), cols.0, cols.1
    ));
    y += table_h + scale(380_000);
    if !slide.bullets.is_empty() {
        let indent = scale(209_550);
        let mut paragraphs = format!("<a:p><a:pPr algn=\"l\"><a:spcAft><a:spcPts val=\"600\"/></a:spcAft><a:buNone/></a:pPr>{}</a:p>", run(&slide.label.to_uppercase(), font(1400), true, MUTED));
        for b in &slide.bullets {
            paragraphs.push_str(&format!(r#"<a:p><a:pPr algn="l" marL="{indent}" indent="-{indent}"><a:lnSpc><a:spcPct val="110000"/></a:lnSpc><a:spcAft><a:spcPts val="400"/></a:spcAft><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>{}</a:p>"#, run(b, font(1900), false, INK)));
        }
        kept.push_str(&text_box("Scope", margin, y, width, (h - y - h * 6 / 100).max(scale(600_000)), &paragraphs));
    }
    Some(renumbered(&format!("{}{}{}", &xml[..first], kept, &xml[end..])))
}

// ═══════════════ Adding them to a deck ═══════════════

/// The notes of a slide say what it is, as the master's tags do, so nothing takes it for another service's slide.
fn tag_notes(pkg: &mut Package, slide_part: &str, tag: &str) {
    let Some(rel) = pptx::rels_of(pkg, slide_part).into_iter().find(|r| r.rel_type.ends_with("/notesSlide")) else { return };
    let notes = pptx::resolve(slide_part, &rel.target);
    let xml = pkg.text_of(&notes);
    let mut done = false;
    let (out, _) = rewrite_paragraphs(&xml, |_, t| {
        if !t.contains('[') { return None; }
        let text = if done { String::new() } else { tag.to_string() };
        done = true;
        Some(text)
    });
    pkg.set_text(&notes, out);
}

/// Where a deck's own fee slide to copy is: (the deck or the master to copy from is the caller's) its 1-based
/// position, and whether it is one of the master's plain fee slides.
pub fn donor_in(pkg: &Package) -> Option<(usize, bool)> {
    let parts = pptx::slide_parts_in_order(pkg);
    let xmls: Vec<String> = parts.iter().map(|p| pkg.text_of(p)).collect();
    if let Some(i) = xmls.iter().position(|x| is_master_fee_slide(x)) {
        return Some((i + 1, true));
    }
    if let Some(i) = xmls.iter().position(|x| shape_regex().find_iter(x).any(|s| is_title_box(s.as_str()))) {
        return Some((i + 1, false));
    }
    // No "Project Fees" box anywhere (a GM Representative deck): the deck's fee slide still gives the layout and
    // the table's header colour; the titles are drawn.
    let roles = crate::proposal_library::classify(&pptx::inspect(pkg));
    roles.iter().position(|s| s.role == crate::proposal_library::Role::Fees)
        .or_else(|| xmls.iter().position(|x| x.contains("<a:tbl>") && crate::smartfill::money_regex().is_match(&paragraph_texts(x).join(" "))))
        .map(|i| (i + 1, false))
}

/// Adds the slides at `at` (0-based, in deck order), each a rewritten copy of the donor slide: slide `donor.0` of
/// `source`, which is the deck itself or the master it was built from. Returns how many were added.
pub fn add_slides(pkg: &mut Package, source: &Package, donor: (usize, bool), at: usize, slides: &[ExtraSlide]) -> Result<usize, String> {
    let size = slide_size(pkg);
    for (k, slide) in slides.iter().enumerate() {
        let added = crate::pptx_import::import_slides(pkg, source, &[donor.0], at + k)?;
        if added != 1 {
            return Err(format!("The slide for {} could not be added.", slide.title));
        }
        let part = pptx::slide_parts_in_order(pkg).get(at + k).cloned().ok_or("The added slide was not found.")?;
        let xml = pkg.text_of(&part);
        let rewritten = if donor.1 { rewrite_master(&xml, slide) } else { rewrite_plain(&xml, slide, size) }.ok_or(format!("The slide for {} could not be laid out.", slide.title))?;
        pkg.set_text(&part, rewritten);
        tag_notes(pkg, &part, if slide.mark == SUMMARY_MARK { "[module: summary] [role: summary]" } else { "[module: custom] [role: fees]" });
    }
    Ok(slides.len())
}

/// The summary's table brought up to date in a deck being revised: each row by its label, the term's total by
/// what it is. Returns the slide and how many figures changed; None when the slide is not a summary.
pub fn refresh_summary(xml: &str, lines: &[SmartLine], months: Option<i64>, currency: &str) -> Option<(String, usize)> {
    if !xml.contains(&format!("name=\"{}\"", xml_escape(SUMMARY_MARK))) {
        return None;
    }
    let rows = summary_rows(lines, months, currency).unwrap_or_default();
    let term_total = |label: &str| label.trim().to_lowercase().ends_with("-month total");
    let mut changed = 0;
    let out = shape_regex().replace_all(xml, |c: &regex::Captures| {
        let shape = &c[0];
        if shape_name(shape) != xml_escape(SUMMARY_MARK) {
            return shape.to_string();
        }
        let mut first = true;
        rows_regex().replace_all(shape, |r: &regex::Captures| {
            let row = &r[0];
            if first { first = false; return row.to_string(); }
            let cells: Vec<String> = cells_regex().find_iter(row).map(|c| paragraph_texts(c.as_str()).join(" ")).collect();
            let (Some(label), Some(value)) = (cells.first(), cells.get(1)) else { return row.to_string() };
            let Some(now) = rows.iter().find(|x| x.label == label.trim() || (term_total(&x.label) && term_total(label))) else { return row.to_string() };
            if now.value == value.trim() { return row.to_string(); }
            changed += 1;
            let mut k = 0;
            cells_regex().replace_all(row, |c: &regex::Captures| { k += 1; if k == 2 { with_text(&c[0], &[&now.value]) } else { c[0].to_string() } }).to_string()
        }).to_string()
    }).to_string();
    Some((out, changed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LineRate;

    fn line(name: &str, price: Option<f64>, monthly: bool) -> SmartLine {
        SmartLine { service: name.into(), unit_price: price, months: monthly.then_some(12.0), quantity: 1.0, ..Default::default() }
    }

    fn custom(name: &str, unit: &str, price: Option<f64>, row: Option<LineRate>, scope: &str) -> SmartLine {
        SmartLine { service: name.into(), unit: Some(unit.into()), unit_price: price, months: matches!(unit, "per_month" | "per_person_per_month").then_some(12.0), quantity: 1.0, rates: row.into_iter().collect(), description: Some(scope.into()), ..Default::default() }
    }

    #[test]
    fn the_summary_has_a_row_per_service_and_the_totals() {
        let lines = vec![line("Payroll", Some(4000.0), true), SmartLine { quantity: 2.0, ..line("GM Representative", Some(3000.0), true) }, line("Business Setup", Some(55000.0), false)];
        let rows = summary_rows(&lines, Some(6), "SAR").unwrap();
        let said: Vec<(&str, &str, bool)> = rows.iter().map(|r| (r.label.as_str(), r.value.as_str(), r.strong)).collect();
        assert_eq!(said, vec![
            ("Payroll", "4,000 SAR per month", false), ("GM Representative", "6,000 SAR per month", false), ("Business Setup", "55,000 SAR one-time", false),
            ("Monthly total", "10,000 SAR", true), ("One-time fees", "55,000 SAR", true), ("6-month total", "115,000 SAR", true),
        ]);
        // One service is not a summary; no term reads as twelve months.
        assert!(summary_rows(&lines[..1], Some(12), "SAR").is_none());
        assert_eq!(summary_rows(&lines[..2], None, "SAR").unwrap().last().unwrap().label, "12-month total");
    }

    #[test]
    fn a_fee_that_is_not_a_sum_is_on_the_list_and_not_in_the_totals() {
        let pct = LineRate { label: "Professional Staff".into(), percent: Some(15.0), ..Default::default() };
        let lines = vec![
            line("Payroll", Some(4000.0), true),
            SmartLine { rates: vec![pct], ..line("Recruitment", None, false) },
            custom("Visa processing", "per_visa", None, Some(LineRate { label: "Per visa".into(), price: Some(1500.0), ..Default::default() }), ""),
            custom("On-site HR", "per_person_per_month", None, Some(LineRate { label: "Per person per month".into(), price: Some(150.0), ..Default::default() }), ""),
            custom("Search fee", "percent_of_annual_package", None, Some(LineRate { label: "% of annual package".into(), percent: Some(12.5), ..Default::default() }), ""),
            SmartLine { rates: vec![LineRate { from: Some(1), to: Some(5), price: Some(2000.0), ..Default::default() }, LineRate { from: Some(6), to: Some(15), price: Some(3750.0), ..Default::default() }], ..line("Admin PRO", None, true) },
        ];
        let slide = summary_slide(&lines, Some(12), "SAR").unwrap();
        let said: Vec<(&str, &str)> = slide.rows.iter().map(|r| (r.label.as_str(), r.value.as_str())).collect();
        assert_eq!(said, vec![
            ("Payroll", "4,000 SAR per month"), ("Recruitment", "15% of the annual package"), ("Visa processing", "1,500 SAR per visa"), ("On-site HR", "150 SAR per person per month"),
            ("Search fee", "12.5% of annual package"), ("Admin PRO", "As per its fee table"), ("Monthly total", "4,000 SAR"), ("12-month total", "48,000 SAR"),
        ]);
        assert_eq!((slide.label.as_str(), slide.bullets.len(), slide.mark), ("Totals", 1, SUMMARY_MARK));
        // Every fee a sum: nothing to add under the table.
        assert!(summary_slide(&lines[..1].iter().cloned().chain([line("PRO", Some(1000.0), true)]).collect::<Vec<_>>(), Some(12), "SAR").unwrap().bullets.is_empty());
    }

    #[test]
    fn a_custom_line_has_its_name_its_fee_by_its_unit_and_a_short_scope() {
        let s = custom_slide(&custom("Visa processing", "per_visa", None, Some(LineRate { label: "Per visa".into(), price: Some(1500.0), ..Default::default() }), "• Work visas for new hires\n\n- Exit and re-entry visas\nFamily visas"), "SAR");
        assert_eq!((s.eyebrow.as_str(), s.title.as_str(), s.header.1.as_str()), ("Project fees · Visa processing", "Visa processing", "Fee per visa"));
        assert_eq!(s.rows, vec![Row { label: "Visa processing".into(), value: "1,500 SAR".into(), strong: false }]);
        assert_eq!((s.label.as_str(), s.bullets.clone()), ("Scope", vec!["Work visas for new hires".to_string(), "Exit and re-entry visas".into(), "Family visas".into()]));
        let m = custom_slide(&custom("Market study", "per_month", Some(4000.0), None, ""), "SAR");
        assert_eq!((m.header.1.as_str(), m.rows[0].value.as_str(), m.label.as_str(), m.bullets.len()), ("Monthly fees", "4,000 SAR", "", 0));
        let p = custom_slide(&custom("Search fee", "percent_of_annual_package", None, Some(LineRate { percent: Some(12.0), ..Default::default() }), "one\ntwo\nthree\nfour\nfive\nsix\nseven"), "SAR");
        assert_eq!((p.rows[0].value.as_str(), p.bullets.len()), ("12% of annual package", SCOPE_LINES));
        assert_eq!(custom_slide(&custom("Later", "one_time", None, None, ""), "SAR").rows[0].value, "To be agreed");
    }

    const BAR: &str = r#"<p:sp><p:nvSpPr><p:cNvPr id="3" name="Bar 3"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="990600" y="762000"/><a:ext cx="400050" cy="38100"/></a:xfrm></p:spPr></p:sp>"#;
    fn sp(id: usize, name: &str, y: i64, cy: i64, text: &str) -> String {
        format!(r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="990600" y="{y}"/><a:ext cx="8953500" cy="{cy}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="1900"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>"#)
    }
    fn tc(text: &str) -> String { format!(r#"<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>{text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>"#) }
    fn master_slide() -> String {
        let table = format!(r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Table 8"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="990600" y="1861185"/><a:ext cx="8953500" cy="1123950"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="6096000"/><a:gridCol w="2857500"/></a:tblGrid><a:tr h="457200">{}{}</a:tr><a:tr h="666750">{}{}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#, tc("Category"), tc("Monthly fees"), tc("Temporary GM Representative"), tc("{{fee.price}}"));
        format!(r#"<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/>{BAR}{}{}{table}{}{}{}{}</p:spTree></p:cSld></p:sld>"#,
            sp(6, "Eyebrow 6", 723900, 285750, "Project fees · Temporary GM services"), sp(7, "Title 7", 1104900, 603885, "Temporary GM services fees"),
            sp(9, "Label 9", 3366135, 228600, "Payment &amp; terms"), sp(10, "Bullet 10", 3709035, 598170, "Paid in separate invoices."), sp(11, "Bullet 11", 4364355, 598170, "The first invoice is issued when the service starts."), sp(12, "Side panel 12", 100, 100, "Billed for {{term}}"))
    }

    #[test]
    fn a_master_fee_slide_is_rewritten_in_its_own_shapes() {
        let xml = master_slide();
        assert!(is_master_fee_slide(&xml));
        let lines = vec![line("Payroll", Some(4000.0), true), line("PRO", Some(1000.0), true)];
        let out = rewrite_master(&xml, &summary_slide(&lines, Some(12), "SAR").unwrap()).unwrap();
        assert_eq!(paragraph_texts(&out), vec!["Project fees · Summary", "Summary of fees", "Service", "Fees", "Payroll", "4,000 SAR per month", "PRO", "1,000 SAR per month", "Monthly total", "5,000 SAR", "12-month total", "60,000 SAR"]);
        // No field of the master is left, the table says what it is, and the totals are bold.
        assert!(!out.contains("{{") && out.contains(&format!("name=\"{SUMMARY_MARK}\"")) && !out.contains("Side panel"));
        assert_eq!(out.matches(" b=\"1\"").count(), 2);
        // Three more rows: the frame is taller by them.
        assert!(out.contains(&format!(r#"<a:off x="990600" y="1861185"/><a:ext cx="8953500" cy="{}""#, 1123950 + 3 * 666750)));
        // Ids are unique again.
        let ids: Vec<&str> = regex::Regex::new(r#"<p:cNvPr id="(\d+)""#).unwrap().captures_iter(&out).map(|c| c.get(1).unwrap().as_str()).collect();
        assert_eq!(ids, vec!["1", "2", "3", "4", "5"]);

        let scope = custom_slide(&custom("Visa processing", "per_visa", None, Some(LineRate { price: Some(1500.0), ..Default::default() }), "Work visas\nExit and re-entry visas\nFamily visas"), "SAR");
        let out = rewrite_master(&xml, &scope).unwrap();
        assert_eq!(paragraph_texts(&out), vec!["Project fees · Visa processing", "Visa processing", "Category", "Fee per visa", "Visa processing", "1,500 SAR", "Scope", "Work visas", "Exit and re-entry visas", "Family visas"]);
        // The bullets keep the master's spacing, one under the other.
        let tops: Vec<i64> = shape_regex().find_iter(&out).filter(|s| shape_name(s.as_str()).starts_with("Bullet")).map(|s| offset(s.as_str()).unwrap().1).collect();
        assert_eq!(tops, vec![3709035, 4364355, 5019675]);
    }

    #[test]
    fn a_template_deck_gets_a_plain_slide_under_its_own_title_box() {
        let title = r#"<p:sp><p:nvSpPr><p:cNvPr id="5" name="TextBox 5"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="400000"/><a:ext cx="8000000" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Project Fees</a:t></a:r></a:p><a:p><a:r><a:t>Temporary GM Services</a:t></a:r></a:p></p:txBody></p:sp>"#;
        let band = r#"<p:sp><p:nvSpPr><p:cNvPr id="6" name="TextBox 6"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="298174" y="220010"/><a:ext cx="9652071" cy="565808"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Project Fees</a:t></a:r></a:p><a:p><a:r><a:t>Fees and Payment Terms</a:t></a:r></a:p></p:txBody></p:sp>"#;
        let deck_table = r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Table 7"/></p:nvGraphicFramePr><p:xfrm><a:off x="1" y="1"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr h="1"><a:tc><a:txBody><a:p><a:r><a:t>Category</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnB w="12700"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="005ea8"/></a:solidFill></a:tcPr></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#;
        let xml = format!(r#"<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/>{band}{title}<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture 2"/></p:nvPicPr></p:pic>{}{deck_table}</p:spTree></p:cSld></p:sld>"#, sp(3, "Rectangle 8", 10, 10, "Value Based"));
        assert!(!is_master_fee_slide(&xml));
        let scope = custom_slide(&custom("Visa processing", "one_time", Some(9000.0), None, "Work visas\nFamily visas"), "SAR");
        let out = rewrite_plain(&xml, &scope, (12_192_000, 6_858_000)).unwrap();
        // The band's title stays as the deck has it; the box that names the service names this one.
        assert_eq!(paragraph_texts(&out), vec!["Project Fees", "Fees and Payment Terms", "Project Fees", "Visa processing", "Category", "One-time fee", "Visa processing", "9,000 SAR", "SCOPE", "Work visas", "Family visas"]);
        assert!(!out.contains("Picture 2") && !out.contains("Value Based") && !out.contains("Table 7") && out.contains(&format!("name=\"{CUSTOM_MARK}\"")));
        // The header row takes the colour of the deck's own table headers (not the colour of a border line).
        assert_eq!(header_fill(&xml).as_deref(), Some("005EA8"));
        assert_eq!(out.matches(r#"<a:srgbClr val="005EA8"/>"#).count(), 2);
        // The table sits under the title box, inside the slide, at the title's margin.
        let frame = shape_regex().find_iter(&out).find(|s| s.as_str().contains("<a:tbl>")).unwrap();
        let (x, y, cx, _) = { let c = regex::Regex::new(r#"<a:off x="(\d+)" y="(\d+)"/><a:ext cx="(\d+)" cy="(\d+)""#).unwrap().captures(frame.as_str()).unwrap(); (c[1].parse::<i64>().unwrap(), c[2].parse::<i64>().unwrap(), c[3].parse::<i64>().unwrap(), 0) };
        assert_eq!((x, cx), (975_360, 12_192_000 - 2 * 975_360));
        assert!(y > 1_300_000 && y < 6_858_000);
    }

    #[test]
    fn a_deck_with_no_project_fees_box_gets_the_titles_drawn() {
        // The GM Representative template titles its fee slide its own way: none of its boxes says "Project Fees".
        let band = sp(5, "TextBox 5", 342244, 350364, "Temporary GM Services");
        let table = r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Table 7"/></p:nvGraphicFramePr><p:xfrm><a:off x="1" y="1"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr h="1"><a:tc><a:txBody><a:p><a:r><a:t>Category</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="005EA8"/></a:solidFill></a:tcPr></a:tc></a:tr><a:tr h="1"><a:tc><a:txBody><a:p><a:r><a:t>Temporary GM Representative 6,500 SAR</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#;
        let xml = format!(r#"<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/>{band}{table}</p:spTree></p:cSld></p:sld>"#);
        let scope = custom_slide(&custom("Visa processing", "one_time", Some(9000.0), None, "Work visas"), "SAR");
        let out = rewrite_plain(&xml, &scope, (12_192_000, 6_858_000)).unwrap();
        // The other service's own title is not carried onto this slide; the two usual titles are drawn instead.
        assert_eq!(paragraph_texts(&out), vec!["Project Fees", "Fees and Payment Terms", "Project Fees", "Visa processing", "Category", "One-time fee", "Visa processing", "9,000 SAR", "SCOPE", "Work visas"]);
        assert!(!out.contains("Temporary GM"));
        assert!(out.contains(r#"<a:off x="298174" y="220010"/>"#) && out.contains(r#"<a:pPr algn="ctr"/>"#));
        assert_eq!(out.matches(r#"<a:srgbClr val="005EA8"/>"#).count(), 2);
        // The fee slide is found without the box: by the table that prices something.
        let mut parts = crate::pptx::Parts::new();
        parts.insert("ppt/presentation.xml".into(), br#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>"#.to_vec());
        parts.insert("ppt/_rels/presentation.xml.rels".into(), br#"<Relationships><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="x/slide" Target="slides/slide2.xml"/></Relationships>"#.to_vec());
        parts.insert("ppt/slides/slide1.xml".into(), format!(r#"<p:sld><p:cSld><p:spTree>{}</p:spTree></p:cSld></p:sld>"#, sp(2, "Title", 1, 1, "Proposal")).into_bytes());
        parts.insert("ppt/slides/slide2.xml".into(), xml.into_bytes());
        let pkg = Package { order: parts.keys().cloned().collect(), parts };
        assert_eq!(donor_in(&pkg), Some((2, false)));
    }

    #[test]
    fn revise_prices_brings_the_summary_up_to_date() {
        let before = vec![line("Payroll", Some(4000.0), true), line("PRO", Some(1000.0), true)];
        let xml = rewrite_master(&master_slide(), &summary_slide(&before, Some(12), "SAR").unwrap()).unwrap();
        let after = vec![line("Payroll", Some(4500.0), true), line("PRO", Some(1000.0), true)];
        let (out, changed) = refresh_summary(&xml, &after, Some(12), "SAR").unwrap();
        assert_eq!(changed, 3);
        assert_eq!(paragraph_texts(&out)[4..], ["Payroll", "4,500 SAR per month", "PRO", "1,000 SAR per month", "Monthly total", "5,500 SAR", "12-month total", "66,000 SAR"]);
        // Nothing moved: nothing is rewritten. A slide that is not the summary is not touched.
        assert_eq!(refresh_summary(&xml, &before, Some(12), "SAR"), Some((xml.clone(), 0)));
        assert!(refresh_summary(&master_slide(), &after, Some(12), "SAR").is_none());
        // The term's total is found whatever term its label names.
        let (out, changed) = refresh_summary(&xml, &before, Some(6), "SAR").unwrap();
        assert_eq!((changed, paragraph_texts(&out).last().unwrap().as_str()), (1, "30,000 SAR"));
    }
}
