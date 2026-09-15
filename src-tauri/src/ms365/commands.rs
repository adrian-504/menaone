use super::auth;
use super::graph;
use super::models::{EmailRecord, MicrosoftAccountStatus, Ms365State};
use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use std::time::Duration;
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

const CLIENT_ID_KEY: &str = "ms365_client_id";
const TENANT_ID_KEY: &str = "ms365_tenant_id";

fn get_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .filter(|s| !s.trim().is_empty())
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn get_client_id(conn: &Connection) -> Option<String> { get_meta(conn, CLIENT_ID_KEY) }
fn set_client_id_db(conn: &Connection, client_id: &str) -> rusqlite::Result<()> { set_meta(conn, CLIENT_ID_KEY, client_id) }

/// Directory (tenant) ID or domain from the user's Azure app registration.
/// Required in practice: single-tenant app registrations (the default for
/// anything created after 2018-10-15, and what Settings' walkthrough guides
/// the user to create) reject the generic `/common` endpoint with AADSTS50194.
fn get_tenant_id(conn: &Connection) -> Option<String> { get_meta(conn, TENANT_ID_KEY) }
fn set_tenant_id_db(conn: &Connection, tenant_id: &str) -> rusqlite::Result<()> { set_meta(conn, TENANT_ID_KEY, tenant_id) }

fn read_account_status(conn: &Connection) -> MicrosoftAccountStatus {
    let has_client_id = get_client_id(conn).is_some();
    let row = conn
        .query_row(
            "SELECT status, account_email, display_name, connected_at, last_sync_at FROM microsoft_account WHERE id = 1",
            [],
            |r| {
                Ok(MicrosoftAccountStatus {
                    status: r.get(0)?,
                    account_email: r.get(1)?,
                    display_name: r.get(2)?,
                    connected_at: r.get(3)?,
                    last_sync_at: r.get(4)?,
                    error_message: None,
                    has_client_id,
                })
            },
        )
        .optional()
        .ok()
        .flatten();
    row.unwrap_or(MicrosoftAccountStatus {
        status: "disconnected".into(),
        has_client_id,
        ..Default::default()
    })
}

fn write_account_status(
    conn: &Connection,
    status: &str,
    account_email: Option<&str>,
    display_name: Option<&str>,
    touch_connected_at: bool,
    touch_sync_at: bool,
) -> rusqlite::Result<()> {
    let now = crate::commands::now_iso();
    conn.execute(
        "INSERT INTO microsoft_account (id, status, account_email, display_name, connected_at, last_sync_at)
         VALUES (1, ?1, ?2, ?3, CASE WHEN ?4 THEN ?5 ELSE NULL END, CASE WHEN ?6 THEN ?5 ELSE NULL END)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           account_email = COALESCE(?2, microsoft_account.account_email),
           display_name = COALESCE(?3, microsoft_account.display_name),
           connected_at = CASE WHEN ?4 THEN ?5 ELSE microsoft_account.connected_at END,
           last_sync_at = CASE WHEN ?6 THEN ?5 ELSE microsoft_account.last_sync_at END",
        params![status, account_email, display_name, touch_connected_at, now, touch_sync_at],
    )?;
    Ok(())
}

#[tauri::command]
pub fn ms365_get_client_id(state: State<DbState>) -> CmdResult<Option<String>> {
    let conn = state.0.lock().map_err(err)?;
    Ok(get_client_id(&conn))
}

#[tauri::command]
pub fn ms365_set_client_id(state: State<DbState>, client_id: String) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    set_client_id_db(&conn, client_id.trim()).map_err(err)
}

#[tauri::command]
pub fn ms365_get_tenant_id(state: State<DbState>) -> CmdResult<Option<String>> {
    let conn = state.0.lock().map_err(err)?;
    Ok(get_tenant_id(&conn))
}

#[tauri::command]
pub fn ms365_set_tenant_id(state: State<DbState>, tenant_id: String) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    set_tenant_id_db(&conn, tenant_id.trim()).map_err(err)
}

