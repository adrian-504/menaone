// The agreements import, rehearsed on a COPY of the database:
//   cargo run --example agreements_import_dry_run -- <bundle dir> <database copy> <report dir> [onedrive root]
// Writes report.json and report.md (client data — keep them out of the repo).
// Refuses the live database.
use menabig_tracker_lib::agreements_import::{active_mrr, company_mrr, run, Bundle, ImportOptions, Removal};
use menabig_tracker_lib::db::{init_connection, schema_version};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::path::PathBuf;

fn count(conn: &rusqlite::Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0)
}
fn sar(v: f64) -> String {
    let n = v.round() as i64;
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 { out.push(','); }
        out.push(c);
    }
    format!("SAR {}{}", if n < 0 { "-" } else { "" }, out)
}

struct Decisions { removals: std::collections::HashMap<i64, Removal>, add_skipped: bool, entity: bool }

impl Decisions {
    fn read(path: &std::path::Path) -> Self {
        let Ok(text) = std::fs::read_to_string(path) else { return Decisions { removals: Default::default(), add_skipped: false, entity: false } };
        let v: serde_json::Value = serde_json::from_str(&text).expect("decisions.json");
        let removals = v["removals"].as_object().map(|m| m.iter().filter_map(|(k, d)| {
            let r = match d.as_str()? {
                "keep" => Removal::Keep,
                "on_hold" => Removal::OnHold,
                "lost" => Removal::Remove { proposal_status: Some("Lost".into()) },
                "withdrawn" => Removal::Remove { proposal_status: Some("Withdrawn".into()) },
                _ => Removal::Remove { proposal_status: None },
            };
            Some((k.parse().ok()?, r))
        }).collect()).unwrap_or_default();
        Decisions { removals, add_skipped: v["addSkippedWithBilling"].as_bool().unwrap_or(false), entity: v["defaultBusinessEntity"].as_bool().unwrap_or(false) }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, bundle_dir, db_path, out_dir, ..] = args.as_slice() else { panic!("usage: <bundle dir> <database copy> <report dir> [onedrive root]") };
    assert!(!db_path.contains("Application Support"), "rehearse on a copy, never the live database");
    let onedrive = args.get(4).map(PathBuf::from);
    let today = std::env::var("IMPORT_TODAY").unwrap_or_else(|_| chrono_today());
    let bundle = Bundle::read(std::path::Path::new(bundle_dir)).expect("read bundle");
    let mut conn = init_connection(&PathBuf::from(db_path)).expect("open copy (migrates to the latest schema)");

    // The owner's decisions, if given: <report dir>/decisions.json
    // {"removals": {"<app id>": "keep" | "on_hold" | "remove" | "lost" | "withdrawn"}, "addSkippedWithBilling": true, "defaultBusinessEntity": true}
    let decisions = Decisions::read(&PathBuf::from(out_dir).join("decisions.json"));

    let tables = ["companies", "company_aliases", "agreements", "agreement_lines", "documents", "billing", "company_review_queue", "entity_links"];
    let before: Vec<(String, i64)> = tables.iter().map(|t| (t.to_string(), count(&conn, &format!("SELECT COUNT(*) FROM {t}")))).collect();
    let mrr_before = active_mrr(&conn, &today).unwrap();
    let company_before = company_mrr(&conn, &today).unwrap();
    let active_clients_before = company_before.values().filter(|v| v.0 > 0.0).count();

    let opts = ImportOptions { onedrive_root: onedrive, library_dir: Some("Agreements Central Folder/00_Organized_Library_2026".into()), today: today.clone(), remove_company_records: false,
        removals: decisions.removals, add_skipped_with_billing: decisions.add_skipped, default_business_entity: decisions.entity };
    let report = run(&mut conn, &bundle, &opts).expect("import");

    let after: Vec<(String, i64)> = tables.iter().map(|t| (t.to_string(), count(&conn, &format!("SELECT COUNT(*) FROM {t}")))).collect();
    let mrr_after = active_mrr(&conn, &today).unwrap();
    let company_after = company_mrr(&conn, &today).unwrap();
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    let fk: i64 = conn.prepare("PRAGMA foreign_key_check").unwrap().query_map([], |_| Ok(())).unwrap().count() as i64;
    let chain_violations = count(&conn, "SELECT COUNT(*) FROM (SELECT chain_root_id FROM agreements WHERE chain_root_id IS NOT NULL AND carries_current_terms = 1 GROUP BY chain_root_id HAVING COUNT(*) > 1)");

