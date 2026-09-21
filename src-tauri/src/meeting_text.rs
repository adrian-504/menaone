//! The text of an Outlook invite, kept apart from the notes written in MENA One.
//!
//! Calendar sync used to put the invite body into a meeting's Discussion
//! field, where it read as if someone had written it. It now has its own
//! column (`meetings.invite_text`), and migration 35 moves what earlier syncs
//! left in Discussion (and what was then moved by hand into Agenda) across.

/// Plain text for an invite body: Outlook returns HTML for events created from
/// the app and plain text (with Windows line endings) otherwise.
pub fn invite_plain_text(raw: &str) -> Option<String> {
    let text = if looks_like_html(raw) { html_to_text(raw) } else { raw.to_string() };
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::new();
    let mut blank = 0;
    for line in text.lines().map(str::trim_end) {
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 { continue; }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    let out = out.trim().to_string();
    (!out.is_empty()).then_some(out)
}

fn looks_like_html(s: &str) -> bool {
    let head = s.trim_start().get(..200.min(s.trim_start().len())).unwrap_or("").to_ascii_lowercase();
    head.starts_with("<html") || head.starts_with("<!doctype") || head.contains("<body") || head.starts_with("<div") || head.starts_with("<p")
}

fn html_to_text(html: &str) -> String {
    let mut s = html.to_string();
    for tag in ["head", "style", "script"] {
        s = strip_blocks(&s, tag);
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s.as_str();
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('>') else { rest = ""; break };
        let tag = rest[open + 1..open + close].trim_start_matches('/').to_ascii_lowercase();
        let name: String = tag.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        if matches!(name.as_str(), "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" | "table") {
            out.push('\n');
        }
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
}

/// Removes `<tag …>…</tag>` blocks (case-insensitive).
fn strip_blocks(s: &str, tag: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let (open, close) = (format!("<{tag}"), format!("</{tag}>"));
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(start) = lower[i..].find(&open).map(|p| p + i) {
        out.push_str(&s[i..start]);
        match lower[start..].find(&close) {
            Some(end) => i = start + end + close.len(),
            None => { i = s.len(); break; }
        }
    }
    if i < s.len() { out.push_str(&s[i..]); }
    out
}

/// Text that came from an Outlook invite rather than from someone typing it.
/// Outlook text keeps Windows line endings (`\r\n`), which a text box never
/// produces, so a carriage return is proof. Text moved by hand from one box
/// to another loses them, so an invite-sized text that starts or reads like
/// the usual invite boilerplate counts too.
pub fn looks_like_invite(text: &str) -> bool {
    if text.contains('\r') || looks_like_html(text) { return true; }
    let t = text.trim();
    if t.chars().count() > 300 { return false; }
    t.starts_with("__________")
        || t.contains("-----Original Appointment-----")
        || t.contains("Join with Google Meet")
        || (t.contains("Microsoft Teams meeting") && t.contains("Meeting ID"))
}

/// Migration 35: moves invite text out of Discussion and Agenda of Outlook
/// meetings into `invite_text`. Text someone wrote is never touched.
pub fn move_invite_text(conn: &rusqlite::Connection) -> rusqlite::Result<usize> {
    let rows: Vec<(i64, Option<String>, Option<String>, Option<String>)> = conn
        .prepare("SELECT id, agenda, discussion, invite_text FROM meetings WHERE source = 'outlook' OR outlook_event_id IS NOT NULL")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut moved = 0;
    for (id, agenda, discussion, invite) in rows {
        let from_invite = |t: &Option<String>| t.as_deref().is_some_and(|s| !s.trim().is_empty() && looks_like_invite(s));
        let move_discussion = from_invite(&discussion);
        let move_agenda = from_invite(&agenda);
        if !move_discussion && !move_agenda { continue; }
        // The longest version of the invite wins; the others were copies of it.
        let candidates = [invite.clone(), move_discussion.then(|| discussion.clone()).flatten(), move_agenda.then(|| agenda.clone()).flatten()];
        let best = candidates.iter().flatten().filter_map(|s| invite_plain_text(s)).max_by_key(|s| s.len());
        conn.execute(
            "UPDATE meetings SET invite_text = ?2,
                discussion = CASE WHEN ?3 THEN NULL ELSE discussion END,
                agenda = CASE WHEN ?4 THEN NULL ELSE agenda END
             WHERE id = ?1",
            rusqlite::params![id, best, move_discussion, move_agenda],
        )?;
        crate::v2_search::reindex_meeting(conn, id)?;
        moved += 1;
    }
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_line_endings_mark_an_invite() {
        assert!(looks_like_invite("From: Someone\r\nDate: Thursday"));
        assert!(!looks_like_invite("Discussed pricing\nNext steps with the GM"));
    }

    #[test]
    fn boilerplate_moved_by_hand_is_still_an_invite() {
        assert!(looks_like_invite("________________\nMicrosoft Teams meeting\nJoin: https://example.test\nMeeting ID: 1"));
        assert!(looks_like_invite("Weekly status\nJoin with Google Meet – You have been invited"));
        assert!(!looks_like_invite(&format!("__________ my own divider\n{}", "notes ".repeat(80))));
    }

    #[test]
    fn html_bodies_become_plain_text() {
        let html = "<html><head><style>p{color:red}</style></head><body><p>Hello&nbsp;team</p><div>Agenda<br>1. Pricing</div></body></html>";
        assert_eq!(invite_plain_text(html).unwrap(), "Hello team\n\nAgenda\n1. Pricing");
    }

    #[test]
    fn blank_runs_collapse_and_empty_is_none() {
        assert_eq!(invite_plain_text("a\r\n\r\n\r\n\r\nb  ").unwrap(), "a\n\nb");
        assert_eq!(invite_plain_text(" \r\n "), None);
    }
}