#[tauri::command]
pub fn ms365_status(state: State<DbState>) -> CmdResult<MicrosoftAccountStatus> {
    let conn = state.0.lock().map_err(err)?;
    Ok(read_account_status(&conn))
}

/// Ensures the in-memory access-token cache holds a token valid for at least
/// another 60 seconds, refreshing via the Keychain-stored refresh token if
/// not. This is the single choke point every Graph-calling command routes
/// through, so token lifecycle logic lives in exactly one place.
async fn ensure_access_token(db: &State<'_, DbState>, ms: &State<'_, Ms365State>) -> CmdResult<String> {
    {
        let cache = ms.0.lock().map_err(err)?;
        if let Some(token) = &cache.access_token {
            if cache.expires_at - 60 > now_unix() {
                return Ok(token.clone());
            }
        }
    }
    let (client_id, tenant_id) = {
        let conn = db.0.lock().map_err(err)?;
        let client_id = get_client_id(&conn).ok_or_else(|| "Microsoft 365 Client ID is not configured yet — set it up in Settings.".to_string())?;
        let tenant_id = get_tenant_id(&conn).unwrap_or_default();
        (client_id, tenant_id)
    }; // conn dropped here — load_refresh_token() below shells out to /usr/bin/security
       // (a blocking subprocess spawn) and must never run while the DB mutex is held,
       // or every other command in the app stalls behind it for the duration.
    let refresh_token = auth::load_refresh_token();
    let refresh_token = match refresh_token {
        Some(t) => t,
        None => {
            // The DB may still say "connected" from a prior session — the
            // Keychain is the actual source of truth for whether we can act,
            // so correct the DB status here rather than leave Settings
            // showing a connected state that Graph calls can't actually use
            // (e.g. after a macOS Keychain access grant was invalidated).
            let conn = db.0.lock().map_err(err)?;
            let _ = write_account_status(&conn, "error", None, None, false, false);
            return Err("Microsoft 365 sign-in was lost (the saved credential could no longer be read) — reconnect in Settings.".to_string());
        }
    };

    let result = auth::refresh_access_token(&client_id, &tenant_id, &refresh_token).await;
    match result {
        Ok(tokens) => {
            if let Some(new_refresh) = &tokens.refresh_token {
                let _ = auth::store_refresh_token(new_refresh);
            }
            {
                let mut cache = ms.0.lock().map_err(err)?;
                cache.access_token = Some(tokens.access_token.clone());
                cache.expires_at = now_unix() + tokens.expires_in;
            }
            let conn = db.0.lock().map_err(err)?;
            let _ = write_account_status(&conn, "connected", None, None, false, false);
            Ok(tokens.access_token)
        }
        Err(e) => {
            let conn = db.0.lock().map_err(err)?;
            let _ = write_account_status(&conn, "expired", None, None, false, false);
            Err(format!("Microsoft 365 sign-in has expired — please reconnect in Settings. ({e})"))
        }
    }
}

