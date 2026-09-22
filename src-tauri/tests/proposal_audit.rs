// Audit: which slides each catalogue service generates, in both designs.
// Opt-in, on copies of the real templates (never files inside the repository):
//   MENA_TEMPLATE_DIR=<Proposals New Logo copy> MENA_MASTER=<master copy> MENA_SERVICES="name|category;name|category" \
//   cargo test --test proposal_audit -- --ignored --nocapture
use menabig_tracker_lib::master::{choose, MasterLine};
use menabig_tracker_lib::pptx::{inspect, Package};
use menabig_tracker_lib::proposal_library::{classify, covered, load_library, modules_for_service, module_name, modules_in, plan, Role};
use std::path::PathBuf;

#[test]
#[ignore]
fn prints_the_slides_each_service_generates() {
    let (Ok(dir), Ok(services)) = (std::env::var("MENA_TEMPLATE_DIR"), std::env::var("MENA_SERVICES")) else { return };
    let library = load_library(&PathBuf::from(&dir)).unwrap();
    let master = std::env::var("MENA_MASTER").ok().map(|m| inspect(&Package::read(&PathBuf::from(m)).unwrap()));
    for entry in services.split(';').filter(|s| !s.trim().is_empty()) {
        let (name, category) = entry.split_once('|').unwrap_or((entry, ""));
        let modules = modules_for_service(name, Some(category).filter(|c| !c.is_empty()));
        println!("\n### {name} [{category}] → modules {:?}", modules.iter().map(|m| module_name(m)).collect::<Vec<_>>());
        if modules.is_empty() { println!("  NO MODULE — nothing generated"); continue; }
        let p = plan(&library, &modules).unwrap();
        let base = &library[p.base];
        println!("  current design — base: {}", base.name);
        for s in base.slides.iter().filter(|s| p.keep.contains(&s.index) && s.is_module()) {
            println!("    {:>2} {:?} {:?} {}", s.index, s.role, s.modules, s.title.chars().take(60).collect::<String>());
        }
        for i in &p.imports {
            let t = &library[i.template];
            println!("    + from {} ({}): {:?}", t.name, if i.terms { "terms" } else { "slides" }, i.positions.iter().map(|x| t.slides.iter().find(|s| s.index == *x).map(|s| format!("{} {}", x, s.title.chars().take(40).collect::<String>())).unwrap_or_default()).collect::<Vec<_>>());
        }
        if !p.missing.is_empty() { println!("    MISSING: {:?}", p.missing); }
        if let Some(m) = &master {
            let lines = vec![MasterLine { service: name.into(), modules: modules.clone(), with_recruitment: true, ..Default::default() }];
            let chosen: Vec<String> = choose(m, &lines, Some(12)).into_iter().filter(|c| c.included && c.module.is_some())
                .map(|c| format!("{} {}", c.index, m.slides[c.index - 1].title.chars().take(40).collect::<String>())).collect();
            println!("  2026 design — {} service slides: {:?}", chosen.len(), chosen);
        }
    }
}

#[test]
#[ignore]
fn prints_how_each_template_is_read() {
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    let only = std::env::var("MENA_ONLY").unwrap_or_default();
    for t in load_library(&PathBuf::from(&dir)).unwrap() {
        if !only.is_empty() && !only.split(';').any(|o| t.name.contains(o)) { continue; }
        println!("\n### {} (client on cover: {:?})", t.name, t.client_on_cover);
        for s in &t.slides { println!("  {:>2} {:?} {:?} {}", s.index, s.role, s.modules, s.title.chars().take(70).collect::<String>()); }
    }
}

