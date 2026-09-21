//! People from email: who you've written to and heard from, tallied per
//! address from message envelopes only (sender, recipients, date — never the
//! subject or body). The tally is kept in `app_meta` so the review list opens
//! without reading the mailbox again; which of these people become contacts
//! is decided by rules in src/lib/emailPeople.ts and by the user.

use crate::db::DbState;
use crate::ms365::graph::EmailAddressWrap;
use crate::ms365::models::Ms365State;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub const SCAN_KEY: &str = "email_people_scan";

/// A message envelope as Graph returns it for this query.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    #[serde(default)]
    pub from: Option<EmailAddressWrap>,
    #[serde(default)]
    pub to_recipients: Vec<EmailAddressWrap>,
    #[serde(default)]
    pub cc_recipients: Vec<EmailAddressWrap>,
    #[serde(default)]
    pub received_date_time: Option<String>,
    /// "focused" or "other" (Outlook's own guess at newsletters and bulk mail).
    #[serde(default)]
    pub inference_classification: Option<String>,
}

/// One address and how you've been in touch with it.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmailPerson {
    pub email: String,
    pub name: Option<String>,
    /// Messages you sent them (to or cc).
    pub sent: u32,
    /// Messages they sent you.
    pub received: u32,
    /// Of those, how many Outlook filed under "Other" (bulk, newsletters).
    pub received_other: u32,
    /// Messages to you they were also on (to or cc), sent by someone else.
    pub copied: u32,
    pub first_at: Option<String>,
    pub last_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmailPeopleScan {
    pub scanned_at: String,
    pub months: u32,
    /// Every page was read (false when a mailbox was larger than the read cap).
    pub complete: bool,
    pub messages: u32,
    pub people: Vec<EmailPerson>,
}

fn address(w: &EmailAddressWrap) -> Option<String> {
    let a = w.email_address.address.as_deref()?.trim().to_lowercase();
    a.contains('@').then_some(a)
}

/// Tallies envelopes per address. `me` (the mailbox owner's addresses) is left out.
pub fn tally(inbox: &[Envelope], sent: &[Envelope], me: &[String]) -> Vec<EmailPerson> {
    let mut people: HashMap<String, EmailPerson> = HashMap::new();
    let me: Vec<String> = me.iter().map(|m| m.trim().to_lowercase()).collect();
    let mut touch = |w: &EmailAddressWrap, at: Option<&str>, f: &mut dyn FnMut(&mut EmailPerson)| {
        let Some(email) = address(w) else { return };
        if me.contains(&email) { return; }
        let p = people.entry(email.clone()).or_insert_with(|| EmailPerson { email, ..Default::default() });
        if let Some(at) = at {
            if p.last_at.as_deref().is_none_or(|l| at > l) {
                p.last_at = Some(at.to_string());
                // The most recent display name wins.
                if let Some(n) = w.email_address.name.as_deref().map(str::trim).filter(|n| !n.is_empty() && !n.contains('@')) { p.name = Some(n.to_string()); }
            }
            if p.first_at.as_deref().is_none_or(|f| at < f) { p.first_at = Some(at.to_string()); }
        }
        if p.name.is_none() {
            p.name = w.email_address.name.as_deref().map(str::trim).filter(|n| !n.is_empty() && !n.contains('@')).map(str::to_string);
        }
        f(p);
    };
    for m in sent {
        let at = m.received_date_time.as_deref();
        let mut seen: Vec<String> = Vec::new();
        for r in m.to_recipients.iter().chain(m.cc_recipients.iter()) {
            let Some(a) = address(r) else { continue };
            if seen.contains(&a) { continue; }
            seen.push(a);
            touch(r, at, &mut |p| p.sent += 1);
        }
    }
    for m in inbox {
        let at = m.received_date_time.as_deref();
        let other = m.inference_classification.as_deref() == Some("other");
        if let Some(f) = &m.from {
            touch(f, at, &mut |p| { p.received += 1; if other { p.received_other += 1; } });
        }
        let from = m.from.as_ref().and_then(address);
        let mut seen: Vec<String> = Vec::new();
        for r in m.to_recipients.iter().chain(m.cc_recipients.iter()) {
            let Some(a) = address(r) else { continue };
            if Some(&a) == from.as_ref() || seen.contains(&a) { continue; }
            seen.push(a);
            touch(r, at, &mut |p| p.copied += 1);
        }
    }
    let mut out: Vec<EmailPerson> = people.into_values().collect();
    out.sort_by(|a, b| (b.sent + b.received).cmp(&(a.sent + a.received)).then_with(|| a.email.cmp(&b.email)));
    out
}

