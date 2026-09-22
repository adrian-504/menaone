//! PowerPoint proposal decks, built from a master template without PowerPoint:
//! a .pptx is a zip of XML parts, so the generator keeps the slides a proposal
//! needs, drops everything only the removed slides used, fills `{{tokens}}`
//! (also when PowerPoint split them across text runs) and repeats table rows
//! that contain `{{line.…}}` tokens once per service line.
//!
//! Proven on the real templates in the Sprint 0 spike (spikes/pptx-generator).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::OnceLock;

pub type Parts = BTreeMap<String, Vec<u8>>;

#[derive(Debug, Clone)]
pub struct Package {
    pub(crate) order: Vec<String>,
    pub parts: Parts,
}

fn fail<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

impl Package {
    pub fn read(path: &Path) -> Result<Package, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("Could not open the template: {e}"))?;
        Self::from_reader(file)
    }

    pub fn from_reader<R: Read + std::io::Seek>(reader: R) -> Result<Package, String> {
        let mut zip = zip::ZipArchive::new(reader).map_err(|_| "This file is not a PowerPoint (.pptx) file.".to_string())?;
        let mut order = Vec::new();
        let mut parts = Parts::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(fail)?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(fail)?;
            order.push(f.name().to_string());
            parts.insert(f.name().to_string(), buf);
        }
        if !parts.contains_key("ppt/presentation.xml") {
            return Err("This file is not a PowerPoint (.pptx) presentation.".into());
        }
        Ok(Package { order, parts })
    }

    /// A package from its parts, in name order (tests and tools that build decks in memory).
    pub fn from_parts(parts: Parts) -> Package {
        let order = parts.keys().cloned().collect();
        Package { order, parts }
    }

    pub fn write(&self, path: &Path) -> Result<(), String> {
        let file = std::fs::File::create(path).map_err(|e| format!("Could not write the proposal: {e}"))?;
        self.write_to(file)
    }

    pub fn write_to<W: Write + std::io::Seek>(&self, writer: W) -> Result<(), String> {
        let mut zip = zip::ZipWriter::new(writer);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut names: Vec<&String> = self.order.iter().filter(|n| self.parts.contains_key(*n)).collect();
        // [Content_Types].xml first, as Office writes it.
        names.sort_by_key(|n| *n != "[Content_Types].xml");
        for name in names {
            zip.start_file(name.as_str(), opts).map_err(fail)?;
            zip.write_all(&self.parts[name]).map_err(fail)?;
        }
        zip.finish().map_err(fail)?;
        Ok(())
    }

    pub(crate) fn text(&self, name: &str) -> String {
        self.parts.get(name).map(|b| String::from_utf8_lossy(b).to_string()).unwrap_or_default()
    }

    pub fn text_of(&self, name: &str) -> String {
        self.text(name)
    }

    pub fn set_text(&mut self, name: &str, xml: String) {
        self.remember_part(name);
        self.parts.insert(name.to_string(), xml.into_bytes());
    }

    /// Parts added after reading must be listed to be written.
    pub fn remember_part(&mut self, name: &str) {
        if !self.order.iter().any(|n| n == name) {
            self.order.push(name.to_string());
        }
    }
}

/// Slide part names in presentation order.
pub fn slide_parts_in_order(pkg: &Package) -> Vec<String> {
    slide_refs(pkg).into_iter().map(|s| s.part).collect()
}

// ═══════════════ Relationships ═══════════════

pub(crate) fn rels_path(part: &str) -> String {
    let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
    if dir.is_empty() { format!("_rels/{file}.rels") } else { format!("{dir}/_rels/{file}.rels") }
}

/// Resolves a relationship target relative to the part that owns the rels.
pub(crate) fn resolve(owner: &str, target: &str) -> String {
    if let Some(abs) = target.strip_prefix('/') {
        return abs.to_string();
    }
    let mut segs: Vec<&str> = owner.split('/').collect();
    segs.pop();
    for s in target.split('/') {
        match s {
            ".." => { segs.pop(); }
            "." | "" => {}
            s => segs.push(s),
        }
    }
    segs.join("/")
}