#[tauri::command]
pub async fn ms365_connect(db: State<'_, DbState>, ms: State<'_, Ms365State>) -> CmdResult<MicrosoftAccountStatus> {
    let (client_id, tenant_id) = {
        let conn = db.0.lock().map_err(err)?;
        let client_id = get_client_id(&conn).ok_or_else(|| "Set your Microsoft 365 Client ID first (see the setup steps in Settings).".to_string())?;
        (client_id, get_tenant_id(&conn).unwrap_or_default())
    };

    let verifier = auth::generate_code_verifier();
    let challenge = auth::code_challenge_s256(&verifier);
    let state_token = auth::generate_state();
    let authorize_url = auth::build_authorize_url(&client_id, &tenant_id, &state_token, &challenge);

    tauri_plugin_opener::open_url(&authorize_url, None::<&str>)
        .map_err(|e| format!("Could not open your browser to sign in: {e}"))?;

    let expected_state = state_token.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        auth::wait_for_redirect(&expected_state, Duration::from_secs(180))
    })
    .await
    .map_err(err)??;

    let tokens = auth::exchange_code_for_tokens(&client_id, &tenant_id, &code, &verifier).await?;
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| "Microsoft did not return a refresh token — check that 'offline_access' is granted.".to_string())?;
    auth::store_refresh_token(&refresh_token)?;
    {
        let mut cache = ms.0.lock().map_err(err)?;
        cache.access_token = Some(tokens.access_token.clone());
        cache.expires_at = now_unix() + tokens.expires_in;
    }

    let profile = graph::get_profile(&tokens.access_token).await.ok();
    let conn = db.0.lock().map_err(err)?;
    write_account_status(
        &conn,
        "connected",
        profile.as_ref().and_then(|p| p.mail.as_deref().or(p.user_principal_name.as_deref())),
        profile.as_ref().and_then(|p| p.display_name.as_deref()),
        true,
        true,
    )
    .map_err(err)?;
    Ok(read_account_status(&conn))
}

#[tauri::command]
pub fn ms365_disconnect(db: State<DbState>, ms: State<Ms365State>) -> CmdResult<MicrosoftAccountStatus> {
    auth::delete_refresh_token()?;
    {
        let mut cache = ms.0.lock().map_err(err)?;
        *cache = Default::default();
    }
    let conn = db.0.lock().map_err(err)?;
    write_account_status(&conn, "disconnected", None, None, false, false).map_err(err)?;
    // connected_at is meaningless once disconnected; clear it explicitly (the
    // upsert above only touches it when touch_connected_at is true).
    conn.execute("UPDATE microsoft_account SET connected_at = NULL WHERE id = 1", [])
        .map_err(err)?;
    Ok(read_account_status(&conn))
}

// ═══════════════════════════ Email (Action Required) ═══════════════════════════

fn row_to_email(r: &rusqlite::Row) -> rusqlite::Result<EmailRecord> {
    Ok(EmailRecord {
        id: r.get(0)?,
        message_id: r.get(1)?,
        conversation_id: r.get(2)?,
        subject: r.get(3)?,
        sender_name: r.get(4)?,
        sender_email: r.get(5)?,
        preview: r.get(6)?,
        received_at: r.get(7)?,
        flag_status: r.get(8)?,
        flag_due_at: r.get(9)?,
        web_link: r.get(10)?,
        is_read: r.get::<_, i64>(11)? != 0,
        company_name: r.get(12)?,
        company_id: r.get(13)?,
    })
}
const EMAIL_SELECT: &str = "SELECT id, message_id, conversation_id, subject, sender_name, sender_email, preview, received_at, flag_status, flag_due_at, web_link, is_read, company_name, company_id FROM emails";