    // Billed vs covered, per client, from the review's coverage (May–Jul average).
    let names: HashMap<String, String> = bundle.clients.iter().filter_map(|c| Some((c.get("key")?.as_str()?.to_string(), c.get("displayName")?.as_str()?.to_string()))).collect();
    let mut per_client: BTreeMap<String, (f64, f64, f64, f64)> = BTreeMap::new(); // billed, covered, ended, none
    let mut one_time = 0.0;
    for sv in &bundle.services {
        // As the review measures it: clients billing now, one-time work apart.
        if !sv.get("activeNow").and_then(Value::as_bool).unwrap_or(false) { continue; }
        if sv.get("coverage").and_then(Value::as_str) == Some("one-time work") { one_time += sv.get("monthlyAvgMayJul").and_then(Value::as_f64).unwrap_or(0.0); continue; }
        let key = sv.get("companyKey").and_then(Value::as_str).unwrap_or_default().to_string();
        let avg = sv.get("monthlyAvgMayJul").and_then(Value::as_f64).unwrap_or(0.0);
        let e = per_client.entry(key).or_default();
        e.0 += avg;
        match sv.get("coverage").and_then(Value::as_str) {
            Some("covered") => e.1 += avg,
            Some("agreement ended") => e.2 += avg,
            Some("no agreement") => e.3 += avg,
            _ => {}
        }
    }
    let billed_now: f64 = per_client.values().map(|v| v.0).sum();
    let covered: f64 = per_client.values().map(|v| v.1).sum();
    let ended: f64 = per_client.values().map(|v| v.2).sum();
    let none: f64 = per_client.values().map(|v| v.3).sum();

    std::fs::create_dir_all(out_dir).unwrap();
    let json = serde_json::json!({
        "today": today, "schemaAfter": schema_version(&conn).unwrap_or(0), "integrity": integrity, "foreignKeyProblems": fk,
        "chainViolations": chain_violations, "countsBefore": before, "countsAfter": after,
        "mrrBefore": mrr_before, "mrrAfter": mrr_after, "billedNow": billed_now, "covered": covered, "ended": ended, "noAgreement": none,
        "report": report,
    });
    std::fs::write(format!("{out_dir}/report.json"), serde_json::to_string_pretty(&json).unwrap()).unwrap();

    // ── The owner's report ──
    let mut md = String::new();
    let _ = writeln!(md, "# Agreements import — trial run\n\nRun {today} against a **copy** of your database. Nothing in the app has changed.\n");
    let _ = writeln!(md, "## Result at a glance\n");
    let _ = writeln!(md, "| | |\n|---|---|");
    let created = report.companies.iter().filter(|c| c.action.starts_with("CREATE") && c.company_id.is_some()).count();
    let matched = report.companies.iter().filter(|c| c.action == "MATCH" && c.company_id.is_some()).count();
    let reviewq = report.companies.iter().filter(|c| c.action == "REVIEW").count();
    let skipped = report.companies.iter().filter(|c| c.action == "SKIP").count();
    let aliases: usize = report.companies.iter().map(|c| c.aliases_added).sum();
    let _ = writeln!(md, "| Clients | {matched} matched to your companies · {created} new companies · {reviewq} for review · {skipped} dormant, skipped |");
    let _ = writeln!(md, "| Other names recorded | {aliases} (earlier names and invoice names, so records find their company) |");
    let _ = writeln!(md, "| Groups | {} group records, {} companies under them |", report.groups.len(), report.groups.iter().map(|g| g.2).sum::<usize>());
    let by = |a: &str| report.agreements.iter().filter(|x| x.action == a).count();
    let _ = writeln!(md, "| Agreements | {} added · {} merged into the app's drafts · {} matched to existing rows by reference · {} absorbed (+ {} old-tracker copies) · {} · {} left for your review |", by("inserted"), by("merged"), by("matched by reference"), report.absorbed.len(), report.tracker_duplicates.len(), report.removed.iter().map(|r| r.outcome.split(" · ").next().unwrap_or("").to_string()).fold(BTreeMap::<String, usize>::new(), |mut m, o| { *m.entry(o).or_default() += 1; m }).iter().map(|(o, n)| format!("{n} {o}")).collect::<Vec<_>>().join(" · "), report.review.len());
    let _ = writeln!(md, "| Price lines | {} |", report.lines_written);
    let _ = writeln!(md, "| Documents | {} linked to their agreement · {} to the company only · {} not placed |", report.documents_linked, report.documents_company_only, report.documents_unplaced);
    let _ = writeln!(md, "| Library folders | {} linked · {} not found |", report.folders_linked, report.folders_missing.len());
    let _ = writeln!(md, "| Billing | {} rows · {} (Jan–Jul 2026{}) |", report.billing_rows, sar(report.billing_total), if report.billing_future_months.is_empty() { String::new() } else { format!(", plus {} rows dated Aug–Dec", report.billing_future_months.len()) });
    let _ = writeln!(md, "| Checks on the copy | integrity {integrity} · {fk} foreign-key problems · {chain_violations} chains with more than one current agreement |\n");

