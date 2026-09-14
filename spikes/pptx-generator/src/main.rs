//! PowerPoint generation spike: keep a chosen set of slides from a template
//! and fill text placeholders, working directly on the .pptx package (zip of
//! OOXML parts). No PowerPoint or Office libraries involved.
//!
//! usage: pptx-spike <in.pptx> <out.pptx> <keep: 1,2,5-9> [TOKEN=VALUE ...]

use regex::Regex;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::io::{Read, Write};

type Parts = BTreeMap<String, Vec<u8>>;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: pptx-spike <in.pptx> <out.pptx> <keep> [TOKEN=VALUE ...]");
        std::process::exit(2);
    }
    let keep = parse_ranges(&args[3]);
    let replacements: Vec<(String, String)> = args[4..]
        .iter()
        .map(|kv| {
            let (k, v) = kv.split_once('=').expect("TOKEN=VALUE");
            (k.to_string(), v.to_string())
        })
        .collect();

    let (order, mut parts) = read_package(&args[1]);
    let report = generate(&mut parts, &keep, &replacements);
    write_package(&args[2], &order, &parts);
    println!("{report}");
}

fn parse_ranges(s: &str) -> BTreeSet<usize> {
    let mut out = BTreeSet::new();
    for piece in s.split(',') {
        if let Some((a, b)) = piece.split_once('-') {
            out.extend(a.parse::<usize>().unwrap()..=b.parse::<usize>().unwrap());
        } else {
            out.insert(piece.parse().unwrap());
        }
    }
    out
}

fn read_package(path: &str) -> (Vec<String>, Parts) {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut order = Vec::new();
    let mut parts = Parts::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).unwrap();
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).unwrap();
        order.push(f.name().to_string());
        parts.insert(f.name().to_string(), buf);
    }
    (order, parts)
}

fn write_package(path: &str, order: &[String], parts: &Parts) {
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    // [Content_Types].xml first, as Office writes it.
    let mut names: Vec<&String> = order.iter().filter(|n| parts.contains_key(*n)).collect();
    names.sort_by_key(|n| *n != "[Content_Types].xml");
    for name in names {
        zip.start_file(name.as_str(), opts).unwrap();
        zip.write_all(&parts[name]).unwrap();
    }
    zip.finish().unwrap();
}

fn text(parts: &Parts, name: &str) -> String {
    String::from_utf8(parts[name].clone()).unwrap()
}

fn rels_path(part: &str) -> String {
    let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
    if dir.is_empty() { format!("_rels/{file}.rels") } else { format!("{dir}/_rels/{file}.rels") }
}

