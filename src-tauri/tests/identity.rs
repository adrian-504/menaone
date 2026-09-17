// Identity groundwork: the signed-in account linked to a team member, owner
// names linked to the team directory, and activity stamped with the user.
// Fictional people and companies only.
use menabig_tracker_lib::commercial::{upsert_team_member, TeamMember};
use menabig_tracker_lib::db::init_connection;
use menabig_tracker_lib::identity::{clear_current_user, current_user_id, link_current_user, relink_owners};
use menabig_tracker_lib::opportunities::{create_company_named, save_opportunity_row};
use menabig_tracker_lib::v2_commands::save_project_row;
use menabig_tracker_lib::v2_models::{Opportunity, Project};
use rusqlite::{params, Connection};

fn fresh_db(tag: &str) -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("menabig_identity_{tag}_{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    (path.clone(), init_connection(&path).expect("init db"))
}

fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn member(conn: &Connection, name: &str, email: &str) -> i64 {
    upsert_team_member(conn, &TeamMember { name: name.into(), email: Some(email.into()), active: true, ..Default::default() }).unwrap()
}

#[test]
fn schema_has_identity_columns() {
    let (path, conn) = fresh_db("schema");
    for (table, col) in [("team_members", "entra_object_id"), ("companies", "owner_id"), ("opportunities", "owner_id"), ("projects", "owner_id"), ("activity", "actor_id")] {
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"), params![col], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "{table}.{col}");
    }
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn saving_an_owner_name_links_the_team_member_in_one_edit() {
    let (path, mut conn) = fresh_db("owner");
    let jane = member(&conn, "Jane Tester", "jane@example.test");
    let company = create_company_named(&conn, "Contoso Logistics").unwrap().unwrap();

    let opp = save_opportunity_row(&mut conn, &Opportunity {
        name: "Contoso Saudization".into(), company_id: Some(company), stage: "Lead".into(), status: "Open".into(),
        owner: Some("  jane TESTER ".into()), ..Default::default()
    }).unwrap();
    let (owner_id, version): (Option<i64>, i64) =
        conn.query_row("SELECT owner_id, row_version FROM opportunities WHERE id = ?1", params![opp.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(owner_id, Some(jane), "matched ignoring case and spaces");

    let opp = save_opportunity_row(&mut conn, &Opportunity { owner: Some("Referral".into()), ..opp }).unwrap();
    let (owner_id, after): (Option<i64>, i64) =
        conn.query_row("SELECT owner_id, row_version FROM opportunities WHERE id = ?1", params![opp.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(owner_id, None, "a name that isn't a team member isn't guessed");
    assert_eq!(after, version + 1, "changing the owner is one edit, not two");

    let project = save_project_row(&mut conn, &Project {
        name: "Contoso Delivery".into(), r#type: "client".into(), status: "Planning".into(), priority: "High".into(),
        owner: Some("Jane Tester".into()), ..Default::default()
    }).unwrap();
    assert_eq!(conn.query_row("SELECT owner_id FROM projects WHERE id = ?1", params![project.id], |r| r.get::<_, Option<i64>>(0)).unwrap(), Some(jane));
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn renames_follow_and_new_members_pick_up_their_records() {
    let (path, conn) = fresh_db("rename");
    let company = create_company_named(&conn, "Fabrikam Trading").unwrap().unwrap();
    conn.execute("UPDATE companies SET owner = 'Omar Sample' WHERE id = ?1", params![company]).unwrap();
    assert_eq!(one::<Option<i64>>(&conn, "SELECT owner_id FROM companies"), None);

    // Adding the person to the team directory links what they already own.
    let omar = member(&conn, "Omar Sample", "omar@example.test");
    assert_eq!(one::<Option<i64>>(&conn, "SELECT owner_id FROM companies"), Some(omar));

    // Renaming them updates the name shown on their records.
    upsert_team_member(&conn, &TeamMember { id: omar, name: "Omar A. Sample".into(), email: Some("omar@example.test".into()), active: true, ..Default::default() }).unwrap();
    assert_eq!(one::<String>(&conn, "SELECT owner FROM companies"), "Omar A. Sample");
    assert_eq!(one::<Option<i64>>(&conn, "SELECT owner_id FROM companies"), Some(omar));

    // Removing them keeps the record and its name; only the link clears.
    conn.execute("DELETE FROM team_members WHERE id = ?1", params![omar]).unwrap();
    assert_eq!(one::<Option<i64>>(&conn, "SELECT owner_id FROM companies"), None);
    assert_eq!(one::<String>(&conn, "SELECT owner FROM companies"), "Omar A. Sample");

    // A relink with nothing to link changes nothing.
    let version: i64 = one(&conn, "SELECT row_version FROM companies");
    assert_eq!(relink_owners(&conn).unwrap(), 0);
    assert_eq!(one::<i64>(&conn, "SELECT row_version FROM companies"), version);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn signing_in_links_the_account_to_the_right_team_member() {
    let (path, conn) = fresh_db("signin");
    let jane = member(&conn, "Jane Tester", "Jane@Example.test");
    let _other = member(&conn, "Omar Sample", "omar@example.test");

    // First sign-in: matched by email, and the object id is remembered.
    let id = link_current_user(&conn, "oid-jane-0001", Some("jane@example.test"), Some("Jane Tester")).unwrap();
    assert_eq!(id, jane);
    assert_eq!(current_user_id(&conn).unwrap(), Some(jane));
    assert_eq!(one::<String>(&conn, "SELECT entra_object_id FROM team_members WHERE name = 'Jane Tester'"), "oid-jane-0001");

    // A changed email later still finds the same person by object id.
    assert_eq!(link_current_user(&conn, "oid-jane-0001", Some("jane.tester@example.test"), None).unwrap(), jane);

    // Someone not in the directory is added rather than attached to another member.
    let members_before: i64 = one(&conn, "SELECT COUNT(*) FROM team_members");
    let newcomer = link_current_user(&conn, "oid-new-0002", Some("lee@example.test"), Some("Lee Example")).unwrap();
    assert!(newcomer != jane);
    assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM team_members"), members_before + 1);
    assert_eq!(current_user_id(&conn).unwrap(), Some(newcomer));

    clear_current_user(&conn).unwrap();
    assert_eq!(current_user_id(&conn).unwrap(), None);
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[test]
fn activity_records_who_was_signed_in() {
    let (path, conn) = fresh_db("activity");
    create_company_named(&conn, "Before Sign-in Ltd").unwrap();
    assert_eq!(one::<Option<i64>>(&conn, "SELECT actor_id FROM activity ORDER BY id DESC LIMIT 1"), None, "no user yet");

    let jane = member(&conn, "Jane Tester", "jane@example.test");
    link_current_user(&conn, "oid-jane-0001", Some("jane@example.test"), None).unwrap();
    create_company_named(&conn, "Northwind Services").unwrap();
    assert_eq!(one::<Option<i64>>(&conn, "SELECT actor_id FROM activity ORDER BY id DESC LIMIT 1"), Some(jane));

    let entries = menabig_tracker_lib::activity::query_activity(&conn, &Default::default()).unwrap();
    let latest = entries.iter().find(|e| e.entity_label.as_deref() == Some("Northwind Services")).unwrap();
    assert_eq!(latest.actor.as_deref(), Some("Jane Tester"), "the feed names them");
    drop(conn);
    let _ = std::fs::remove_file(path);
}
