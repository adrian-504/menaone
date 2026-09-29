// Template emails (owner, 29-Sep-2026): seeded templates, a placeholder
// signature, and edits from Settings. Scratch databases only.
use menabig_tracker_lib::db::{init_connection, latest_schema_version, schema_version};
use menabig_tracker_lib::email_templates::{delete_template, migrate_email_templates, read_templates, save_template, EmailTemplate, SIGNATURE_NAME};
use rusqlite::Connection;

fn fresh_db(tag: &str) -> Connection {
    let path = std::env::temp_dir().join(format!("menabig_email_templates_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    init_connection(&path).expect("init db")
}

#[test]
fn migration_43_seeds_seven_templates_and_a_placeholder_signature() {
    let conn = fresh_db("seed");
    assert!(latest_schema_version() >= 43);
    assert_eq!(schema_version(&conn).unwrap(), latest_schema_version());
    let all = read_templates(&conn).unwrap();
    let names: Vec<&str> = all.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, vec!["Sending a proposal", "Following up on a proposal", "After a call — next steps", "Sending the NDA",
        "Thank you for the information", "Introduction · after meeting", "Introduction · first contact", SIGNATURE_NAME]);
    let sig = all.iter().find(|t| t.name == SIGNATURE_NAME).unwrap();
    assert!(sig.body.starts_with("{my_name}\n{my_title}"), "the signature is a placeholder");
    assert!(!sig.body.contains('+'), "no phone number in the seed");
    let first = all.iter().find(|t| t.name == "Introduction · first contact").unwrap();
    assert!(first.body.contains("I am writing because {company} {reason_for_writing}."));
    assert!(first.body.contains("MENA Business Investment Group is a Spanish-founded consultancy"));
}

#[test]
fn running_it_again_never_overwrites_an_edited_template() {
    let conn = fresh_db("rerun");
    let mut t = read_templates(&conn).unwrap().into_iter().find(|t| t.name == "Sending the NDA").unwrap();
    t.body = "Edited".into();
    save_template(&conn, &t).unwrap();
    migrate_email_templates(&conn).unwrap();
    let all = read_templates(&conn).unwrap();
    assert_eq!(all.len(), 8);
    assert_eq!(all.iter().find(|x| x.name == "Sending the NDA").unwrap().body, "Edited");
}

#[test]
fn a_new_template_goes_last_and_the_signature_cannot_be_deleted() {
    let conn = fresh_db("crud");
    let added = save_template(&conn, &EmailTemplate { name: " Renewal reminder ".into(), subject: "{company} renewal".into(), body: "Dear {first_name},".into(), ..Default::default() }).unwrap();
    assert_eq!(added.name, "Renewal reminder");
    assert_eq!(read_templates(&conn).unwrap().last().unwrap().name, "Renewal reminder");
    assert!(save_template(&conn, &EmailTemplate { name: "  ".into(), ..Default::default() }).is_err());
    let sig = read_templates(&conn).unwrap().into_iter().find(|t| t.name == SIGNATURE_NAME).unwrap();
    delete_template(&conn, sig.id).unwrap();
    delete_template(&conn, added.id).unwrap();
    let names: Vec<String> = read_templates(&conn).unwrap().into_iter().map(|t| t.name).collect();
    assert!(names.contains(&SIGNATURE_NAME.to_string()));
    assert!(!names.contains(&"Renewal reminder".to_string()));
}
