//! Facts the pipeline and win/loss views need that aren't on the records
//! themselves: when each opportunity entered its current stage, the stages it
//! went through, and when anything last happened with it or its company.

use crate::db::DbState;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StageVisit {
    pub stage: String,
    /// YYYY-MM-DD (or a timestamp) the opportunity entered this stage.
    pub entered_at: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFact {
    pub opportunity_id: i64,
    pub stage_entered_at: Option<String>,
    /// Latest real activity: logged events on the opportunity or its company,
    /// meetings, and anything else logged for that company.
    pub last_activity_at: Option<String>,
    pub stages: Vec<StageVisit>,
}

/// Schema v23: loss/win reason on opportunities and proposal templates.
pub const INSIGHTS_MIGRATION: &str = r#"
ALTER TABLE opportunities ADD COLUMN win_loss_reason TEXT;

CREATE TABLE IF NOT EXISTS proposal_templates (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  path               TEXT NOT NULL,
  business_entity_id INTEGER REFERENCES business_entities(id) ON DELETE SET NULL,
  config_json        TEXT NOT NULL DEFAULT '{}',
  slide_count        INTEGER,
  file_modified_at   TEXT,
  is_default         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT,
  updated_at         TEXT
);
"#;

/// "Lead → Qualified" style details written by save_opportunity.
fn stage_after_arrow(detail: &str) -> Option<String> {
    detail.split('→').nth(1).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn pipeline_facts(conn: &Connection) -> rusqlite::Result<Vec<PipelineFact>> {
    let opps: Vec<(i64, String, Option<String>, Option<i64>)> = {
        let mut stmt = conn.prepare("SELECT id, stage, created_at, company_id FROM opportunities")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };

    let mut history: HashMap<i64, Vec<StageVisit>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT opportunity_id, kind, detail, created_at FROM opportunity_activity
             WHERE kind IN ('created', 'stage_changed') ORDER BY opportunity_id, created_at, id",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?)))?;
        for row in rows {
            let (id, kind, detail, at) = row?;
            push_visit(history.entry(id).or_default(), &kind, detail.as_deref(), at.unwrap_or_default());
        }
    }

    let mut last_by_opp: HashMap<i64, String> = HashMap::new();
    let mut last_by_company: HashMap<i64, String> = HashMap::new();
    let bump = |map: &mut HashMap<i64, String>, id: i64, at: String| {
        let day: String = at.chars().take(10).collect();
        let e = map.entry(id).or_default();
        if day > *e {
            *e = day;
        }
    };
    {
        let mut stmt = conn.prepare("SELECT entity_type, entity_id, company_id, created_at FROM activity WHERE created_at IS NOT NULL AND created_at <> ''")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?, r.get::<_, String>(3)?)))?;
        for row in rows {
            let (kind, entity_id, company_id, at) = row?;
            if kind == "opportunity" {
                bump(&mut last_by_opp, entity_id, at.clone());
            }
            if let Some(c) = company_id {
                bump(&mut last_by_company, c, at);
            }
        }
        let mut stmt = conn.prepare("SELECT opportunity_id, created_at FROM opportunity_activity WHERE created_at IS NOT NULL")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (id, at) = row?;
            bump(&mut last_by_opp, id, at);
        }
        // Meetings count once they've happened.
        let today = crate::commands::now_iso();
        let mut stmt = conn.prepare("SELECT opportunity_id, company_id, meeting_date FROM meetings WHERE meeting_date IS NOT NULL AND meeting_date <> '' AND is_cancelled = 0")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?)))?;
        for row in rows {
            let (opp, company, date) = row?;
            if date > today {
                continue;
            }
            if let Some(o) = opp {
                bump(&mut last_by_opp, o, date.clone());
            }
            if let Some(c) = company {
                bump(&mut last_by_company, c, date);
            }
        }
    }

    Ok(opps
        .into_iter()
        .map(|(id, stage, created_at, company_id)| {
            let mut visits = history.remove(&id).unwrap_or_default();
            // A creation with no later change started in today's stage.
            for v in visits.iter_mut().filter(|v| v.stage.is_empty()) {
                v.stage = stage.clone();
            }
            if visits.is_empty() {
                if let Some(c) = created_at.clone() {
                    visits.push(StageVisit { stage: stage.clone(), entered_at: c.chars().take(10).collect() });
                }
            }
            let stage_entered_at = visits.iter().rev().find(|v| v.stage == stage).map(|v| v.entered_at.clone()).or_else(|| created_at.clone());
            let opp_last = last_by_opp.get(&id).cloned();
            let company_last = company_id.and_then(|c| last_by_company.get(&c).cloned());
            let last_activity_at = match (opp_last, company_last) {
                (Some(a), Some(b)) => Some(if a > b { a } else { b }),
                (a, b) => a.or(b),
            };
            PipelineFact { opportunity_id: id, stage_entered_at: stage_entered_at.map(|s| s.chars().take(10).collect()), last_activity_at, stages: visits }
        })
        .collect())
}

#[tauri::command]
pub fn get_pipeline_facts(state: State<DbState>) -> CmdResult<Vec<PipelineFact>> {
    let conn = state.0.lock().map_err(err)?;
    pipeline_facts(&conn).map_err(err)
}

/// Adds one opportunity_activity row to a stage history. A change
/// ("Lead → Qualified") also tells us the stage a creation row started in.
fn push_visit(out: &mut Vec<StageVisit>, kind: &str, detail: Option<&str>, at: String) {
    if kind == "created" {
        out.push(StageVisit { stage: String::new(), entered_at: at });
    } else if let Some(d) = detail {
        let before = d.split('→').next().map(|s| s.trim().to_string()).unwrap_or_default();
        if let Some(last) = out.last_mut() {
            if last.stage.is_empty() {
                last.stage = before;
            }
        }
        if let Some(after) = stage_after_arrow(d) {
            out.push(StageVisit { stage: after, entered_at: at });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_stage_history_from_activity() {
        let mut v = Vec::new();
        push_visit(&mut v, "created", None, "2026-09-01".into());
        push_visit(&mut v, "stage_changed", Some("Lead → Qualified"), "2026-09-05".into());
        push_visit(&mut v, "stage_changed", Some("Qualified → Proposal"), "2026-09-10".into());
        assert_eq!(v.iter().map(|x| x.stage.as_str()).collect::<Vec<_>>(), vec!["Lead", "Qualified", "Proposal"]);
    }

    #[test]
    fn reads_stage_from_change_detail() {
        assert_eq!(stage_after_arrow("Lead → Qualified").as_deref(), Some("Qualified"));
        assert_eq!(stage_after_arrow("Lead"), None);
    }
}
