// Opt-in: combines real proposal templates. Point MENA_TEMPLATE_DIR at a
// folder of template copies (never the OneDrive originals):
//   MENA_TEMPLATE_DIR=/tmp/templates cargo test --test pptx_import_real -- --ignored --nocapture
use menabig_tracker_lib::pptx::{inspect, Package};
use menabig_tracker_lib::pptx_import::import_slides;
use std::path::PathBuf;

#[test]
#[ignore]
fn combines_accountancy_with_labor_law() {
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    let dir = PathBuf::from(dir);
    let mut dest = Package::read(&dir.join("Accountancy & VAT Service Proposal Template.pptx")).unwrap();
    let src = Package::read(&dir.join("Labor Law - HR - Manpower Consultancy Services Proposal Template.pptx")).unwrap();
    let before = inspect(&dest).slide_count;
    // Labor Law module: divider, approach, fees (slides 5–7); insert before Accountancy's Terms divider (slide 11).
    let added = import_slides(&mut dest, &src, &[5, 6, 7], 10).unwrap();
    let after = inspect(&dest);
    println!("slides {before} -> {} (added {added})", after.slide_count);
    for s in &after.slides[8..14] { println!("  {} {}", s.index, s.title.chars().take(60).collect::<String>()); }
    let out = dir.join("out");
    std::fs::create_dir_all(&out).unwrap();
    dest.write(&out.join("combined-accountancy-laborlaw.pptx")).unwrap();
    // Workforce terms slides into Admin & PRO, and a module from another master family.
    let mut dest2 = Package::read(&dir.join("Admin & PRO and Payroll & GOSI Services Proposal Template.pptx")).unwrap();
    let src2 = Package::read(&dir.join("Workforce Services Proposal Template.pptx")).unwrap();
    import_slides(&mut dest2, &src2, &[5, 6, 7, 10, 11, 12], 10).unwrap();
    dest2.write(&out.join("combined-admin-workforce.pptx")).unwrap();
    assert_eq!(inspect(&Package::read(&out.join("combined-accountancy-laborlaw.pptx")).unwrap()).slide_count, before + 3);
}

#[test]
#[ignore]
fn classifies_the_template_library() {
    use menabig_tracker_lib::proposal_library::{classify, client_on_cover, cover_services, covered};
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    let mut entries: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().map(|x| x == "pptx").unwrap_or(false)).collect();
    entries.sort();
    for path in entries {
        let pkg = Package::read(&path).unwrap();
        let info = inspect(&pkg);
        let c = classify(&info);
        println!("\n== {} | covers {:?} | client {:?} | title {:?}", path.file_name().unwrap().to_string_lossy(), covered(&c), client_on_cover(&info), cover_services(&info));
        for s in &c {
            println!("  {:>2} {:<15} {:<40} {}", s.index, format!("{:?}", s.role), s.modules.join(","), s.title.chars().take(50).collect::<String>());
        }
    }
}