pub fn load_scan(conn: &Connection) -> rusqlite::Result<Option<EmailPeopleScan>> {
    let raw: Option<String> = conn.query_row("SELECT value FROM app_meta WHERE key = ?1", params![SCAN_KEY], |r| r.get(0)).optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn save_scan(conn: &Connection, scan: &EmailPeopleScan) -> rusqlite::Result<()> {
    let json = serde_json::to_string(scan).unwrap_or_else(|_| "{}".into());
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SCAN_KEY, json],
    )?;
    Ok(())
}

/// The last tally, without reading the mailbox (None before the first scan).
#[tauri::command]
pub fn ms365_email_people_cached(db: State<'_, DbState>) -> CmdResult<Option<EmailPeopleScan>> {
    let conn = db.0.lock().map_err(err)?;
    load_scan(&conn).map_err(err)
}

/// Reads the envelopes of the Inbox and Sent Items for the last `months`
/// months, tallies them and keeps the result.
#[tauri::command]
pub async fn ms365_scan_email_people(db: State<'_, DbState>, ms: State<'_, Ms365State>, months: u32) -> CmdResult<EmailPeopleScan> {
    let months = months.clamp(1, 60);
    let token = crate::ms365::commands::ensure_access_token(&db, &ms).await?;
    let since = {
        let conn = db.0.lock().map_err(err)?;
        let s: String = conn.query_row(&format!("SELECT strftime('%Y-%m-%dT00:00:00Z', 'now', '-{months} months')"), [], |r| r.get(0)).map_err(err)?;
        s
    };
    let (inbox, inbox_complete) = crate::ms365::graph::list_envelopes(&token, "inbox", &since).await?;
    let (sent, sent_complete) = crate::ms365::graph::list_envelopes(&token, "sentitems", &since).await?;
    let me: Vec<String> = crate::ms365::graph::get_profile(&token).await.ok()
        .map(|p| [p.mail, p.user_principal_name].into_iter().flatten().collect())
        .unwrap_or_default();
    let people = tally(&inbox, &sent, &me);
    let conn = db.0.lock().map_err(err)?;
    let scanned_at: String = conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| r.get(0)).map_err(err)?;
    let scan = EmailPeopleScan {
        scanned_at, months, complete: inbox_complete && sent_complete, messages: (inbox.len() + sent.len()) as u32, people,
    };
    save_scan(&conn, &scan).map_err(err)?;
    Ok(scan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ms365::graph::EmailAddress;

    fn who(name: &str, email: &str) -> EmailAddressWrap {
        EmailAddressWrap { email_address: EmailAddress { name: Some(name.into()), address: Some(email.into()) } }
    }
    fn env(from: Option<EmailAddressWrap>, to: Vec<EmailAddressWrap>, cc: Vec<EmailAddressWrap>, at: &str, class: &str) -> Envelope {
        Envelope { from, to_recipients: to, cc_recipients: cc, received_date_time: Some(at.into()), inference_classification: Some(class.into()) }
    }

    #[test]
    fn tallies_both_ways_copies_and_bulk_mail() {
        let me = who("Me", "me@contoso-advisory.test");
        let jane = who("Jane Doe", "Jane@Acme.test");
        let omar = who("Omar Haddad", "omar@acme.test");
        let news = who("Acme News", "news@acme.test");
        let inbox = vec![
            env(Some(jane.clone()), vec![me.clone()], vec![omar.clone()], "2026-09-01T08:00:00Z", "focused"),
            env(Some(jane.clone()), vec![me.clone()], vec![], "2026-09-10T08:00:00Z", "focused"),
            env(Some(news.clone()), vec![me.clone()], vec![], "2026-09-05T08:00:00Z", "other"),
        ];
        let sent = vec![env(None, vec![jane.clone(), jane.clone()], vec![omar.clone()], "2026-09-12T08:00:00Z", "focused")];
        let out = tally(&inbox, &sent, &["ME@contoso-advisory.test".into()]);
        let get = |e: &str| out.iter().find(|p| p.email == e).unwrap().clone();
        let j = get("jane@acme.test");
        assert_eq!((j.sent, j.received, j.received_other, j.copied), (1, 2, 0, 0));
        assert_eq!((j.first_at.as_deref(), j.last_at.as_deref(), j.name.as_deref()), (Some("2026-09-01T08:00:00Z"), Some("2026-09-12T08:00:00Z"), Some("Jane Doe")));
        let o = get("omar@acme.test");
        assert_eq!((o.sent, o.received, o.copied), (1, 0, 1));
        let n = get("news@acme.test");
        assert_eq!((n.received, n.received_other), (1, 1));
        assert!(out.iter().all(|p| p.email != "me@contoso-advisory.test"), "the mailbox owner is left out");
        assert_eq!(out[0].email, "jane@acme.test", "most in touch first");
    }
}
