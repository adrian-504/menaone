// The check before sending, against the team's real templates (a template is
// a deck nobody has filled in, so it should fail on highlights or placeholders
// and find the cover, letter and agenda). Opt-in, on a COPY of the folder:
//   MENA_TEMPLATE_DIR=/scratch/templates cargo test --test send_check_real -- --ignored --nocapture
// Prints file names, statuses and slide numbers; never slide text. Reads only.
use menabig_tracker_lib::sendcheck::check_file;

#[test]
#[ignore]
fn the_check_reads_every_real_template() {
    let Ok(dir) = std::env::var("MENA_TEMPLATE_DIR") else { return };
    assert!(!dir.contains("/CloudStorage/"), "use a scratch copy of the templates folder");
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "pptx").unwrap_or(false) && !p.file_name().unwrap().to_string_lossy().starts_with("~$")).collect();
    files.sort();
    assert!(!files.is_empty(), "no templates in {dir}");
    let mut found = (0, 0);
    for f in &files {
        let c = check_file(f);
        assert!(c.checked, "{}: {}", c.file_name, c.note);
        assert_eq!(c.lines.len(), 5);
        let cell = |key: &str| { let l = c.lines.iter().find(|l| l.key == key).unwrap(); format!("{}{}", l.status, if l.slides.is_empty() { String::new() } else { format!(" {:?}", l.slides) }) };
        println!("{:<58} {:>2} slides · highlights {} · marks {} · placeholders {} · dates {} · agenda {}", c.file_name, c.slide_count, cell("highlights"), cell("marks"), cell("placeholders"), cell("dates"), cell("agenda"));
        if c.lines.iter().any(|l| l.key == "dates" && l.status != "not_checked") { found.0 += 1; }
        if c.lines.iter().any(|l| l.key == "agenda" && l.status != "not_checked") { found.1 += 1; }
    }
    println!("{} templates: cover and letter dates found in {}, the agenda in {}", files.len(), found.0, found.1);
}