/// Re-syncs the locally cached flagged-email set from Outlook: upserts every
/// currently-flagged message and removes any cached row that is no longer
/// flagged (covers both "unflagged externally" and "marked complete
/// externally" — Part 4: "when an email is unflagged externally in Outlook,
/// synchronize the change back into MENA BIG").
#[tauri::command]
pub async fn ms365_sync_flagged_emails(db: State<'_, DbState>, ms: State<'_, Ms365State>) -> CmdResult<Vec<EmailRecord>> {
    let token = ensure_access_token(&db, &ms).await?;
    let (messages, complete) = graph::list_flagged_messages(&token).await?;

    let conn = db.0.lock().map_err(err)?;
    let now = crate::commands::now_iso();
    let seen_ids: Vec<String> = messages.iter().map(|m| m.id.clone()).collect();

    for m in &messages {
        let (sender_name, sender_email) = m
            .from
            .as_ref()
            .map(|f| (f.email_address.name.clone(), f.email_address.address.clone()))
            .unwrap_or((None, None));
        let (flag_status, flag_due_at) = m
            .flag
            .as_ref()
            .map(|f| (f.flag_status.clone(), f.due_date_time.as_ref().map(|d| utc_instant(&d.date_time, "UTC"))))
            .unwrap_or(("flagged".to_string(), None));
        let recipients_json = people_json(m.to_recipients.iter().chain(m.cc_recipients.iter()));
        conn.execute(
            "INSERT INTO emails (message_id, conversation_id, subject, sender_name, sender_email, preview, received_at, flag_status, flag_due_at, web_link, is_read, last_synced_at, created_at, recipients_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12,?13)
             ON CONFLICT(message_id) DO UPDATE SET
               conversation_id=excluded.conversation_id, subject=excluded.subject, sender_name=excluded.sender_name,
               sender_email=excluded.sender_email, preview=excluded.preview, received_at=excluded.received_at,
               flag_status=excluded.flag_status, flag_due_at=excluded.flag_due_at, web_link=excluded.web_link,
               is_read=excluded.is_read, last_synced_at=excluded.last_synced_at, recipients_json=excluded.recipients_json
             WHERE emails.subject IS NOT excluded.subject OR emails.flag_status IS NOT excluded.flag_status
                OR emails.flag_due_at IS NOT excluded.flag_due_at OR emails.is_read IS NOT excluded.is_read
                OR emails.preview IS NOT excluded.preview OR emails.recipients_json IS NOT excluded.recipients_json
                OR emails.received_at IS NOT excluded.received_at OR emails.sender_email IS NOT excluded.sender_email",
            params![
                m.id, m.conversation_id, m.subject, sender_name, sender_email, m.body_preview,
                m.received_date_time, flag_status, flag_due_at, m.web_link, m.is_read.unwrap_or(false) as i64, now,
                recipients_json,
            ],
        ).map_err(err)?;
    }

    // Clearing rows that are no longer flagged needs the full list; if it was
    // cut short, keep everything rather than drop mail that is still flagged.
    if !complete {
        let _ = write_account_status(&conn, "connected", None, None, false, true);
        let mut stmt = conn.prepare(&format!("{EMAIL_SELECT} WHERE flag_status = 'flagged' ORDER BY received_at DESC")).map_err(err)?;
        let rows = stmt.query_map([], row_to_email).map_err(err)?;
        return rows.collect::<rusqlite::Result<_>>().map_err(err);
    }
    let not_seen_clause = if seen_ids.is_empty() { String::new() } else { format!("AND message_id NOT IN ({})", seen_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",")) };
    let seen_params: Vec<&dyn rusqlite::ToSql> = seen_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    // Rows no longer flagged in Outlook: if nothing in the work graph links to
    // them, drop them (Outlook is the source of truth for "flagged" — no
    // reason to keep an unlinked cache row). If something DOES link to them
    // (Part 4: emails stay part of the work graph after they're handled),
    // keep the row but stamp it not-flagged so it drops out of Action
    // Required while remaining resolvable for relationship display.
    conn.execute(
        &format!(
            "UPDATE emails SET flag_status = 'notFlagged' WHERE flag_status = 'flagged' {not_seen_clause}
             AND id IN (SELECT from_id FROM entity_links WHERE from_type = 'email' UNION SELECT to_id FROM entity_links WHERE to_type = 'email')"
        ),
        seen_params.as_slice(),
    ).map_err(err)?;
    conn.execute(
        &format!(
            "DELETE FROM emails WHERE flag_status = 'flagged' {not_seen_clause}
             AND id NOT IN (SELECT from_id FROM entity_links WHERE from_type = 'email' UNION SELECT to_id FROM entity_links WHERE to_type = 'email')"
        ),
        seen_params.as_slice(),
    ).map_err(err)?;
    let _ = write_account_status(&conn, "connected", None, None, false, true);

    let mut stmt = conn.prepare(&format!("{EMAIL_SELECT} WHERE flag_status = 'flagged' ORDER BY received_at DESC")).map_err(err)?;
    let rows = stmt.query_map([], row_to_email).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[tauri::command]
