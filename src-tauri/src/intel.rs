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
use regex::Regex;
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
    /// The services this story touches, worked out from its words on ingest.
    #[serde(default)]
    pub affected_services: Vec<String>,
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
        affected_services: r
            .get::<_, Option<String>>(22)?
            .and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok())
            .unwrap_or_default(),
    })
}

const ITEM_SELECT: &str = "SELECT id, kind, headline, summary, what_changed, effective_date, who_affected, why_it_matters, country, category, status, importance, source_name, source_tier, source_url, published_at, saved, archived, created_at, company_name, ingested_via, company_id, affected_services_json FROM intelligence_items";

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
    let prior = crate::opportunities::prior_company(&conn, "intelligence_items", Some("company_name"), item.id).map_err(err)?;
    let id = upsert(&conn, &item).map_err(err)?;
    crate::opportunities::link_company(&conn, "intelligence_items", id, prior.as_ref(), item.company_id, item.company_name.as_deref()).map_err(err)?;
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

/// Where Watch looks. Two kinds of source:
///
/// * a publisher's own feed (Argaam, Saudi Arabia's main financial outlet);
/// * a **news search turned into a feed**. The ministries — MHRSD, ZATCA,
///   GOSI — publish no usable RSS, which is why regulatory coverage used to be
///   manual-entry-only. A search feed scoped to their domains reaches the same
///   announcements, and the same mechanism brings in the law firms that explain
///   them. These endpoints are unofficial: each is fetched independently and a
///   failure is recorded against that source alone (see `feed_status`).
const FEEDS: &[FeedSource] = &[
    FeedSource { name: "Argaam", kind: "business", url: "https://www.argaam.com/en/rss/ho-main-news?sectionid=1524", source_tier: 5 },
    FeedSource { name: "Ministry of Human Resources (MHRSD)", kind: "regulatory", url: "https://news.google.com/rss/search?q=site:hrsd.gov.sa&hl=en-US&gl=US&ceid=US:en", source_tier: 2 },
    FeedSource { name: "ZATCA", kind: "regulatory", url: "https://news.google.com/rss/search?q=site:zatca.gov.sa&hl=en-US&gl=US&ceid=US:en", source_tier: 2 },
    FeedSource { name: "GOSI", kind: "regulatory", url: "https://news.google.com/rss/search?q=site:gosi.gov.sa&hl=en-US&gl=US&ceid=US:en", source_tier: 2 },
    FeedSource { name: "Saudi labour law", kind: "regulatory", url: "https://news.google.com/rss/search?q=%22Saudi+labor+law%22+OR+%22Saudi+labour+law%22&hl=en-US&gl=US&ceid=US:en", source_tier: 4 },
    FeedSource { name: "Saudization", kind: "regulatory", url: "https://news.google.com/rss/search?q=Saudization+OR+Nitaqat&hl=en-US&gl=US&ceid=US:en", source_tier: 4 },
    FeedSource { name: "VAT & e-invoicing", kind: "regulatory", url: "https://news.google.com/rss/search?q=Saudi+%28ZATCA+OR+%22e-invoicing%22+OR+VAT%29&hl=en-US&gl=US&ceid=US:en", source_tier: 4 },
    FeedSource { name: "GOSI & payroll", kind: "regulatory", url: "https://news.google.com/rss/search?q=Saudi+%28GOSI+OR+%22social+insurance%22+OR+%22wage+protection%22%29&hl=en-US&gl=US&ceid=US:en", source_tier: 4 },
    FeedSource { name: "Company formation", kind: "business", url: "https://news.google.com/rss/search?q=Saudi+%28MISA+OR+%22commercial+registration%22+OR+%22foreign+investment+licence%22%29&hl=en-US&gl=US&ceid=US:en", source_tier: 4 },
];

