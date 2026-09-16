//! Thin, typed wrappers over the Microsoft Graph v1.0 REST API — just the
//! calls Part 1's initial surface needs (profile, flagged mail, calendar
//! CRUD). Every response struct only declares the fields MENA BIG actually
//! uses; Graph's extra JSON fields are ignored by default (no
//! `deny_unknown_fields`), so this stays resilient to Graph adding fields.

use serde::{Deserialize, Serialize};

const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

fn client() -> reqwest::Client {
    // Without timeouts a stalled Graph call leaves the app waiting forever.
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn graph_get(access_token: &str, path_and_query: &str) -> Result<serde_json::Value, String> {
    graph_get_url(access_token, &format!("{GRAPH_BASE}{path_and_query}")).await
}

async fn graph_get_url(access_token: &str, url: &str) -> Result<serde_json::Value, String> {
    let resp = client()
        .get(url)
        .bearer_auth(access_token)
        .header("Prefer", r#"outlook.timezone="UTC""#)
        .send()
        .await
        .map_err(|e| format!("Could not reach Microsoft Graph: {e}"))?;
    handle_response(resp).await
}

async fn graph_patch(access_token: &str, path: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let resp = client()
        .patch(format!("{GRAPH_BASE}{path}"))
        .bearer_auth(access_token)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Microsoft Graph: {e}"))?;
    handle_response(resp).await
}

async fn graph_post(access_token: &str, path: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let resp = client()
        .post(format!("{GRAPH_BASE}{path}"))
        .bearer_auth(access_token)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Microsoft Graph: {e}"))?;
    handle_response(resp).await
}

async fn graph_delete(access_token: &str, path: &str) -> Result<(), String> {
    let resp = client()
        .delete(format!("{GRAPH_BASE}{path}"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Microsoft Graph: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(graph_error_message(status, &text))
    }
}

/// Signals "access token is expired/invalid" distinctly so callers (see
/// commands.rs's `with_valid_token`) can refresh once and retry, rather than
/// surfacing a raw 401 to the UI.
pub const UNAUTHORIZED_MARKER: &str = "MS365_UNAUTHORIZED";

async fn handle_response(resp: reqwest::Response) -> Result<serde_json::Value, String> {
    let status = resp.status();
    if status.as_u16() == 401 {
        return Err(UNAUTHORIZED_MARKER.to_string());
    }
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(graph_error_message(status, &text));
    }
    if text.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("Unexpected response from Microsoft Graph: {e}"))
}

fn graph_error_message(status: reqwest::StatusCode, text: &str) -> String {
    #[derive(Deserialize)]
    struct Err1 {
        error: Err2,
    }
    #[derive(Deserialize)]
    struct Err2 {
        #[serde(default)]
        message: String,
    }
    let msg = serde_json::from_str::<Err1>(text)
        .ok()
        .map(|e| e.error.message)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| text.to_string());
    format!("Microsoft Graph error ({status}): {msg}")
}

// ═══════════════════════════ Profile ═══════════════════════════

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphProfile {
    pub display_name: Option<String>,
    pub mail: Option<String>,
    pub user_principal_name: Option<String>,
}

pub async fn get_profile(access_token: &str) -> Result<GraphProfile, String> {
    let v = graph_get(access_token, "/me?$select=displayName,mail,userPrincipalName").await?;
    serde_json::from_value(v).map_err(|e| e.to_string())
}

