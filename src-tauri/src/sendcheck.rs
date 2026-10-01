//! The check before sending (generator, 1.66): what is still wrong with a
//! deck, read from the file that is about to go to the client. Five lines,
//! each pass, fail, "check these" or "not found, not checked", with the slide
//! numbers. It warns; it never blocks, and it changes nothing.
//!
//! - **Highlights**: text still highlighted (the templates mark what to fill
//!   in with a highlight).
//! - **Review marks**: comments left in the file fail; text coloured red is
//!   listed as "check these" (some designs use red on purpose).
//! - **Placeholder text**: 'Client Name' in any quote style, a `{{field}}`
//!   nobody filled, the template's "Logo" and "Photos" boxes.
//! - **Dates**: the cover's date and the letter's date differ.
//! - **Agenda**: a page number on the agenda that is not where its section
//!   starts.
//!
//! Dates and agenda need the usual cover, letter and agenda slides; on a deck
//! built another way they say "not found, not checked" — never "pass". A file
//! that is not a PowerPoint is not checked at all. Prices are not compared
//! with the proposal (owner's limit: no price signals).

use crate::pptx::{self, Package};
use crate::smartfill::{client_placeholder_regex, paragraph_texts};
use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

type CmdResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckLine {
    /// highlights | marks | placeholders | dates | agenda
    pub key: String,
    pub label: String,
    /// pass | fail | check | not_checked
    pub status: String,
    /// What was found, in a few words; empty on a plain pass.
    pub detail: String,
    /// The slides it is about, in order.
    pub slides: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SendCheck {
    pub file_name: String,
    /// False when the file could not be read as a PowerPoint: `note` says why and `lines` is empty.
    pub checked: bool,
    pub note: String,
    pub lines: Vec<CheckLine>,
    pub slide_count: usize,
}

fn line(key: &str, label: &str, status: &str, detail: String, slides: Vec<usize>) -> CheckLine {
    CheckLine { key: key.into(), label: label.into(), status: status.into(), detail, slides }
}

/// "slide 4", "slides 4, 9 and 12".
pub fn slide_list(slides: &[usize]) -> String {
    match slides {
        [] => String::new(),
        [one] => format!("slide {one}"),
        many => {
            let (last, rest) = many.split_last().unwrap();
            format!("slides {} and {last}", rest.iter().map(|s| s.to_string()).collect::<Vec<_>>().join(", "))
        }
    }
}

fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("regex"))
}

