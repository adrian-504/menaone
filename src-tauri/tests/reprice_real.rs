// Revise prices against the real templates: a deck revised in place must read exactly like the deck generated
// afresh at the new prices (everything but the prices was the same to begin with), or it must refuse.
// Opt-in, on COPIES (never files inside the repository, never the live database, never OneDrive):
//   MENA_DB_COPY=<copy.sqlite3> MENA_TEMPLATE_DIR=<Proposals New Logo copy> MENA_OUT=<scratch dir> [MENA_MASTER_MODE=1] [MENA_TERM=12:6] [MENA_ONLY=Payroll] [MENA_KEEP_OUTPUT=1] \
//   cargo test --test reprice_real -- --ignored --nocapture
// Prints service names, slide numbers and the app's own messages; never slide text beyond a differing line.
use menabig_tracker_lib::commands::upsert_proposal_rows;
use menabig_tracker_lib::generator::{generate_proposal, revise_prices, GenerateRequest, OutputPolicy, ReviseRequest};
use menabig_tracker_lib::models::{CommercialLine, LineRate, Proposal};
use menabig_tracker_lib::pptx::Package;
use menabig_tracker_lib::pricing::{parse_range, row_kind, Card, RowKind};
use menabig_tracker_lib::proposal_library::modules_for_service;
use std::path::PathBuf;

fn slide_texts(path: &PathBuf) -> Vec<Vec<String>> {
    let pkg = Package::read(path).unwrap();
    let para = regex::Regex::new(r"(?s)<a:p>.*?</a:p>|<a:p\b[^/>]*>.*?</a:p>").unwrap();
    let run = regex::Regex::new(r"(?s)<a:t(?: [^>]*)?>(.*?)</a:t>").unwrap();
    menabig_tracker_lib::pptx::slide_parts_in_order(&pkg).iter().map(|p| {
        para.find_iter(&pkg.text_of(p)).map(|m| run.captures_iter(m.as_str()).map(|c| c[1].to_string()).collect::<String>().trim().to_string()).filter(|t| !t.is_empty()).collect()
    }).collect()
}