// The renamed Workforce categories still receive their prices on the updated template.
//   MENA_WORKFORCE_TEMPLATE=<copy of the Workforce template> cargo test --test proposal_audit fills -- --ignored --nocapture
#[test]
#[ignore]
fn fills_workforce_prices_under_the_new_category_names() {
    use menabig_tracker_lib::models::LineRate;
    use menabig_tracker_lib::pptx::{build_with_smart_fields, BuildInput};
    use menabig_tracker_lib::pricing::RowKind;
    use menabig_tracker_lib::smartfill::{SmartInput, SmartLine};
    use std::collections::{BTreeSet, HashMap};
    let Ok(path) = std::env::var("MENA_WORKFORCE_TEMPLATE") else { return };
    let labels: Vec<String> = menabig_tracker_lib::db::WORKFORCE_CATEGORY_RENAMES.iter().map(|(_, n)| n.to_string()).collect();
    let rate = |l: &str, p: f64| LineRate { label: l.into(), price: Some(p), ..Default::default() };
    let lines = vec![SmartLine {
        service: "Employer of Record".into(), modules: vec!["workforce"], kind: Some(RowKind::Category),
        rates: vec![rate(&labels[1], 3111.0), rate(&labels[2], 2222.0), rate(&labels[0], 1333.0)],
        preset_labels: labels.clone(), ..Default::default()
    }];
    let mut pkg = Package::read(&PathBuf::from(&path)).unwrap();
    let n = inspect(&pkg).slide_count;
    let keep: BTreeSet<usize> = (1..=n).collect();
    let smart = SmartInput { client_name: "Acme Test Co", date_iso: "2026-09-22", country: None, currency: "SAR", lines: &lines, logo: None, contract_months: None, standards: Default::default() };
    let report = build_with_smart_fields(&mut pkg, &BuildInput { keep: &keep, values: &HashMap::new(), lines: &[], replacements: &[] }, Some(smart)).unwrap().smart.unwrap();
    println!("filled: {:?}\nwarnings: {:?}", report.filled, report.warnings);
    // Tables aren't in the inspected text: check the written file's XML.
    let out = std::env::temp_dir().join("menabig_wf_fill_check.pptx");
    pkg.write(&out).unwrap();
    println!("written: {}", out.display());
    assert!(report.filled.iter().any(|f| f.contains("3 categories")), "categories not filled: {:?}", report.filled);
}

// Every service a template covers keeps at least one terms slide when proposed on its own
// (a service-specific terms slide naming the wrong service drops the deck's only terms).
//   MENA_TEMPLATE_DIR=<copy of the templates> cargo test --test proposal_audit keeps_terms -- --ignored --nocapture
#[test]
#[ignore]
fn keeps_terms_for_every_service() {
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    let library = load_library(&PathBuf::from(&dir)).unwrap();
    let mut failures = Vec::new();
    let modules: std::collections::BTreeSet<&'static str> = library.iter().flat_map(|t| covered(&t.slides)).collect();
    for m in modules {
        let p = plan(&library, &[m]).unwrap();
        let base = &library[p.base];
        let kept = base.slides.iter().filter(|s| p.keep.contains(&s.index) && s.role == Role::Terms).count();
        let imported: usize = p.imports.iter().filter(|i| i.terms).map(|i| i.positions.len()).sum();
        println!("{:<38} base {:<60} terms kept {kept} + imported {imported}", module_name(m), base.name);
        if kept + imported == 0 { failures.push(module_name(m)); }
    }
    assert!(failures.is_empty(), "no terms slide for: {failures:?}");
}