/// Which services a story touches, so an item lands next to the work it
/// affects (`affected_services_json`, a column that has existed since the
/// beginning and was never filled). Keywords only — no model involved.
const SERVICE_KEYWORDS: &[(&str, &[&str])] = &[
    ("Administration and PRO", &["labor law", "labour law", "mhrsd", "qiwa", "muqeem", "absher", "iqama", "work permit", "ministry of human resources"]),
    ("Payroll", &["gosi", "social insurance", "wage protection", "wps", "payroll", "end of service", "salary"]),
    ("Accountancy", &["zatca", "vat", "e-invoicing", "einvoicing", "tax", "zakat", "fatoora"]),
    ("Business Setup", &["misa", "commercial registration", "company formation", "foreign investment", "business licence", "business license", "regional headquarters"]),
    ("Company Maintenance", &["commercial registration", "licence renewal", "license renewal", "chamber of commerce", "municipality"]),
    ("Employer of Record", &["employer of record", "outsourcing", "staffing", "seconded", "labour market", "labor market"]),
    ("Recruitment", &["recruitment", "hiring", "job seekers", "employment contract", "expat"]),
    ("Mobilization", &["visa", "block visa", "mobilization", "mobilisation", "border number"]),
    ("Saudization", &["saudization", "saudisation", "nitaqat", "localization quota"]),
];

/// Market chatter: true unless the story also names a client.
const MARKET_NOISE: &[&str] = &[
    "tasi", "stock", "shares", "index", "ipo", "dividend", "earnings", "bourse", "reit",
    "money market", "profit rose", "profit fell", "net profit", "market cap", "52-week",
];

/// A story is regulatory when it reads like a rule, not like coverage.
const RULE_WORDS: &[&str] = &[
    "regulation", "regulations", "amendment", "amend", "decision", "decree", "circular",
    "ministerial", "comes into force", "takes effect", "effective", "mandatory", "deadline",
    "penalty", "penalties", "violation", "new rule", "rules", "law", "requirement",
];

fn haystack(headline: &str, summary: Option<&str>) -> String {
    format!("{headline} {}", summary.unwrap_or("")).to_lowercase()
}

fn services_for(text: &str) -> Vec<String> {
    SERVICE_KEYWORDS
        .iter()
        .filter(|(_, words)| words.iter().any(|w| text.contains(w)))
        .map(|(service, _)| service.to_string())
        .collect()
}

/// Everything a story is worth to MENA BIG, worked out from its words.
struct Assessment {
    keep: bool,
    importance: &'static str,
    services: Vec<String>,
    effective_date: Option<String>,
    company: Option<(i64, String)>,
}

/// How MENA One decides what a story is worth. Rules, not a model: keyword
/// matches against the services MENA BIG sells, the companies already in the
/// database, and the words that make a story a rule rather than coverage.
fn assess(conn: &Connection, headline: &str, summary: Option<&str>, tier: i64) -> rusqlite::Result<Assessment> {
    let text = haystack(headline, summary);
    let services = services_for(&text);
    let company = match_company(conn, &text)?;
    let is_noise = MARKET_NOISE.iter().any(|w| text.contains(w));
    let rule_words = RULE_WORDS.iter().filter(|w| text.contains(*w)).count();
    let effective_date = effective_date_in(&text);

    // Market noise is dropped unless it names a client or prospect — then it is
    // exactly the kind of thing worth knowing before a call.
    let keep = company.is_some() || (!is_noise && (!services.is_empty() || tier <= 2));

    let importance = if effective_date.is_some() && rule_words > 0 {
        "critical"
    } else if tier <= 2 || rule_words >= 2 || (!services.is_empty() && rule_words > 0) {
        "important"
    } else {
        "monitor"
    };

    Ok(Assessment { keep, importance, services, effective_date, company })
}

/// A date a rule starts applying ("effective 1 January 2027"), so a compliance
/// deadline can be seen without opening the article.
fn effective_date_in(text: &str) -> Option<String> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)(?:effective|takes effect|comes into force|starting|as of|from)\s+(?:on\s+)?(\d{1,2}\s+[a-z]+\s+20\d{2}|[a-z]+\s+\d{1,2},?\s+20\d{2}|\d{4}-\d{2}-\d{2})").unwrap()
    });
    re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string())
}