    let _ = writeln!(md, "## Money\n");
    let _ = writeln!(md, "**Billed now (clients invoicing now, May–Jul average):** {} a month — covered by a live agreement {} ({:.1}%), agreement ended {} ({:.1}%), no agreement {} ({:.1}%). One-time work, not a monthly service: {} more.\n",
        sar(billed_now), sar(covered), 100.0 * covered / billed_now.max(1.0), sar(ended), 100.0 * ended / billed_now.max(1.0), sar(none), 100.0 * none / billed_now.max(1.0), sar(one_time));
    let _ = writeln!(md, "**Contracted MRR** (active agreements, SAR) — what My Day's Business line, the Agreements list and Analytics show:\n");
    let _ = writeln!(md, "| | Before import | After import, as the app counts today | After import, with the invoiced fee winning (§5.6) |\n|---|---|---|---|");
    let _ = writeln!(md, "| Total | {} | {} | {} |", sar(mrr_before.0), sar(mrr_after.0), sar(mrr_after.1));
    let active_after = company_after.values().filter(|v| v.1 > 0.0).count();
    let _ = writeln!(md, "| Companies with contracted MRR | {active_clients_before} | {} | {active_after} |\n", company_after.values().filter(|v| v.0 > 0.0).count());
    let _ = writeln!(md, "Today the app prefers the sum of an agreement's price lines over its stored fee, and many lines are per-action or per-person, so the middle column undercounts. §5.6 (the stored, invoiced fee wins) is a code change for the real build. Reports is not affected: its MRR column shows proposal fees, not agreements.\n");
    // Where the §5.6 figure comes from, so it reconciles with the review's billed-and-covered total.
    let part = |w: &str| -> (f64, i64) { conn.query_row(&format!(
        "SELECT COALESCE(SUM(CASE WHEN COALESCE(a.fee_basis, '') = 'invoiced' THEN COALESCE(a.monthly_fee, 0)
                  ELSE (CASE WHEN (SELECT COUNT(*) FROM agreement_lines l WHERE l.agreement_id = a.id) > 0
                        THEN (SELECT COALESCE(SUM(COALESCE(l.quantity, 1) * l.unit_price), 0) FROM agreement_lines l WHERE l.agreement_id = a.id AND l.billing = 'monthly' AND l.unit_price IS NOT NULL)
                        ELSE COALESCE(a.monthly_fee, 0) END) END), 0), COUNT(*)
         FROM agreements a WHERE COALESCE(a.status, '') != 'Canceled' AND a.service_status = 'Active' AND COALESCE(a.currency, 'SAR') = 'SAR' AND ({w})"), [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap() };
    let live = part("a.fee_basis = 'invoiced' AND (a.end_date IS NULL OR a.end_date >= date('now'))");
    let past = part("a.fee_basis = 'invoiced' AND a.end_date < date('now')");
    let other = part("COALESCE(a.fee_basis, '') != 'invoiced' AND (a.end_date IS NULL OR a.end_date >= date('now'))");
    let _ = writeln!(md, "The §5.6 figure is made of: invoiced and covered by a live agreement {} ({} agreements) · invoiced after the term ended {} ({}) · **not from invoicing** {} ({}) — rows already in the app marked service Active whose fee comes from their price lines or stored fee, not from billing (listed under *Already in the app, and contradictory* and in the agreements table). Billed-and-papered alone: **{}**.\n",
        sar(live.0), live.1, sar(past.0), past.1, sar(other.0), other.1, sar(live.0 + past.0));

    let _ = writeln!(md, "### Billed vs covered, per client billing now\n\n| Client | Billed / month | Covered | Agreement ended | No agreement |\n|---|---|---|---|---|");
    let mut rows: Vec<_> = per_client.iter().filter(|(_, v)| v.0 > 0.0).collect();
    rows.sort_by(|a, b| b.1 .0.partial_cmp(&a.1 .0).unwrap());
    for (k, v) in rows {
        let _ = writeln!(md, "| {} | {} | {} | {} | {} |", names.get(k).cloned().unwrap_or(k.clone()), sar(v.0), if v.1 > 0.0 { sar(v.1) } else { "—".into() }, if v.2 > 0.0 { sar(v.2) } else { "—".into() }, if v.3 > 0.0 { sar(v.3) } else { "—".into() });
    }

    // ── What the data says, checked against how the business works ──
    let q = |sql: &str| -> Vec<Vec<String>> {
        let mut st = conn.prepare(sql).unwrap();
        let n = st.column_count();
        st.query_map([], |r| Ok((0..n).map(|i| r.get::<_, rusqlite::types::Value>(i).map(|v| match v {
            rusqlite::types::Value::Null => String::new(), rusqlite::types::Value::Integer(i) => i.to_string(),
            rusqlite::types::Value::Real(f) => format!("{f:.0}"), rusqlite::types::Value::Text(t) => t, _ => String::new() }).unwrap_or_default()).collect()))
            .unwrap().collect::<Result<Vec<_>, _>>().unwrap()
    };
    let _ = writeln!(md, "\n## Checked against how the business works\n");
    let by_type = q("SELECT COALESCE(NULLIF(type, ''), '(no type)'), ROUND(SUM(monthly_fee)), COUNT(*) FROM agreements WHERE fee_basis = 'invoiced' AND service_status = 'Active' AND monthly_fee > 0 GROUP BY 1 ORDER BY 2 DESC");
    let _ = writeln!(md, "**What the contracted MRR is made of** (invoiced May–Jul average, including agreements billed after their term).\n\n| Agreement type | Monthly | Agreements |\n|---|---|---|");
    for r in &by_type { let _ = writeln!(md, "| {} | {} | {} |", r[0], sar(r[1].parse().unwrap_or(0.0)), r[2]); }
    let exposure = q("SELECT COALESCE(NULLIF(agr_ref, ''), '(no reference)'), client, end_date, printf('SAR %,d', CAST(COALESCE(monthly_fee, 0) AS INTEGER)) FROM agreements WHERE import_key IS NOT NULL AND service_status = 'Active' AND end_date < date('now') ORDER BY end_date");
    let _ = writeln!(md, "\n**Exposure — still invoiced, term ended ({}).** Most likely renewed by themselves with the renewal paperwork missing: Signed · Active, their real end date kept, counted in MRR at the invoiced fee (§5.6 column). The real build lists them as \"renewal not on file\" on the company page and in their own list:\n", exposure.len());
    for r in &exposure { let _ = writeln!(md, "- {} · {} · ended {} · {} a month", r[1], r[0], r[2], r[3]); }
    let idle = q("SELECT COALESCE(NULLIF(agr_ref, ''), '(no reference)'), client, COALESCE(NULLIF(type, ''), 'no type'), COALESCE('ends ' || end_date, 'no end date'), COALESCE(renewal_rule, 'unknown') FROM agreements WHERE import_key IS NOT NULL AND service_status IS NULL ORDER BY client");
    let _ = writeln!(md, "\n**In force but not invoiced May–Jul ({}).** The service is left unset, so they don't count as active. Each is either dormant or work that isn't being billed — worth a look:\n", idle.len());
    for r in &idle { let _ = writeln!(md, "- {} · {} · {} · {} · renewal {}", r[1], r[0], r[2], r[3], r[4]); }
    let skipped: Vec<&String> = report.notes.iter().filter(|n| n.starts_with("Billing for ")).collect();
    if !skipped.is_empty() {
        let mut who: BTreeMap<String, (usize, f64)> = BTreeMap::new();
        for row in &bundle.billing {
            let key = row.get("companyKey").and_then(Value::as_str).unwrap_or_default();
            if report.companies.iter().any(|c| c.company_key == key && c.company_id.is_some()) || row.get("appCompanyId").and_then(Value::as_i64).is_some() { continue; }
            let e = who.entry(names.get(key).cloned().unwrap_or(key.to_string())).or_default();
            e.0 += 1;
            e.1 += row.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        }
        let _ = writeln!(md, "\n**Invoiced in 2026 but skipped as dormant ({} clients, net {}).** \"Skip the dormant clients with no agreements\" also skipped these, so their invoicing isn't loaded and the app's billing total falls short of the sales report by that much. Negative amounts are credit notes:\n", who.len(), sar(who.values().map(|v| v.1).sum()));
        for (n, (rows, amt)) in &who { let _ = writeln!(md, "- {n} — {rows} invoice row(s), {}", sar(*amt)); }
    }
    let contradictions = q("SELECT id, COALESCE(agr_ref, ''), client, status FROM agreements WHERE import_key IS NULL AND service_status = 'Active' AND status IN ('In Preparation', 'Client Review', 'Client Signature', 'MENA Signature', '')");
    if !contradictions.is_empty() {
        let _ = writeln!(md, "\n**Already in the app, and contradictory ({}):** drafts not yet signed but marked \"service active\", so they count towards MRR today. Not touched by the import:\n", contradictions.len());
        for r in &contradictions { let _ = writeln!(md, "- #{} {} · {} · {}", r[0], r[1], r[2], r[3]); }
    }
    let _ = writeln!(md, "\n**Dates.** For agreements that have renewed, the end date is the current term's end and \"Term\" is the length of the first term — so a 12-month agreement can end two years after it started. Of the live agreements, {} have no end date and {} no notice period; the real build shows those as *unknown*.\n",
        count(&conn, "SELECT COUNT(*) FROM agreements WHERE import_key IS NOT NULL AND service_status = 'Active' AND carries_current_terms = 1 AND end_date IS NULL"),
        count(&conn, "SELECT COUNT(*) FROM agreements WHERE import_key IS NOT NULL AND service_status = 'Active' AND carries_current_terms = 1 AND notice_days IS NULL"));

    let _ = writeln!(md, "\n## Your decisions (22-Sep), as applied\n");
    let entity_rows = q("SELECT COALESCE(e.name, '(none)'), COUNT(*) FROM agreements a LEFT JOIN business_entities e ON e.id = a.business_entity_id WHERE a.import_key IS NOT NULL GROUP BY 1 ORDER BY 2 DESC");
    let _ = writeln!(md, "**1. Billing entity: all under MENA.** No legal billing entity is tracked for now; the imported agreements take the app's MENA entity for their currency: {}. (The agreements name the MENA side in {} ways; that stays in the review files, not the app.)\n",
        entity_rows.iter().map(|r| format!("{} ({})", r[0], r[1])).collect::<Vec<_>>().join(", "), report.mena_entities.len());
    let _ = writeln!(md, "**2. The review's four removals:**\n\n| Client | Draft | Proposal (before) | Done |\n|---|---|---|---|");
    for r in &report.removed {
        let _ = writeln!(md, "| {} | #{} {} | {} | {} |", r.client, r.app_id, r.agr_ref.clone().unwrap_or_default(),
            r.proposal_id.map(|p| format!("SL# {p} · {}", r.proposal_status.clone().unwrap_or_default())).unwrap_or("—".into()), r.outcome);
    }
    let _ = writeln!(md, "\nThe app has no \"Postponed\" status for proposals, so a postponed client's draft is kept and set *On Hold*: that records the postponement and stops \"Draft from proposals\" from making a second draft. Company records are all kept.\n");
    let created: Vec<String> = report.groups.iter().map(|g| g.0.clone()).collect();
    let not_created: Vec<String> = bundle.groups.iter().filter_map(|g| g.get("group").and_then(|v| v.as_str()))
        .filter(|g| !created.iter().any(|c| c == g)).map(str::to_string).collect();
    let _ = writeln!(md, "**3. Groups:** one group record each ({}), members under it.{}\n",
        created.join(", "),
        if not_created.is_empty() { String::new() } else { format!(" Not created: {} — its members aren't among the imported clients.", not_created.join(", ")) });
    let _ = writeln!(md, "**4. Types mapped to the app's list.** {}{}\n",
        if report.types_mapped.is_empty() { "Every agreement carries one of the app's types.".to_string() } else { format!("The document's own word → the app's type: {}.", report.types_mapped.iter().map(|(t, n)| format!("{t} ({n})")).collect::<Vec<_>>().join(", ")) },
        if report.types_outside_list.is_empty() { String::new() } else { format!(" Still outside the list: {}.", report.types_outside_list.iter().map(|(t, n)| format!("{t} ({n})")).collect::<Vec<_>>().join(", ")) });
    let added: Vec<&str> = report.companies.iter().filter(|c| c.action.starts_with("CREATE (invoiced")).map(|c| c.name.as_str()).collect();
    let _ = writeln!(md, "**5. Invoiced clients skipped as dormant: added** ({}) as companies, so their 2026 invoicing loads and the app's billing total matches Finance's report.{}\n",
        added.join(", "), if skipped.is_empty() { "" } else { " Some billing still has no company — see Notes." });
    let _ = writeln!(md, "**Billed after the term ended: counted in MRR.** Most likely the service renewed by itself and the renewal paperwork is missing. They count at their invoiced fee in the §5.6 column, keep their real end date, and stay on the exposure list above until the renewal is on file.\n");
    let _ = writeln!(md, "## How the import reads the review (bundle v1.2)\n");
    let _ = writeln!(md, "- **{} app agreements from the old tracker have the same reference as a reviewed agreement** but aren't in the collision list; the import updates them in place (\"matched by reference\" below) instead of duplicating them.", report.agreements.iter().filter(|a| a.action == "matched by reference").count());
    let _ = writeln!(md, "- **Billing** is keyed on Finance's own row (company, department, service, sales type, month, source), as §4 now says.");
    let _ = writeln!(md, "- **Coverage counted once.** Each billed service has one primary agreement, which takes the fee; the other agreements naming it are in force at SAR 0. A billed service whose agreement ended puts its fee on the chain's current link. One-time work isn't a monthly fee.");
    let _ = writeln!(md, "- **Additive addenda** are keyed on the review's `addsToParent` flag and stay in force beside their parent.");
    if report.drafts_filed_as_documents > 0 { let _ = writeln!(md, "- **Unsigned drafts** ({}) are filed as documents on their chain's current agreement, not as agreements.", report.drafts_filed_as_documents); }
    let _ = writeln!(md, "- **Reports** isn't affected by §5.6: its MRR column shows proposal fees, not agreements.\n");
    let _ = writeln!(md, "## Left for review\n");
    let _ = writeln!(md, "**App drafts the review couldn't match to a live agreement ({}):**\n", report.review.len());
    for (id, r, why) in &report.review { let _ = writeln!(md, "- #{id} {r} — {why}"); }
    let _ = writeln!(md, "\n**Clients for review:**\n");
    for c in report.companies.iter().filter(|c| c.action == "REVIEW") { let _ = writeln!(md, "- {} — {}", c.name, c.note.clone().unwrap_or_default()); }
    if !report.tracker_duplicates.is_empty() {
        let _ = writeln!(md, "\n**Old-tracker copies of reviewed agreements ({}):** the review merged its data into the app's proposal-linked draft, so these older rows with the same reference are marked absorbed into it (kept, not deleted), leaving one of each:\n", report.tracker_duplicates.len());
        for (id, r, t) in &report.tracker_duplicates { let _ = writeln!(md, "- #{id} {r} → #{t}"); }
    }
    let _ = writeln!(md, "\n**App agreements no reviewed agreement accounts for ({}):** older tracker rows left as they are — an agreement the review didn't find, or one that ended long ago.\n", report.untouched_app_rows.len());
    for (id, r, client, status) in &report.untouched_app_rows {
        // Same company as reviewed agreements, and no reference: possibly one of them.
        let same_company = count(&conn, &format!("SELECT COUNT(*) FROM agreements x JOIN agreements y ON y.company_id = x.company_id WHERE x.id = {id} AND y.import_key IS NOT NULL"));
        let hint = if same_company > 0 && r.as_deref().map_or(true, |x| x.trim().is_empty()) { " — no reference, and the company has reviewed agreements: possibly one of them" } else { "" };
        let _ = writeln!(md, "- #{id} {} · {client} · {}{hint}", r.clone().filter(|x| !x.trim().is_empty()).unwrap_or_else(|| "(no reference)".into()), status.clone().filter(|x| !x.trim().is_empty()).unwrap_or_else(|| "no status".into()));
    }
    let _ = writeln!(md, "\n## Agreements\n\n| Reference | Company | What happened | Status | Service | Monthly (invoiced) | Ends | Note |\n|---|---|---|---|---|---|---|---|");
    let mut ags: Vec<_> = report.agreements.iter().collect();
    ags.sort_by(|a, b| a.company.cmp(&b.company));
    for a in ags {
        let _ = writeln!(md, "| {} | {} | {}{} | {} | {} | {} | {} | {} |", a.agr_ref.clone().unwrap_or(a.import_key.clone()), a.company, a.action, a.app_id.map(|i| format!(" (#{i})")).unwrap_or_default(), a.status,
            a.service_status.clone().unwrap_or("—".into()), a.monthly_fee.map(sar).unwrap_or("—".into()), a.end_date.clone().unwrap_or("unknown".into()), a.note.clone().unwrap_or_default());
    }
    let _ = writeln!(md, "\n## Companies\n\n| Client | What happened | App company | Other names added | Note |\n|---|---|---|---|---|");
    for c in report.companies.iter().filter(|c| c.action != "SKIP") {
        let _ = writeln!(md, "| {} | {} | {} | {} | {} |", c.name, c.action, c.company_id.map(|i| format!("#{i}")).unwrap_or("—".into()), c.aliases_added, c.note.clone().unwrap_or_default());
    }
    let _ = writeln!(md, "\n## Notes from the data\n");
    if !report.documents_missing_files.is_empty() { let _ = writeln!(md, "- Documents whose file isn't at its recorded path ({}): {}", report.documents_missing_files.len(), report.documents_missing_files.join("; ")); }
    if !report.folders_missing.is_empty() { let _ = writeln!(md, "- Library folders not found on this Mac ({}): {}", report.folders_missing.len(), report.folders_missing.join("; ")); }
    if !report.billing_future_months.is_empty() { let _ = writeln!(md, "- {} billing rows are dated after July 2026 ({}): loaded as given; the monthly figure uses May–Jul only.", report.billing_future_months.len(), report.billing_future_months.iter().map(|(m, a)| format!("{m} {}", sar(*a))).collect::<Vec<_>>().join(", ")); }
    if !report.lines_unmapped_services.is_empty() { let _ = writeln!(md, "- Price-line services not in the catalogue (kept by name): {}", report.lines_unmapped_services.iter().map(|(k, n)| format!("{k} ({n})")).collect::<Vec<_>>().join(", ")); }
    if !report.billing_unmapped_services.is_empty() { let _ = writeln!(md, "- Billing services not in the catalogue: {}", report.billing_unmapped_services.iter().map(|(k, n)| format!("{k} ({n})")).collect::<Vec<_>>().join(", ")); }
    for n in &report.notes { let _ = writeln!(md, "- {n}"); }
    let _ = writeln!(md, "\n## Table counts on the copy\n\n| Table | Before | After |\n|---|---|---|");
    for ((t, b), (_, a)) in before.iter().zip(after.iter()) { let _ = writeln!(md, "| {t} | {b} | {a} |"); }
    std::fs::write(format!("{out_dir}/report.md"), md).unwrap();
    println!("schema {} · integrity {integrity} · fk problems {fk} · chain violations {chain_violations}", schema_version(&conn).unwrap_or(0));
    println!("MRR before {:.0} · after (today's rule) {:.0} · after (§5.6) {:.0} · billed now {:.0}", mrr_before.0, mrr_after.0, mrr_after.1, billed_now);
}

fn chrono_today() -> String {
    let out = std::process::Command::new("date").arg("+%Y-%m-%d").output().expect("date");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}