/// A run's colour is red: strong red, little green and blue. The brand's coral and amber are not.
fn is_red(hex: &str) -> bool {
    let v = u32::from_str_radix(hex, 16).unwrap_or(0);
    let (r, g, b) = ((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF);
    r >= 0xC0 && g <= 0x40 && b <= 0x40
}

/// Does a slide have text typed in red? Only a run's own colour counts, and only when the run says something.
fn has_red_text(xml: &str) -> bool {
    static RUN: OnceLock<Regex> = OnceLock::new();
    static PROPS: OnceLock<Regex> = OnceLock::new();
    static LINE: OnceLock<Regex> = OnceLock::new();
    static HILITE: OnceLock<Regex> = OnceLock::new();
    static FILL: OnceLock<Regex> = OnceLock::new();
    static TEXT: OnceLock<Regex> = OnceLock::new();
    for run in re(r"(?s)<a:r>.*?</a:r>", &RUN).find_iter(xml) {
        let run = run.as_str();
        let said = re(r"(?s)<a:t[^>]*>(.*?)</a:t>", &TEXT).captures(run).map(|c| !c[1].trim().is_empty()).unwrap_or(false);
        if !said { continue; }
        let Some(props) = re(r"(?s)<a:rPr\b[^>]*>.*?</a:rPr>", &PROPS).find(run) else { continue };
        // The outline and the highlight have colours of their own; the text's is the fill directly on the run.
        let props = re(r"(?s)<a:ln\b.*?</a:ln>", &LINE).replace_all(props.as_str(), "");
        let props = re(r"(?s)<a:highlight>.*?</a:highlight>", &HILITE).replace_all(&props, "");
        if re(r#"<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})""#, &FILL).captures(&props).map(|c| is_red(&c[1])).unwrap_or(false) {
            return true;
        }
    }
    false
}

const MONTHS: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/// The first date written in a text, as (year, month, day): "Sunday, 9th June 2024", "16th of May 2024",
/// "June 28th 2026", "September 7th, 2026".
pub fn first_date(text: &str) -> Option<(i64, u32, u32)> {
    static DAY_FIRST: OnceLock<Regex> = OnceLock::new();
    static MONTH_FIRST: OnceLock<Regex> = OnceLock::new();
    const NAMES: &str = "January|February|March|April|May|June|July|August|September|October|November|December";
    let day_first = DAY_FIRST.get_or_init(|| Regex::new(&format!(r"(?i)\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({NAMES}),?\s+(\d{{4}})\b")).expect("regex"));
    let month_first = MONTH_FIRST.get_or_init(|| Regex::new(&format!(r"(?i)\b({NAMES})\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b")).expect("regex"));
    let month = |name: &str| MONTHS.iter().position(|m| *m == name.to_lowercase()).map(|i| i as u32 + 1);
    let a = day_first.captures(text).and_then(|c| Some((c.get(0)?.start(), (c[3].parse().ok()?, month(&c[2])?, c[1].parse().ok()?))));
    let b = month_first.captures(text).and_then(|c| Some((c.get(0)?.start(), (c[3].parse().ok()?, month(&c[1])?, c[2].parse().ok()?))));
    match (a, b) {
        (Some(x), Some(y)) => Some(if x.0 <= y.0 { x.1 } else { y.1 }),
        (x, y) => x.or(y).map(|d| d.1),
    }
}

fn written(d: (i64, u32, u32)) -> String {
    let name = MONTHS[(d.1 as usize).clamp(1, 12) - 1];
    format!("{} {}{} {}", d.2, name[..1].to_uppercase(), &name[1..], d.0)
}

/// The agenda as it is written and where each section really starts: (section, the page written, the page it
/// starts on). None when the deck has no agenda slide, or its sections and numbers do not pair up.
pub fn agenda_pages(texts: &[Vec<String>]) -> Option<Vec<(String, usize, Option<usize>)>> {
    static NUMBER: OnceLock<Regex> = OnceLock::new();
    let number = re(r"^\s*\d{1,2}\s*$", &NUMBER);
    let agenda = texts.iter().position(|t| t.iter().any(|p| p.trim().eq_ignore_ascii_case("agenda")))?;
    let labels: Vec<&String> = texts[agenda].iter().filter(|p| !p.trim().is_empty() && !p.trim().eq_ignore_ascii_case("agenda") && !number.is_match(p)).collect();
    let numbers: Vec<usize> = texts[agenda].iter().filter(|p| number.is_match(p)).filter_map(|p| p.trim().parse().ok()).collect();
    if labels.is_empty() || labels.len() != numbers.len() {
        return None;
    }
    Some(labels.iter().zip(numbers).map(|(label, page)| {
        let key = label.trim().to_lowercase();
        // A section starts on its divider: a slide with little on it whose first line is the section's name.
        let starts = texts.iter().enumerate().find(|(i, t)| *i != agenda && t.len() <= 3 && t.first().map(|f| f.trim().to_lowercase() == key).unwrap_or(false)).map(|(i, _)| i + 1);
        (label.trim().to_string(), page, starts)
    }).collect())
}

/// The five lines for a deck already read.
pub fn check_package(pkg: &Package) -> Vec<CheckLine> {
    let parts = pptx::slide_parts_in_order(pkg);
    let xmls: Vec<String> = parts.iter().map(|p| pkg.text_of(p)).collect();
    let texts: Vec<Vec<String>> = xmls.iter().map(|x| paragraph_texts(x)).collect();
    let at = |hit: &dyn Fn(usize) -> bool| -> Vec<usize> { (0..xmls.len()).filter(|i| hit(*i)).map(|i| i + 1).collect() };

    // 1. Highlights.
    let highlighted = at(&|i| xmls[i].contains("<a:highlight"));
    let highlights = if highlighted.is_empty() { line("highlights", "No highlights left", "pass", String::new(), vec![]) }
        else { line("highlights", "Highlights left", "fail", format!("Text still highlighted on {}", slide_list(&highlighted)), highlighted) };

    // 2. Review marks: comments fail; red text is to be looked at.
    let comments = pkg.parts.keys().filter(|k| k.starts_with("ppt/comments/") && k.ends_with(".xml")).count();
    let red = at(&|i| has_red_text(&xmls[i]));
    let marks = if comments > 0 {
        let also = if red.is_empty() { String::new() } else { format!("; red text on {}", slide_list(&red)) };
        line("marks", "Review marks left", "fail", format!("{comments} comment{} still in the file{also}", if comments == 1 { "" } else { "s" }), red)
    } else if !red.is_empty() {
        line("marks", "Red text: check these", "check", format!("Text in red on {}", slide_list(&red)), red)
    } else {
        line("marks", "No review marks", "pass", String::new(), vec![])
    };

    // 3. Placeholder text.
    let is_box = |p: &String| { let t = p.trim(); t.eq_ignore_ascii_case("logo") || t.eq_ignore_ascii_case("photos") };
    let client = at(&|i| texts[i].iter().any(|p| client_placeholder_regex().is_match(p)));
    let fields = at(&|i| texts[i].iter().any(|p| !pptx::find_tokens(p).is_empty()));
    let boxes = at(&|i| texts[i].iter().any(is_box));
    let mut found: Vec<String> = Vec::new();
    if !client.is_empty() { found.push(format!("'Client Name' on {}", slide_list(&client))); }
    if !fields.is_empty() { found.push(format!("an unfilled {{{{field}}}} on {}", slide_list(&fields))); }
    if !boxes.is_empty() { found.push(format!("a \"Logo\" or \"Photos\" box on {}", slide_list(&boxes))); }
    let mut where_: Vec<usize> = [client, fields, boxes].concat();
    where_.sort_unstable();
    where_.dedup();
    let placeholders = if found.is_empty() { line("placeholders", "No placeholder text", "pass", String::new(), vec![]) }
        else { let mut d = found.join("; "); if let Some(f) = d.get_mut(0..1) { f.make_ascii_uppercase(); } line("placeholders", "Placeholder text left", "fail", d, where_) };

    // 4. The cover's date and the letter's: the first date on slide 1, and the first on slides 2 to 4.
    let date_on = |i: usize| texts.get(i).and_then(|t| t.iter().find_map(|p| first_date(p)));
    let cover = date_on(0);
    let letter = (1..texts.len().min(4)).find_map(|i| date_on(i).map(|d| (i + 1, d)));
    let dates = match (cover, letter) {
        (Some(c), Some((slide, l))) if c == l => line("dates", "Cover and letter dates match", "pass", written(c), vec![1, slide]),
        (Some(c), Some((slide, l))) => line("dates", "Cover and letter dates differ", "fail", format!("The cover says {}, the letter (slide {slide}) says {}", written(c), written(l)), vec![1, slide]),
        (None, None) => line("dates", "Dates: not found, not checked", "not_checked", "No date on the cover or the letter".into(), vec![]),
        (None, _) => line("dates", "Dates: not found, not checked", "not_checked", "No date on the cover".into(), vec![]),
        (_, None) => line("dates", "Dates: not found, not checked", "not_checked", "No date on the letter".into(), vec![]),
    };

    // 5. Agenda page numbers.
    let agenda = match agenda_pages(&texts) {
        None => line("agenda", "Agenda: not found, not checked", "not_checked", "No agenda slide with a page number for each section".into(), vec![]),
        Some(rows) => {
            let lost: Vec<&(String, usize, Option<usize>)> = rows.iter().filter(|r| r.2.is_none()).collect();
            let wrong: Vec<&(String, usize, Option<usize>)> = rows.iter().filter(|r| r.2.is_some_and(|s| s != r.1)).collect();
            if !wrong.is_empty() {
                let d = wrong.iter().map(|(label, page, starts)| format!("{label} says {page:02}, starts on {:02}", starts.unwrap_or(0))).collect::<Vec<_>>().join("; ");
                line("agenda", "Agenda page numbers don't match", "fail", d, wrong.iter().filter_map(|r| r.2).collect())
            } else if !lost.is_empty() {
                line("agenda", "Agenda: not found, not checked", "not_checked", format!("No section slide found for {}", lost.iter().map(|r| r.0.clone()).collect::<Vec<_>>().join(", ")), vec![])
            } else {
                line("agenda", "Agenda page numbers match", "pass", String::new(), vec![])
            }
        }
    };
    vec![highlights, marks, placeholders, dates, agenda]
}

/// The check for a file on disk. Anything that is not a PowerPoint deck is not checked, and says so.
pub fn check_file(path: &Path) -> SendCheck {
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let is_pptx = path.extension().map(|e| e.to_string_lossy().eq_ignore_ascii_case("pptx")).unwrap_or(false);
    if !is_pptx {
        return SendCheck { file_name, checked: false, note: "Not a PowerPoint file, not checked".into(), ..Default::default() };
    }
    match Package::read(path) {
        Err(e) => SendCheck { file_name, checked: false, note: if path.exists() { format!("Could not be read, not checked: {e}") } else { "The file is not there any more, not checked".into() }, ..Default::default() },
        Ok(pkg) => SendCheck { file_name, checked: true, note: String::new(), slide_count: pptx::slide_parts_in_order(&pkg).len(), lines: check_package(&pkg) },
    }
}

/// The check for a deck in OneDrive (the app's files commands read nothing outside it).
#[tauri::command]
pub fn proposal_send_check(path: String) -> CmdResult<SendCheck> {
    let p = Path::new(&path);
    if !crate::localfiles::is_within_onedrive(p) {
        return Err("That file is outside OneDrive.".into());
    }
    Ok(check_file(p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pptx::Parts;

    fn para(text: &str) -> String {
        format!("<a:p><a:r><a:t>{text}</a:t></a:r></a:p>")
    }
    fn shape(paras: &[&str]) -> String {
        format!("<p:sp><p:txBody>{}</p:txBody></p:sp>", paras.iter().map(|p| if p.starts_with("<a:p>") { p.to_string() } else { para(p) }).collect::<String>())
    }
    /// A deck from its slides' bodies (each a list of shapes), with any extra parts.
    fn deck(slides: &[String], extra: &[(&str, &str)]) -> Package {
        let mut parts = Parts::new();
        let mut put = |name: &str, xml: &str| { parts.insert(name.to_string(), xml.as_bytes().to_vec()); };
        put("[Content_Types].xml", "<Types></Types>");
        put("_rels/.rels", r#"<Relationships><Relationship Id="rId1" Type="x/officeDocument" Target="ppt/presentation.xml"/></Relationships>"#);
        let ids: String = (0..slides.len()).map(|i| format!(r#"<p:sldId id="{}" r:id="rId{}"/>"#, 256 + i, i + 2)).collect();
        put("ppt/presentation.xml", &format!("<p:presentation><p:sldIdLst>{ids}</p:sldIdLst></p:presentation>"));
        let rels: String = (0..slides.len()).map(|i| format!(r#"<Relationship Id="rId{}" Type="x/slide" Target="slides/slide{}.xml"/>"#, i + 2, i + 1)).collect();
        put("ppt/_rels/presentation.xml.rels", &format!("<Relationships>{rels}</Relationships>"));
        for (i, body) in slides.iter().enumerate() {
            put(&format!("ppt/slides/slide{}.xml", i + 1), &format!(r#"<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>{body}</p:spTree></p:cSld></p:sld>"#));
        }
        for (name, xml) in extra { put(name, xml); }
        Package::from_parts(parts)
    }
    /// A clean deck: cover, letter, agenda, a section divider on the page the agenda says, its content, terms.
    fn clean() -> Vec<String> {
        vec![
            shape(&["Payroll Proposal", "Thursday, 1st October 2026"]),
            shape(&["Date: 1st of October 2026", "Dear Sample Client,"]),
            shape(&["Agenda", "Our approach", "04", "Fees breakdown", "06"]),
            shape(&["Our approach"]),
            shape(&["How we run payroll", "Monthly", "Cut-off on the 20th", "Payslips by the 28th"]),
            shape(&["Fees breakdown"]),
            shape(&["Payroll", "3,000 SAR", "per month", "12 months"]),
        ]
    }
    fn status(lines: &[CheckLine]) -> Vec<(&str, &str)> {
        lines.iter().map(|l| (l.key.as_str(), l.status.as_str())).collect()
    }

    #[test]
    fn a_clean_deck_passes_all_five() {
        let lines = check_package(&deck(&clean(), &[]));
        assert_eq!(status(&lines), vec![("highlights", "pass"), ("marks", "pass"), ("placeholders", "pass"), ("dates", "pass"), ("agenda", "pass")]);
        assert_eq!(lines[3].detail, "1 October 2026");
        assert_eq!(lines[3].slides, vec![1, 2]);
        assert!(lines.iter().filter(|l| l.key != "dates").all(|l| l.detail.is_empty() && l.slides.is_empty()));
    }

    #[test]
    fn highlights_left_fail_with_their_slides() {
        let mut slides = clean();
        slides[4] = shape(&[r#"<a:p><a:r><a:rPr lang="en-GB"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>12 employees</a:t></a:r></a:p>"#]);
        slides[6] = shape(&[r#"<a:p><a:r><a:rPr><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>3,000 SAR</a:t></a:r></a:p>"#]);
        let lines = check_package(&deck(&slides, &[]));
        assert_eq!((lines[0].status.as_str(), lines[0].label.as_str(), lines[0].detail.as_str(), lines[0].slides.clone()), ("fail", "Highlights left", "Text still highlighted on slides 5 and 7", vec![5, 7]));
        // A yellow highlight is not red text.
        assert_eq!(lines[1].status, "pass");
    }

    #[test]
    fn red_text_is_check_these_and_comments_fail() {
        let red = |hex: &str, text: &str| format!(r#"<a:p><a:r><a:rPr><a:solidFill><a:srgbClr val="{hex}"/></a:solidFill></a:rPr><a:t>{text}</a:t></a:r></a:p>"#);
        let mut slides = clean();
        slides[4] = shape(&[&red("FF0000", "confirm the cut-off"), &red("E8604C", "the brand's coral is not a review mark")]);
        let lines = check_package(&deck(&slides, &[]));
        assert_eq!((lines[1].status.as_str(), lines[1].label.as_str(), lines[1].detail.as_str(), lines[1].slides.clone()), ("check", "Red text: check these", "Text in red on slide 5", vec![5]));
        // Coral alone, a red outline, a red highlight and an empty red run are not red text.
        slides[4] = shape(&[&red("E8604C", "coral"), r#"<a:p><a:r><a:rPr><a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:rPr><a:t>outlined</a:t></a:r></a:p>"#, &red("FF0000", " ")]);
        assert_eq!(check_package(&deck(&slides, &[]))[1].status, "pass");
        // A comment left in the file fails, and says the red text too.
        slides[4] = shape(&[&red("C00000", "check with Hassan")]);
        let lines = check_package(&deck(&slides, &[("ppt/comments/comment1.xml", "<p:cmLst/>"), ("ppt/comments/modernComment_1.xml", "<p188:cmLst/>")]));
        assert_eq!((lines[1].status.as_str(), lines[1].label.as_str(), lines[1].detail.as_str()), ("fail", "Review marks left", "2 comments still in the file; red text on slide 5"));
    }

    #[test]
    fn placeholder_text_left_fails_and_says_which() {
        let mut slides = clean();
        slides[1] = shape(&["Date: 1st of October 2026", "Dear ‘Client Name’,"]);
        slides[4] = shape(&["Prepared for {{client.name}}"]);
        slides[6] = shape(&["Logo"]);
        let lines = check_package(&deck(&slides, &[]));
        assert_eq!(lines[2].status, "fail");
        assert_eq!(lines[2].detail, "'Client Name' on slide 2; an unfilled {{field}} on slide 5; a \"Logo\" or \"Photos\" box on slide 7");
        assert_eq!(lines[2].slides, vec![2, 5, 7]);
        // "Logo" inside a sentence is not the template's box.
        slides[1] = clean()[1].clone();
        slides[4] = shape(&["Your logo on every payslip"]);
        slides[6] = clean()[6].clone();
        assert_eq!(check_package(&deck(&slides, &[]))[2].status, "pass");
    }

    #[test]
    fn dates_that_differ_fail_and_missing_ones_are_not_checked() {
        let mut slides = clean();
        slides[1] = shape(&["Date: 28th of September 2026", "Dear Sample Client,"]);
        let lines = check_package(&deck(&slides, &[]));
        assert_eq!((lines[3].status.as_str(), lines[3].detail.as_str(), lines[3].slides.clone()), ("fail", "The cover says 1 October 2026, the letter (slide 2) says 28 September 2026", vec![1, 2]));
        // The same day written two ways matches.
        slides[1] = shape(&["October 1st, 2026"]);
        assert_eq!(check_package(&deck(&slides, &[]))[3].status, "pass");
        // No date on the letter, or none on the cover: said, never passed.
        slides[1] = shape(&["Dear Sample Client,"]);
        slides[2] = shape(&["Agenda", "Our approach", "04", "Fees breakdown", "06"]);
        let lines = check_package(&deck(&slides, &[]));
        assert_eq!((lines[3].status.as_str(), lines[3].label.as_str(), lines[3].detail.as_str()), ("not_checked", "Dates: not found, not checked", "No date on the letter"));
        slides[0] = shape(&["Payroll Proposal"]);
        assert_eq!(check_package(&deck(&slides, &[]))[3].detail, "No date on the cover or the letter");
    }

    #[test]
    fn agenda_numbers_that_do_not_match_fail_and_an_unusual_deck_is_not_checked() {
        let mut slides = clean();
        // A slide was added by hand before the fees: the agenda still says 06.
        slides.insert(5, shape(&["Who does what", "You", "Us", "Monthly"]));
        let lines = check_package(&deck(&slides, &[]));
        assert_eq!((lines[4].status.as_str(), lines[4].label.as_str(), lines[4].detail.as_str(), lines[4].slides.clone()), ("fail", "Agenda page numbers don't match", "Fees breakdown says 06, starts on 07", vec![7]));
        // No agenda slide at all.
        let plain = vec![clean()[0].clone(), clean()[1].clone(), clean()[6].clone()];
        let lines = check_package(&deck(&plain, &[]));
        assert_eq!((lines[4].status.as_str(), lines[4].label.as_str()), ("not_checked", "Agenda: not found, not checked"));
        // An agenda whose sections and numbers do not pair up, or whose section slide is gone.
        let mut odd = clean();
        odd[2] = shape(&["Agenda", "Our approach", "04", "Fees breakdown"]);
        assert_eq!(check_package(&deck(&odd, &[]))[4].status, "not_checked");
        let mut gone = clean();
        gone[5] = shape(&["Pricing"]);
        let lines = check_package(&deck(&gone, &[]));
        assert_eq!((lines[4].status.as_str(), lines[4].detail.as_str()), ("not_checked", "No section slide found for Fees breakdown"));
    }

    #[test]
    fn reads_dates_in_the_styles_the_templates_use() {
        assert_eq!(first_date("Sunday, 9th June 2024"), Some((2024, 6, 9)));
        assert_eq!(first_date("Date: 16th of May 2024"), Some((2024, 5, 16)));
        assert_eq!(first_date("June 28th 2026"), Some((2026, 6, 28)));
        assert_eq!(first_date("Sunday, September 7th, 2026"), Some((2026, 9, 7)));
        assert_eq!(first_date("Valid for 30 days"), None);
        assert_eq!(slide_list(&[4]), "slide 4");
        assert_eq!(slide_list(&[4, 9, 12]), "slides 4, 9 and 12");
    }

    #[test]
    fn a_file_that_is_not_a_powerpoint_is_not_checked() {
        let dir = std::env::temp_dir().join(format!("menabig_sendcheck_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pdf = dir.join("Sample_Payroll Proposal.pdf");
        std::fs::write(&pdf, b"%PDF-1.7").unwrap();
        let c = check_file(&pdf);
        assert_eq!((c.checked, c.note.as_str(), c.lines.len()), (false, "Not a PowerPoint file, not checked", 0));
        let missing = check_file(&dir.join("gone.pptx"));
        assert_eq!((missing.checked, missing.note.as_str()), (false, "The file is not there any more, not checked"));
        let broken = dir.join("broken.pptx");
        std::fs::write(&broken, b"not a zip").unwrap();
        let b = check_file(&broken);
        assert!(!b.checked && b.note.starts_with("Could not be read, not checked"));
        let good = dir.join("Sample_Payroll Proposal_011026.pptx");
        deck(&clean(), &[]).write(&good).unwrap();
        let g = check_file(&good);
        assert_eq!((g.checked, g.slide_count, g.lines.len(), g.file_name.as_str()), (true, 7, 5, "Sample_Payroll Proposal_011026.pptx"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
