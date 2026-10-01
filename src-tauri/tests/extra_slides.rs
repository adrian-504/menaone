// Slides MENA One adds to a deck itself (generator, 1.66): a scope-and-fee slide for each custom line, and the
// summary of fees for a deck with two or more services. Generated end to end from a small tagged master built
// here (fictional names; everything is written to a temporary folder).
use menabig_tracker_lib::commands::upsert_proposal_rows;
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::extra_slides::{CUSTOM_MARK, SUMMARY_MARK};
use menabig_tracker_lib::generator::{generate_proposal, revise_prices, GenerateRequest, OutputPolicy, ReviseRequest};
use menabig_tracker_lib::models::{CommercialLine, Proposal};
use menabig_tracker_lib::pptx::{Package, Parts};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

struct Setup {
    dir: PathBuf,
    db: Mutex<Connection>,
}

impl Drop for Setup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn sp(id: usize, name: &str, y: i64, text: &str) -> String {
    format!(r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="990600" y="{y}"/><a:ext cx="8953500" cy="598170"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="1900"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>"#)
}
fn tc(text: &str) -> String { format!(r#"<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>{text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>"#) }

/// A master of six tagged slides: cover, the GM section (divider, approach, a plain fee slide), terms, back cover.
fn write_master(path: &Path) {
    let fee = format!(
        r#"{}{}<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Table 8"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="990600" y="1861185"/><a:ext cx="8953500" cy="1123950"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="6096000"/><a:gridCol w="2857500"/></a:tblGrid><a:tr h="457200">{}{}</a:tr><a:tr h="666750">{}{}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>{}{}{}"#,
        sp(6, "Eyebrow 6", 723900, "Project fees · Temporary GM services"), sp(7, "Title 7", 1104900, "Temporary GM services fees"),
        tc("Category"), tc("Monthly fees"), tc("Temporary GM Representative"), tc("{{fee.price}}"),
        sp(9, "Label 9", 3366135, "Payment terms"), sp(10, "Bullet 10", 3709035, "Paid in separate invoices."), sp(11, "Bullet 11", 4364355, "Service is for a minimum of {{term}}.")
    );
    let slides: Vec<(String, &str)> = vec![
        (sp(2, "Title 2", 100, "Proposal for {{client_name}}"), "[always] [role: cover]"),
        (sp(2, "Title 2", 100, "Temporary GM services"), "[module: gm_representative] [role: divider]"),
        (sp(2, "Title 2", 100, "How the GM service works"), "[module: gm_representative] [role: approach]"),
        (fee, "[module: gm_representative] [role: fees]"),
        (sp(2, "Title 2", 100, "Terms and conditions"), "[always] [role: section-terms]"),
        (sp(2, "Title 2", 100, "Thank you"), "[always] [role: back]"),
    ];
    let mut parts = Parts::new();
    let mut put = |name: String, xml: String| { parts.insert(name, xml.into_bytes()); };
    let n = slides.len();
    put("[Content_Types].xml".into(), format!("<Types><Override PartName=\"/ppt/presentation.xml\"/>{}</Types>", (1..=n).map(|i| format!("<Override PartName=\"/ppt/slides/slide{i}.xml\"/><Override PartName=\"/ppt/notesSlides/notesSlide{i}.xml\"/>")).collect::<String>()));
    put("_rels/.rels".into(), r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>"#.into());
    put("ppt/presentation.xml".into(), format!("<p:presentation><p:sldIdLst>{}</p:sldIdLst><p:sldSz cx=\"18288000\" cy=\"10287000\"/></p:presentation>", (0..n).map(|i| format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 256 + i, i + 2)).collect::<String>()));
    put("ppt/_rels/presentation.xml.rels".into(), format!("<Relationships>{}</Relationships>", (0..n).map(|i| format!("<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{}.xml\"/>", i + 2, i + 1)).collect::<String>()));
    for (i, (body, tags)) in slides.iter().enumerate() {
        let k = i + 1;
        put(format!("ppt/slides/slide{k}.xml"), format!(r#"<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{body}</p:spTree></p:cSld></p:sld>"#));
        put(format!("ppt/slides/_rels/slide{k}.xml.rels"), format!(r#"<Relationships><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide{k}.xml"/></Relationships>"#));
        put(format!("ppt/notesSlides/notesSlide{k}.xml"), format!(r#"<p:notes xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>{tags}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>"#));
    }
    Package::from_parts(parts).write(path).unwrap();
}

fn setup(tag: &str, lines: Vec<CommercialLine>) -> Setup {
    let dir = std::env::temp_dir().join(format!("menabig_extra_slides_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("Proposals")).unwrap();
    let mut conn = init_connection(&dir.join("db.sqlite3")).unwrap();
    write_master(&dir.join("master.pptx"));
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposals_root', ?1)", params![dir.join("Proposals").to_string_lossy()]).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposal_master_path', ?1)", params![dir.join("master.pptx").to_string_lossy()]).unwrap();
    upsert_proposal_rows(&mut conn, &[Proposal { id: 1, client: "Contoso Logistics".into(), status: "Drafting".into(), currency: Some("SAR".into()), contract_months: Some(12), lines, ..Default::default() }]).unwrap();
    Setup { dir, db: Mutex::new(conn) }
}

fn gm(price: f64) -> CommercialLine {
    CommercialLine { id: 1, service_name: "GM Representative".into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(price), ..Default::default() }
}
fn visa(price: f64) -> CommercialLine {
    CommercialLine { id: 2, service_name: "Visa processing".into(), unit: Some("per_visa".into()), unit_price: Some(price), quantity: 1.0, billing: "monthly".into(), description: Some("Work visas for new hires\nExit and re-entry visas".into()), ..Default::default() }
}

fn request(file: &str, dry_run: bool, keep: Option<Vec<usize>>) -> GenerateRequest {
    GenerateRequest { proposal_id: 1, date: "2026-10-01".into(), file_name: file.into(), keep, dry_run, from_master: true, ..Default::default() }
}

fn slide_texts(path: &Path) -> Vec<Vec<String>> {
    let pkg = Package::read(path).unwrap();
    let run = regex::Regex::new(r"<a:t>([^<]*)</a:t>").unwrap();
    menabig_tracker_lib::pptx::slide_parts_in_order(&pkg).iter().map(|p| run.captures_iter(&pkg.text_of(p)).map(|c| c[1].replace("&amp;", "&")).filter(|t| !t.is_empty()).collect()).collect()
}

#[test]
fn a_custom_line_gets_its_slide_and_two_services_get_a_summary() {
    let s = setup("adds", vec![gm(6500.0), visa(1500.0)]);
    // The preview lists them where they go, on by default, as slides MENA One adds.
    let preview = generate_proposal(&s.db, &request("Contoso_V1.pptx", true, None), OutputPolicy::AnyFolder).unwrap();
    let listed: Vec<(usize, &str, bool, &str)> = preview.slides.iter().map(|c| (c.index, c.title.as_str(), c.included, c.source.as_str())).collect();
    assert_eq!(listed[3..6], [(4, "Project fees · Temporary GM services", true, ""), (7, "Visa processing", true, "Added by MENA One"), (8, "Summary of fees", true, "Added by MENA One")]);
    assert_eq!(preview.slides.len(), 8);
    assert!(preview.warnings.iter().all(|w| !w.contains("Visa processing")), "{:?}", preview.warnings);

    let done = generate_proposal(&s.db, &request("Contoso_V1.pptx", false, None), OutputPolicy::AnyFolder).unwrap();
    let path = PathBuf::from(done.path.unwrap());
    let texts = slide_texts(&path);
    assert_eq!(texts.len(), 8);
    assert_eq!(texts[3], vec!["Project fees · Temporary GM services", "Temporary GM services fees", "Category", "Monthly fees", "Temporary GM Representative", "6,500 SAR", "Payment terms", "Paid in separate invoices.", "Service is for a minimum of 12 months."]);
    // After the last service slide: the custom line's scope and fee, then the summary; the terms follow.
    assert_eq!(texts[4], vec!["Project fees · Visa processing", "Visa processing", "Category", "Fee per visa", "Visa processing", "1,500 SAR", "Scope", "Work visas for new hires", "Exit and re-entry visas"]);
    assert_eq!(texts[5], vec!["Project fees · Summary", "Summary of fees", "Service", "Fees", "GM Representative", "6,500 SAR per month", "Visa processing", "1,500 SAR per visa", "Monthly total", "6,500 SAR", "12-month total", "78,000 SAR", "Totals", "Fees charged per person, per visa, as a percentage or by a fee table are not part of the totals."]);
    assert_eq!(texts[6], vec!["Terms and conditions"]);
    let pkg = Package::read(&path).unwrap();
    let parts = menabig_tracker_lib::pptx::slide_parts_in_order(&pkg);
    assert!(pkg.text_of(&parts[4]).contains(CUSTOM_MARK) && pkg.text_of(&parts[5]).contains(SUMMARY_MARK));
    assert!(parts.iter().all(|p| !pkg.text_of(p).contains("{{")), "a field was left in the deck");
    // Their notes say what they are, so neither is taken for the GM service's slide.
    let notes = menabig_tracker_lib::pptx::inspect(&pkg).slides.iter().map(|s| s.notes.clone()).collect::<Vec<_>>();
    assert_eq!(notes[4..6], ["[module: custom] [role: fees]".to_string(), "[module: summary] [role: summary]".to_string()]);

    // Revise prices finds the custom line's row and brings the summary up to date.
    {
        let mut conn = s.db.lock().unwrap();
        let mut p = menabig_tracker_lib::commands::read_all_data(&conn).unwrap().proposals.into_iter().find(|p| p.id == 1).unwrap();
        p.lines = vec![gm(7000.0), visa(1800.0)];
        upsert_proposal_rows(&mut conn, &[p]).unwrap();
    }
    let doc = done.document.unwrap().id;
    let revised = revise_prices(&s.db, &ReviseRequest { proposal_id: 1, document_id: doc, date: "2026-10-01".into(), file_name: "Contoso_V2.pptx".into(), ..Default::default() }, OutputPolicy::AnyFolder).unwrap();
    assert!(revised.can_save, "{}", revised.reason);
    assert_eq!(revised.line, "Prices revised from V1: 6 amounts updated on slides 4, 5 and 6");
    let v2 = slide_texts(&PathBuf::from(revised.path.unwrap()));
    assert_eq!(v2[4][5], "1,800 SAR");
    assert_eq!(v2[5][4..12], ["GM Representative", "7,000 SAR per month", "Visa processing", "1,800 SAR per visa", "Monthly total", "7,000 SAR", "12-month total", "84,000 SAR"]);
}

#[test]
fn the_added_slides_can_be_left_out_and_one_service_has_no_summary() {
    let s = setup("leaves", vec![gm(6500.0), visa(1500.0)]);
    // The summary's tile unticked in the preview: every other slide is kept.
    let kept = generate_proposal(&s.db, &request("Contoso_V1.pptx", false, Some(vec![1, 2, 3, 4, 5, 6, 7])), OutputPolicy::AnyFolder).unwrap();
    let texts = slide_texts(&PathBuf::from(kept.path.unwrap()));
    assert_eq!(texts.len(), 7);
    assert_eq!(texts[4][1], "Visa processing");
    assert_eq!(texts[5], vec!["Terms and conditions"]);
    assert!(kept.slides.iter().any(|c| c.title == "Summary of fees" && !c.included && c.reason == "Removed by you"));

    // One service: nothing to sum up, and no slide is added.
    let one = setup("single", vec![gm(6500.0)]);
    let preview = generate_proposal(&one.db, &request("Contoso_V1.pptx", true, None), OutputPolicy::AnyFolder).unwrap();
    assert_eq!(preview.slides.len(), 6);
    assert!(preview.slides.iter().all(|c| c.source.is_empty()));

    // Custom lines only: the deck is the standard slides, the lines' own slides and their summary.
    let market = CommercialLine { id: 3, service_name: "Market study".into(), unit: Some("one_time".into()), unit_price: Some(9000.0), quantity: 1.0, billing: "one_time".into(), ..Default::default() };
    let custom = setup("custom_only", vec![visa(1500.0), market]);
    let done = generate_proposal(&custom.db, &request("Contoso_V1.pptx", false, None), OutputPolicy::AnyFolder).unwrap();
    let texts = slide_texts(&PathBuf::from(done.path.unwrap()));
    assert_eq!(texts.iter().map(|t| t[0].clone()).collect::<Vec<_>>(), vec!["Proposal for Contoso Logistics", "Project fees · Visa processing", "Project fees · Market study", "Project fees · Summary", "Terms and conditions", "Thank you"]);
    // A one-time fee and a fee per visa: the one-time fee is the only sum, and there is no monthly total to give.
    assert_eq!(texts[2][2..6], ["Category", "One-time fee", "Market study", "9,000 SAR"]);
    assert_eq!(texts[3][4..], ["Visa processing", "1,500 SAR per visa", "Market study", "9,000 SAR one-time", "One-time fees", "9,000 SAR", "Totals", "Fees charged per person, per visa, as a percentage or by a fee table are not part of the totals."]);
}