pub(crate) struct Rel {
    pub id: String,
    pub target: String,
    pub rel_type: String,
    pub external: bool,
    pub raw: String,
}

pub(crate) fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

pub(crate) fn attr(raw: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let start = raw.find(&needle)? + needle.len();
    let end = raw[start..].find('"')? + start;
    Some(raw[start..end].to_string())
}

pub(crate) fn rels_of(pkg: &Package, owner: &str) -> Vec<Rel> {
    static REL: OnceLock<Regex> = OnceLock::new();
    let xml = pkg.text(&rels_path(owner));
    re(r"<Relationship\b[^>]*/>", &REL)
        .find_iter(&xml)
        .map(|m| {
            let raw = m.as_str().to_string();
            Rel {
                id: attr(&raw, "Id").unwrap_or_default(),
                target: attr(&raw, "Target").unwrap_or_default(),
                rel_type: attr(&raw, "Type").unwrap_or_default(),
                external: attr(&raw, "TargetMode").as_deref() == Some("External"),
                raw,
            }
        })
        .collect()
}

pub(crate) fn remove_rel(pkg: &mut Package, owner: &str, id: &str) {
    let path = rels_path(owner);
    let xml = pkg.text(&path);
    if let Some(rel) = rels_of(pkg, owner).into_iter().find(|r| r.id == id) {
        pkg.parts.insert(path, xml.replacen(&rel.raw, "", 1).into_bytes());
    }
}

// ═══════════════ Slides and their text ═══════════════

#[derive(Debug, Clone)]
pub(crate) struct SlideRef {
    /// `<p:sldId>` element as written.
    pub element: String,
    /// Stable id PowerPoint keeps when slides are reordered.
    pub slide_id: String,
    pub rel_id: String,
    pub part: String,
}

