//! Copying slides from one proposal template into another — how a mixed
//! proposal (e.g. Accountancy + Labor Law) is put together from the service
//! templates, the way PowerPoint's "keep source formatting" paste works:
//!
//! - the slide and everything it uses (pictures, charts, notes) are copied
//!   under new part names; identical pictures and themes are shared;
//! - its layout is reused when the destination already has one that looks
//!   exactly the same (same layout and master content); otherwise the layout
//!   and its master (with theme) are copied too, so the slide looks unchanged;
//! - links to other slides are dropped (their targets may not exist).

use crate::pptx::{attr, re, rels_of, rels_path, resolve, slide_refs, Package};
use regex::Regex;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeSet, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;

fn hash_bytes(b: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    b.hash(&mut h);
    h.finish()
}

/// Content of a part with relationship ids replaced by what they point at,
/// so two parts compare equal when they look the same even if their ids differ.
fn fingerprint(pkg: &Package, part: &str, depth: usize) -> u64 {
    static RID: OnceLock<Regex> = OnceLock::new();
    static LAYOUT_ID: OnceLock<Regex> = OnceLock::new();
    let xml = pkg.text(part);
    let rels: HashMap<String, crate::pptx::Rel> = rels_of(pkg, part).into_iter().map(|r| (r.id.clone(), r)).collect();
    let replaced = re(r#"(r:(?:id|embed|link|pict))="([^"]+)""#, &RID).replace_all(&xml, |c: &regex::Captures| {
        let Some(rel) = rels.get(&c[2]) else { return format!(r#"{}="?""#, &c[1]) };
        if rel.rel_type.ends_with("/slideLayout") {
            return format!(r#"{}="layout""#, &c[1]);
        }
        if rel.external {
            return format!(r#"{}="{}""#, &c[1], rel.target);
        }
        let target = resolve(part, &rel.target);
        let value = match pkg.parts.get(&target) {
            Some(bytes) if !target.ends_with(".xml") => hash_bytes(bytes),
            Some(_) if depth < 1 => fingerprint(pkg, &target, depth + 1),
            _ => hash_bytes(rel.rel_type.as_bytes()),
        };
        format!(r#"{}="{:x}""#, &c[1], value)
    });
    let stripped = re(r"<p:sldLayoutId\b[^>]*/>", &LAYOUT_ID).replace_all(&replaced, "");
    // A master's theme decides its colours and fonts.
    let theme = rels.values().find(|r| r.rel_type.ends_with("/theme")).map(|r| pkg.parts.get(&resolve(part, &r.target)).map(|b| hash_bytes(b)).unwrap_or(0)).unwrap_or(0);
    hash_bytes(stripped.as_bytes()) ^ theme.rotate_left(7)
}

fn layout_key(pkg: &Package, layout: &str) -> u64 {
    let master = rels_of(pkg, layout).into_iter().find(|r| r.rel_type.ends_with("/slideMaster")).map(|r| resolve(layout, &r.target));
    fingerprint(pkg, layout, 0) ^ master.map(|m| fingerprint(pkg, &m, 0).rotate_left(13)).unwrap_or(0)
}

/// A free part name like `ppt/media/image7.png` next to `base`.
fn free_name(dest: &Package, base: &str, reserved: &BTreeSet<String>) -> String {
    static NUM: OnceLock<Regex> = OnceLock::new();
    let (dir, file) = base.rsplit_once('/').unwrap_or(("", base));
    let (stem, ext) = file.rsplit_once('.').unwrap_or((file, ""));
    let stem = re(r"\d+$", &NUM).replace(stem, "").to_string();
    let mut n = 1;
    loop {
        let name = format!("{dir}/{stem}{n}.{ext}");
        if !dest.parts.contains_key(&name) && !reserved.contains(&name) {
            return name;
        }
        n += 1;
    }
}

fn relative(from_part: &str, to_part: &str) -> String {
    let from: Vec<&str> = from_part.split('/').collect();
    let to: Vec<&str> = to_part.split('/').collect();
    let from_dir = &from[..from.len() - 1];
    let common = from_dir.iter().zip(to.iter()).take_while(|(a, b)| a == b).count();
    let mut out: Vec<String> = std::iter::repeat("..".to_string()).take(from_dir.len() - common).collect();
    out.extend(to[common..].iter().map(|s| s.to_string()));
    out.join("/")
}

struct Importer<'a> {
    dest: &'a mut Package,
    src: &'a Package,
    /// Source part → destination part, for parts already copied in this import.
    copied: HashMap<String, String>,
    /// Destination binary parts by content, to share identical pictures.
    media: HashMap<u64, String>,
    /// Destination layouts by look.
    layouts: HashMap<u64, String>,
    reserved: BTreeSet<String>,
}

impl<'a> Importer<'a> {
    fn new(dest: &'a mut Package, src: &'a Package) -> Self {
        let media = dest.parts.iter().filter(|(n, _)| !n.ends_with(".xml") && !n.ends_with(".rels")).map(|(n, b)| (hash_bytes(b), n.clone())).collect();
        let layouts = dest.parts.keys().filter(|n| n.starts_with("ppt/slideLayouts/slideLayout") && n.ends_with(".xml")).map(|n| (layout_key(dest, n), n.clone())).collect();
        Importer { dest, src, copied: HashMap::new(), media, layouts, reserved: BTreeSet::new() }
    }

    fn put(&mut self, name: &str, bytes: Vec<u8>) {
        self.dest.parts.insert(name.to_string(), bytes);
        self.dest.remember_part(name);
    }

    fn content_type_of_src(&self, part: &str) -> Option<String> {
        static OV: OnceLock<Regex> = OnceLock::new();
        let ct = self.src.text("[Content_Types].xml");
        re(r#"<Override\b[^>]*/>"#, &OV).find_iter(&ct).map(|m| m.as_str()).find(|o| attr(o, "PartName").as_deref() == Some(&format!("/{part}"))).and_then(|o| attr(o, "ContentType"))
    }

    fn register_type(&mut self, src_part: &str, dest_part: &str) {
        static DEF: OnceLock<Regex> = OnceLock::new();
        let mut ct = self.dest.text("[Content_Types].xml");
        if let Some(t) = self.content_type_of_src(src_part) {
            if !ct.contains(&format!(r#"PartName="/{dest_part}""#)) {
                ct = ct.replacen("</Types>", &format!(r#"<Override PartName="/{dest_part}" ContentType="{t}"/></Types>"#), 1);
            }
        } else if let Some((_, ext)) = dest_part.rsplit_once('.') {
            let has = re(r#"<Default\b[^>]*/>"#, &DEF).find_iter(&ct).any(|m| attr(m.as_str(), "Extension").map(|e| e.eq_ignore_ascii_case(ext)).unwrap_or(false));
            if !has {
                let src_ct = self.src.text("[Content_Types].xml");
                if let Some(def) = re(r#"<Default\b[^>]*/>"#, &DEF).find_iter(&src_ct).find(|m| attr(m.as_str(), "Extension").map(|e| e.eq_ignore_ascii_case(ext)).unwrap_or(false)) {
                    ct = ct.replacen("<Default ", &format!("{}<Default ", def.as_str()), 1);
                }
            }
        }
        self.dest.parts.insert("[Content_Types].xml".into(), ct.into_bytes());
    }

    /// Copies a part and, recursively, what it points at. `rewrite` decides
    /// the target of special relationships (layout, master, notes master…).
    fn copy_part(&mut self, src_part: &str) -> Result<String, String> {
        if let Some(done) = self.copied.get(src_part) {
            return Ok(done.clone());
        }
        let bytes = self.src.parts.get(src_part).cloned().ok_or_else(|| format!("The template is missing {src_part}."))?;
        if !src_part.ends_with(".xml") {
            let h = hash_bytes(&bytes);
            if let Some(existing) = self.media.get(&h) {
                self.copied.insert(src_part.to_string(), existing.clone());
                return Ok(existing.clone());
            }
            let name = free_name(self.dest, src_part, &self.reserved);
            self.reserved.insert(name.clone());
            self.put(&name, bytes);
            self.register_type(src_part, &name);
            self.media.insert(h, name.clone());
            self.copied.insert(src_part.to_string(), name.clone());
            return Ok(name);
        }
        let name = free_name(self.dest, src_part, &self.reserved);
        self.reserved.insert(name.clone());
        self.copied.insert(src_part.to_string(), name.clone());
        let mut rels_xml = self.src.text(&rels_path(src_part));
        let mut xml = String::from_utf8_lossy(&bytes).to_string();
        for rel in rels_of(self.src, src_part) {
            if rel.external {
                continue;
            }
            let target = resolve(src_part, &rel.target);
            let new_target = if rel.rel_type.ends_with("/slideLayout") && src_part.contains("/slides/") {
                Some(self.ensure_layout(&target)?)
            } else if rel.rel_type.ends_with("/slide") && src_part.contains("/notesSlides/") {
                // A notes page points back at its slide, copied just before.
                self.copied.get(&target).cloned()
            } else if rel.rel_type.ends_with("/slide") {
                // A link to another slide: drop it, the slide may not be in this proposal.
                let pattern = format!(r#"<a:hlinkClick\b[^>]*r:id="{}"[^>]*/>"#, regex::escape(&rel.id));
                xml = Regex::new(&pattern).map_err(|e| e.to_string())?.replace_all(&xml, "").to_string();
                rels_xml = rels_xml.replacen(&rel.raw, "", 1);
                None
            } else if rel.rel_type.ends_with("/notesMaster") {
                match self.dest_notes_master() {
                    Some(nm) => Some(nm),
                    None => { rels_xml = rels_xml.replacen(&rel.raw, "", 1); None }
                }
            } else if rel.rel_type.ends_with("/slideMaster") && src_part.contains("/slideLayouts/") {
                // ensure_layout attaches the layout to its master afterwards.
                rels_xml = rels_xml.replacen(&rel.raw, "", 1);
                None
            } else if self.src.parts.contains_key(&target) {
                Some(self.copy_part(&target)?)
            } else {
                None
            };
            if let Some(nt) = new_target {
                let fixed = rel.raw.replacen(&format!(r#"Target="{}""#, rel.target), &format!(r#"Target="{}""#, relative(&name, &nt)), 1);
                rels_xml = rels_xml.replacen(&rel.raw, &fixed, 1);
            }
        }
        self.put(&name, xml.into_bytes());
        self.register_type(src_part, &name);
        if !rels_xml.is_empty() {
            let rp = rels_path(&name);
            self.put(&rp, rels_xml.into_bytes());
        }
        Ok(name)
    }

    fn dest_notes_master(&self) -> Option<String> {
        rels_of(self.dest, "ppt/presentation.xml").into_iter().find(|r| r.rel_type.ends_with("/notesMaster")).map(|r| resolve("ppt/presentation.xml", &r.target))
    }

    /// A destination layout that looks like the source one, copying layout
    /// and master when the destination has none.
    fn ensure_layout(&mut self, src_layout: &str) -> Result<String, String> {
        if let Some(done) = self.copied.get(src_layout) {
            return Ok(done.clone());
        }
        let key = layout_key(self.src, src_layout);
        if let Some(existing) = self.layouts.get(&key) {
            self.copied.insert(src_layout.to_string(), existing.clone());
            return Ok(existing.clone());
        }
        let src_master = rels_of(self.src, src_layout).into_iter().find(|r| r.rel_type.ends_with("/slideMaster")).map(|r| resolve(src_layout, &r.target)).ok_or("A slide layout has no master.")?;
        let dest_master = self.ensure_master(&src_master)?;
        let layout = self.copy_part(src_layout)?;
        // Layout → its (copied) master.
        let rp = rels_path(&layout);
        let mut rels = self.dest.text(&rp);
        if rels.is_empty() {
            rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.into();
        }
        let src_rel = rels_of(self.src, src_layout).into_iter().find(|r| r.rel_type.ends_with("/slideMaster")).expect("checked above");
        rels = rels.replacen("</Relationships>", &format!(r#"<Relationship Id="{}" Type="{}" Target="{}"/></Relationships>"#, src_rel.id, src_rel.rel_type, relative(&layout, &dest_master)), 1);
        self.put(&rp, rels.into_bytes());
        // Master → layout, with a new unique id in its layout list.
        let master_rels_path = rels_path(&dest_master);
        let mut mrels = self.dest.text(&master_rels_path);
        let new_rid = format!("rIdMena{}", self.dest.parts.len());
        mrels = mrels.replacen("</Relationships>", &format!(r#"<Relationship Id="{new_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="{}"/></Relationships>"#, relative(&dest_master, &layout)), 1);
        self.put(&master_rels_path, mrels.into_bytes());
        let id = self.next_master_or_layout_id();
        let mut mxml = self.dest.text(&dest_master);
        let entry = format!(r#"<p:sldLayoutId id="{id}" r:id="{new_rid}"/>"#);
        if mxml.contains("</p:sldLayoutIdLst>") {
            mxml = mxml.replacen("</p:sldLayoutIdLst>", &format!("{entry}</p:sldLayoutIdLst>"), 1);
        } else {
            mxml = mxml.replacen("</p:cSld>", &format!("</p:cSld><p:sldLayoutIdLst>{entry}</p:sldLayoutIdLst>"), 1);
        }
        self.put(&dest_master, mxml.into_bytes());
        self.layouts.insert(key, layout.clone());
        Ok(layout)
    }

    /// Copies a master with its theme and pictures but none of its layouts.
    fn ensure_master(&mut self, src_master: &str) -> Result<String, String> {
        if let Some(done) = self.copied.get(src_master) {
            return Ok(done.clone());
        }
        static LAYOUT_LIST: OnceLock<Regex> = OnceLock::new();
        let name = free_name(self.dest, src_master, &self.reserved);
        self.reserved.insert(name.clone());
        self.copied.insert(src_master.to_string(), name.clone());
        let xml = self.src.text(src_master);
        let xml = re(r"(?s)<p:sldLayoutIdLst>.*?</p:sldLayoutIdLst>", &LAYOUT_LIST).replace(&xml, "<p:sldLayoutIdLst></p:sldLayoutIdLst>").to_string();
        let mut rels_xml = self.src.text(&rels_path(src_master));
        for rel in rels_of(self.src, src_master) {
            if rel.external {
                continue;
            }
            if rel.rel_type.ends_with("/slideLayout") {
                rels_xml = rels_xml.replacen(&rel.raw, "", 1);
                continue;
            }
            let target = resolve(src_master, &rel.target);
            if !self.src.parts.contains_key(&target) {
                continue;
            }
            let nt = if rel.rel_type.ends_with("/theme") { self.copy_theme(&target)? } else { self.copy_part(&target)? };
            let fixed = rel.raw.replacen(&format!(r#"Target="{}""#, rel.target), &format!(r#"Target="{}""#, relative(&name, &nt)), 1);
            rels_xml = rels_xml.replacen(&rel.raw, &fixed, 1);
        }
        self.put(&name, xml.into_bytes());
        self.register_type(src_master, &name);
        self.put(&rels_path(&name), rels_xml.into_bytes());
        // Register the master in the presentation.
        let pres = "ppt/presentation.xml";
        let rid = format!("rIdMenaM{}", self.dest.parts.len());
        let prels_path = rels_path(pres);
        let prels = self.dest.text(&prels_path).replacen("</Relationships>", &format!(r#"<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="{}"/></Relationships>"#, relative(pres, &name)), 1);
        self.put(&prels_path, prels.into_bytes());
        let id = self.next_master_or_layout_id();
        let pxml = self.dest.text(pres).replacen("</p:sldMasterIdLst>", &format!(r#"<p:sldMasterId id="{id}" r:id="{rid}"/></p:sldMasterIdLst>"#), 1);
        self.put(pres, pxml.into_bytes());
        Ok(name)
    }

    /// Themes are shared when identical; otherwise copied.
    fn copy_theme(&mut self, src_theme: &str) -> Result<String, String> {
        let bytes = self.src.parts.get(src_theme).cloned().unwrap_or_default();
        let h = hash_bytes(&bytes);
        if let Some(existing) = self.dest.parts.iter().find(|(n, b)| n.starts_with("ppt/theme/") && n.ends_with(".xml") && hash_bytes(b) == h).map(|(n, _)| n.clone()) {
            self.copied.insert(src_theme.to_string(), existing.clone());
            return Ok(existing);
        }
        self.copy_part(src_theme)
    }

    /// Master and layout ids share one number space above 2^31.
    fn next_master_or_layout_id(&self) -> u64 {
        static IDS: OnceLock<Regex> = OnceLock::new();
        let mut max: u64 = 2147483648;
        let texts = std::iter::once(self.dest.text("ppt/presentation.xml")).chain(self.dest.parts.keys().filter(|n| n.starts_with("ppt/slideMasters/slideMaster") && n.ends_with(".xml")).map(|n| self.dest.text(n)));
        for t in texts {
            for c in re(r#"<p:(?:sldMasterId|sldLayoutId)\b[^>]*\bid="(\d+)""#, &IDS).captures_iter(&t) {
                if let Ok(v) = c[1].parse::<u64>() {
                    max = max.max(v);
                }
            }
        }
        max + 1
    }
}

/// Copies slides (1-based positions in `src`) into `dest`, inserted so the
/// first lands at 0-based `insert_at` in `dest`'s slide order (clamped to the
/// end). Returns how many slides were added.
pub fn import_slides(dest: &mut Package, src: &Package, positions: &[usize], insert_at: usize) -> Result<usize, String> {
    let src_slides = slide_refs(src);
    let mut importer = Importer::new(dest, src);
    let mut new_parts = Vec::new();
    for &pos in positions {
        let Some(s) = src_slides.get(pos.wrapping_sub(1)) else { continue };
        new_parts.push(importer.copy_part(&s.part)?);
    }
    let dest = importer.dest;
    let pres = "ppt/presentation.xml";
    let existing = slide_refs(dest);
    let mut next_id = existing.iter().filter_map(|s| s.slide_id.parse::<u64>().ok()).max().unwrap_or(255) + 1;
    let anchor = existing.get(insert_at).map(|s| s.element.clone());
    let mut pxml = dest.text(pres);
    let mut prels = dest.text(&rels_path(pres));
    let mut elements = String::new();
    let mut new_ids = Vec::new();
    for (i, part) in new_parts.iter().enumerate() {
        let rid = format!("rIdMenaS{}_{i}", dest.parts.len());
        prels = prels.replacen("</Relationships>", &format!(r#"<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="{}"/></Relationships>"#, relative(pres, part)), 1);
        elements.push_str(&format!(r#"<p:sldId id="{next_id}" r:id="{rid}"/>"#));
        new_ids.push(next_id);
        next_id += 1;
    }
    match anchor {
        Some(a) => pxml = pxml.replacen(&a, &format!("{elements}{a}"), 1),
        None => pxml = pxml.replacen("</p:sldIdLst>", &format!("{elements}</p:sldIdLst>"), 1),
    }
    // Sections (PowerPoint 2010+) list every slide: add the new ones next to their neighbour.
    if pxml.contains("<p14:sectionLst") {
        let neighbour = existing.get(insert_at).or_else(|| existing.last()).map(|s| s.slide_id.clone());
        if let Some(n) = neighbour {
            let ids: String = new_ids.iter().map(|id| format!(r#"<p14:sldId id="{id}"/>"#)).collect();
            let target = format!(r#"<p14:sldId id="{n}"/>"#);
            pxml = if existing.get(insert_at).is_some() { pxml.replacen(&target, &format!("{ids}{target}"), 1) } else { pxml.replacen(&target, &format!("{target}{ids}"), 1) };
        }
    }
    dest.set_text(pres, pxml);
    dest.set_text(&rels_path(pres), prels);
    if dest.parts.contains_key("docProps/app.xml") {
        static SLIDES: OnceLock<Regex> = OnceLock::new();
        let count = slide_refs(dest).len();
        let app = dest.text("docProps/app.xml");
        let app = re(r"<Slides>\d+</Slides>", &SLIDES).replace(&app, format!("<Slides>{count}</Slides>").as_str()).to_string();
        dest.set_text("docProps/app.xml", app);
    }
    Ok(new_parts.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        assert_eq!(relative("ppt/slides/slide3.xml", "ppt/media/image1.png"), "../media/image1.png");
        assert_eq!(relative("ppt/presentation.xml", "ppt/slides/slide3.xml"), "slides/slide3.xml");
        assert_eq!(relative("ppt/slideLayouts/slideLayout2.xml", "ppt/slideMasters/slideMaster1.xml"), "../slideMasters/slideMaster1.xml");
    }
}