#[test]
#[ignore]
fn composes_proposals_from_the_library() {
    use menabig_tracker_lib::proposal_library::{compose, load_library};
    use menabig_tracker_lib::smartfill::{apply, SmartInput, SmartLine};
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    let dir = PathBuf::from(dir);
    let library = load_library(&dir).unwrap();
    let out = dir.join("out");
    std::fs::create_dir_all(&out).unwrap();
    let cases: &[(&str, &[&'static str])] = &[
        ("compose-admin", &["admin_pro"]),
        ("compose-gosi", &["gosi_payroll"]),
        ("compose-accountancy-laborlaw", &["accountancy", "labor_law"]),
        ("compose-accountancy-workforce", &["accountancy", "workforce"]),
        ("compose-constitution-maintenance", &["constitution_maintenance"]),
        ("compose-business-setup", &["business_setup"]),
        ("compose-liquidation-admin", &["liquidation", "admin_pro"]),
    ];
    for (name, wanted) in cases {
        let mut c = compose(&library, wanted).unwrap();
        let lines: Vec<SmartLine> = vec![];
        let report = apply(&mut c.package, SmartInput { client_name: "Acme Holdings", date_iso: "2026-09-14", country: Some("Saudi Arabia"), currency: "SAR", lines: &lines, logo: None, contract_months: None, standards: Default::default() });
        println!("\n== {name}: base {} · title \"{}\" · missing {:?} · {} slides", c.base, c.title, c.missing, c.slides.len());
        for (i, s) in c.slides.iter().enumerate() {
            println!("  {:>2} {:?} {:?} ← {} #{} {}", i + 1, s.role, s.modules, s.source.chars().take(24).collect::<String>(), s.source_index, s.title.chars().take(40).collect::<String>());
        }
        println!("  filled: {:?}", report.filled);
        c.package.write(&out.join(format!("{name}.pptx"))).unwrap();
        let text: String = inspect(&Package::read(&out.join(format!("{name}.pptx"))).unwrap()).slides.iter().map(|s| s.text.clone()).collect::<Vec<_>>().join("\n");
        assert!(!text.contains("Al Faya"), "{name}: sent client's name left in");
        assert!(!text.contains("'Client Name'"), "{name}: placeholder left");
    }
}

#[test]
#[ignore]
fn fills_fees_from_the_rate_cards() {
    use menabig_tracker_lib::feefill::Standards;
    use menabig_tracker_lib::generator::smart_line;
    use menabig_tracker_lib::models::{CommercialLine, LineRate};
    use menabig_tracker_lib::pricing::Card;
    use menabig_tracker_lib::proposal_library::{compose, load_library, modules_for_service};
    use menabig_tracker_lib::smartfill::{apply, SmartInput};
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    let dir = PathBuf::from(dir);
    let seed: serde_json::Value = serde_json::from_str(include_str!("../src/catalog_seed.json")).unwrap();
    let card = |name: &str| seed["rateCards"].as_array().unwrap().iter().find(|r| r["name"] == name).and_then(|r| Card::from_json(&r["pricing"]));
    let band = |from: i64, to: i64, price: f64| LineRate { label: String::new(), from: Some(from), to: Some(to), price: Some(price), ..Default::default() };
    let named = |label: &str, price: f64| LineRate { label: label.into(), price: Some(price), ..Default::default() };
    let pct = |label: &str, p: f64| LineRate { label: label.into(), percent: Some(p), ..Default::default() };
    let line = |service: &str, price: Option<f64>, rates: Vec<LineRate>| CommercialLine { service_name: service.into(), unit_price: price, quantity: 1.0, rates, ..Default::default() };
    let library = load_library(&dir).unwrap();
    let standards = Standards { constitution: card("Company Constitution").and_then(|c| c.standard_price()), maintenance: card("Company Maintenance").and_then(|c| c.standard_price()) };
    let cases: Vec<(&str, i64, Vec<(CommercialLine, Option<Card>)>)> = vec![
        ("fees-admin-gosi-recruitment-3m", 3, vec![
            (line("Admin PRO", Some(4625.0), vec![LineRate { label: "25 employees and below".into(), ..band(1, 25, 4625.0) }, band(26, 35, 6075.0), band(36, 50, 7950.0)]), card("Administration & PRO")),
            (line("Payroll and GOSI", Some(1250.0), vec![band(1, 5, 1250.0), band(6, 15, 3000.0), band(16, 25, 3500.0)]), card("GOSI & Payroll")),
            (line("Recruitment", None, vec![pct("Professional Staff", 10.0), pct("Blue Collar Staff", 12.0)]), card("Recruitment")),
        ]),
        ("fees-workforce-accountancy-6m", 6, vec![
            (line("Workforce", None, vec![named("Non-Nationalized (Unskilled)", 1450.0), named("Nationalized (Engineers & Managers)", 3350.0), named("Drivers", 1900.0)]), card("Workforce Services")),
            (line("Accountancy and VAT", Some(2500.0), vec![named("Accountancy (No Projects)", 2500.0), named("Accountancy (Projects)", 5250.0), named("VAT Return – Monthly Preparation & Declaration", 1000.0)]), card("Accountancy & VAT")),
        ]),
        ("fees-business-setup-6m", 6, vec![(line("Business Setup and Maintenance Package", Some(8000.0), vec![]), card("Business Setup & Maintenance Package"))]),
        ("fees-bundle-12m", 12, vec![(line("Company Constitution & Maintenance Package", Some(9000.0), vec![]), card("Company Constitution & Maintenance Package"))]),
        ("fees-mobilization", 12, vec![(CommercialLine { billing: "one_time".into(), ..line("Mobilization", Some(6300.0), vec![named("Kuwait", 3800.0), named("Spain", 2500.0)]) }, card("Mobilization"))]),
        ("fees-gm-representative", 12, vec![(line("GM Representative", Some(6500.0), vec![]), card("GM Representative"))]),
    ];
    for (name, months, lines) in cases {
        let mut wanted: Vec<&'static str> = vec![];
        for (l, _) in &lines {
            for m in modules_for_service(&l.service_name, None) {
                if !wanted.contains(&m) { wanted.push(m); }
            }
        }
        let smart: Vec<_> = lines.iter().map(|(l, c)| menabig_tracker_lib::smartfill::SmartLine { months: (l.billing != "one_time").then_some(months as f64), ..smart_line(l, c.as_ref(), None) }).collect();
        let mut c = compose(&library, &wanted).unwrap();
        let report = apply(&mut c.package, SmartInput { client_name: "Acme Holdings", date_iso: "2026-09-14", country: None, currency: "SAR", lines: &smart, logo: None, contract_months: Some(months), standards: standards.clone() });
        println!("\n== {name}: base {} · {} slides · {}", c.base, c.slides.len(), c.title);
        for f in &report.filled { println!("  filled: {f}"); }
        for f in &report.checks { println!("  CHECK: {f}"); }
        c.package.write(&dir.join("out").join(format!("{name}.pptx"))).unwrap();
    }
}

/// One-off: turns a sent GM Representative proposal into a template (client
/// name back to the placeholder). MENA_GM_SOURCE = the sent deck (a copy),
/// MENA_GM_TARGET = where to write the template; MENA_GM_CLIENT = the client's name in it.
#[test]
#[ignore]
fn makes_the_gm_representative_template() {
    use menabig_tracker_lib::pptx::{fill_placeholders, slide_parts_in_order};
    let (Ok(src), Ok(dst), Ok(client)) = (std::env::var("MENA_GM_SOURCE"), std::env::var("MENA_GM_TARGET"), std::env::var("MENA_GM_CLIENT")) else { return };
    let mut pkg = Package::read(std::path::Path::new(&src)).unwrap();
    let mut pairs = vec![];
    for name in client.split('|') {
        pairs.push((name.to_string(), "'Client Name'".to_string()));
    }
    let mut total = 0;
    for part in slide_parts_in_order(&pkg) {
        let (xml, n) = fill_placeholders(&pkg.text_of(&part), &pairs);
        total += n;
        pkg.set_text(&part, xml);
    }
    // The sent deck's cover carries the client's logo and project photos: use a clean template cover.
    if let Ok(cover_src) = std::env::var("MENA_GM_COVER_FROM") {
        let cover = Package::read(std::path::Path::new(&cover_src)).unwrap();
        menabig_tracker_lib::pptx_import::import_slides(&mut pkg, &cover, &[1], 0).unwrap();
        let count = inspect(&pkg).slide_count;
        let keep: std::collections::BTreeSet<usize> = (1..=count).filter(|i| *i != 2).collect();
        let empty = std::collections::HashMap::new();
        menabig_tracker_lib::pptx::build(&mut pkg, &menabig_tracker_lib::pptx::BuildInput { keep: &keep, values: &empty, lines: &[], replacements: &[] }).unwrap();
        let first = slide_parts_in_order(&pkg)[0].clone();
        let (xml, _) = fill_placeholders(&pkg.text_of(&first), &[("Company Maintenance Services".to_string(), "Temporary GM Services".to_string())]);
        pkg.set_text(&first, xml);
    }
    pkg.write(std::path::Path::new(&dst)).unwrap();
    let text: String = inspect(&Package::read(std::path::Path::new(&dst)).unwrap()).slides.iter().map(|s| s.text.clone()).collect::<Vec<_>>().join("\n");
    println!("replaced {total}; still mentions client: {}", client.split('|').any(|c| text.contains(c)));
}

/// Builds proposals from the 2026 master (MENA_MASTER = the built master deck).
#[test]
#[ignore]
fn builds_proposals_from_the_2026_master() {
    use menabig_tracker_lib::master::{choose, fill, parse, FillInput, MasterLine};
    use menabig_tracker_lib::models::LineRate;
    use menabig_tracker_lib::pricing::RowKind;
    use std::collections::{BTreeSet, HashMap};
    let (Ok(master), Ok(out)) = (std::env::var("MENA_MASTER"), std::env::var("MENA_MASTER_OUT")) else { return };
    let band = |from: i64, to: i64, price: f64| LineRate { from: Some(from), to: Some(to), price: Some(price), ..Default::default() };
    let named = |label: &str, price: f64| LineRate { label: label.into(), price: Some(price), ..Default::default() };
    let line = |service: &str, modules: Vec<&'static str>, kind: Option<RowKind>, rates: Vec<LineRate>, price: Option<f64>| MasterLine { service: service.into(), modules, kind, rates, unit_price: price };
    let cases: Vec<(&str, Option<i64>, Vec<MasterLine>)> = vec![
        ("master-admin-gosi-6m", Some(6), vec![
            line("Admin PRO", vec!["admin_pro"], Some(RowKind::Tranche), vec![band(1, 5, 2000.0), band(6, 15, 3750.0), band(16, 25, 5000.0)], Some(2000.0)),
            line("Payroll and GOSI", vec!["gosi_payroll"], Some(RowKind::Tranche), vec![band(1, 5, 1250.0), band(6, 15, 3000.0)], Some(1250.0)),
        ]),
        ("master-workforce-recruitment-accountancy", None, vec![
            MasterLine { ..line("Workforce", vec!["workforce"], Some(RowKind::Category), vec![named("Professional Nationalized Employee (Engineers & Managers)", 3400.0), named("Professional Non-Nationalized Employee (Unskilled)", 1500.0)], None) },
            line("Accountancy and VAT", vec!["accountancy"], Some(RowKind::Row), vec![named("Accountancy (No Projects)", 2500.0), named("Accountancy (Projects)", 5250.0), named("VAT Return – Monthly Preparation & Declaration", 1000.0)], Some(2500.0)),
            line("Recruitment", vec!["recruitment"], Some(RowKind::Percent), vec![LineRate { label: "Professional Staff".into(), percent: Some(10.0), ..Default::default() }, LineRate { label: "Blue Collar Staff".into(), percent: Some(12.0), ..Default::default() }], None),
        ]),
        ("master-business-setup-6m", Some(6), vec![line("Business Setup and Maintenance Package", vec!["business_setup"], None, vec![], Some(8000.0))]),
        ("master-bundle-mobilization", None, vec![
            line("Company Constitution & Maintenance Package", vec!["constitution_maintenance"], None, vec![], Some(9000.0)),
            line("Mobilization", vec!["mobilization"], Some(RowKind::Country), vec![named("Kuwait", 3800.0), named("Spain", 2500.0)], Some(6300.0)),
        ]),
    ];
    std::fs::create_dir_all(&out).unwrap();
    for (name, months, lines) in cases {
        let mut pkg = Package::read(std::path::Path::new(&master)).unwrap();
        let insp = inspect(&pkg);
        let choices = choose(&insp, &lines, months);
        let keep: BTreeSet<usize> = choices.iter().filter(|c| c.included).map(|c| c.index).collect();
        let empty = HashMap::new();
        menabig_tracker_lib::pptx::build(&mut pkg, &menabig_tracker_lib::pptx::BuildInput { keep: &keep, values: &empty, lines: &[], replacements: &[] }).unwrap();
        let tags: Vec<_> = insp.slides.iter().filter(|s| keep.contains(&s.index)).map(|s| parse(&s.notes)).collect();
        let values: HashMap<String, String> = [("client_name", "Acme Holdings"), ("proposal_date", "14 September 2026"), ("services_title", "Test Services"), ("entity_region", "KSA"), ("client_country_line", "Kingdom of Saudi Arabia")]
            .iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let report = fill(&mut pkg, &tags, &FillInput { values, lines: &lines, months, currency: "SAR", constitution_standard: Some(55000.0), maintenance_standard: Some(7500.0) });
        println!("\n== {name}: {} slides · missing {:?}", keep.len(), report.missing_tokens);
        for c in &report.checks { println!("  CHECK {c}"); }
        pkg.write(&std::path::Path::new(&out).join(format!("{name}.pptx"))).unwrap();
        assert!(report.missing_tokens.is_empty(), "{name}: {:?}", report.missing_tokens);
    }
}
