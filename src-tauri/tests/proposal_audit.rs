// Audit: which slides each catalogue service generates, in both designs.
// Opt-in, on copies of the real templates (never files inside the repository):
//   MENA_TEMPLATE_DIR=<Proposals New Logo copy> MENA_MASTER=<master copy> MENA_SERVICES="name|category;name|category" \
//   cargo test --test proposal_audit -- --ignored --nocapture
use menabig_tracker_lib::master::{choose, MasterLine};
use menabig_tracker_lib::pptx::{inspect, Package};
use menabig_tracker_lib::proposal_library::{covered, load_library, modules_for_service, module_name, plan, Role};
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
