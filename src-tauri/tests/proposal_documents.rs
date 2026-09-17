// Phase 4 — proposal document workflow. Generating a proposal saves a new
// deck, records it as the proposal's next version, never replaces an earlier
// version, refuses incomplete decks, and records nothing when it fails.
// Fictional names only; everything is written to a temporary folder.
use menabig_tracker_lib::commands::{read_all_data, upsert_proposal_rows};
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::integrity::integrity_report;
use menabig_tracker_lib::generator::{generate_proposal, next_document_version, version_in_name, GenerateRequest, OutputPolicy};
use menabig_tracker_lib::models::{CommercialLine, Proposal};
use menabig_tracker_lib::opportunities::save_opportunity_row;
use menabig_tracker_lib::pptx::{Package, Parts};
use menabig_tracker_lib::v2_models::Opportunity;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

struct Setup {
    dir: PathBuf,
    db: Mutex<Connection>,
    proposal: i64,
    opportunity: i64,
    company: i64,
}

impl Drop for Setup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// A one-slide deck whose text uses the given fields.
fn write_template(path: &Path, text: &str) {
    let slide = format!(
        r#"<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#
    );
    let mut parts = Parts::new();
    let mut put = |name: &str, xml: &str| { parts.insert(name.to_string(), xml.as_bytes().to_vec()); };
    put("[Content_Types].xml", r#"<Types><Override PartName="/ppt/presentation.xml"/><Override PartName="/ppt/slides/slide1.xml"/></Types>"#);
    put("_rels/.rels", r#"<Relationships><Relationship Id="rId1" Type="x/officeDocument" Target="ppt/presentation.xml"/></Relationships>"#);
    put("ppt/presentation.xml", r#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>"#);
    put("ppt/_rels/presentation.xml.rels", r#"<Relationships><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/></Relationships>"#);
    put("ppt/slides/slide1.xml", &slide);
    Package::from_parts(parts).write(path).unwrap();
}

fn setup(tag: &str) -> Setup {
    let dir = std::env::temp_dir().join(format!("menabig_proposal_docs_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("Proposals")).unwrap();
    let mut conn = init_connection(&dir.join("db.sqlite3")).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('proposals_root', ?1)", params![dir.join("Proposals").to_string_lossy()]).unwrap();

    write_template(&dir.join("good.pptx"), "Proposal for {{client_name}}: {{services}}, valid until {{valid_until}}");
    write_template(&dir.join("needs-more.pptx"), "Proposal for {{client_name}} — {{site_address}}");
    conn.execute("INSERT INTO proposal_templates (id, name, path, config_json, is_default) VALUES (1, 'Standard deck', ?1, '{\"smartFields\":false}', 1)", params![dir.join("good.pptx").to_string_lossy()]).unwrap();
    conn.execute("INSERT INTO proposal_templates (id, name, path, config_json, is_default) VALUES (2, 'Site deck', ?1, '{\"smartFields\":false}', 0)", params![dir.join("needs-more.pptx").to_string_lossy()]).unwrap();

    let line = CommercialLine { id: 1, service_name: "Recruitment".into(), billing: "one_time".into(), quantity: 1.0, unit_price: Some(25000.0), ..Default::default() };
    upsert_proposal_rows(&mut conn, &[Proposal { id: 1, client: "Contoso Logistics".into(), status: "Drafting".into(), currency: Some("SAR".into()), lines: vec![line], ..Default::default() }]).unwrap();
    let company: i64 = conn.query_row("SELECT company_id FROM proposals WHERE id = 1", [], |r| r.get(0)).unwrap();
    let opp = save_opportunity_row(&mut conn, &Opportunity {
        name: "Contoso Recruitment".into(), company_id: Some(company), company_name: Some("Contoso Logistics".into()), stage: "Proposal".into(), status: "Open".into(), proposal_id: Some(1), ..Default::default()
    }).unwrap();
    Setup { dir, db: Mutex::new(conn), proposal: 1, opportunity: opp.id, company }
}

fn request(s: &Setup, template_id: i64, file_name: &str, dry_run: bool) -> GenerateRequest {
    GenerateRequest { proposal_id: s.proposal, template_id, date: "2026-09-15".into(), file_name: file_name.into(), keep: None, logo_path: None, dry_run, from_library: false, from_master: false }
}

fn documents(s: &Setup) -> Vec<(i64, i64, String, String)> {
    let conn = s.db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT version, proposal_id, file_name, path FROM proposal_documents ORDER BY version").unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect()
}

const V1: &str = "Contoso Logistics_Recruitment Proposal_15.09.2026.pptx";
const V2: &str = "Contoso Logistics_Recruitment Proposal_15.09.2026_V2.pptx";

#[test]
fn generating_records_v1_then_a_separate_v2() {
    let s = setup("versions");
    // 1–3. The first generation saves the deck and records it as V1 on this proposal.
    let first = generate_proposal(&s.db, &request(&s, 1, V1, false), OutputPolicy::AnyFolder).unwrap();
    let doc1 = first.document.clone().expect("recorded");
    assert_eq!((doc1.version, doc1.kind.as_str(), doc1.file_name.as_str()), (Some(1), "proposal", V1));
    let v1_path = PathBuf::from(first.path.clone().unwrap());
    assert!(v1_path.is_file(), "V1 deck saved");
    assert_eq!(documents(&s), vec![(1, s.proposal, V1.to_string(), v1_path.to_string_lossy().to_string())]);

    // 4–5. A second generation is V2 in its own file; V1 is untouched.
    let v1_bytes = std::fs::read(&v1_path).unwrap();
    let second = generate_proposal(&s.db, &request(&s, 1, V2, false), OutputPolicy::AnyFolder).unwrap();
    assert_eq!(second.document.as_ref().and_then(|d| d.version), Some(2));
    let v2_path = PathBuf::from(second.path.clone().unwrap());
    assert_ne!(v1_path, v2_path);
    assert!(v2_path.is_file());
    assert_eq!(std::fs::read(&v1_path).unwrap(), v1_bytes, "V1 file unchanged");
    assert_eq!(documents(&s).iter().map(|d| d.0).collect::<Vec<_>>(), vec![1, 2]);

    // 10–11. Both belong to the proposal; the proposal still belongs to its opportunity and company.
    let data = { let conn = s.db.lock().unwrap(); read_all_data(&conn).unwrap() };
    let p = data.proposals.iter().find(|p| p.id == s.proposal).unwrap();
    assert_eq!(p.documents.iter().map(|d| d.version).collect::<Vec<_>>(), vec![Some(1), Some(2)]);
    assert_eq!(p.company_id, Some(s.company));
    assert_eq!(p.folder_path.as_deref(), v1_path.parent().map(|f| f.to_string_lossy().to_string()).as_deref(), "client folder remembered");
    let conn = s.db.lock().unwrap();
    let linked: Option<i64> = conn.query_row("SELECT proposal_id FROM opportunities WHERE id = ?1", params![s.opportunity], |r| r.get(0)).unwrap();
    assert_eq!(linked, Some(s.proposal));
    drop(conn);

    // Generated records carry sync ids like any other row; nothing dangling.
    { let conn = s.db.lock().unwrap(); let report = integrity_report(&conn).unwrap(); assert!(report.is_clean(), "{report:?}"); }

    // Saving the proposal as the app holds it after generation keeps both versions.
    let mut conn = s.db.lock().unwrap();
    upsert_proposal_rows(&mut conn, &[Proposal { remarks: Some("edited after V2".into()), ..p.clone() }]).unwrap();
    drop(conn);
    assert_eq!(documents(&s).len(), 2);
}

#[test]
fn failed_generations_record_nothing_and_keep_earlier_versions() {
    let s = setup("failures");
    generate_proposal(&s.db, &request(&s, 1, V1, false), OutputPolicy::AnyFolder).unwrap();
    let second = generate_proposal(&s.db, &request(&s, 1, V2, false), OutputPolicy::AnyFolder).unwrap();
    let v2_path = PathBuf::from(second.path.unwrap());
    let v2_bytes = std::fs::read(&v2_path).unwrap();

    // 6–7. Saving over an existing deck fails: no new record, no version used, V2 intact.
    let clash = generate_proposal(&s.db, &request(&s, 1, V2, false), OutputPolicy::AnyFolder);
    assert!(clash.unwrap_err().contains("already exists"));
    // A template that can't be read fails the same way.
    { s.db.lock().unwrap().execute("UPDATE proposal_templates SET path = '/nonexistent/deck.pptx' WHERE id = 1", []).unwrap(); }
    assert!(generate_proposal(&s.db, &request(&s, 1, "Contoso Logistics_Recruitment Proposal_15.09.2026_V3.pptx", false), OutputPolicy::AnyFolder).is_err());
    // The OneDrive-only policy refuses a folder outside OneDrive.
    { s.db.lock().unwrap().execute("UPDATE proposal_templates SET path = ?1 WHERE id = 1", params![s.dir.join("good.pptx").to_string_lossy()]).unwrap(); }
    assert!(generate_proposal(&s.db, &request(&s, 1, "Contoso Logistics_Recruitment Proposal_15.09.2026_V3.pptx", false), OutputPolicy::OneDriveOnly).is_err());

    assert_eq!(documents(&s).iter().map(|d| d.0).collect::<Vec<_>>(), vec![1, 2], "no V3 recorded");
    assert_eq!(std::fs::read(&v2_path).unwrap(), v2_bytes, "V2 file intact");
    assert!(!s.dir.join("Proposals/Contoso Logistics/Contoso Logistics_Recruitment Proposal_15.09.2026_V3.pptx").exists(), "no V3 file left behind");
    let leftovers: Vec<_> = std::fs::read_dir(v2_path.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".partial")).collect();
    assert!(leftovers.is_empty(), "no partial files: {leftovers:?}");
    let conn = s.db.lock().unwrap();
    assert_eq!(next_document_version(&conn, s.proposal, "x.pptx").unwrap(), 3, "the next success is still V3");
}

#[test]
fn missing_template_data_is_an_error_and_blank_optional_fields_are_warnings() {
    let s = setup("validation");
    // 9. Blank optional field (no validity date): a warning, and the deck can still be generated.
    let preview = generate_proposal(&s.db, &request(&s, 1, V1, true), OutputPolicy::AnyFolder).unwrap();
    assert!(preview.errors.is_empty(), "{:?}", preview.errors);
    assert!(preview.warnings.iter().any(|w| w.starts_with("Valid until is blank")), "{:?}", preview.warnings);
    assert!(preview.document.is_none() && preview.path.is_none(), "a preview saves nothing");
    assert!(documents(&s).is_empty());

    // 8. A field the template needs that MENA One can't fill: reported as an error, and generation refuses.
    let blocked = generate_proposal(&s.db, &request(&s, 2, V1, true), OutputPolicy::AnyFolder).unwrap();
    assert_eq!(blocked.errors.len(), 1, "{:?}", blocked.errors);
    assert!(blocked.errors[0].contains("{{site_address}}"));
    let refused = generate_proposal(&s.db, &request(&s, 2, V1, false), OutputPolicy::AnyFolder).unwrap_err();
    assert!(refused.starts_with("Cannot generate the proposal. Missing:"), "{refused}");
    assert!(documents(&s).is_empty(), "nothing recorded");
    assert!(!s.dir.join("Proposals/Contoso Logistics").join(V1).exists(), "no incomplete deck written");

    // A proposal without a client can't be generated.
    { s.db.lock().unwrap().execute("UPDATE proposals SET client = '' WHERE id = 1", []).unwrap(); }
    let no_client = generate_proposal(&s.db, &request(&s, 1, V1, true), OutputPolicy::AnyFolder).unwrap();
    assert!(no_client.errors.iter().any(|e| e.starts_with("Client name")), "{:?}", no_client.errors);
}

#[test]
fn version_numbers_follow_records_and_file_names() {
    assert_eq!(version_in_name("Acme_Payroll Proposal_13.09.2026_V3.pptx"), Some(3));
    assert_eq!(version_in_name("Acme_Payroll Proposal_13.09.2026_v12.PPTX"), Some(12));
    assert_eq!(version_in_name("Acme_Payroll Proposal_13.09.2026.pptx"), None);
    assert_eq!(version_in_name("Acme_Vendor Proposal.pptx"), None);
    let s = setup("numbers");
    let conn = s.db.lock().unwrap();
    assert_eq!(next_document_version(&conn, s.proposal, V1).unwrap(), 1);
    assert_eq!(next_document_version(&conn, s.proposal, "Deck_V4.pptx").unwrap(), 4, "a higher _V<n> in the name wins");
}

/// Opt-in end-to-end run on a copy of a real database with the real proposal
/// templates (read only): `MENA_REHEARSAL_DB=<copy> MENA_E2E_PROPOSAL=<id>
/// cargo test --test proposal_documents -- --ignored --nocapture`. Links the
/// proposal to a new opportunity in the copy, generates V1, changes the
/// proposal, generates V2, then forces two failures. Decks are written to a
/// temporary folder, never to OneDrive.
#[test]
#[ignore]
fn real_proposal_workflow_on_a_database_copy() {
    let (Ok(db_path), Ok(proposal_id)) = (std::env::var("MENA_REHEARSAL_DB"), std::env::var("MENA_E2E_PROPOSAL")) else { return };
    assert!(!db_path.contains("Application Support"), "point this at a copy, never the live database");
    let proposal_id: i64 = proposal_id.parse().unwrap();
    let out = std::env::temp_dir().join(format!("menabig_e2e_decks_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    std::fs::create_dir_all(&out).unwrap();
    let mut conn = init_connection(&PathBuf::from(&db_path)).unwrap();

    // Real templates, read only; output redirected to the temporary folder.
    let library = menabig_tracker_lib::generator::library_dir(&conn).unwrap();
    let master = menabig_tracker_lib::master::locate(library.as_deref(), None);
    println!("library: {library:?}\nmaster: {master:?}");
    for (key, value) in [("proposal_library_dir", library.as_ref().map(|p| p.to_string_lossy().to_string())), ("proposal_master_path", master.as_ref().map(|p| p.to_string_lossy().to_string())), ("proposals_root", Some(out.to_string_lossy().to_string()))] {
        if let Some(v) = value {
            conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)", params![key, v]).unwrap();
        }
    }
    conn.execute("UPDATE proposals SET folder_path = NULL WHERE id = ?1", params![proposal_id]).unwrap();
    let (client, company): (String, Option<i64>) = conn.query_row("SELECT client, company_id FROM proposals WHERE id = ?1", params![proposal_id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    let opp = save_opportunity_row(&mut conn, &Opportunity {
        name: format!("{client} Recruitment (E2E copy)"), company_id: company, company_name: Some(client.clone()), stage: "Proposal".into(), status: "Open".into(), proposal_id: Some(proposal_id), ..Default::default()
    }).unwrap();
    let before_max: i64 = conn.query_row("SELECT COALESCE(MAX(version), 0) FROM proposal_documents WHERE proposal_id = ?1 AND kind = 'proposal'", params![proposal_id], |r| r.get(0)).unwrap();
    let db = Mutex::new(conn);
    let services: String = { db.lock().unwrap().query_row("SELECT COALESCE(group_concat(service_name, ' & '), 'Services') FROM proposal_lines WHERE proposal_id = ?1", params![proposal_id], |r| r.get(0)).unwrap() };
    let name = |suffix: &str| format!("{client}_{services} Proposal_15.09.2026{suffix}.pptx");
    let req = |file: String, dry_run: bool| GenerateRequest { proposal_id, template_id: 0, date: "2026-09-15".into(), file_name: file, keep: None, logo_path: None, dry_run, from_library: master.is_none(), from_master: master.is_some() };

    let preview = generate_proposal(&db, &req(name(""), true), OutputPolicy::AnyFolder).unwrap();
    println!("preview: {} slides kept, errors {:?}\nwarnings {:#?}", preview.slides.iter().filter(|s| s.included).count(), preview.errors, preview.warnings);
    assert!(preview.errors.is_empty(), "the real proposal should be generatable: {:?}", preview.errors);

    let v1 = generate_proposal(&db, &req(name(""), false), OutputPolicy::AnyFolder).unwrap();
    let d1 = v1.document.clone().unwrap();
    println!("V1 → {} (version {:?})", v1.path.clone().unwrap(), d1.version);
    let v1_path = PathBuf::from(v1.path.unwrap());
    assert!(v1_path.is_file() && menabig_tracker_lib::pptx::Package::read(&v1_path).is_ok(), "V1 is a readable deck");

    // Change the proposal, as the app would save it, then generate again.
    {
        let mut conn = db.lock().unwrap();
        let data = read_all_data(&conn).unwrap();
        let p = data.proposals.into_iter().find(|p| p.id == proposal_id).unwrap();
        upsert_proposal_rows(&mut conn, &[Proposal { remarks: Some(format!("{} (E2E: changed before V2)", p.remarks.clone().unwrap_or_default())), ..p }]).unwrap();
    }
    let v2 = generate_proposal(&db, &req(name("_V2"), false), OutputPolicy::AnyFolder).unwrap();
    let d2 = v2.document.clone().unwrap();
    println!("V2 → {} (version {:?})", v2.path.clone().unwrap(), d2.version);
    let v2_path = PathBuf::from(v2.path.unwrap());
    assert_eq!((d1.version, d2.version), (Some(before_max + 1), Some(before_max + 2)), "V1 then V2");
    let v1_bytes = std::fs::read(&v1_path).unwrap();
    let v2_bytes = std::fs::read(&v2_path).unwrap();

    // Failure 1: the V2 name again. Failure 2: the client folder can't be written to.
    assert!(generate_proposal(&db, &req(name("_V2"), false), OutputPolicy::AnyFolder).unwrap_err().contains("already exists"));
    let folder = v2_path.parent().unwrap().to_path_buf();
    // A read-only folder via Unix mode bits; Windows has no equivalent that
    // blocks creating files, so this part only runs on macOS/Linux.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&folder).unwrap().permissions();
        perms.set_mode(0o555);
        std::fs::set_permissions(&folder, perms.clone()).unwrap();
        let locked = generate_proposal(&db, &req(name("_V3"), false), OutputPolicy::AnyFolder);
        perms.set_mode(0o755);
        std::fs::set_permissions(&folder, perms).unwrap();
        println!("forced failures: {:?}", locked.as_ref().err());
        assert!(locked.is_err());
    }

    let conn = db.lock().unwrap();
    let versions: Vec<i64> = conn.prepare("SELECT version FROM proposal_documents WHERE proposal_id = ?1 AND kind = 'proposal' ORDER BY version").unwrap()
        .query_map(params![proposal_id], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    println!("recorded versions: {versions:?}");
    assert!(versions.ends_with(&[d1.version.unwrap(), d2.version.unwrap()]), "V1 and V2 recorded, no V3: {versions:?}");
    assert_eq!(std::fs::read(&v1_path).unwrap(), v1_bytes);
    assert_eq!(std::fs::read(&v2_path).unwrap(), v2_bytes);
    assert!(!folder.join(name("_V3")).exists());
    let linked: Option<i64> = conn.query_row("SELECT proposal_id FROM opportunities WHERE id = ?1", params![opp.id], |r| r.get(0)).unwrap();
    assert_eq!(linked, Some(proposal_id), "opportunity → proposal kept");
    let report = integrity_report(&conn).unwrap();
    println!("integrity: {report:#?}");
    drop(conn);
    let _ = std::fs::remove_dir_all(&out);
}
