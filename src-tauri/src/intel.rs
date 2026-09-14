// Regulatory Watch / Business Watch (Part 20-24 of the M365 upgrade spec).
//
// Originally a manually-curated watchlist only — the spec was emphatic about
// source verification risk (an LLM-driven summary drifting from its source,
// a page changing shape underneath a scraper). Automatic feed ingestion was
// added later at the user's explicit request, fully aware of that tradeoff.
// The mitigations that survive: no LLM rewriting anywhere in this path — a
// fetched item's headline/summary/link are stored verbatim from the feed,
// never regenerated; `importance` always defaults to the lowest tier
// ("monitor") rather than guessing severity; and every ingested row is
// tagged `ingested_via = "feed"` (NULL for a human-entered item) so the UI
// can always show which items were never personally reviewed.
use crate::commands::now_iso;
use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn default_importance() -> String { "monitor".to_string() }
fn default_source_tier() -> i64 { 7 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceItem {
    #[serde(default)]
    pub id: i64,
    /// "regulatory" | "business"
    pub kind: String,
    pub headline: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub what_changed: Option<String>,
    #[serde(default)]
    pub effective_date: Option<String>,
    #[serde(default)]
    pub who_affected: Option<String>,
    #[serde(default)]
    pub why_it_matters: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// confirmed | official_announcement | draft | consultation | proposed | guidance | enforcement_update
    #[serde(default)]
    pub status: Option<String>,
    /// critical | important | monitor
    #[serde(default = "default_importance")]
    pub importance: String,
    pub source_name: String,
    /// 1 = government/official ... 7 = reputable news (lower is more authoritative)
    #[serde(default = "default_source_tier")]
    pub source_tier: i64,
    pub source_url: String,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub saved: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub company_name: Option<String>,
    /// "feed" for automatically-ingested items, None for manually-added ones.
    #[serde(default)]
    pub ingested_via: Option<String>,
    #[serde(default)]
    pub company_id: Option<i64>,
}

fn row_to_item(r: &rusqlite::Row) -> rusqlite::Result<IntelligenceItem> {
    Ok(IntelligenceItem {
        id: r.get(0)?,
        kind: r.get(1)?,
        headline: r.get(2)?,
        summary: r.get(3)?,
        what_changed: r.get(4)?,
        effective_date: r.get(5)?,
        who_affected: r.get(6)?,
        why_it_matters: r.get(7)?,
        country: r.get(8)?,
        category: r.get(9)?,
        status: r.get(10)?,
        importance: r.get(11)?,
        source_name: r.get(12)?,
        source_tier: r.get(13)?,
        source_url: r.get(14)?,
        published_at: r.get(15)?,
        saved: r.get::<_, i64>(16)? != 0,
        archived: r.get::<_, i64>(17)? != 0,
        created_at: r.get(18)?,
        company_name: r.get(19)?,
        ingested_via: r.get(20)?,
        company_id: r.get(21)?,
    })
}

const ITEM_SELECT: &str = "SELECT id, kind, headline, summary, what_changed, effective_date, who_affected, why_it_matters, country, category, status, importance, source_name, source_tier, source_url, published_at, saved, archived, created_at, company_name, ingested_via, company_id FROM intelligence_items";

#[tauri::command]
pub fn get_intelligence_items(state: State<DbState>, kind: Option<String>, include_archived: bool) -> CmdResult<Vec<IntelligenceItem>> {
    let conn = state.0.lock().map_err(err)?;
    let mut sql = ITEM_SELECT.to_string();
    let mut clauses: Vec<String> = vec![];
    if kind.is_some() { clauses.push("kind = ?1".to_string()); }
    if !include_archived { clauses.push("archived = 0".to_string()); }
    if !clauses.is_empty() { sql.push_str(" WHERE "); sql.push_str(&clauses.join(" AND ")); }
    sql.push_str(" ORDER BY COALESCE(published_at, created_at) DESC, id DESC");

    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = if let Some(k) = kind {
        stmt.query_map(params![k], row_to_item).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>()
    } else {
        stmt.query_map([], row_to_item).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>()
    };
    rows.map_err(err)
}

fn upsert(conn: &Connection, item: &IntelligenceItem) -> rusqlite::Result<i64> {
    let now = now_iso();
    if item.id > 0 {
        conn.execute(
            "UPDATE intelligence_items SET kind=?2, headline=?3, summary=?4, what_changed=?5, effective_date=?6,
                who_affected=?7, why_it_matters=?8, country=?9, category=?10, status=?11, importance=?12,
                source_name=?13, source_tier=?14, source_url=?15, published_at=?16, company_name=?17 WHERE id=?1",
            params![item.id, item.kind, item.headline, item.summary, item.what_changed, item.effective_date,
                item.who_affected, item.why_it_matters, item.country, item.category, item.status, item.importance,
                item.source_name, item.source_tier, item.source_url, item.published_at, item.company_name],
        )?;
        Ok(item.id)
    } else {
        conn.execute(
            "INSERT INTO intelligence_items (kind, headline, summary, what_changed, effective_date, who_affected,
                why_it_matters, country, category, status, importance, source_name, source_tier, source_url,
                published_at, saved, archived, created_at, company_name, ingested_via)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0,0,?15,?16,?17)",
            params![item.kind, item.headline, item.summary, item.what_changed, item.effective_date, item.who_affected,
                item.why_it_matters, item.country, item.category, item.status, item.importance, item.source_name,
                item.source_tier, item.source_url, item.published_at, now, item.company_name, item.ingested_via],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn save_intelligence_item(state: State<DbState>, item: IntelligenceItem) -> CmdResult<IntelligenceItem> {
    let conn = state.0.lock().map_err(err)?;
    let id = upsert(&conn, &item).map_err(err)?;
    crate::opportunities::link_company(&conn, "intelligence_items", id, item.company_name.as_deref()).map_err(err)?;
    crate::v2_search::reindex_intelligence(&conn, id).map_err(err)?;
    let sql = format!("{ITEM_SELECT} WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_item).map_err(err)
}

#[tauri::command]
pub fn delete_intelligence_item(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("DELETE FROM intelligence_items WHERE id = ?1", params![id]).map_err(err)?;
    crate::db::remove_orphan_links_of(&conn, "intelligence").map_err(err)?;
    conn.execute("DELETE FROM search_index WHERE entity_type='intelligence' AND entity_id=?1", params![id]).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn set_intelligence_saved(state: State<DbState>, id: i64, saved: bool) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("UPDATE intelligence_items SET saved = ?1 WHERE id = ?2", params![saved as i64, id]).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn set_intelligence_archived(state: State<DbState>, id: i64, archived: bool) -> CmdResult<()> {
    let conn = state.0.lock().map_err(err)?;
    conn.execute("UPDATE intelligence_items SET archived = ?1 WHERE id = ?2", params![archived as i64, id]).map_err(err)?;
    Ok(())
}

// ═══════════════════════════ Automatic feed ingestion ═══════════════════════════

struct FeedSource {
    name: &'static str,
    kind: &'static str,
    url: &'static str,
    source_tier: i64,
}

/// Plain list, not a settings table — adding another feed is a one-line
/// change here, no schema/UI needed. Only sources actually verified to
/// return real, working RSS at the time this was written are included:
/// Argaam is Saudi Arabia's primary financial-news outlet. No official
/// government regulatory feed (MHRSD/GOSI/ZATCA) could be confirmed working
/// — their sites don't expose a clean public RSS endpoint — so "Regulatory"
/// stays manual-entry-only for now; add a FeedSource here if you find one.
const FEEDS: &[FeedSource] = &[
    FeedSource { name: "Argaam", kind: "business", url: "https://www.argaam.com/en/rss/ho-main-news?sectionid=1524", source_tier: 5 },
];

/// Normalizes a headline into intelligence_items.dedup_key (a column that
/// already existed, reserved, unused until now) so re-running a sync doesn't
/// re-insert a story it already pulled in.
fn dedup_key_for(headline: &str) -> String {
    headline
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Feed summaries are simple HTML at most — a crude tag-stripper avoids
/// pulling in a full HTML parser dependency for this alone.
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// Fetches every configured feed and inserts whatever's genuinely new,
/// skipping (not failing the whole sync on) any single feed that's
/// unreachable or unparsable. Every inserted row is verbatim from the feed —
/// headline/summary/link/date, never rewritten — importance always lands at
/// "monitor", and ingested_via='feed' marks it as not personally reviewed.
/// Returns how many new items were added.
#[tauri::command]
pub async fn sync_intelligence_feeds(state: State<'_, DbState>) -> CmdResult<i64> {
    let client = reqwest::Client::new();
    let mut added = 0i64;

    for feed in FEEDS {
        let bytes = match client
            .get(feed.url)
            .header("User-Agent", "Mozilla/5.0 (compatible; MENAOne/1.0)")
            .send()
            .await
        {
            Ok(resp) => match resp.error_for_status() {
                Ok(resp) => match resp.bytes().await {
                    Ok(b) => b,
                    Err(e) => { eprintln!("[intel sync] {} body read failed: {e}", feed.name); continue; }
                },
                Err(e) => { eprintln!("[intel sync] {} returned an error status: {e}", feed.name); continue; }
            },
            Err(e) => { eprintln!("[intel sync] {} fetch failed: {e}", feed.name); continue; }
        };

        let parsed = match feed_rs::parser::parse(&bytes[..]) {
            Ok(f) => f,
            Err(e) => { eprintln!("[intel sync] {} parse failed: {e}", feed.name); continue; }
        };

        let conn = state.0.lock().map_err(err)?;
        for entry in parsed.entries.iter().take(30) {
            let headline = entry.title.as_ref().map(|t| t.content.trim().to_string()).unwrap_or_default();
            if headline.is_empty() { continue; }

            let dedup_key = dedup_key_for(&headline);
            let exists: Option<i64> = conn
                .query_row("SELECT id FROM intelligence_items WHERE dedup_key = ?1 LIMIT 1", params![dedup_key], |r| r.get(0))
                .optional()
                .map_err(err)?;
            if exists.is_some() { continue; }

            let summary = entry.summary.as_ref().map(|t| strip_html(&t.content)).filter(|s| !s.is_empty());
            let source_url = entry.links.first().map(|l| l.href.clone()).unwrap_or_else(|| feed.url.to_string());
            let published_at = entry.published.or(entry.updated).map(|d| d.format("%Y-%m-%d").to_string());

            conn.execute(
                "INSERT INTO intelligence_items (kind, headline, summary, importance, source_name, source_tier,
                    source_url, published_at, saved, archived, created_at, dedup_key, ingested_via)
                 VALUES (?1,?2,?3,'monitor',?4,?5,?6,?7,0,0,?8,?9,'feed')",
                params![feed.kind, headline, summary, feed.name, feed.source_tier, source_url, published_at, now_iso(), dedup_key],
            ).map_err(err)?;
            added += 1;
        }
    }

    Ok(added)
}
