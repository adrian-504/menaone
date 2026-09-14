// Runs the deck engine on real templates. Opt-in, and never on files inside
// the repository: point MENA_TEMPLATE_DIR at a folder of template copies.
//   MENA_TEMPLATE_DIR=/tmp/templates cargo test --test pptx_real_templates -- --ignored --nocapture
use menabig_tracker_lib::pptx::{build_with_smart_fields, inspect, BuildInput, Package};
use menabig_tracker_lib::smartfill::{read_logo, SmartInput, SmartLine};
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

#[test]
#[ignore]
fn builds_decks_from_real_templates() {
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    let dir = PathBuf::from(dir);
    let out_dir = dir.join("out");
    std::fs::create_dir_all(&out_dir).unwrap();
    let logo = concat!(env!("CARGO_MANIFEST_DIR"), "/icons/icon.png");
    for entry in std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("pptx") { continue; }
        let info = inspect(&Package::read(&path).unwrap());
        println!("\n{} — {} slides", path.file_name().unwrap().to_string_lossy(), info.slide_count);
        for s in info.slides.iter().filter(|s| !s.smart_fields.is_empty()) {
            println!("  {:>2} {} → {:?}", s.index, s.title.chars().take(40).collect::<String>(), s.smart_fields);
        }
        // Drop the second slide of each template to exercise agenda recounting.
        let keep: BTreeSet<usize> = (1..=info.slide_count).filter(|i| *i != 6).collect();
        let lines = vec![
            SmartLine { service: "Workforce".into(), description: Some("Engineers & Managers".into()), unit_price: Some(3350.0), ..Default::default() },
            SmartLine { service: "Recruitment".into(), description: Some("Professional Staff Only".into()), unit_price: Some(12.0), ..Default::default() },
        ];
        let smart = SmartInput { client_name: "Acme Test Co (شركة أكمي للاختبار)", date_iso: "2026-09-14", country: Some("United Arab Emirates"), currency: "SAR", lines: &lines, logo: Some(read_logo(std::path::Path::new(logo)).unwrap()), contract_months: None, standards: Default::default() };
        let mut pkg = Package::read(&path).unwrap();
        let report = build_with_smart_fields(&mut pkg, &BuildInput { keep: &keep, values: &HashMap::new(), lines: &[], replacements: &[] }, Some(smart)).unwrap();
        let out = out_dir.join(path.file_name().unwrap());
        pkg.write(&out).unwrap();
        let smart = report.smart.unwrap();
        println!("  filled: {:?}", smart.filled);
        println!("  warnings: {:?}", smart.warnings);
        println!("  fees to check: {}", smart.fees_to_check.len());
        for f in smart.fees_to_check.iter().take(6) { println!("    {f}"); }
        assert_eq!(inspect(&Package::read(&out).unwrap()).slide_count, keep.len());
    }
}
