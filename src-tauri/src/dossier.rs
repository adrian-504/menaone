//! The company page in one round trip (foundations P4): its timeline activity,
//! dated notes, links, linked files and emails, read under one lock, so the
//! page paints once instead of section by section.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::activity::{note_entries_for, query_activity, ActivityEntry, ActivityFilter, CompanyNoteEntry};
use crate::db::DbState;
use crate::localfiles::{files_by_ids, LocalFileItem};
use crate::ms365::commands::emails_for_company;
use crate::ms365::models::EmailRecord;
use crate::v2_commands::links_for;
use crate::v2_models::EntityLink;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyDossier {
    pub activity: Vec<ActivityEntry>,
    pub note_entries: Vec<CompanyNoteEntry>,
    pub links: Vec<EntityLink>,
    pub files: Vec<LocalFileItem>,
    pub emails: Vec<EmailRecord>,
}

pub fn build_company_dossier(conn: &Connection, company_id: Option<i64>, company_name: Option<&str>) -> Result<CompanyDossier, String> {
    let e = |x: rusqlite::Error| x.to_string();
    let activity = query_activity(conn, &ActivityFilter { company_id, limit: Some(400), ..Default::default() }).map_err(e)?;
    let note_entries = note_entries_for(conn, company_id, company_name).map_err(e)?;
    let links = match company_id { Some(id) => links_for(conn, "company", id).map_err(e)?, None => vec![] };
    let file_ids: Vec<i64> = links.iter()
        .filter(|l| l.to_type == "company" && Some(l.to_id) == company_id && l.from_type == "msfile")
        .map(|l| l.from_id).collect();
    let files = files_by_ids(conn, &file_ids)?;
    let emails = match company_id { Some(id) => emails_for_company(conn, id).map_err(e)?, None => vec![] };
    Ok(CompanyDossier { activity, note_entries, links, files, emails })
}

#[tauri::command]
pub fn company_dossier(state: State<DbState>, company_id: Option<i64>, company_name: Option<String>) -> Result<CompanyDossier, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    build_company_dossier(&conn, company_id, company_name.as_deref())
}
