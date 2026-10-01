// Revise prices (generator, 1.66): the next version of a deck with only its prices and its two dates changed.
// The version it is made from is never modified; nothing is saved or recorded when a price has no row, when
// nothing would change, or on a dry run. Fictional names only; everything is written to a temporary folder.
use menabig_tracker_lib::commands::{read_all_data, upsert_proposal_rows};
use menabig_tracker_lib::db::init_connection;
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

fn para(t: &str) -> String { format!("<a:p><a:r><a:t>{t}</a:t></a:r></a:p>") }
fn shape(lines: &[&str]) -> String { format!("<p:sp><p:spPr><a:xfrm><a:ext cx=\"9000000\" cy=\"400000\"/></a:xfrm></p:spPr><p:txBody>{}</p:txBody></p:sp>", lines.iter().map(|t| para(t)).collect::<String>()) }
fn row(cells: &[&str]) -> String { format!("<a:tr h=\"1\">{}</a:tr>", cells.iter().map(|c| format!("<a:tc><a:txBody>{}</a:txBody></a:tc>", para(c))).collect::<String>()) }

/// A three-slide deck as someone left it: a cover and a letter with their dates, and a fee slide with a note typed by hand.
fn write_deck(path: &Path, fee: &str) {
    let slides = [
        shape(&["Proposal for Contoso Logistics", "Tuesday, 15th September 2026"]),
        shape(&["Date: 15th of September 2026", "Dear Sir,"]),
        format!("{}<a:tbl>{}{}</a:tbl>", shape(&["Project Fees", "Payroll Services", "Typed by hand: the first invoice is in November."]), row(&["Category", "Monthly fees"]), row(&["Payroll services", fee])),
    ];
    let mut parts = Parts::new();
    let mut put = |name: &str, xml: String| { parts.insert(name.to_string(), xml.into_bytes()); };
    put("[Content_Types].xml", format!("<Types><Override PartName=\"/ppt/presentation.xml\"/>{}</Types>", (1..=slides.len()).map(|i| format!("<Override PartName=\"/ppt/slides/slide{i}.xml\"/>")).collect::<String>()));
    put("_rels/.rels", r#"<Relationships><Relationship Id="rId1" Type="x/officeDocument" Target="ppt/presentation.xml"/></Relationships>"#.to_string());
    put("ppt/presentation.xml", format!("<p:presentation><p:sldIdLst>{}</p:sldIdLst></p:presentation>", (0..slides.len()).map(|i| format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 256 + i, i + 2)).collect::<String>()));
    put("ppt/_rels/presentation.xml.rels", format!("<Relationships>{}</Relationships>", (0..slides.len()).map(|i| format!("<Relationship Id=\"rId{}\" Type=\"x/slide\" Target=\"slides/slide{}.xml\"/>", i + 2, i + 1)).collect::<String>()));
    for (i, s) in slides.iter().enumerate() {
        put(&format!("ppt/slides/slide{}.xml", i + 1), format!(r#"<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>{s}</p:spTree></p:cSld></p:sld>"#));
    }
    Package::from_parts(parts).write(path).unwrap();
}

fn texts(path: &Path) -> Vec<String> {
    let pkg = Package::read(path).unwrap();
    let run = regex::Regex::new(r"<a:t>([^<]*)</a:t>").unwrap();
    menabig_tracker_lib::pptx::slide_parts_in_order(&pkg).iter().flat_map(|p| run.captures_iter(&pkg.text_of(p)).map(|c| c[1].to_string()).collect::<Vec<_>>()).collect()
}

const V1: &str = "Contoso Logistics_Payroll Proposal_15.09.2026.pptx";
const V2: &str = "Contoso Logistics_Payroll Proposal_01.10.2026_V2.pptx";

fn line(id: i64, name: &str, price: f64) -> CommercialLine {
    CommercialLine { id, service_name: name.into(), billing: "monthly".into(), quantity: 1.0, unit_price: Some(price), ..Default::default() }
}

fn save(s: &Setup, lines: Vec<CommercialLine>) {
    let mut conn = s.db.lock().unwrap();
    let mut p = read_all_data(&conn).unwrap().proposals.into_iter().find(|p| p.id == 1).unwrap();
    p.lines = lines;
    upsert_proposal_rows(&mut conn, &[p]).unwrap();
}

/// A proposal for Payroll at 5,000 a month whose V1 deck (5,000 SAR) is in its client folder.
fn setup(tag: &str) -> Setup {
    let dir = std::env::temp_dir().join(format!("menabig_revise_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let folder = dir.join("Proposals").join("Contoso Logistics");
    std::fs::create_dir_all(&folder).unwrap();
    let mut conn = init_connection(&dir.join("db.sqlite3")).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposals_root', ?1)", params![dir.join("Proposals").to_string_lossy()]).unwrap();
    upsert_proposal_rows(&mut conn, &[Proposal { id: 1, client: "Contoso Logistics".into(), status: "Drafting".into(), currency: Some("SAR".into()), contract_months: Some(12), lines: vec![line(1, "Payroll", 5000.0)], ..Default::default() }]).unwrap();
    write_deck(&folder.join(V1), "5,000 SAR");
    conn.execute(
        "INSERT INTO proposal_documents (id, proposal_id, kind, version, file_name, path, notes, created_at) VALUES (1, 1, 'proposal', 1, ?1, ?2, 'Generated from Payroll Proposal Template', '2026-09-15')",
        params![V1, folder.join(V1).to_string_lossy()],
    ).unwrap();
    Setup { dir, db: Mutex::new(conn) }
}

fn request(file_name: &str, dry_run: bool) -> ReviseRequest {
    ReviseRequest { proposal_id: 1, document_id: 1, date: "2026-10-01".into(), file_name: file_name.into(), round: Some("client".into()), round_reason: Some("  Price for 40 employees ".into()), dry_run }
}

fn documents(s: &Setup) -> Vec<(i64, String, Option<String>, Option<String>, Option<String>, Option<i64>, Option<String>)> {
    let conn = s.db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT version, file_name, notes, round, round_reason, carried_from_version, generated_sha256 FROM proposal_documents ORDER BY version").unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).unwrap().map(Result::unwrap).collect()
}

#[test]
fn the_next_version_has_the_new_price_and_dates_and_everything_typed_by_hand() {
    let s = setup("saves");
    let folder = s.dir.join("Proposals").join("Contoso Logistics");
    let before = std::fs::read(folder.join(V1)).unwrap();
    save(&s, vec![line(1, "Payroll", 4500.0)]);

    // A dry run says what would change and writes nothing.
    let dry = revise_prices(&s.db, &request(V2, true), OutputPolicy::AnyFolder).unwrap();
    assert!(dry.can_save && dry.reason.is_empty() && dry.path.is_none() && dry.document.is_none());
    assert_eq!(dry.line, "Prices revised from V1: 1 amount updated on slide 3; dates on slides 1 and 2");
    assert!(!folder.join(V2).exists());
    assert_eq!(documents(&s).len(), 1);

    let done = revise_prices(&s.db, &request(V2, false), OutputPolicy::AnyFolder).unwrap();
    let doc = done.document.expect("recorded");
    assert_eq!((doc.version, doc.round.as_deref(), doc.round_reason.as_deref(), doc.carried_from_version, doc.not_carried), (Some(2), Some("client"), Some("Price for 40 employees"), Some(1), false));
    assert_eq!(doc.notes.as_deref(), Some("Prices revised from V1: 1 amount updated on slide 3; dates on slides 1 and 2"));
    // The file it was made from is as it was, byte for byte.
    assert_eq!(std::fs::read(folder.join(V1)).unwrap(), before);
    assert_eq!(texts(&folder.join(V2)), vec![
        "Proposal for Contoso Logistics", "Thursday, 1st October 2026", "Date: 1st of October 2026", "Dear Sir,",
        "Project Fees", "Payroll Services", "Typed by hand: the first invoice is in November.", "Category", "Monthly fees", "Payroll services", "4,500 SAR",
    ]);
    // Recorded as V2 with its report, its round, where it came from, and its fingerprint; V1's record is untouched.
    let docs = documents(&s);
    assert_eq!(docs.len(), 2);
    assert_eq!((docs[0].0, docs[0].1.as_str(), docs[0].2.as_deref(), docs[0].3.as_deref(), docs[0].6.as_deref()), (1, V1, Some("Generated from Payroll Proposal Template"), None, None));
    assert_eq!((docs[1].0, docs[1].1.as_str(), docs[1].3.as_deref(), docs[1].4.as_deref(), docs[1].5), (2, V2, Some("client"), Some("Price for 40 employees"), Some(1)));
    assert_eq!(docs[1].6, menabig_tracker_lib::localfiles::sha256_of(&folder.join(V2)));
    // It is read back with the proposal like any other version.
    let read = read_all_data(&s.db.lock().unwrap()).unwrap().proposals.into_iter().find(|p| p.id == 1).unwrap();
    assert_eq!(read.documents.iter().map(|d| (d.version, d.carried_from_version)).collect::<Vec<_>>(), vec![(Some(1), None), (Some(2), Some(1))]);
    // The same name again is refused: a version is never written over.
    assert_eq!(revise_prices(&s.db, &request(V1, false), OutputPolicy::AnyFolder).unwrap_err(), format!("{V1} already exists in the client folder. Choose another name."));
}

#[test]
fn a_price_with_no_row_or_nothing_to_change_saves_nothing() {
    let s = setup("refuses");
    let folder = s.dir.join("Proposals").join("Contoso Logistics");
    // A service was added: its price has no row, so the deck is not revised in place.
    save(&s, vec![line(1, "Payroll", 4500.0), line(2, "GM Representative", 6500.0)]);
    let r = revise_prices(&s.db, &request(V2, false), OutputPolicy::AnyFolder).unwrap();
    assert!(!r.can_save && r.path.is_none() && r.document.is_none());
    assert_eq!(r.reason, "One price has no row in V1: GM Representative.");
    // The prices already match: an unchanged file is never saved as a revision.
    save(&s, vec![line(1, "Payroll", 5000.0)]);
    let r = revise_prices(&s.db, &request(V2, false), OutputPolicy::AnyFolder).unwrap();
    assert!(!r.can_save && r.document.is_none());
    assert_eq!(r.reason, "The prices and the term in V1 already match the proposal.");
    assert!(!folder.join(V2).exists());
    assert_eq!(documents(&s).len(), 1);
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 1, "nothing was left in the client folder");
}

#[test]
fn only_a_powerpoint_deck_of_this_proposal_that_is_still_there_is_revised() {
    let s = setup("guards");
    let folder = s.dir.join("Proposals").join("Contoso Logistics");
    save(&s, vec![line(1, "Payroll", 4500.0)]);
    let other = ReviseRequest { document_id: 99, ..request(V2, false) };
    assert_eq!(revise_prices(&s.db, &other, OutputPolicy::AnyFolder).unwrap_err(), "That version is not one of this proposal's decks.");
    // The app itself only reads and writes inside OneDrive.
    assert_eq!(revise_prices(&s.db, &request(V2, false), OutputPolicy::OneDriveOnly).unwrap_err(), "V1 is outside OneDrive, so it wasn't read.");
    std::fs::rename(folder.join(V1), folder.join("moved.pptx")).unwrap();
    assert_eq!(revise_prices(&s.db, &request(V2, false), OutputPolicy::AnyFolder).unwrap_err(), format!("{V1} is not in the client folder any more."));
    s.db.lock().unwrap().execute("UPDATE proposal_documents SET path = ?1, file_name = 'Signed.pdf' WHERE id = 1", params![folder.join("Signed.pdf").to_string_lossy()]).unwrap();
    assert_eq!(revise_prices(&s.db, &request(V2, false), OutputPolicy::AnyFolder).unwrap_err(), "V1 is not a PowerPoint file, so its prices can't be revised.");
    assert_eq!(documents(&s).len(), 1);
}

#[test]
fn regenerating_instead_says_the_hand_edits_were_not_carried() {
    let s = setup("regenerates");
    let template = s.dir.join("standard.pptx");
    let mut parts = Parts::new();
    let mut put = |name: &str, xml: &str| { parts.insert(name.to_string(), xml.as_bytes().to_vec()); };
    put("[Content_Types].xml", r#"<Types><Override PartName="/ppt/presentation.xml"/><Override PartName="/ppt/slides/slide1.xml"/></Types>"#);
    put("_rels/.rels", r#"<Relationships><Relationship Id="rId1" Type="x/officeDocument" Target="ppt/presentation.xml"/></Relationships>"#);
    put("ppt/presentation.xml", r#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>"#);
    put("ppt/_rels/presentation.xml.rels", r#"<Relationships><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/></Relationships>"#);
    put("ppt/slides/slide1.xml", r#"<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Proposal for {{client_name}}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#);
    Package::from_parts(parts).write(&template).unwrap();
    s.db.lock().unwrap().execute("INSERT INTO proposal_templates (id, name, path, config_json, is_default) VALUES (1, 'Standard deck', ?1, '{\"smartFields\":false}', 1)", params![template.to_string_lossy()]).unwrap();
    let req = GenerateRequest { proposal_id: 1, template_id: 1, date: "2026-10-01".into(), file_name: V2.into(), round: Some("internal".into()), not_carried_from: Some(1), ..Default::default() };
    let doc = generate_proposal(&s.db, &req, OutputPolicy::AnyFolder).unwrap().document.expect("recorded");
    assert_eq!((doc.version, doc.round.as_deref(), doc.carried_from_version, doc.not_carried), (Some(2), Some("internal"), Some(1), true));
    let read = read_all_data(&s.db.lock().unwrap()).unwrap().proposals.into_iter().find(|p| p.id == 1).unwrap();
    let v2 = read.documents.iter().find(|d| d.version == Some(2)).unwrap();
    assert!(v2.not_carried && v2.carried_from_version == Some(1));
    // A plain generation carries no such mark.
    let plain = generate_proposal(&s.db, &GenerateRequest { file_name: "Contoso Logistics_Payroll Proposal_01.10.2026_V3.pptx".into(), round: None, not_carried_from: None, ..req }, OutputPolicy::AnyFolder).unwrap().document.unwrap();
    assert_eq!((plain.version, plain.round, plain.carried_from_version, plain.not_carried), (Some(3), None, None, false));
}