pub fn ms365_get_cached_emails(state: State<DbState>) -> CmdResult<Vec<EmailRecord>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn.prepare(&format!("{EMAIL_SELECT} WHERE flag_status = 'flagged' ORDER BY received_at DESC")).map_err(err)?;
    let rows = stmt.query_map([], row_to_email).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Emails from or to one address (a contact's page), newest first.
#[tauri::command]
pub fn ms365_get_emails_by_address(state: State<DbState>, address: String) -> CmdResult<Vec<EmailRecord>> {
    let address = address.trim().to_lowercase();
    if address.is_empty() { return Ok(vec![]); }
    let conn = state.0.lock().map_err(err)?;
    let sql = format!("{EMAIL_SELECT} WHERE lower(sender_email) = ?1 OR lower(COALESCE(recipients_json, '')) LIKE '%' || ?1 || '%' ORDER BY received_at DESC LIMIT 50");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt.query_map(params![address], row_to_email).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Resolves specific email ids regardless of flag_status — used to render
/// linked emails on a Project/Company/Contact workspace even after the email
/// itself was completed/unflagged and dropped out of Action Required.
#[tauri::command]
pub fn ms365_get_emails_by_ids(state: State<DbState>, ids: Vec<i64>) -> CmdResult<Vec<EmailRecord>> {
    if ids.is_empty() { return Ok(vec![]); }
    let conn = state.0.lock().map_err(err)?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("{EMAIL_SELECT} WHERE id IN ({placeholders}) ORDER BY received_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let params_dyn: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(params_dyn.as_slice(), row_to_email).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Emails linked to a company through `emails.company_id`.
#[tauri::command]
pub fn ms365_get_emails_by_company(state: State<DbState>, company_id: i64) -> CmdResult<Vec<EmailRecord>> {
    let conn = state.0.lock().map_err(err)?;
    let sql = format!("{EMAIL_SELECT} WHERE company_id = ?1 ORDER BY received_at DESC LIMIT 50");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt.query_map(params![company_id], row_to_email).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// `complete` marks the flag done (kept in Outlook's flag history); `false`
/// clears the flag entirely. Either way the message drops out of "Action
/// Required" on the next sync, matching Outlook's own behavior. If the email
/// has been linked into the work graph (Project/Company/Contact/Task/Note),
/// its row and links are kept — only its flag_status changes — so those
/// relationships keep resolving; otherwise the cache row is dropped.
#[tauri::command]
pub async fn ms365_update_email_flag(db: State<'_, DbState>, ms: State<'_, Ms365State>, id: i64, complete: bool) -> CmdResult<()> {
    let token = ensure_access_token(&db, &ms).await?;
    let (message_id, subject, sender_name, sender_email): (String, Option<String>, Option<String>, Option<String>) = {
        let conn = db.0.lock().map_err(err)?;
        conn.query_row(
            "SELECT message_id, subject, sender_name, sender_email FROM emails WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).map_err(err)?
    };
    let status = if complete { "complete" } else { "notFlagged" };
    graph::set_message_flag_status(&token, &message_id, status).await?;
    let conn = db.0.lock().map_err(err)?;
    if complete {
        conn.execute(
            "INSERT INTO email_completed_log (message_id, subject, sender_name, sender_email, completed_at) VALUES (?1,?2,?3,?4,?5)",
            params![message_id, subject, sender_name, sender_email, crate::commands::now_iso()],
        ).map_err(err)?;
    }
    let has_links: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM entity_links WHERE (from_type='email' AND from_id=?1) OR (to_type='email' AND to_id=?1))",
        params![id], |r| r.get(0),
    ).map_err(err)?;
    if has_links {
        conn.execute("UPDATE emails SET flag_status = ?1 WHERE id = ?2", params![status, id]).map_err(err)?;
    } else {
        conn.execute("DELETE FROM emails WHERE id = ?1", params![id]).map_err(err)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailCompletedRecord {
    pub id: i64,
    pub message_id: String,
    pub subject: Option<String>,
    pub sender_name: Option<String>,
    pub sender_email: Option<String>,
    pub completed_at: String,
}

#[tauri::command]
pub fn ms365_get_completed_emails(state: State<DbState>, limit: i64) -> CmdResult<Vec<EmailCompletedRecord>> {
    let conn = state.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, message_id, subject, sender_name, sender_email, completed_at FROM email_completed_log ORDER BY completed_at DESC LIMIT ?1")
        .map_err(err)?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(EmailCompletedRecord {
                id: r.get(0)?,
                message_id: r.get(1)?,
                subject: r.get(2)?,
                sender_name: r.get(3)?,
                sender_email: r.get(4)?,
                completed_at: r.get(5)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[tauri::command]
pub fn ms365_set_email_company(state: State<DbState>, id: i64, company_name: Option<String>) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    let val = company_name.filter(|s| !s.trim().is_empty());
    let prior = crate::opportunities::prior_company(&conn, "emails", Some("company_name"), id).map_err(err)?;
    conn.execute("UPDATE emails SET company_name = ?1 WHERE id = ?2", params![val, id]).map_err(err)?;
    crate::opportunities::link_company(&conn, "emails", id, prior.as_ref(), None, val.as_deref()).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn ms365_open_email(id: i64, state: State<DbState>) -> CmdResult<()> {
    let web_link: Option<String> = {
        let conn = state.0.lock().map_err(err)?;
        conn.query_row("SELECT web_link FROM emails WHERE id = ?1", params![id], |r| r.get(0)).map_err(err)?
    };
    let link = web_link.ok_or_else(|| "This email has no Outlook link.".to_string())?;
    tauri_plugin_opener::open_url(&link, None::<&str>).map_err(err)
}

// ═══════════════════════════ Calendar / Meetings ═══════════════════════════

/// Upserts one Graph event into the local `meetings` cache (matched by
/// `outlook_event_id`) — the single place that translates a GraphEvent into
/// the meetings table row, shared by calendar sync and by create/update so a
/// newly created or edited Outlook meeting appears locally immediately
/// instead of waiting for the next calendar sync.
/// `[{"name": .., "email": ..}]` for a set of Graph recipients or attendees.
fn people_json<'a>(people: impl Iterator<Item = &'a graph::EmailAddressWrap>) -> String {
    let list: Vec<serde_json::Value> = people
        .map(|p| serde_json::json!({ "name": p.email_address.name, "email": p.email_address.address }))
        .collect();
    serde_json::to_string(&list).unwrap_or_else(|_| "[]".into())
}

/// Graph sends event times as a zone-less wall time plus a zone name. Sync asks
/// for UTC, so mark the value as UTC ("…Z") — otherwise the frontend reads it
/// as local time and meetings show hours off.
pub(crate) fn utc_instant(date_time: &str, time_zone: &str) -> String {
    let has_zone = date_time.ends_with('Z') || date_time.get(19..).is_some_and(|rest| rest.contains('+') || rest.contains('-'));
    if has_zone || !time_zone.eq_ignore_ascii_case("UTC") { return date_time.to_string(); }
    let (base, frac) = date_time.split_once('.').unwrap_or((date_time, ""));
    let millis: String = frac.chars().take(3).collect();
    if millis.is_empty() { format!("{base}Z") } else { format!("{base}.{millis}Z") }
}

pub fn upsert_meeting_from_event(conn: &Connection, e: &graph::GraphEvent, now: &str) -> rusqlite::Result<()> {
    let organizer = e.organizer.as_ref().and_then(|o| o.email_address.name.clone().or(o.email_address.address.clone()));
    let organizer_email = e.organizer.as_ref().and_then(|o| o.email_address.address.clone());
    let attendee_emails_json = people_json(e.attendees.iter());
    let attendees_json = serde_json::to_string(
        &e.attendees.iter().map(|a| a.email_address.name.clone().or(a.email_address.address.clone()).unwrap_or_default()).collect::<Vec<_>>(),
    ).unwrap_or_else(|_| "[]".into());
    let location = e.location.as_ref().and_then(|l| l.display_name.clone());
    let description = e.body.as_ref().and_then(|b| b.content.clone()).or_else(|| e.body_preview.clone());
    let start_at = e.start.as_ref().map(|s| utc_instant(&s.date_time, &s.time_zone));
    let end_at = e.end.as_ref().map(|s| utc_instant(&s.date_time, &s.time_zone));
    let is_online = e.is_online_meeting.unwrap_or(false);
    let online_url = e.online_meeting.as_ref().and_then(|o| o.join_url.clone());
    let is_cancelled = e.is_cancelled.unwrap_or(false);
    let meeting_date = start_at.as_deref().and_then(|s| s.get(0..10)).map(|d| d.to_string());

    conn.execute(
        "INSERT INTO meetings (title, meeting_date, attendees_json, discussion, outlook_event_id, start_at, end_at,
            organizer, location, is_online_meeting, online_meeting_url, is_cancelled, source, last_synced_at, created_at, updated_at,
            organizer_email, attendee_emails_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'outlook',?13,?13,?13,?14,?15)
         ON CONFLICT(outlook_event_id) WHERE outlook_event_id IS NOT NULL DO UPDATE SET
           title=excluded.title, meeting_date=excluded.meeting_date, attendees_json=excluded.attendees_json,
           start_at=excluded.start_at, end_at=excluded.end_at, organizer=excluded.organizer, location=excluded.location,
           is_online_meeting=excluded.is_online_meeting, online_meeting_url=excluded.online_meeting_url,
           is_cancelled=excluded.is_cancelled, last_synced_at=excluded.last_synced_at, updated_at=excluded.last_synced_at,
           organizer_email=excluded.organizer_email, attendee_emails_json=excluded.attendee_emails_json
         -- An unchanged event is left alone, so a re-sync doesn't count as an edit of every meeting.
         WHERE meetings.title IS NOT excluded.title OR meetings.meeting_date IS NOT excluded.meeting_date
            OR meetings.attendees_json IS NOT excluded.attendees_json OR meetings.start_at IS NOT excluded.start_at
            OR meetings.end_at IS NOT excluded.end_at OR meetings.organizer IS NOT excluded.organizer
            OR meetings.location IS NOT excluded.location OR meetings.is_online_meeting IS NOT excluded.is_online_meeting
            OR meetings.online_meeting_url IS NOT excluded.online_meeting_url OR meetings.is_cancelled IS NOT excluded.is_cancelled
            OR meetings.organizer_email IS NOT excluded.organizer_email OR meetings.attendee_emails_json IS NOT excluded.attendee_emails_json",
        params![
            e.subject.clone().unwrap_or_else(|| "(No subject)".into()), meeting_date, attendees_json, description,
            e.id, start_at, end_at, organizer, location, is_online as i64, online_url, is_cancelled as i64, now,
            organizer_email, attendee_emails_json,
        ],
    )?;
    Ok(())
}

/// Syncs Outlook events in the given UTC range into the existing `meetings`
/// table (matched by `outlook_event_id`) and returns them. Internal
/// (non-Outlook) meetings in the same range are untouched and returned too,
/// so the Calendar view is one query over one table regardless of origin.
#[tauri::command]
pub async fn ms365_sync_calendar(db: State<'_, DbState>, ms: State<'_, Ms365State>, start_iso: String, end_iso: String) -> CmdResult<()> {
    let token = ensure_access_token(&db, &ms).await?;
    let events = graph::list_calendar_view(&token, &start_iso, &end_iso).await?;
    let conn = db.0.lock().map_err(err)?;
    let now = crate::commands::now_iso();
    for e in &events {
        upsert_meeting_from_event(&conn, e, &now).map_err(err)?;
    }
    let _ = write_account_status(&conn, "connected", None, None, false, true);
    Ok(())
}

#[tauri::command]
pub async fn ms365_create_teams_meeting(
    db: State<'_, DbState>,
    ms: State<'_, Ms365State>,
    subject: String,
    start_iso: String,
    end_iso: String,
    time_zone: String,
    description: String,
    location: String,
    attendee_emails: Vec<String>,
    is_teams_meeting: bool,
) -> CmdResult<crate::v2_models::Meeting> {
    let token = ensure_access_token(&db, &ms).await?;
    let input = graph::NewEventInput {
        subject: &subject,
        start_iso: &start_iso,
        end_iso: &end_iso,
        time_zone: &time_zone,
        body_html: &description,
        location: &location,
        attendee_emails: &attendee_emails,
        is_teams_meeting,
    };
    let event = graph::create_event(&token, &input).await?;
    let conn = db.0.lock().map_err(err)?;
    let now = crate::commands::now_iso();
    upsert_meeting_from_event(&conn, &event, &now).map_err(err)?;
    let sql = format!("{} WHERE outlook_event_id = ?1", crate::v2_commands::MEETING_SELECT);
    conn.query_row(&sql, params![event.id], crate::v2_commands::row_to_meeting).map_err(err)
}

#[tauri::command]
pub async fn ms365_update_outlook_meeting(
    db: State<'_, DbState>,
    ms: State<'_, Ms365State>,
    outlook_event_id: String,
    subject: String,
    start_iso: String,
    end_iso: String,
    time_zone: String,
    description: String,
    location: String,
    attendee_emails: Vec<String>,
    is_teams_meeting: bool,
) -> CmdResult<crate::v2_models::Meeting> {
    let token = ensure_access_token(&db, &ms).await?;
    let input = graph::NewEventInput {
        subject: &subject,
        start_iso: &start_iso,
        end_iso: &end_iso,
        time_zone: &time_zone,
        body_html: &description,
        location: &location,
        attendee_emails: &attendee_emails,
        is_teams_meeting,
    };
    let event = graph::update_event(&token, &outlook_event_id, &input).await?;
    let conn = db.0.lock().map_err(err)?;
    let now = crate::commands::now_iso();
    upsert_meeting_from_event(&conn, &event, &now).map_err(err)?;
    let sql = format!("{} WHERE outlook_event_id = ?1", crate::v2_commands::MEETING_SELECT);
    conn.query_row(&sql, params![event.id], crate::v2_commands::row_to_meeting).map_err(err)
}

/// Cancels the event in Outlook and marks the local Meeting row cancelled
/// rather than deleting it, so its relationships/history survive (Part 11).
#[tauri::command]
pub async fn ms365_cancel_outlook_meeting(db: State<'_, DbState>, ms: State<'_, Ms365State>, outlook_event_id: String) -> CmdResult<()> {
    let token = ensure_access_token(&db, &ms).await?;
    graph::delete_event(&token, &outlook_event_id).await?;
    let conn = db.0.lock().map_err(err)?;
    conn.execute("UPDATE meetings SET is_cancelled = 1 WHERE outlook_event_id = ?1", params![outlook_event_id]).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod time_tests {
    use super::utc_instant;

    #[test]
    fn marks_graph_utc_times_as_utc() {
        assert_eq!(utc_instant("2026-09-13T10:00:00.0000000", "UTC"), "2026-09-13T10:00:00.000Z");
        assert_eq!(utc_instant("2026-09-13T10:00:00", "UTC"), "2026-09-13T10:00:00Z");
        assert_eq!(utc_instant("2026-09-13T10:00:00Z", "UTC"), "2026-09-13T10:00:00Z");
        assert_eq!(utc_instant("2026-09-13T12:00:00", "Arab Standard Time"), "2026-09-13T12:00:00");
    }
}