// Terms written for one service don't sit in another service's deck (clauses copied
// between decks by mistake: Business Setup penalties in GM Representative, etc.).
//   MENA_TEMPLATE_DIR=<copy of the templates> cargo test --test proposal_audit terms_stay -- --ignored --nocapture
#[test]
#[ignore]
fn terms_stay_in_their_own_deck() {
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    // Phrase → the decks (file name fragments) allowed to carry it in their terms.
    let only_in: &[(&str, &[&str])] = &[
        ("saudization", &["Labor Law", "Workforce", "All Services"]),
        // Owner decision 22-Sep-2026: GM Representative carries the Business Setup penalties.
        ("constitution of the ksa entity", &["Company Constitution", "Business_Setup_Package", "GM Representative"]),
        ("15,000 sar", &["Company Constitution", "Business_Setup_Package", "GM Representative"]),
        ("40,000 sar", &["Company Constitution", "Business_Setup_Package", "GM Representative"]),
        ("probation", &["Recruitment", "Workforce", "Labor Law"]),
        ("replace the candidate", &["Recruitment", "Workforce"]),
    ];
    let never_candidate = ["Company Maintenance", "Accountancy", "GM Representative", "Liquidation", "Mobilization"];
    let mut problems = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.ends_with(".pptx") || name.starts_with("~$") { continue; }
        let pkg = Package::read(&path).unwrap();
        let info = inspect(&pkg);
        let parts = menabig_tracker_lib::pptx::slide_parts_in_order(&pkg);
        let slides = classify(&info);
        let own = covered(&slides);
        let tag = regex::Regex::new(r"<a:t>([^<]*)</a:t>|</a:p>").unwrap();
        for s in slides.iter().filter(|s| s.role == Role::Terms) {
            // The whole slide, not the inspection's first 400 characters.
            let xml = pkg.text_of(&parts[s.index - 1]);
            let text: String = tag.captures_iter(&xml).map(|c| c.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| "\n".into())).collect::<String>()
                .replace("&amp;", "&").to_lowercase();
            for (phrase, allowed) in only_in {
                if text.contains(phrase) && !allowed.iter().any(|a| name.contains(a)) {
                    problems.push(format!("{name} slide {}: \"{phrase}\" belongs to {allowed:?}", s.index));
                }
            }
            if text.contains("candidate") && never_candidate.iter().any(|d| name.contains(d)) {
                problems.push(format!("{name} slide {}: mentions a candidate", s.index));
            }
            // The subtitle names the service the terms are for: it must be one this deck carries.
            let subtitle = text.lines().find(|l| l.trim_start().starts_with("assumptions and limitations")).unwrap_or("");
            for m in modules_in(subtitle) {
                // A package deck's setup terms say "Business Setup Services": the package includes the setup.
                let in_package = m == "constitution" && own.contains("business_setup");
                if !own.contains(m) && !in_package { problems.push(format!("{name} slide {}: terms for {} in a deck without it", s.index, module_name(m))); }
            }
        }
    }
    for p in &problems { println!("{p}"); }
    assert!(problems.is_empty(), "{} terms problems", problems.len());
}

/// Opens a database COPY for end-to-end generation with every path the app derives from
/// app_meta pointed at scratch: the proposals root (created first — a missing folder makes the
/// app fall back to the real OneDrive Proposals folder) and the template library. Returns the
/// connection and a snapshot of the real Proposals folder, to prove afterwards it was not touched.
fn scratch_generation(db: &str, lib: &str, out: &str) -> (rusqlite::Connection, Option<(PathBuf, Vec<String>)>) {
    assert!(!db.contains("Application Support"), "use a copy, never the live database");
    let out_dir = PathBuf::from(out);
    let cloud = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/CloudStorage");
    assert!(!out_dir.starts_with(&cloud), "MENA_OUT must be a scratch folder, not inside OneDrive");
    std::fs::create_dir_all(&out_dir).unwrap();
    let conn = menabig_tracker_lib::db::init_connection(&PathBuf::from(db)).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposals_root', ?1)", [out]).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposal_library_dir', ?1)", [lib]).unwrap();
    let real = menabig_tracker_lib::commercial::detect_proposals_root().map(|r| {
        let mut names: Vec<String> = std::fs::read_dir(&r).map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
        names.sort();
        (r, names)
    });
    (conn, real)
}

/// The real Proposals folder is as it was, and the test's own decks are removed.
fn finish_scratch_generation(real: Option<(PathBuf, Vec<String>)>, out: &str, written: &[PathBuf]) {
    for w in written {
        assert!(w.starts_with(out), "a deck was written outside MENA_OUT: {}", w.display());
    }
    if let Some((root, before)) = real {
        let mut after: Vec<String> = std::fs::read_dir(&root).map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
        after.sort();
        assert_eq!(before, after, "the real Proposals folder changed");
    }
    // MENA_KEEP_OUTPUT=1 leaves the decks in MENA_OUT (scratch) to look at.
    if std::env::var("MENA_KEEP_OUTPUT").is_err() {
        for w in written {
            if let Some(dir) = w.parent() { let _ = std::fs::remove_dir_all(dir); }
        }
    }
}