/// Resolves a relationship target relative to the part that owns the rels.
fn resolve(owner: &str, target: &str) -> String {
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

struct Rel { id: String, target: String, external: bool, raw: String }

fn rels_of(parts: &Parts, owner: &str) -> Vec<Rel> {
    let path = rels_path(owner);
    let Some(bytes) = parts.get(&path) else { return Vec::new() };
    let xml = String::from_utf8_lossy(bytes).to_string();
    let re = Regex::new(r"<Relationship\b[^>]*/>").unwrap();
    let attr = |raw: &str, name: &str| Regex::new(&format!(r#"\b{name}="([^"]*)""#)).unwrap().captures(raw).map(|c| c[1].to_string());
    re.find_iter(&xml)
        .map(|m| {
            let raw = m.as_str().to_string();
            Rel {
                id: attr(&raw, "Id").unwrap_or_default(),
                target: attr(&raw, "Target").unwrap_or_default(),
                external: attr(&raw, "TargetMode").as_deref() == Some("External"),
                raw,
            }
        })
        .collect()
}

fn generate(parts: &mut Parts, keep: &BTreeSet<usize>, replacements: &[(String, String)]) -> String {
    let mut log = Vec::new();
    let pres_name = "ppt/presentation.xml";
    let mut pres = text(parts, pres_name);
    let pres_rels = rels_of(parts, pres_name);
    let rel_target: HashMap<String, String> = pres_rels.iter().map(|r| (r.id.clone(), resolve(pres_name, &r.target))).collect();

    // Slide order comes from <p:sldIdLst>.
    let sld_re = Regex::new(r#"<p:sldId\b[^>]*\bid="(\d+)"[^>]*\br:id="(rId\d+)"[^>]*/>"#).unwrap();
    let slides: Vec<(String, String, String)> = sld_re
        .captures_iter(&pres)
        .map(|c| (c[0].to_string(), c[1].to_string(), c[2].to_string()))
        .collect();
    let total = slides.len();
    let mut deleted_parts = BTreeSet::new();
    for (pos, (el, sld_id, rid)) in slides.iter().enumerate() {
        if keep.contains(&(pos + 1)) {
            continue;
        }
        deleted_parts.insert(rel_target[rid].clone());
        pres = pres.replacen(el.as_str(), "", 1);
        // Section lists (PowerPoint 2010+) repeat slide ids.
        pres = pres.replace(&format!(r#"<p14:sldId id="{sld_id}"/>"#), "");
        remove_rel(parts, pres_name, rid);
    }
    parts.insert(pres_name.into(), pres.into_bytes());
    let kept_count = total - deleted_parts.len();
    log.push(format!("slides: {total} -> {kept_count}"));

    // Kept parts that still point at a deleted slide (e.g. an agenda hyperlink
    // jumping to it) would leave a dangling reference: drop those links.
    let all_names: Vec<String> = parts.keys().cloned().collect();
    for owner in all_names.iter().filter(|n| !n.contains("/_rels/") && !deleted_parts.contains(*n)) {
        for rel in rels_of(parts, owner) {
            if !rel.external && deleted_parts.contains(&resolve(owner, &rel.target)) {
                let xml = text(parts, owner);
                let fixed = Regex::new(&format!(r#"<a:hlinkClick\b[^>]*r:id="{}"[^>]*/>"#, rel.id)).unwrap().replace_all(&xml, "").to_string();
                parts.insert(owner.clone(), fixed.into_bytes());
                remove_rel(parts, owner, &rel.id);
                log.push(format!("dropped link {owner} -> {}", rel.target));
            }
        }
    }

    // Garbage-collect every part no longer reachable from the package root
    // (the deleted slides plus their notes, comments, and media only they used).
    let mut reachable = BTreeSet::new();
    let mut queue: VecDeque<String> = VecDeque::from(["".to_string()]);
    while let Some(owner) = queue.pop_front() {
        let rels = if owner.is_empty() { rels_of(parts, "") } else { rels_of(parts, &owner) };
        for rel in rels.iter().filter(|r| !r.external) {
            let target = if owner.is_empty() { rel.target.trim_start_matches('/').to_string() } else { resolve(&owner, &rel.target) };
            if deleted_parts.contains(&target) {
                continue;
            }
            if reachable.insert(target.clone()) {
                queue.push_back(target);
            }
        }
    }
    let before = parts.len();
    let droppable: Vec<String> = parts
        .keys()
        .filter(|n| *n != "[Content_Types].xml" && !n.ends_with(".rels") && !reachable.contains(*n))
        .cloned()
        .collect();
    for n in &droppable {
        parts.remove(n);
        parts.remove(&rels_path(n));
    }
    log.push(format!("parts removed: {} (of {before})", before - parts.len()));

    // Content types: drop overrides for removed parts.
    let ct = text(parts, "[Content_Types].xml");
    let ct = Regex::new(r#"<Override PartName="/([^"]+)"[^>]*/>"#)
        .unwrap()
        .replace_all(&ct, |c: &regex::Captures| if parts.contains_key(&c[1]) { c[0].to_string() } else { String::new() })
        .to_string();
    parts.insert("[Content_Types].xml".into(), ct.into_bytes());

    if let Some(app) = parts.get("docProps/app.xml").map(|b| String::from_utf8_lossy(b).to_string()) {
        let app = Regex::new(r"<Slides>\d+</Slides>").unwrap().replace(&app, format!("<Slides>{kept_count}</Slides>").as_str()).to_string();
        parts.insert("docProps/app.xml".into(), app.into_bytes());
    }

    // Placeholders, including ones PowerPoint split across several runs.
    let slide_names: Vec<String> = parts.keys().filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml")).cloned().collect();
    let mut filled = 0;
    for name in slide_names {
        let (xml, n) = fill_placeholders(&text(parts, &name), replacements);
        filled += n;
        parts.insert(name, xml.into_bytes());
    }
    log.push(format!("placeholders filled: {filled}"));
    log.join("\n")
}

fn remove_rel(parts: &mut Parts, owner: &str, id: &str) {
    let path = rels_path(owner);
    let xml = text(parts, &path);
    let rel = rels_of(parts, owner).into_iter().find(|r| r.id == id).unwrap();
    parts.insert(path, xml.replacen(&rel.raw, "", 1).into_bytes());
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Replaces tokens paragraph by paragraph. A token split over several runs
/// ("'Client", " Name'") is written into its first run — which keeps that run's
/// formatting — and removed from the rest.
fn fill_placeholders(xml: &str, replacements: &[(String, String)]) -> (String, usize) {
    let para_re = Regex::new(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/]*?>.*?</a:p>").unwrap();
    let t_re = Regex::new(r"(?s)(<a:t>|<a:t [^>]*>)(.*?)</a:t>").unwrap();
    let mut count = 0;
    let out = para_re.replace_all(xml, |pc: &regex::Captures| {
        let para = pc[0].to_string();
        let spans: Vec<(usize, usize, String)> = t_re
            .captures_iter(&para)
            .map(|c| { let m = c.get(2).unwrap(); (m.start(), m.end(), unescape(m.as_str())) })
            .collect();
        let mut texts: Vec<String> = spans.iter().map(|s| s.2.clone()).collect();
        for (token, value) in replacements {
            loop {
                let joined: String = texts.concat();
                let Some(start) = joined.find(token.as_str()) else { break };
                let end = start + token.len();
                let (mut offset, mut first, mut last) = (0, None, None);
                let mut local = (0, 0);
                for (i, t) in texts.iter().enumerate() {
                    let (s, e) = (offset, offset + t.len());
                    if first.is_none() && start >= s && start < e { first = Some(i); local.0 = start - s; }
                    if end > s && end <= e { last = Some(i); local.1 = end - s; }
                    offset = e;
                }
                let (Some(f), Some(l)) = (first, last) else { break };
                let tail = texts[l][local.1..].to_string();
                let head = texts[f][..local.0].to_string();
                for t in texts.iter_mut().take(l + 1).skip(f) { t.clear(); }
                texts[f] = format!("{head}{value}{tail}");
                count += 1;
            }
        }
        let mut rebuilt = para.clone();
        for (i, (s, e, original)) in spans.iter().enumerate().rev() {
            if texts[i] != *original {
                rebuilt.replace_range(*s..*e, &escape(&texts[i]));
            }
        }
        rebuilt
    });
    (out.to_string(), count)
}
