//! Saved lists (schema v28): company lists and smart lists.
//!
//! A list belongs to Companies or Contacts. A list with `filters` is a smart
//! list — a saved set of filters whose members are worked out by the app
//! each time it's opened. A company list without filters has hand-picked
//! members in `company_list_members`. Hand-picked contact lists stay in
//! `contact_list_defs` / `contact_list_members`, keyed by name as before.

use crate::commands::now_iso;
use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub const ENTITY_COMPANY: &str = "company";
pub const ENTITY_CONTACT: &str = "contact";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedList {
    pub id: i64,
    pub name: String,
    /// "company" or "contact".
    pub entity: String,
    /// Saved filters for a smart list; `None` for a hand-picked list.
    #[serde(default)]
    pub filters: Option<serde_json::Value>,
    /// Hand-picked members (company lists only).
    #[serde(default)]
    pub company_ids: Vec<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

pub fn migrate_saved_lists(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_lists (
           id           INTEGER PRIMARY KEY,
           name         TEXT NOT NULL,
           entity       TEXT NOT NULL CHECK (entity IN ('company', 'contact')),
           filters_json TEXT,
           created_at   TEXT,
           updated_at   TEXT,
           UNIQUE (entity, name)
         );
         CREATE TABLE IF NOT EXISTS company_list_members (
           list_id    INTEGER NOT NULL REFERENCES saved_lists(id) ON DELETE CASCADE,
           company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
           added_at   TEXT,
           PRIMARY KEY (list_id, company_id)
         );
         CREATE INDEX IF NOT EXISTS idx_company_list_members_company ON company_list_members(company_id);",
    )?;
    crate::db::add_sync_columns_to(conn, &["saved_lists"])
}

pub fn read_saved_lists(conn: &Connection) -> rusqlite::Result<Vec<SavedList>> {
    let mut stmt = conn.prepare("SELECT id, name, entity, filters_json, created_at, updated_at FROM saved_lists ORDER BY entity, name COLLATE NOCASE")?;
    let mut lists: Vec<SavedList> = stmt
        .query_map([], |r| {
            let filters: Option<String> = r.get(3)?;
            Ok(SavedList {
                id: r.get(0)?,
                name: r.get(1)?,
                entity: r.get(2)?,
                filters: filters.and_then(|f| serde_json::from_str(&f).ok()),
                company_ids: Vec::new(),
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut mstmt = conn.prepare("SELECT list_id, company_id FROM company_list_members ORDER BY company_id")?;
    let mut members: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    for row in mstmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (list, company) = row?;
        members.entry(list).or_default().push(company);
    }
    for l in &mut lists {
        l.company_ids = members.remove(&l.id).unwrap_or_default();
    }
    Ok(lists)
}

fn read_one(conn: &Connection, id: i64) -> Result<SavedList, String> {
    read_saved_lists(conn).map_err(err)?.into_iter().find(|l| l.id == id).ok_or_else(|| "List not found.".to_string())
}

/// Creates (id 0) or renames / re-filters a list. Members are changed with
/// `set_list_companies`, never here.
pub fn upsert_saved_list(conn: &Connection, list: &SavedList) -> Result<SavedList, String> {
    let name = list.name.trim();
    if name.is_empty() {
        return Err("A list needs a name.".into());
    }
    if list.entity != ENTITY_COMPANY && list.entity != ENTITY_CONTACT {
        return Err("A list belongs to companies or contacts.".into());
    }
    if list.entity == ENTITY_CONTACT && list.filters.is_none() {
        return Err("Hand-picked contact lists are managed from Contacts → Manage lists.".into());
    }
    if let Some(f) = &list.filters {
        if !f.is_object() {
            return Err("The list's filters are not in the expected shape.".into());
        }
    }
    let clash: Option<i64> = conn
        .query_row(
            "SELECT id FROM saved_lists WHERE entity = ?1 AND name = ?2 COLLATE NOCASE AND id <> ?3",
            params![list.entity, name, list.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let contact_clash = list.entity == ENTITY_CONTACT
        && conn
            .query_row("SELECT 1 FROM contact_list_defs WHERE name = ?1 COLLATE NOCASE", params![name], |_| Ok(()))
            .optional()
            .map_err(err)?
            .is_some();
    if clash.is_some() || contact_clash {
        return Err(format!("There is already a list called \"{name}\"."));
    }
    let filters = list.filters.as_ref().map(|f| f.to_string());
    let now = now_iso();
    let id = if list.id > 0 {
        let changed = conn
            .execute(
                "UPDATE saved_lists SET name = ?1, filters_json = ?2, updated_at = ?3 WHERE id = ?4",
                params![name, filters, now, list.id],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err("List not found.".into());
        }
        list.id
    } else {
        conn.execute(
            "INSERT INTO saved_lists (name, entity, filters_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![name, list.entity, filters, now],
        )
        .map_err(err)?;
        conn.last_insert_rowid()
    };
    read_one(conn, id)
}

/// Adds and removes hand-picked companies; unknown company ids are skipped.
pub fn set_list_companies(conn: &mut Connection, list_id: i64, add: &[i64], remove: &[i64]) -> Result<SavedList, String> {
    let smart: Option<Option<String>> = conn
        .query_row("SELECT filters_json FROM saved_lists WHERE id = ?1 AND entity = 'company'", params![list_id], |r| r.get(0))
        .optional()
        .map_err(err)?;
    match smart {
        None => return Err("Company list not found.".into()),
        Some(Some(_)) => return Err("A smart list picks its companies from its filters.".into()),
        Some(None) => {}
    }
    let tx = conn.transaction().map_err(err)?;
    let now = now_iso();
    for id in add {
        tx.execute(
            "INSERT OR IGNORE INTO company_list_members (list_id, company_id, added_at) SELECT ?1, id, ?2 FROM companies WHERE id = ?3",
            params![list_id, now, id],
        )
        .map_err(err)?;
    }
    for id in remove {
        tx.execute("DELETE FROM company_list_members WHERE list_id = ?1 AND company_id = ?2", params![list_id, id]).map_err(err)?;
    }
    tx.execute("UPDATE saved_lists SET updated_at = ?1 WHERE id = ?2", params![now, list_id]).map_err(err)?;
    tx.commit().map_err(err)?;
    read_one(conn, list_id)
}

#[tauri::command]
pub fn get_saved_lists(state: State<DbState>) -> CmdResult<Vec<SavedList>> {
    let conn = state.0.lock().map_err(err)?;
    read_saved_lists(&conn).map_err(err)
}

#[tauri::command]
pub fn save_saved_list(state: State<DbState>, list: SavedList) -> CmdResult<SavedList> {
    let conn = state.0.lock().map_err(err)?;
    upsert_saved_list(&conn, &list)
}

#[tauri::command]
pub fn delete_saved_list(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM saved_lists WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn set_saved_list_companies(state: State<DbState>, list_id: i64, add: Vec<i64>, remove: Vec<i64>) -> CmdResult<SavedList> {
    let mut conn = state.0.lock().map_err(err)?;
    set_list_companies(&mut conn, list_id, &add, &remove)
}