/// A client or prospect named in the story. Only names long enough to be
/// unambiguous are matched, so "Acme" doesn't catch every acme in the region.
fn match_company(conn: &Connection, text: &str) -> rusqlite::Result<Option<(i64, String)>> {
    let mut stmt = conn.prepare("SELECT id, name FROM companies")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, name) = row?;
        let needle = name.trim().to_lowercase();
        if needle.len() >= 5 && text.contains(&needle) {
            return Ok(Some((id, name)));
        }
    }
    Ok(None)
}

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
/// What each source did on the last run, so the Watch page can say whether it
/// is actually pulling anything — the old version gave no sign either way.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeedStatus {
    pub name: String,
    pub kind: String,
    pub last_run_at: Option<String>,
    pub added: i64,
    pub considered: i64,
    pub error: Option<String>,
}

fn write_feed_status(conn: &Connection, statuses: &[FeedStatus]) -> rusqlite::Result<()> {
    let json = serde_json::to_string(statuses).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('intel_feed_status', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )?;
    Ok(())
}

#[tauri::command]
pub fn intelligence_feed_status(state: State<DbState>) -> CmdResult<Vec<FeedStatus>> {
    let conn = state.0.lock().map_err(err)?;
    let raw: Option<String> = conn
        .query_row("SELECT value FROM app_meta WHERE key = 'intel_feed_status'", [], |r| r.get(0))
        .optional()
        .map_err(err)?;
    Ok(raw.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default())
}

/// Fetches every source and keeps what is relevant: a story is dropped when it
/// is market chatter that names none of our clients, or when it touches none of
/// the services MENA BIG sells. What is kept arrives with an importance, the
/// services it affects, any date it comes into force, and the client it names.
///
/// Every source fails on its own — one unreachable feed never stops the rest,
/// and the failure is recorded against that source so it is visible on the page.
/// Returns how many new items were added.
#[tauri::command]
pub async fn sync_intelligence_feeds(state: State<'_, DbState>) -> CmdResult<i64> {
    // Without timeouts a stalled server left the sync pending forever.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(err)?;
    let mut added = 0i64;
    let mut statuses: Vec<FeedStatus> = Vec::new();
    let run_at = now_iso();

    for feed in FEEDS {
        let mut status = FeedStatus { name: feed.name.into(), kind: feed.kind.into(), last_run_at: Some(run_at.clone()), ..Default::default() };
        let fetched = client
            .get(feed.url)
            .header("User-Agent", "Mozilla/5.0 (compatible; MENAOne/1.0)")
            .send()
            .await
            .and_then(|r| r.error_for_status());
        let bytes = match fetched {
            Ok(resp) => match resp.bytes().await {
                Ok(b) => b,
                Err(e) => { status.error = Some(format!("Could not read the response: {e}")); statuses.push(status); continue; }
            },
            Err(e) => { status.error = Some(format!("Could not reach this source: {e}")); statuses.push(status); continue; }
        };

        let parsed = match feed_rs::parser::parse(&bytes[..]) {
            Ok(f) => f,
            Err(e) => { status.error = Some(format!("The feed could not be read: {e}")); statuses.push(status); continue; }
        };

        let conn = state.0.lock().map_err(err)?;
        for entry in parsed.entries.iter().take(40) {
            let headline = entry.title.as_ref().map(|t| t.content.trim().to_string()).unwrap_or_default();
            if headline.is_empty() { continue; }
            status.considered += 1;

            let dedup_key = dedup_key_for(&headline);
            let exists: Option<i64> = conn
                .query_row("SELECT id FROM intelligence_items WHERE dedup_key = ?1 LIMIT 1", params![dedup_key], |r| r.get(0))
                .optional()
                .map_err(err)?;
            if exists.is_some() { continue; }

            let summary = entry.summary.as_ref().map(|t| strip_html(&t.content)).filter(|s| !s.is_empty());
            let a = assess(&conn, &headline, summary.as_deref(), feed.source_tier).map_err(err)?;
            if !a.keep { continue; }

            let source_url = entry.links.first().map(|l| l.href.clone()).unwrap_or_else(|| feed.url.to_string());
            let published_at = entry.published.or(entry.updated).map(|d| d.format("%Y-%m-%d").to_string());
            let services_json = if a.services.is_empty() { None } else { serde_json::to_string(&a.services).ok() };
            let (company_id, company_name) = match a.company {
                Some((id, name)) => (Some(id), Some(name)),
                None => (None, None),
            };

            conn.execute(
                "INSERT INTO intelligence_items (kind, headline, summary, importance, source_name, source_tier,
                    source_url, published_at, saved, archived, created_at, dedup_key, ingested_via,
                    affected_services_json, effective_date, company_id, company_name, country)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,0,?9,?10,'feed',?11,?12,?13,?14,'Saudi Arabia')",
                params![feed.kind, headline, summary, a.importance, feed.name, feed.source_tier, source_url,
                        published_at, now_iso(), dedup_key, services_json, a.effective_date, company_id, company_name],
            ).map_err(err)?;
            added += 1;
            status.added += 1;
        }
        let _ = write_feed_status(&conn, &statuses.iter().chain(std::iter::once(&status)).cloned().collect::<Vec<_>>());
        statuses.push(status);
    }

    let conn = state.0.lock().map_err(err)?;
    write_feed_status(&conn, &statuses).map_err(err)?;
    Ok(added)
}