// End to end on a COPY of a real database and the real template folder: generates an
// Admin & PRO and a Labour Law proposal (fictional client, 6-month term) into a scratch folder.
//   MENA_DB_COPY=<copy.sqlite3> MENA_TEMPLATE_DIR=<Proposals New Logo> MENA_OUT=<scratch dir, created if missing> \
//   cargo test --test proposal_audit generates_real -- --ignored --nocapture
#[test]
#[ignore]
fn generates_real_decks_on_a_database_copy() {
    use menabig_tracker_lib::commands::upsert_proposal_rows;
    use menabig_tracker_lib::generator::{generate_proposal, GenerateRequest, OutputPolicy};
    use menabig_tracker_lib::models::{CommercialLine, Proposal};
    let (Ok(db), Ok(lib), Ok(out)) = (std::env::var("MENA_DB_COPY"), std::env::var("MENA_TEMPLATE_DIR"), std::env::var("MENA_OUT")) else { return };
    let (mut conn, real) = scratch_generation(&db, &lib, &out);
    let mut written = Vec::new();
    let service = |name: &str| -> i64 { conn.query_row("SELECT id FROM services WHERE name = ?1", [name], |r| r.get(0)).unwrap() };
    let cases = [(990001_i64, "Administration and PRO", 4000.0), (990002, "Labour Law Consultancy", 7000.0)];
    let rows: Vec<Proposal> = cases.iter().map(|(id, name, price)| Proposal {
        id: *id, client: "Acme Test Co".into(), status: "Drafting".into(), currency: Some("SAR".into()), contract_months: Some(6),
        lines: vec![CommercialLine { id: *id, service_id: Some(service(name)), service_name: (*name).into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(*price), ..Default::default() }],
        ..Default::default()
    }).collect();
    upsert_proposal_rows(&mut conn, &rows).unwrap();
    for p in &rows { menabig_tracker_lib::commercial::save_lines(&conn, "proposal_lines", "proposal_id", p.id, &p.lines).unwrap(); }
    let db = std::sync::Mutex::new(conn);
    for (id, name, _) in cases {
        let req = GenerateRequest { proposal_id: id, template_id: 0, date: "2026-09-22".into(), file_name: format!("Acme Test Co_{name}_check.pptx"), keep: None, logo_path: None, dry_run: false, from_library: true, from_master: false };
        let r = generate_proposal(&db, &req, OutputPolicy::AnyFolder).unwrap();
        println!("\n{name}: {:?}\n  errors {:?}\n  warnings {:?}", r.path, r.errors, r.warnings);
        written.extend(r.path.clone().map(PathBuf::from));
        assert!(r.errors.is_empty());
    }
    finish_scratch_generation(real, &out, &written);
}

