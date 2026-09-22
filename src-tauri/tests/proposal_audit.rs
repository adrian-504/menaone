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
        // GM Representative carries the Business Setup penalties too: kept while the owner
        // decides whether they belong there (22-Sep-2026). Revisit and drop "GM Representative".
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

// End to end on a COPY of a real database and the real template folder: generates an
// Admin & PRO and a Labour Law proposal (fictional client, 6-month term) into a scratch folder.
//   MENA_DB_COPY=<copy.sqlite3> MENA_TEMPLATE_DIR=<Proposals New Logo> MENA_OUT=<scratch dir> \
//   cargo test --test proposal_audit generates_real -- --ignored --nocapture
#[test]
#[ignore]
fn generates_real_decks_on_a_database_copy() {
    use menabig_tracker_lib::commands::upsert_proposal_rows;
    use menabig_tracker_lib::generator::{generate_proposal, GenerateRequest, OutputPolicy};
    use menabig_tracker_lib::models::{CommercialLine, Proposal};
    let (Ok(db), Ok(lib), Ok(out)) = (std::env::var("MENA_DB_COPY"), std::env::var("MENA_TEMPLATE_DIR"), std::env::var("MENA_OUT")) else { return };
    assert!(!db.contains("Application Support"), "use a copy, never the live database");
    let mut conn = menabig_tracker_lib::db::init_connection(&PathBuf::from(&db)).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposals_root', ?1)", [&out]).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposal_library_dir', ?1)", [&lib]).unwrap();
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
        assert!(r.errors.is_empty());
    }
}
