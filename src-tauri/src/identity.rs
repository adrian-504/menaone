//! Who is using MENA One, and who owns a record. Groundwork for colleagues
//! sharing the data: the team directory (`team_members`) is the user list,
//! the signed-in Microsoft account is linked to one member by its permanent
//! Entra object id, and companies, opportunities and projects carry an
//! `owner_id` next to their free-text `owner`.
//!
//! Everything here is local. MENA BIG is a single Microsoft tenant, so the
//! tenant id is a constant rather than a key on every row
//! (docs/system-audit/ARCHITECTURE_DECISIONS_REQUIRED.md Q1).

use crate::db::DbState;
use crate::ms365::models::Ms365State;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

/// `app_meta` key for the team member using this device. Written by Rust
/// only; `set_app_meta` refuses it (commands::UI_META_KEYS).
pub const CURRENT_USER_KEY: &str = "current_user_id";

/// The team member an owner name refers to: same name ignoring case and
/// surrounding spaces, active members first. `{n}` is the SQL parameter
/// holding the name. Used inside the save statement itself, so setting the
/// link doesn't count as a second edit of the record.
pub fn owner_id_for_name_sql(n: usize) -> String {
    format!(
        "(SELECT id FROM team_members WHERE TRIM(?{n}) <> '' AND LOWER(TRIM(name)) = LOWER(TRIM(?{n})) ORDER BY active DESC, id LIMIT 1)"
    )
}

/// Tables whose `owner` text is linked to the team directory.
pub const OWNED_TABLES: [&str; 3] = ["companies", "opportunities", "projects"];

/// Links owner names that match a team member but aren't linked yet — after a
/// member is added or renamed, or records arrive through an import. Rows that
/// already have the right link aren't touched, so nothing counts as edited.
pub fn relink_owners(conn: &Connection) -> rusqlite::Result<usize> {
    let mut linked = 0;
    for table in OWNED_TABLES {
        linked += conn.execute(
            &format!(
                "UPDATE {table} SET owner_id = (SELECT t.id FROM team_members t
                     WHERE LOWER(TRIM(t.name)) = LOWER(TRIM({table}.owner)) ORDER BY t.active DESC, t.id LIMIT 1)
                 WHERE owner_id IS NULL AND TRIM(COALESCE(owner, '')) <> ''
                   AND EXISTS (SELECT 1 FROM team_members t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM({table}.owner)))"
            ),
            [],
        )?;
    }
    Ok(linked)
}

/// A team member's new name follows onto the records they own.
pub fn rename_owner(conn: &Connection, member_id: i64, new_name: &str) -> rusqlite::Result<()> {
    for table in OWNED_TABLES {
        conn.execute(
            &format!("UPDATE {table} SET owner = ?2 WHERE owner_id = ?1 AND owner IS NOT ?2"),
            params![member_id, new_name.trim()],
        )?;
    }
    Ok(())
}

/// Links the signed-in Microsoft account to a team member and records them as
/// this device's user. Matching order: the member already carrying this
/// object id; otherwise the member with the same email who isn't linked to a
/// different account; otherwise a new member is added for them.
pub fn link_current_user(conn: &Connection, object_id: &str, email: Option<&str>, display_name: Option<&str>) -> rusqlite::Result<i64> {
    let object_id = object_id.trim();
    let email = email.map(str::trim).filter(|e| !e.is_empty());
    let by_object: Option<i64> = conn
        .query_row("SELECT id FROM team_members WHERE entra_object_id = ?1", params![object_id], |r| r.get(0))
        .optional()?;
    let id = match by_object {
        Some(id) => id,
        None => {
            let by_email: Option<i64> = match email {
                Some(e) => conn
                    .query_row(
                        "SELECT id FROM team_members WHERE LOWER(TRIM(email)) = LOWER(?1) AND entra_object_id IS NULL
                         ORDER BY active DESC, id LIMIT 1",
                        params![e],
                        |r| r.get(0),
                    )
                    .optional()?,
                None => None,
            };
            match by_email {
                Some(id) => {
                    conn.execute("UPDATE team_members SET entra_object_id = ?2 WHERE id = ?1", params![id, object_id])?;
                    id
                }
                None => {
                    let now = crate::commands::now_iso();
                    let name = display_name.map(str::trim).filter(|n| !n.is_empty()).or(email).unwrap_or("Me");
                    conn.execute(
                        "INSERT INTO team_members (name, email, active, is_reviewer, entra_object_id, created_at, updated_at)
                         VALUES (?1, ?2, 1, 0, ?3, ?4, ?4)",
                        params![name, email, object_id, now],
                    )?;
                    let id = conn.last_insert_rowid();
                    relink_owners(conn)?;
                    id
                }
            }
        }
    };
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![CURRENT_USER_KEY, id.to_string()],
    )?;
    Ok(id)
}

/// This device's user, if one is recorded and still in the team directory.
pub fn current_user_id(conn: &Connection) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT t.id FROM app_meta m JOIN team_members t ON t.id = CAST(m.value AS INTEGER) WHERE m.key = ?1",
        params![CURRENT_USER_KEY],
        |r| r.get(0),
    )
    .optional()
}

/// Signing out of Microsoft ends the link between this device and a person.
pub fn clear_current_user(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM app_meta WHERE key = ?1", params![CURRENT_USER_KEY])?;
    Ok(())
}

/// The team member using this device, linking the Microsoft account on first
/// use (a device signed in before this existed has no link yet). Also links
/// any owner names that match the directory. Never fails the app's start:
/// without a Microsoft connection the answer is simply "not known".
#[tauri::command]
pub async fn identity_current_user(db: State<'_, DbState>, ms: State<'_, Ms365State>) -> Result<Option<i64>, String> {
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        relink_owners(&conn).map_err(|e| e.to_string())?;
        if let Some(id) = current_user_id(&conn).map_err(|e| e.to_string())? {
            return Ok(Some(id));
        }
    }
    let Ok(token) = crate::ms365::commands::access_token_if_connected(&db, &ms).await else { return Ok(None) };
    let Some(token) = token else { return Ok(None) };
    let Ok(profile) = crate::ms365::graph::get_profile(&token).await else { return Ok(None) };
    let Some(object_id) = profile.id.as_deref() else { return Ok(None) };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let email = profile.mail.as_deref().or(profile.user_principal_name.as_deref());
    link_current_user(&conn, object_id, email, profile.display_name.as_deref()).map(Some).map_err(|e| e.to_string())
}