// ═══════════════════════════ Mail (flagged messages) ═══════════════════════════

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EmailAddressWrap {
    #[serde(rename = "emailAddress")]
    pub email_address: EmailAddress,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EmailAddress {
    pub name: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageFlag {
    #[serde(rename = "flagStatus")]
    pub flag_status: String,
    #[serde(rename = "dueDateTime")]
    pub due_date_time: Option<GraphDateTimeTz>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct GraphDateTimeTz {
    #[serde(rename = "dateTime")]
    pub date_time: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMessage {
    pub id: String,
    pub conversation_id: Option<String>,
    pub subject: Option<String>,
    pub from: Option<EmailAddressWrap>,
    pub body_preview: Option<String>,
    pub received_date_time: Option<String>,
    pub is_read: Option<bool>,
    pub web_link: Option<String>,
    pub flag: Option<MessageFlag>,
    #[serde(default)]
    pub to_recipients: Vec<EmailAddressWrap>,
    #[serde(default)]
    pub cc_recipients: Vec<EmailAddressWrap>,
}

/// Most pages Graph hands back before we stop following `@odata.nextLink`.
const MAX_PAGES: usize = 50;

/// Every item of a Graph collection, following `@odata.nextLink` page by page.
/// Graph returns at most `$top` items per request, so reading only the first
/// page silently drops the rest. Returns the items and whether the whole
/// collection was read (false only if MAX_PAGES was hit).
async fn graph_get_all<T: serde::de::DeserializeOwned>(access_token: &str, path_and_query: &str) -> Result<(Vec<T>, bool), String> {
    let mut items = Vec::new();
    let mut url = format!("{GRAPH_BASE}{path_and_query}");
    for _ in 0..MAX_PAGES {
        let mut v = graph_get_url(access_token, &url).await?;
        let next = v.get("@odata.nextLink").and_then(|n| n.as_str()).map(str::to_string);
        let page: Vec<T> = serde_json::from_value(v.get_mut("value").map(serde_json::Value::take).unwrap_or_default()).map_err(|e| e.to_string())?;
        items.extend(page);
        match next {
            Some(n) if n.starts_with(GRAPH_BASE) => url = n,
            Some(n) => return Err(format!("Unexpected next page address from Microsoft Graph: {n}")),
            None => return Ok((items, true)),
        }
    }
    Ok((items, false))
}

/// All flagged (not-yet-completed) messages, every page of them — `$top` is
/// only the page size (reading one page capped the list at 100 and dropped
/// newer flagged mail). Deliberately no
/// `$orderby`: combining it with the `flag/flagStatus` $filter above makes
/// Graph reject the whole query with a 400 ("The restriction or sort order
/// is too complex for this operation") — a known Graph limitation on mail
/// queries, not something fixable by rephrasing the filter. Harmless to
/// drop since the caller (actionRequired.ts) already sorts by receivedAt
/// itself after fetching.
pub async fn list_flagged_messages(access_token: &str) -> Result<(Vec<GraphMessage>, bool), String> {
    let query = "/me/messages?$filter=flag/flagStatus eq 'flagged'&$select=id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,receivedDateTime,isRead,webLink,flag&$top=250";
    graph_get_all(access_token, query).await
}

pub async fn set_message_flag_status(access_token: &str, message_id: &str, status: &str) -> Result<(), String> {
    let body = serde_json::json!({ "flag": { "flagStatus": status } });
    graph_patch(access_token, &format!("/me/messages/{message_id}"), &body).await?;
    Ok(())
}

// ═══════════════════════════ Calendar ═══════════════════════════

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventDateTime {
    #[serde(rename = "dateTime")]
    pub date_time: String,
    #[serde(rename = "timeZone")]
    pub time_zone: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventLocation {
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventBody {
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OnlineMeetingInfo {
    #[serde(rename = "joinUrl")]
    pub join_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEvent {
    pub id: String,
    pub subject: Option<String>,
    pub body_preview: Option<String>,
    pub body: Option<EventBody>,
    pub start: Option<EventDateTime>,
    pub end: Option<EventDateTime>,
    pub location: Option<EventLocation>,
    pub organizer: Option<EmailAddressWrap>,
    #[serde(default)]
    pub attendees: Vec<EmailAddressWrap>,
    pub is_cancelled: Option<bool>,
    pub is_online_meeting: Option<bool>,
    pub online_meeting: Option<OnlineMeetingInfo>,
    pub web_link: Option<String>,
    pub series_master_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: Option<String>, // singleInstance | occurrence | exception | seriesMaster
}

/// `calendarView` (not `/events`) expands recurring series into concrete
/// instances within the range — the correct primitive for a day/week/month
/// grid (Part 9: "correctly handle recurring events").
pub async fn list_calendar_view(access_token: &str, start_iso: &str, end_iso: &str) -> Result<Vec<GraphEvent>, String> {
    let query = format!(
        "/me/calendarView?startDateTime={start}&endDateTime={end}&$select=id,subject,bodyPreview,start,end,location,organizer,attendees,isCancelled,isOnlineMeeting,onlineMeeting,webLink,seriesMasterId,type&$orderby=start/dateTime&$top=250",
        start = urlencode(start_iso),
        end = urlencode(end_iso),
    );
    Ok(graph_get_all(access_token, &query).await?.0)
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[derive(Debug, Serialize)]
pub struct NewEventInput<'a> {
    pub subject: &'a str,
    pub start_iso: &'a str,
    pub end_iso: &'a str,
    pub time_zone: &'a str,
    pub body_html: &'a str,
    pub location: &'a str,
    pub attendee_emails: &'a [String],
    pub is_teams_meeting: bool,
}

fn event_payload(input: &NewEventInput) -> serde_json::Value {
    let attendees: Vec<_> = input
        .attendee_emails
        .iter()
        .map(|email| {
            serde_json::json!({
                "emailAddress": { "address": email },
                "type": "required"
            })
        })
        .collect();
    let mut payload = serde_json::json!({
        "subject": input.subject,
        "body": { "contentType": "HTML", "content": input.body_html },
        "start": { "dateTime": input.start_iso, "timeZone": input.time_zone },
        "end": { "dateTime": input.end_iso, "timeZone": input.time_zone },
        "attendees": attendees,
    });
    if !input.location.is_empty() {
        payload["location"] = serde_json::json!({ "displayName": input.location });
    }
    if input.is_teams_meeting {
        payload["isOnlineMeeting"] = serde_json::json!(true);
        payload["onlineMeetingProvider"] = serde_json::json!("teamsForBusiness");
    }
    payload
}

pub async fn create_event(access_token: &str, input: &NewEventInput<'_>) -> Result<GraphEvent, String> {
    let body = event_payload(input);
    let v = graph_post(access_token, "/me/events", &body).await?;
    serde_json::from_value(v).map_err(|e| e.to_string())
}

pub async fn update_event(access_token: &str, event_id: &str, input: &NewEventInput<'_>) -> Result<GraphEvent, String> {
    let body = event_payload(input);
    let v = graph_patch(access_token, &format!("/me/events/{event_id}"), &body).await?;
    serde_json::from_value(v).map_err(|e| e.to_string())
}

pub async fn delete_event(access_token: &str, event_id: &str) -> Result<(), String> {
    graph_delete(access_token, &format!("/me/events/{event_id}")).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_recipients_parse_and_default_to_empty() {
        let with: GraphMessage = serde_json::from_str(
            r#"{"id":"m1","subject":"Hi","toRecipients":[{"emailAddress":{"name":"Jane Tester","address":"jane@example.test"}}],
                "ccRecipients":[{"emailAddress":{"address":"ops@example.test"}}]}"#,
        )
        .unwrap();
        assert_eq!(with.to_recipients[0].email_address.address.as_deref(), Some("jane@example.test"));
        assert_eq!(with.cc_recipients[0].email_address.name, None);

        let without: GraphMessage = serde_json::from_str(r#"{"id":"m2"}"#).unwrap();
        assert!(without.to_recipients.is_empty() && without.cc_recipients.is_empty());
    }
}