#[test]
#[ignore]
fn a_revised_deck_reads_like_one_generated_at_the_new_prices() {
    let (Ok(db), Ok(lib), Ok(out)) = (std::env::var("MENA_DB_COPY"), std::env::var("MENA_TEMPLATE_DIR"), std::env::var("MENA_OUT")) else { return };
    let master_mode = std::env::var("MENA_MASTER_MODE").is_ok();
    // MENA_TERM=12:6 — the term moves (here from 12 to 6 months) together with the prices.
    let term_move: Option<(i64, i64)> = std::env::var("MENA_TERM").ok().and_then(|v| { let (a, b) = v.split_once(':')?; Some((a.parse().ok()?, b.parse().ok()?)) });
    assert!(!db.contains("Application Support"), "use a copy, never the live database");
    let out_dir = PathBuf::from(&out);
    let cloud = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/CloudStorage");
    assert!(!out_dir.starts_with(&cloud) && !PathBuf::from(&lib).starts_with(&cloud), "MENA_OUT and MENA_TEMPLATE_DIR must be scratch folders, not inside OneDrive");
    std::fs::create_dir_all(&out_dir).unwrap();
    let mut conn = menabig_tracker_lib::db::init_connection(&PathBuf::from(&db)).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposals_root', ?1)", [&out]).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposal_library_dir', ?1)", [&lib]).unwrap();
    conn.execute("DELETE FROM app_meta WHERE key = 'proposal_master_path'", []).unwrap();
    let real = menabig_tracker_lib::commercial::detect_proposals_root().map(|r| {
        let mut names: Vec<String> = std::fs::read_dir(&r).map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
        names.sort();
        (r, names)
    });

    let services: Vec<(i64, String, String)> = conn.prepare("SELECT id, name, COALESCE(category, '') FROM services WHERE active = 1 ORDER BY id").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect();
    // Priced rows as the proposal editor starts them from the service's rate card; `step` moves every price.
    let rates_for = |conn: &rusqlite::Connection, service_id: i64, step: f64| -> Vec<LineRate> {
        let pricing: Option<String> = conn.query_row("SELECT r.pricing_json FROM services s JOIN rate_cards r ON r.id = s.rate_card_id WHERE s.id = ?1", [service_id], |r| r.get(0)).ok();
        let Some(card) = pricing.and_then(|p| serde_json::from_str::<serde_json::Value>(&p).ok()).and_then(|v| Card::from_json(&v)) else { return vec![] };
        let price = |i: usize| Some(1100.0 * (i as f64 + 2.0) + step * (i as f64 + 1.0));
        match row_kind(&card) {
            Some(RowKind::Tranche) => card.tranches.iter().take(3).enumerate().map(|(i, tr)| { let r = parse_range(&tr.label); LineRate { label: tr.label.clone(), from: r.map(|x| x.0), to: r.map(|x| x.1), price: price(i), ..Default::default() } }).collect(),
            Some(RowKind::Category) => card.tranches.iter().enumerate().map(|(i, tr)| LineRate { label: tr.label.clone(), price: price(i), ..Default::default() }).collect(),
            Some(RowKind::Row) => card.rows.iter().enumerate().map(|(i, r)| LineRate { label: r.label.clone(), price: price(i), ..Default::default() }).collect(),
            Some(RowKind::Percent) => card.rows.iter().enumerate().map(|(i, r)| LineRate { label: r.label.clone(), percent: Some(10.0 + i as f64 + if step > 0.0 { 2.5 } else { 0.0 }), ..Default::default() }).collect(),
            Some(RowKind::Country) => vec![LineRate { label: "Egypt".into(), price: Some(1500.0 + step), ..Default::default() }],
            _ => vec![],
        }
    };
    let price = |name: &str, step: f64| -> f64 { step + match name { "Recruitment" | "Dedicated Recruiter" => 10.0, "Business Setup" => 55000.0, "Company Liquidation" => 30000.0, "Mobilization" => 1500.0, _ => 4300.0 } };
    let mut sets: Vec<Vec<String>> = services.iter().filter(|(_, n, c)| !modules_for_service(n, Some(c.as_str()).filter(|c| !c.is_empty())).is_empty()).map(|(_, n, _)| vec![n.clone()]).collect();
    for combo in [&["Administration and PRO", "Payroll"][..], &["Business Setup", "Company Maintenance"], &["Employer of Record", "Mobilization"], &["Labour Law Consultancy", "Recruitment"], &["Administration and PRO", "Accountancy", "Recruitment"]] {
        sets.push(combo.iter().map(|s| s.to_string()).collect());
    }
    // Custom lines beside a catalogue service, and on their own (the 2026 design only: the current one starts from a service's template).
    sets.push(vec!["Payroll".into(), "custom:Visa processing|per_visa|1500".into(), "custom:Market study|per_month|4000".into(), "custom:Executive search|percent_of_annual_package|12".into()]);
    sets.push(vec!["custom:Market study|one_time|9000".into(), "custom:On-site HR|per_person_per_month|150".into()]);
    // A deck whose fee slide has no "Project Fees" title box (the GM Representative template): the added slides draw their own titles.
    sets.push(vec!["GM Representative".into(), "custom:Visa processing|per_visa|1500".into()]);
    // A custom line (1.66): "custom:<name>|<unit>|<price>", a service outside the catalogue with a short scope.
    let custom_line = |id: i64, spec: &str, step: f64| -> CommercialLine {
        let mut it = spec.trim_start_matches("custom:").split('|');
        let (name, unit, price) = (it.next().unwrap(), it.next().unwrap(), it.next().unwrap().parse::<f64>().unwrap());
        let price = if unit == "percent_of_annual_package" { price + if step > 0.0 { 2.5 } else { 0.0 } } else { price + step };
        CommercialLine { id, service_name: name.into(), unit: Some(unit.into()), unit_price: Some(price), quantity: 1.0, billing: "monthly".into(), description: Some("First point of the scope\nSecond point of the scope\nThird point".into()), ..Default::default() }
    };
    let lines_at = |conn: &rusqlite::Connection, id: i64, set: &[String], step: f64| -> Vec<CommercialLine> {
        set.iter().enumerate().map(|(k, n)| {
            if n.starts_with("custom:") { return custom_line(id * 10 + k as i64, n, step); }
            let s = services.iter().find(|s| s.1 == *n).expect("service");
            CommercialLine { id: id * 10 + k as i64, service_id: Some(s.0), service_name: n.clone(), billing: if n == "Business Setup" || n == "Company Liquidation" || n == "Mobilization" { "one_time".into() } else { "monthly".into() }, quantity: 1.0, unit_price: Some(price(n, step)), rates: rates_for(conn, s.0, step), ..Default::default() }
        }).collect()
    };
    let mut id = 996000;
    let mut plan: Vec<(i64, String, i64, Vec<String>)> = Vec::new();
    let mut rows = Vec::new();
    for months in match term_move { Some((from, _)) => vec![from], None => vec![12_i64, 6] } {
        for set in &sets {
            id += 1;
            rows.push(Proposal { id, client: format!("Acme Test Co {id}"), status: "Proposal Request Received".into(), currency: Some("SAR".into()), contract_months: Some(months), lines: lines_at(&conn, id, set, 0.0), ..Default::default() });
            plan.push((id, set.join(" + "), months, set.clone()));
        }
    }
    // MENA_ONLY=<part of a set's name> runs those sets alone (with MENA_KEEP_OUTPUT=1, to look at their decks).
    if let Ok(only) = std::env::var("MENA_ONLY") { plan.retain(|p| p.1.contains(&only)); }
    upsert_proposal_rows(&mut conn, &rows).unwrap();
    for p in &rows { menabig_tracker_lib::commercial::save_lines(&conn, "proposal_lines", "proposal_id", p.id, &p.lines).unwrap(); }
    let db = std::sync::Mutex::new(conn);
    let gen = |pid: i64, file: String| GenerateRequest { proposal_id: pid, template_id: 0, date: "2026-09-22".into(), file_name: file, from_library: !master_mode, from_master: master_mode, ..Default::default() };
    let mut written: Vec<PathBuf> = Vec::new();
    let (mut same, mut refused, mut wrong) = (0, 0, Vec::new());
    for (pid, label, months, set) in &plan {
        let v1 = match generate_proposal(&db, &gen(*pid, format!("deck_{pid}_V1.pptx")), OutputPolicy::AnyFolder) {
            Ok(r) if r.errors.is_empty() => r,
            Ok(r) => { println!("{label:<60} {months:>2} mo  not generated: {:?}", r.errors); continue; }
            Err(e) => { println!("{label:<60} {months:>2} mo  not generated: {e}"); continue; }
        };
        let v1_path = PathBuf::from(v1.path.clone().unwrap());
        let v1_bytes = std::fs::read(&v1_path).unwrap();
        written.push(v1_path.clone());
        // The prices move; nothing else does.
        {
            let conn = db.lock().unwrap();
            menabig_tracker_lib::commercial::save_lines(&conn, "proposal_lines", "proposal_id", *pid, &lines_at(&conn, *pid, set, 150.0)).unwrap();
            if let Some((_, to)) = term_move { conn.execute("UPDATE proposals SET contract_months = ?2 WHERE id = ?1", [*pid, to]).unwrap(); }
        }
        let doc = v1.document.as_ref().unwrap().id;
        let revised = revise_prices(&db, &ReviseRequest { proposal_id: *pid, document_id: doc, date: "2026-09-22".into(), file_name: format!("deck_{pid}_V2.pptx"), round: Some("internal".into()), ..Default::default() }, OutputPolicy::AnyFolder).unwrap();
        assert_eq!(std::fs::read(&v1_path).unwrap(), v1_bytes, "{label}: the version it was made from changed");
        if !revised.can_save {
            assert!(revised.path.is_none() && revised.document.is_none(), "{label}: saved a deck it said it could not revise");
            refused += 1;
            println!("{label:<60} {months:>2} mo  refused: {} (terms stated {:?})", revised.reason, revised.report.terms_stated);
            continue;
        }
        let v2_path = PathBuf::from(revised.path.clone().unwrap());
        written.push(v2_path.clone());
        let fresh = generate_proposal(&db, &gen(*pid, format!("deck_{pid}_fresh.pptx")), OutputPolicy::AnyFolder).unwrap();
        let fresh_path = PathBuf::from(fresh.path.clone().unwrap());
        written.push(fresh_path.clone());
        let (a, b) = (slide_texts(&v2_path), slide_texts(&fresh_path));
        let mut diffs: Vec<String> = Vec::new();
        if a.len() != b.len() { diffs.push(format!("{} slides against {}", a.len(), b.len())); }
        for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
            if x == y { continue; }
            if x.len() != y.len() { diffs.push(format!("slide {}: {} paragraphs against {}", i + 1, x.len(), y.len())); continue; }
            for (p, q) in x.iter().zip(y.iter()).filter(|(p, q)| p != q) {
                diffs.push(format!("slide {}: revised \"{}\" / fresh \"{}\"", i + 1, p.chars().take(90).collect::<String>(), q.chars().take(90).collect::<String>()));
            }
        }
        if diffs.is_empty() {
            same += 1;
            println!("{label:<60} {months:>2} mo  same as fresh · {}{}", revised.line, if revised.report.checks.is_empty() { String::new() } else { format!(" · checks: {:?}", revised.report.checks) });
        } else {
            println!("{label:<60} {months:>2} mo  DIFFERS · {} (terms stated {:?})", revised.line, revised.report.terms_stated);
            for d in diffs.iter().take(8) { println!("      {d}"); }
            wrong.push(label.clone());
        }
    }
    for w in &written {
        assert!(w.starts_with(&out), "a deck was written outside MENA_OUT: {}", w.display());
    }
    if let Some((root, before)) = real {
        let mut after: Vec<String> = std::fs::read_dir(&root).map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
        after.sort();
        assert_eq!(before, after, "the real Proposals folder changed");
    }
    if std::env::var("MENA_KEEP_OUTPUT").is_err() {
        for w in &written { if let Some(dir) = w.parent() { let _ = std::fs::remove_dir_all(dir); } }
    }
    println!("\n{} proposals: {same} revised and identical to a fresh deck, {refused} refused, {} differ", plan.len(), wrong.len());
    assert!(wrong.is_empty(), "a revised deck differs from the fresh one: {wrong:?}");
}