pub(crate) fn slide_refs(pkg: &Package) -> Vec<SlideRef> {
    static SLD: OnceLock<Regex> = OnceLock::new();
    let pres = pkg.text("ppt/presentation.xml");
    let targets: HashMap<String, String> = rels_of(pkg, "ppt/presentation.xml").into_iter().map(|r| (r.id, resolve("ppt/presentation.xml", &r.target))).collect();
    re(r#"<p:sldId\b[^>]*/>"#, &SLD)
        .find_iter(&pres)
        .filter_map(|m| {
            let el = m.as_str().to_string();
            let slide_id = attr(&el, "id")?;
            let rel_id = attr(&el, "r:id")?;
            let part = targets.get(&rel_id)?.clone();
            Some(SlideRef { element: el, slide_id, rel_id, part })
        })
        .collect()
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Text of each paragraph in a part, runs joined.
pub(crate) fn paragraphs(xml: &str) -> Vec<String> {
    static PARA: OnceLock<Regex> = OnceLock::new();
    static T: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>", &PARA)
        .find_iter(xml)
        .map(|p| re(r"(?s)<a:t(?:\s[^>]*)?>(.*?)</a:t>", &T).captures_iter(p.as_str()).map(|c| unescape(&c[1])).collect::<String>())
        .filter(|t| !t.trim().is_empty())
        .collect()
}

/// The slide's title placeholder text, or its first line of text.
fn slide_title(xml: &str) -> String {
    static SP: OnceLock<Regex> = OnceLock::new();
    for shape in re(r"(?s)<p:sp>.*?</p:sp>", &SP).find_iter(xml) {
        let s = shape.as_str();
        if s.contains(r#"type="title""#) || s.contains(r#"type="ctrTitle""#) {
            let t = paragraphs(s).join(" ");
            if !t.trim().is_empty() {
                return t;
            }
        }
    }
    paragraphs(xml).into_iter().next().unwrap_or_default()
}

pub fn find_tokens(text: &str) -> Vec<String> {
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    let mut out: Vec<String> = Vec::new();
    for c in re(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}", &TOKEN).captures_iter(text) {
        let t = c[1].to_string();
        if !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

// ═══════════════ Template inspection ═══════════════

/// Rules a template author can put in a slide's speaker notes:
/// `[always]`, `[never]`, `[services: Payroll, PRO]`, `[entity: KSA]`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlideTags {
    pub always: bool,
    pub never: bool,
    pub services: Vec<String>,
    pub entity: Option<String>,
}

pub fn parse_tags(notes: &str) -> SlideTags {
    static TAG: OnceLock<Regex> = OnceLock::new();
    let mut tags = SlideTags::default();
    for c in re(r"\[\s*([A-Za-z]+)\s*(?::\s*([^\]]*))?\]", &TAG).captures_iter(notes) {
        let key = c[1].to_lowercase();
        let value = c.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        match key.as_str() {
            "always" => tags.always = true,
            "never" | "skip" => tags.never = true,
            "service" | "services" => tags.services.extend(value.split([',', ';']).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())),
            "entity" => tags.entity = Some(value).filter(|v| !v.is_empty()),
            _ => {}
        }
    }
    tags
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideInfo {
    /// 1-based position in the template.
    pub index: usize,
    pub slide_id: String,
    pub title: String,
    pub text: String,
    pub notes: String,
    pub tags: SlideTags,
    pub tokens: Vec<String>,
    /// The slide has a table row that repeats for each service line.
    pub has_line_table: bool,
    /// What the automatic fields would fill here (client name, date, logo…).
    pub smart_fields: Vec<String>,
    /// Every paragraph (`text` keeps the first 400 characters for display).
    #[serde(skip)]
    pub full_text: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInspection {
    pub slide_count: usize,
    pub slides: Vec<SlideInfo>,
    pub tokens: Vec<String>,
}

fn notes_text(pkg: &Package, slide_part: &str) -> String {
    let Some(rel) = rels_of(pkg, slide_part).into_iter().find(|r| r.rel_type.ends_with("/notesSlide")) else { return String::new() };
    let notes_part = resolve(slide_part, &rel.target);
    let xml = pkg.text(&notes_part);
    // Skip the slide-image and slide-number placeholders; keep the body.
    static SP: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<p:sp>.*?</p:sp>", &SP)
        .find_iter(&xml)
        .filter(|s| !s.as_str().contains(r#"type="sldNum""#) && !s.as_str().contains(r#"type="sldImg""#))
        .flat_map(|s| paragraphs(s.as_str()))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn inspect(pkg: &Package) -> TemplateInspection {
    let mut all_tokens: Vec<String> = Vec::new();
    let slides: Vec<SlideInfo> = slide_refs(pkg)
        .into_iter()
        .enumerate()
        .map(|(i, s)| {
            let xml = pkg.text(&s.part);
            let text = paragraphs(&xml).join("\n");
            let notes = notes_text(pkg, &s.part);
            let tokens = find_tokens(&text);
            for t in &tokens {
                if !all_tokens.contains(t) {
                    all_tokens.push(t.clone());
                }
            }
            SlideInfo {
                index: i + 1,
                slide_id: s.slide_id,
                title: slide_title(&xml),
                text: text.chars().take(400).collect(),
                full_text: text.clone(),
                tags: parse_tags(&notes),
                notes,
                has_line_table: tokens.iter().any(|t| t.starts_with("line.")),
                smart_fields: crate::smartfill::detect_slide(&xml),
                tokens,
            }
        })
        .collect();
    TemplateInspection { slide_count: slides.len(), slides, tokens: all_tokens }
}

// ═══════════════ Generation ═══════════════

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BuildReport {
    pub slides_before: usize,
    pub slides_after: usize,
    pub parts_removed: usize,
    pub tokens_filled: usize,
    /// `{{tokens}}` still in the deck because no value was known.
    pub missing_tokens: Vec<String>,
    /// What the automatic fields for templates without placeholders did.
    pub smart: Option<crate::smartfill::SmartReport>,
}

pub struct BuildInput<'a> {
    /// 1-based slide positions to keep; their order in the template is kept.
    pub keep: &'a BTreeSet<usize>,
    pub values: &'a HashMap<String, String>,
    /// One map per service line (`service`, `amount`, …) for `{{line.…}}` rows.
    pub lines: &'a [HashMap<String, String>],
    /// Plain text to replace, for templates without `{{tokens}}` (e.g. "'Client Name'").
    pub replacements: &'a [(String, String)],
}

pub fn build_with_smart_fields(pkg: &mut Package, input: &BuildInput, smart: Option<crate::smartfill::SmartInput>) -> Result<BuildReport, String> {
    let mut report = build(pkg, input)?;
    if let Some(smart) = smart {
        report.smart = Some(crate::smartfill::apply(pkg, smart));
    }
    Ok(report)
}

pub fn build(pkg: &mut Package, input: &BuildInput) -> Result<BuildReport, String> {
    let pres_name = "ppt/presentation.xml";
    let slides = slide_refs(pkg);
    if slides.is_empty() {
        return Err("The template has no slides.".into());
    }
    if input.keep.is_empty() || !input.keep.iter().any(|k| *k >= 1 && *k <= slides.len()) {
        return Err("No slides were selected for this proposal.".into());
    }
    let mut report = BuildReport { slides_before: slides.len(), ..Default::default() };
    let mut pres = pkg.text(pres_name);
    let mut deleted: BTreeSet<String> = BTreeSet::new();
    for (pos, s) in slides.iter().enumerate() {
        if input.keep.contains(&(pos + 1)) {
            continue;
        }
        deleted.insert(s.part.clone());
        pres = pres.replacen(&s.element, "", 1);
        // Section lists (PowerPoint 2010+) repeat slide ids.
        pres = pres.replace(&format!(r#"<p14:sldId id="{}"/>"#, s.slide_id), "");
        remove_rel(pkg, pres_name, &s.rel_id);
    }
    pkg.parts.insert(pres_name.into(), pres.into_bytes());
    report.slides_after = slides.len() - deleted.len();

    // Kept parts pointing at a removed slide (e.g. an agenda link): drop the link.
    let owners: Vec<String> = pkg.parts.keys().filter(|n| !n.contains("/_rels/") && !deleted.contains(*n)).cloned().collect();
    for owner in owners {
        for rel in rels_of(pkg, &owner) {
            if !rel.external && deleted.contains(&resolve(&owner, &rel.target)) {
                let xml = pkg.text(&owner);
                let pattern = format!(r#"<a:hlinkClick\b[^>]*r:id="{}"[^>]*/>"#, regex::escape(&rel.id));
                let fixed = Regex::new(&pattern).map_err(fail)?.replace_all(&xml, "").to_string();
                pkg.parts.insert(owner.clone(), fixed.into_bytes());
                remove_rel(pkg, &owner, &rel.id);
            }
        }
    }

    // Drop every part no longer reachable from the package root.
    let mut reachable: BTreeSet<String> = BTreeSet::new();
    let mut queue: VecDeque<String> = VecDeque::from([String::new()]);
    while let Some(owner) = queue.pop_front() {
        for rel in rels_of(pkg, &owner).iter().filter(|r| !r.external) {
            let target = if owner.is_empty() { rel.target.trim_start_matches('/').to_string() } else { resolve(&owner, &rel.target) };
            if deleted.contains(&target) {
                continue;
            }
            if reachable.insert(target.clone()) {
                queue.push_back(target);
            }
        }
    }
    let before = pkg.parts.len();
    let droppable: Vec<String> = pkg.parts.keys().filter(|n| *n != "[Content_Types].xml" && !n.ends_with(".rels") && !reachable.contains(*n)).cloned().collect();
    for n in &droppable {
        pkg.parts.remove(n);
        pkg.parts.remove(&rels_path(n));
    }
    report.parts_removed = before - pkg.parts.len();

    static OVERRIDE: OnceLock<Regex> = OnceLock::new();
    let ct = pkg.text("[Content_Types].xml");
    let parts_ref = &pkg.parts;
    let ct = re(r#"<Override PartName="/([^"]+)"[^>]*/>"#, &OVERRIDE)
        .replace_all(&ct, |c: &regex::Captures| if parts_ref.contains_key(&c[1]) { c[0].to_string() } else { String::new() })
        .to_string();
    pkg.parts.insert("[Content_Types].xml".into(), ct.into_bytes());
    if pkg.parts.contains_key("docProps/app.xml") {
        static SLIDES: OnceLock<Regex> = OnceLock::new();
        let app = pkg.text("docProps/app.xml");
        let app = re(r"<Slides>\d+</Slides>", &SLIDES).replace(&app, format!("<Slides>{}</Slides>", report.slides_after).as_str()).to_string();
        pkg.parts.insert("docProps/app.xml".into(), app.into_bytes());
    }

    // Text: repeating rows first, then tokens and plain replacements.
    let mut pairs: Vec<(String, String)> = input.values.iter().flat_map(|(k, v)| [(format!("{{{{{k}}}}}"), v.clone()), (format!("{{{{ {k} }}}}"), v.clone())]).collect();
    pairs.extend(input.replacements.iter().filter(|(f, _)| !f.is_empty()).cloned());
    let slide_parts: Vec<String> = pkg.parts.keys().filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml")).cloned().collect();
    let mut missing: Vec<String> = Vec::new();
    for name in slide_parts {
        let xml = pkg.text(&name);
        let xml = repeat_line_rows(&xml, input.lines);
        let (xml, n) = fill_placeholders(&xml, &pairs);
        report.tokens_filled += n;
        for t in find_tokens(&paragraphs(&xml).join("\n")) {
            if !missing.contains(&t) {
                missing.push(t);
            }
        }
        pkg.parts.insert(name, xml.into_bytes());
    }
    report.missing_tokens = missing;
    Ok(report)
}

/// Table rows containing `{{line.…}}` are repeated once per service line
/// (and removed when there are no lines).
fn repeat_line_rows(xml: &str, lines: &[HashMap<String, String>]) -> String {
    static ROW: OnceLock<Regex> = OnceLock::new();
    if !xml.contains("line.") {
        return xml.to_string();
    }
    re(r"(?s)<a:tr\b[^>]*>.*?</a:tr>", &ROW)
        .replace_all(xml, |c: &regex::Captures| {
            let row = &c[0];
            if !find_tokens(&paragraphs(row).join(" ")).iter().any(|t| t.starts_with("line.")) {
                return row.to_string();
            }
            lines
                .iter()
                .map(|line| {
                    let pairs: Vec<(String, String)> = line.iter().flat_map(|(k, v)| [(format!("{{{{line.{k}}}}}"), v.clone()), (format!("{{{{ line.{k} }}}}"), v.clone())]).collect();
                    fill_placeholders(row, &pairs).0
                })
                .collect::<String>()
        })
        .to_string()
}

/// Replaces text paragraph by paragraph. A token split over several runs
/// ("{{client", "_name}}") is written into its first run — which keeps that
/// run's formatting — and removed from the rest.
pub fn fill_placeholders(xml: &str, replacements: &[(String, String)]) -> (String, usize) {
    static PARA: OnceLock<Regex> = OnceLock::new();
    static T: OnceLock<Regex> = OnceLock::new();
    let mut count = 0;
    let out = re(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>", &PARA).replace_all(xml, |pc: &regex::Captures| {
        let para = pc[0].to_string();
        let spans: Vec<(usize, usize, String)> = re(r"(?s)(?:<a:t>|<a:t [^>]*>)(.*?)</a:t>", &T)
            .captures_iter(&para)
            .map(|c| {
                let m = c.get(1).expect("group");
                (m.start(), m.end(), unescape(m.as_str()))
            })
            .collect();
        if spans.is_empty() {
            return para;
        }
        let mut texts: Vec<String> = spans.iter().map(|s| s.2.clone()).collect();
        for (token, value) in replacements {
            if token.is_empty() || value.contains(token.as_str()) {
                continue;
            }
            loop {
                let joined: String = texts.concat();
                let Some(start) = joined.find(token.as_str()) else { break };
                let end = start + token.len();
                let (mut offset, mut first, mut last) = (0, None, None);
                let mut local = (0, 0);
                for (i, t) in texts.iter().enumerate() {
                    let (s, e) = (offset, offset + t.len());
                    if first.is_none() && start >= s && start < e {
                        first = Some(i);
                        local.0 = start - s;
                    }
                    if end > s && end <= e {
                        last = Some(i);
                        local.1 = end - s;
                    }
                    offset = e;
                }
                let (Some(f), Some(l)) = (first, last) else { break };
                let tail = texts[l][local.1..].to_string();
                let head = texts[f][..local.0].to_string();
                for t in texts.iter_mut().take(l + 1).skip(f) {
                    t.clear();
                }
                texts[f] = format!("{head}{value}{tail}");
                count += 1;
            }
        }
        let mut rebuilt = para.clone();
        let touched = texts.iter().zip(spans.iter()).any(|(t, s)| *t != s.2);
        for (i, (s, e, original)) in spans.iter().enumerate().rev() {
            if texts[i] != *original {
                rebuilt.replace_range(*s..*e, &escape(&texts[i]));
            }
        }
        if touched { clear_highlight(&rebuilt) } else { rebuilt }
    });
    (out.to_string(), count)
}

/// Templates mark text to update with a yellow highlight; once filled it goes.
pub fn clear_highlight(para: &str) -> String {
    static HL: OnceLock<Regex> = OnceLock::new();
    re(r"(?s)<a:highlight>.*?</a:highlight>", &HL).replace_all(para, "").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn slide(body: &str) -> String {
        format!(r#"<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>{body}</p:spTree></p:cSld></p:sld>"#)
    }

    /// A three-slide package with just the parts the generator touches.
    fn sample() -> Package {
        let mut parts = Parts::new();
        let put = |parts: &mut Parts, name: &str, xml: String| { parts.insert(name.to_string(), xml.into_bytes()); };
        put(&mut parts, "[Content_Types].xml", r#"<Types><Override PartName="/ppt/presentation.xml"/><Override PartName="/ppt/slides/slide1.xml"/><Override PartName="/ppt/slides/slide2.xml"/><Override PartName="/ppt/slides/slide3.xml"/><Override PartName="/ppt/notesSlides/notesSlide2.xml"/><Override PartName="/ppt/media/only2.png"/></Types>"#.into());
        put(&mut parts, "_rels/.rels", r#"<Relationships><Relationship Id="rId1" Type="x/officeDocument" Target="ppt/presentation.xml"/></Relationships>"#.into());
        put(&mut parts, "ppt/presentation.xml", r#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst></p:presentation>"#.into());
        put(&mut parts, "ppt/_rels/presentation.xml.rels", r#"<Relationships><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="x/slide" Target="slides/slide2.xml"/><Relationship Id="rId4" Type="x/slide" Target="slides/slide3.xml"/></Relationships>"#.into());
        put(&mut parts, "ppt/slides/slide1.xml", slide(r#"<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Proposal for {{client</a:t></a:r><a:r><a:t>_name}}</a:t></a:r></a:p></p:txBody></p:sp>"#));
        put(&mut parts, "ppt/slides/slide2.xml", slide(r#"<p:sp><p:txBody><a:p><a:r><a:t>Payroll module</a:t></a:r></a:p></p:txBody></p:sp>"#));
        put(&mut parts, "ppt/slides/_rels/slide2.xml.rels", r#"<Relationships><Relationship Id="rId1" Type="x/notesSlide" Target="../notesSlides/notesSlide2.xml"/><Relationship Id="rId2" Type="x/image" Target="../media/only2.png"/></Relationships>"#.into());
        put(&mut parts, "ppt/notesSlides/notesSlide2.xml", r#"<p:notes><p:sp><p:txBody><a:p><a:r><a:t>[services: Payroll, PRO] [entity: KSA]</a:t></a:r></a:p></p:txBody></p:sp></p:notes>"#.into());
        parts.insert("ppt/media/only2.png".into(), vec![1, 2, 3]);
        put(&mut parts, "ppt/slides/slide3.xml", slide(r#"<a:tbl><a:tr h="1"><a:tc><a:txBody><a:p><a:r><a:t>Service</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr h="2"><a:tc><a:txBody><a:p><a:r><a:t>{{line.service}}</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>{{line.amount}}</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl><p:sp><p:txBody><a:p><a:r><a:t>Total {{monthly_total}} {{unknown_token}}</a:t></a:r></a:p></p:txBody></p:sp>"#));
        let order = parts.keys().cloned().collect();
        Package { order, parts }
    }

    #[test]
    fn filled_text_loses_its_to_do_highlight() {
        let para = r#"<a:p><a:r><a:rPr><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>'Client Name'</a:t></a:r></a:p><a:p><a:r><a:rPr><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>Other</a:t></a:r></a:p>"#;
        let (out, n) = fill_placeholders(para, &[("'Client Name'".into(), "Acme".into())]);
        assert_eq!(n, 1);
        assert_eq!(out.matches("<a:highlight>").count(), 1, "only the filled paragraph is cleared");
    }

    #[test]
    fn inspects_titles_tags_and_tokens() {
        let info = inspect(&sample());
        assert_eq!(info.slide_count, 3);
        assert_eq!(info.slides[0].title, "Proposal for {{client_name}}");
        assert_eq!(info.slides[0].tokens, vec!["client_name"]);
        assert_eq!(info.slides[1].tags.services, vec!["Payroll", "PRO"]);
        assert_eq!(info.slides[1].tags.entity.as_deref(), Some("KSA"));
        assert!(info.slides[2].has_line_table);
    }

    #[test]
    fn keeps_selected_slides_fills_tokens_and_repeats_rows() {
        let mut pkg = sample();
        let keep: BTreeSet<usize> = [1, 3].into_iter().collect();
        let values: HashMap<String, String> = [("client_name".to_string(), "Test & Co".to_string()), ("monthly_total".to_string(), "SAR 9,000".to_string())].into_iter().collect();
        let lines = vec![
            [("service".to_string(), "Payroll".to_string()), ("amount".to_string(), "SAR 6,000".to_string())].into_iter().collect(),
            [("service".to_string(), "PRO".to_string()), ("amount".to_string(), "SAR 3,000".to_string())].into_iter().collect(),
        ];
        let report = build(&mut pkg, &BuildInput { keep: &keep, values: &values, lines: &lines, replacements: &[] }).unwrap();
        assert_eq!((report.slides_before, report.slides_after), (3, 2));
        assert!(!pkg.parts.contains_key("ppt/slides/slide2.xml"), "removed slide is dropped");
        assert!(!pkg.parts.contains_key("ppt/media/only2.png"), "media only it used is dropped");
        assert!(!pkg.text("[Content_Types].xml").contains("slide2.xml"));
        assert!(pkg.text("ppt/slides/slide1.xml").contains("Proposal for Test &amp; Co"));
        let table = pkg.text("ppt/slides/slide3.xml");
        assert_eq!(table.matches("<a:tr ").count(), 3, "header plus one row per line");
        assert!(table.contains("PRO") && table.contains("SAR 6,000"));
        assert_eq!(report.missing_tokens, vec!["unknown_token"]);

        // Round-trips through a real zip.
        let mut buf = Cursor::new(Vec::new());
        pkg.write_to(&mut buf).unwrap();
        buf.set_position(0);
        let again = Package::from_reader(buf).unwrap();
        assert_eq!(inspect(&again).slide_count, 2);
    }

    #[test]
    fn reads_tags_loosely() {
        let t = parse_tags("Module slide\n[Services: Recruitment; Manpower]\n[ALWAYS]");
        assert!(t.always);
        assert_eq!(t.services, vec!["Recruitment", "Manpower"]);
        assert!(parse_tags("[never]").never);
    }
}