// A mixed proposal (Admin & PRO + Payroll + Labour Law) and an EOR proposal, generated on a
// DATABASE COPY with the real templates: terms once, one acceptance, dividers and agenda in
// deck order, no recruitment-only slides for EOR, and the proposal moves to Drafting.
//   MENA_DB_COPY=<copy.sqlite3> MENA_TEMPLATE_DIR=<Proposals New Logo> MENA_OUT=<scratch dir> [MENA_MASTER_MODE=1] \
//   cargo test --test proposal_audit mixed_proposal -- --ignored --nocapture
#[test]
#[ignore]
fn mixed_proposal_is_consistent() {
    use menabig_tracker_lib::commands::upsert_proposal_rows;
    use menabig_tracker_lib::generator::{generate_proposal, GenerateRequest, OutputPolicy};
    use menabig_tracker_lib::models::{CommercialLine, Proposal};
    let (Ok(db), Ok(lib), Ok(out)) = (std::env::var("MENA_DB_COPY"), std::env::var("MENA_TEMPLATE_DIR"), std::env::var("MENA_OUT")) else { return };
    let master_mode = std::env::var("MENA_MASTER_MODE").is_ok();
    let (mut conn, real) = scratch_generation(&db, &lib, &out);
    let mut written: Vec<PathBuf> = Vec::new();
    let service = |name: &str| -> i64 { conn.query_row("SELECT id FROM services WHERE name = ?1", [name], |r| r.get(0)).unwrap() };
    let line = |id: i64, name: &str, price: f64| CommercialLine { id, service_id: Some(service(name)), service_name: name.into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(price), ..Default::default() };
    let cases: Vec<(i64, &str, Vec<CommercialLine>)> = vec![
        (990011, "mixed", vec![line(990011, "Administration and PRO", 4000.0), line(990012, "Payroll", 1500.0), line(990013, "Labour Law Consultancy", 7000.0)]),
        (990021, "eor", vec![line(990021, "Employer of Record", 3550.0)]),
        (990031, "mixed2", vec![line(990031, "Administration and PRO", 4000.0), line(990032, "Accountancy", 5000.0), line(990033, "Recruitment", 10.0)]),
        (990041, "reversed", vec![line(990041, "Recruitment", 10.0), line(990042, "Administration and PRO", 4000.0)]),
    ];
    let rows: Vec<Proposal> = cases.iter().map(|(id, _, lines)| Proposal { id: *id, client: "Acme Test Co".into(), status: "Proposal Request Received".into(), currency: Some("SAR".into()), lines: lines.clone(), ..Default::default() }).collect();
    upsert_proposal_rows(&mut conn, &rows).unwrap();
    for p in &rows { menabig_tracker_lib::commercial::save_lines(&conn, "proposal_lines", "proposal_id", p.id, &p.lines).unwrap(); }
    let db = std::sync::Mutex::new(conn);
    let mut problems = Vec::new();
    for (id, tag, _) in &cases {
        let req = GenerateRequest { proposal_id: *id, template_id: 0, date: "2026-09-22".into(), file_name: format!("Acme Test Co_{tag}_check.pptx"), keep: None, logo_path: None, dry_run: false, from_library: !master_mode, from_master: master_mode };
        let r = generate_proposal(&db, &req, OutputPolicy::AnyFolder).unwrap();
        assert!(r.errors.is_empty(), "{tag}: {:?}", r.errors);
        let path = PathBuf::from(r.path.clone().unwrap());
        written.push(path.clone());
        let pkg = Package::read(&path).unwrap();
        let parts = menabig_tracker_lib::pptx::slide_parts_in_order(&pkg);
        let para = regex::Regex::new(r"(?s)<a:p>.*?</a:p>").unwrap();
        let run = regex::Regex::new(r"<a:t>([^<]*)</a:t>").unwrap();
        let slides: Vec<Vec<String>> = parts.iter().map(|p| {
            let xml = pkg.text_of(p);
            para.find_iter(&xml).map(|m| run.captures_iter(m.as_str()).map(|c| c[1].to_string()).collect::<String>().replace("&amp;", "&").trim().to_string()).filter(|t| !t.is_empty()).collect()
        }).collect();
        println!("\n### {tag} ({} slides)", slides.len());
        for (i, s) in slides.iter().enumerate() { println!("  {:>2} {}", i + 1, s.iter().take(4).cloned().collect::<Vec<_>>().join(" | ").chars().take(110).collect::<String>()); }
        let is_terms = |s: &Vec<String>| s.iter().any(|p| p.starts_with("Assumptions and Limitations") || p.starts_with("The stated scope of work"));
        // One general block: no clause paragraph repeated across terms slides.
        let mut seen = std::collections::HashMap::new();
        for (i, s) in slides.iter().enumerate().filter(|(_, s)| is_terms(s)) {
            // The slide heading and service subtitle repeat on each terms slide by design.
            for p in s.iter().filter(|p| p.len() > 60 && !p.starts_with("Assumptions and Limitations") && !p.starts_with("Terms & Conditions")) {
                if let Some(first) = seen.insert(p.to_lowercase(), i + 1) { problems.push(format!("{tag}: slide {} repeats slide {first}: {}", i + 1, p.chars().take(70).collect::<String>())); }
            }
        }
        let acceptance = slides.iter().filter(|s| s.iter().any(|p| p.starts_with("We believe that this proposal"))).count();
        if acceptance != 1 { problems.push(format!("{tag}: {acceptance} acceptance slides")); }
        // Service dividers ("… PART n") numbered 1..n in deck order.
        let parts_n: Vec<String> = slides.iter().filter(|s| s.len() <= 7 && s.iter().any(|p| p == "PART")).filter_map(|s| s.iter().rev().find(|p| p.chars().all(|c| c.is_ascii_digit())).cloned()).collect();
        let expected: Vec<String> = (1..=parts_n.len()).map(|n| n.to_string()).collect();
        println!("  PART numbers {parts_n:?}");
        if parts_n != expected { problems.push(format!("{tag}: PART numbers {parts_n:?}")); }
        // Agenda numbers equal the slide each section starts on ("04" or "p. 04" beside each title).
        if let Some(agenda) = slides.iter().find(|s| s.iter().any(|p| p.eq_ignore_ascii_case("agenda"))) {
            let page = |p: &str| -> Option<usize> { p.trim().trim_start_matches("p.").trim().parse().ok().filter(|_| p.trim().starts_with("p.")) };
            let pairs: Vec<(String, usize)> = if agenda.iter().any(|p| page(p).is_some()) {
                agenda.windows(2).filter_map(|w| page(&w[1]).map(|n| (w[0].clone(), n))).collect()
            } else {
                let labels: Vec<&String> = agenda.iter().filter(|p| !p.eq_ignore_ascii_case("agenda") && !p.chars().all(|c| c.is_ascii_digit())).collect();
                let numbers: Vec<usize> = agenda.iter().filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())).map(|p| p.parse().unwrap()).collect();
                labels.into_iter().cloned().zip(numbers).collect()
            };
            for (label, n) in pairs {
                let start = slides.iter().position(|s| s.len() <= 3 && s.iter().any(|f| f.eq_ignore_ascii_case(&label))).map(|i| i + 1);
                println!("  agenda {label} → {n} (starts at {start:?})");
                if start != Some(n) { problems.push(format!("{tag}: agenda '{label}' says {n}, section starts at {start:?}")); }
            }
        }
        // Service sections follow the proposal's lines (first line first).
        let expected: &[&str] = match *tag { "mixed" => &["admin", "labor"], "mixed2" => &["admin", "accountancy", "recruitment"], "reversed" => &["recruitment", "admin"], _ => &[] };
        let dividers: Vec<String> = slides.iter().filter_map(|s| {
            if s.first().map(|f| f == "Service").unwrap_or(false) { s.get(1).map(|x| x.to_lowercase()) }
            else if s.len() <= 7 && s.iter().any(|p| p == "PART") { s.first().map(|x| x.to_lowercase()) }
            else { None }
        }).collect();
        let firsts: Vec<Option<usize>> = expected.iter().map(|k| dividers.iter().position(|d| d.contains(k))).collect();
        println!("  section order {dividers:?}");
        if firsts.iter().any(|f| f.is_none()) || firsts.windows(2).any(|w| w[0] >= w[1]) { problems.push(format!("{tag}: sections {dividers:?} not in line order {expected:?}")); }
        if *tag == "eor" && slides.iter().flatten().any(|p| p.to_lowercase().contains("only if recruitment required")) { problems.push("eor: recruitment-only slide present".into()); }
        let status: String = db.lock().unwrap().query_row("SELECT status FROM proposals WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        println!("  status {status}");
        if status != "Drafting" { problems.push(format!("{tag}: status {status}")); }
    }
    for p in &problems { println!("PROBLEM {p}"); }
    finish_scratch_generation(real, &out, &written);
    assert!(problems.is_empty(), "{} problems", problems.len());
}