/// The classifier, exposed for the feed test (tuple rather than the private
/// struct: kept, importance, services).
pub fn assess_for_test(conn: &Connection, headline: &str, summary: Option<&str>, tier: i64) -> (bool, String, Vec<String>) {
    let a = assess(conn, headline, summary, tier).expect("assess");
    (a.keep, a.importance.to_string(), a.services)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT);").unwrap();
        conn.execute("INSERT INTO companies (id, name) VALUES (1, 'Woodgrove Capital')", []).unwrap();
        conn
    }

    #[test]
    fn market_chatter_is_dropped_unless_it_names_a_client() {
        let conn = db();
        let noise = assess(&conn, "TASI: 15 stocks fall to 52-week lows", None, 5).unwrap();
        assert!(!noise.keep, "stock market movements are not business intelligence");

        let client = assess(&conn, "Woodgrove Capital raises SAR 200M to expand in Riyadh", None, 5).unwrap();
        assert!(client.keep, "the same kind of story matters when it names a client");
        assert_eq!(client.company.unwrap().1, "Woodgrove Capital");
    }

    #[test]
    fn a_rule_with_a_date_outranks_coverage_of_it() {
        let conn = db();
        let rule = assess(
            &conn,
            "Saudi Arabia amends labor law: new regulation effective 1 January 2027",
            Some("The ministerial decision sets a deadline for employers."),
            4,
        )
        .unwrap();
        assert_eq!(rule.importance, "critical");
        assert_eq!(rule.effective_date.as_deref(), Some("1 january 2027"));
        assert!(rule.services.contains(&"Administration and PRO".to_string()));

        let coverage = assess(&conn, "What Saudization means for hiring in 2027", None, 6).unwrap();
        assert_eq!(coverage.importance, "monitor");
        assert!(coverage.keep);
    }

    #[test]
    fn a_story_is_filed_against_the_services_it_touches() {
        let conn = db();
        let gosi = assess(&conn, "GOSI announces updated contribution rates", Some("Wage protection changes too."), 2).unwrap();
        assert!(gosi.services.contains(&"Payroll".to_string()));
        assert_eq!(gosi.importance, "important", "an official source is worth more than coverage");

        let vat = assess(&conn, "ZATCA extends e-invoicing wave to more taxpayers", None, 2).unwrap();
        assert!(vat.services.contains(&"Accountancy".to_string()));
    }

    #[test]
    fn something_with_no_bearing_on_what_we_sell_is_left_out() {
        let conn = db();
        let irrelevant = assess(&conn, "Riyadh Season announces concert line-up", None, 6).unwrap();
        assert!(!irrelevant.keep);
    }
}
