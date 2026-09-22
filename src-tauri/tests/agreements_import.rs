// The agreements import on a fictional bundle: companies and aliases, merge /
// absorb / remove, chains, coverage counted once, exposure on the current link,
// superseded links ended, idempotent billing, and a second run changes nothing.
use menabig_tracker_lib::agreements_import::{active_mrr, run, Bundle, ImportOptions, Removal};
use menabig_tracker_lib::db::init_connection;
use rusqlite::{params, Connection};
use serde_json::json;
use std::path::PathBuf;

fn tmp(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("menabig_agr_import_{name}_{}", std::process::id()));
    let _ = std::fs::remove_file(&p);
    let _ = std::fs::remove_dir_all(&p);
    p
}
fn one<T: rusqlite::types::FromSql>(c: &Connection, sql: &str) -> T { c.query_row(sql, [], |r| r.get(0)).unwrap() }

fn bundle() -> Bundle {
    let v = |x: serde_json::Value| x.as_array().unwrap().clone();
    Bundle {
        clients: v(json!([
            { "key": "contoso", "displayName": "Contoso Logistics", "aliases": ["Contoso KSA"], "invoiceNames": ["CONTOSO LOGISTICS LLC"], "libraryFolder": "01_Active clients/Contoso" },
            { "key": "globex-me", "displayName": "Globex Middle East", "aliases": [], "invoiceNames": ["Globex ME"] },
            { "key": "globex-intl", "displayName": "Globex International — KSA Branch", "aliases": [], "invoiceNames": [] },
            { "key": "initech", "displayName": "Initech", "aliases": [], "invoiceNames": [] }
        ])),
        matches: v(json!([
            { "companyKey": "contoso", "displayName": "Contoso Logistics", "action": "MATCH", "appId": 1 },
            { "companyKey": "globex-me", "displayName": "Globex Middle East", "action": "MATCH", "appId": 2 },
            { "companyKey": "globex-intl", "displayName": "Globex International — KSA Branch", "action": "CREATE (history)", "appId": null },
            { "companyKey": "initech", "displayName": "Initech", "action": "SKIP", "appId": null }
        ])),
        groups: v(json!([{ "group": "Globex Group", "members": ["globex-me", "globex-intl"], "review": "" }])),
        agreements: v(json!([
            // Contoso: a principal superseded by its amendment, which is live and invoiced.
            { "sourceId": "C1", "importKey": "C1", "agrRef": "CON_001_0125", "refStem": "CON_001", "chainId": "C1", "carriesCurrentTerms": false, "evidenceState": "superseded",
              "companyKey": "contoso", "client": "Contoso", "agreementType": "Administration", "signatureStatus": "SIGNED-BOTH", "documentHeld": true, "currentTermEndDate": null, "services": ["Payroll"] },
            { "sourceId": "C2", "importKey": "C2", "agrRef": "CON_001_0125 / Amendment 1", "refStem": "CON_001", "chainId": "C1", "parentSourceId": "C1", "carriesCurrentTerms": true, "evidenceState": "documented",
              "companyKey": "contoso", "client": "Contoso", "agreementType": null, "signatureStatus": "MENA-SIGNED", "documentHeld": true, "currentTermEndDate": "2027-06-30", "renewalType": "auto", "nonRenewalNoticeDays": 60, "services": ["Payroll"] },
            // Globex ME: term ended, still invoiced — exposure; the review names the principal.
            { "sourceId": "G1", "importKey": "G1", "agrRef": "GLX/2022/001", "refStem": "GLX", "chainId": "G1", "carriesCurrentTerms": false, "evidenceState": "expired",
              "companyKey": "globex-me", "client": "Globex ME", "agreementType": "Workforce", "signatureStatus": "SIGNED-BOTH", "documentHeld": true, "currentTermEndDate": "2025-09-19", "services": ["Employer of Record"] },
            { "sourceId": "G2", "importKey": "G2", "agrRef": "GLX/2022/001 AM_01", "refStem": "GLX", "chainId": "G1", "parentSourceId": "G1", "carriesCurrentTerms": true, "evidenceState": "expired",
              "companyKey": "globex-me", "client": "Globex ME", "agreementType": "Workforce", "signatureStatus": "SIGNED-BOTH", "documentHeld": true, "currentTermEndDate": "2025-09-19", "services": ["Employer of Record"] },
            // Globex International: in term, not invoiced.
            { "sourceId": "G3", "importKey": "G3", "agrRef": null, "refStem": "GLXI_WF_0824", "chainId": "G3", "carriesCurrentTerms": true, "evidenceState": "documented",
              "companyKey": "globex-intl", "client": "Globex International", "agreementType": "Recruitment", "appType": "Workforce", "signatureStatus": "SIGNED-BOTH", "documentHeld": true, "currentTermEndDate": "2027-12-31", "services": ["Workforce"] }
        ])),
        lines: v(json!([
            { "agreementSourceId": "C2", "serviceName": "Payroll", "billing": "monthly", "unitPrice": 900.0 },
            { "agreementSourceId": "C2", "serviceName": "Visa processing", "billing": "per_action", "unitPrice": 250.0 }
        ])),
        documents: v(json!([{ "agrRef": "CON_001_0125 / Amendment 1", "client": "Contoso Logistics", "kind": "Amendment", "pathRelativeToOneDrive": "Library/Contoso/amendment.pdf" }])),
        billing: v(json!([
            { "companyKey": "contoso", "appCompanyId": 1, "month": "2026-06", "amount": 5000.0, "service": "Payroll", "financeDepartment": "Admin", "financeService": "Payroll", "salesType": "Monthly", "invoiceLines": 1, "source": "test" },
            { "companyKey": "contoso", "appCompanyId": 1, "month": "2026-06", "amount": 300.0, "service": "Payroll", "financeDepartment": "Admin", "financeService": "Payroll", "salesType": "Extra", "invoiceLines": 1, "source": "test" },
            { "companyKey": "globex-me", "appCompanyId": 2, "month": "2026-06", "amount": 40000.0, "service": "Employer of Record", "financeDepartment": "Workforce", "financeService": "Consultancy", "salesType": "Monthly", "invoiceLines": 3, "source": "test" },
            { "companyKey": "initech", "appCompanyId": null, "month": "2026-06", "amount": 100.0, "service": "Payroll", "financeDepartment": "Admin", "financeService": "Payroll", "salesType": "Monthly", "invoiceLines": 1, "source": "test" }
        ])),
        services: v(json!([
            // Covered by both links of Contoso's chain: counted once, on the current one.
            { "companyKey": "contoso", "service": "Payroll", "coverage": "covered", "coveredBy": ["CON_001_0125", "CON_001_0125 / Amendment 1"], "endedAgreements": [], "monthlyAvgMayJul": 5300.0 },
            { "companyKey": "contoso", "service": "Company Setup", "coverage": "one-time work", "coveredBy": ["CON_001_0125 / Amendment 1"], "endedAgreements": [], "monthlyAvgMayJul": 2000.0 },
            // Invoiced in May but not since: not billed now, so G3 isn't live.
            { "companyKey": "globex-intl", "service": "Workforce", "coverage": "covered", "coveredBy": ["GLXI_WF_0824"], "endedAgreements": [], "monthlyAvgMayJul": 100.0, "activeNow": false },
            { "companyKey": "globex-me", "service": "Employer of Record", "coverage": "agreement ended", "coveredBy": [], "endedAgreements": ["GLX/2022/001"], "monthlyAvgMayJul": 40000.0 }
        ])),
        collisions: v(json!([
            { "appId": 10, "action": "MERGE", "targetAgreement": "CON_001_0125 / Amendment 1" },
            { "appId": 11, "action": "ABSORB", "targetAgreement": "CON_001_0125 / Amendment 1" },
            { "appId": 12, "action": "REMOVE" },
            { "appId": 15, "action": "REMOVE" },
            { "appId": 13, "action": "REVIEW", "appRef": "CON_OTH_001", "actionNote": "services don't match" }
        ])),
    }
}

fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO companies (id, name, created_at) VALUES (1, 'Contoso Logistics', '2026-01-01'), (2, 'Globex Middle East LLC', '2026-01-01'), (3, 'Umbrella Co', '2026-01-01');
         INSERT INTO proposals (id, client, company_id, status, date_added) VALUES (70, 'Contoso Logistics', 1, 'Signed by Both Parties', '2026-01-01'), (71, 'Umbrella Co', 3, 'Signed by Both Parties', '2026-01-01');
         INSERT INTO agreements (id, agr_ref, client, company_id, status, proposal_id, created_at) VALUES
           (10, 'CON_ADM_001_0125', 'Contoso Logistics', 1, 'In Preparation', 70, '2026-01-01'),
           (11, 'CON_ADM_002_0125', 'Contoso Logistics', 1, 'In Preparation', NULL, '2026-01-01'),
           (12, 'UMB_WF_001_0625', 'Umbrella Co', 3, 'In Preparation', 71, '2026-01-01'),
           (13, 'CON_OTH_001', 'Contoso Logistics', 1, 'In Preparation', NULL, '2026-01-01'),
           (14, 'GLX/2022/001 AM_01', 'Globex Middle East LLC', 2, 'Signed', NULL, '2026-01-01'),
           (15, 'UMB_CM_002_0625', 'Umbrella Co', 3, 'In Preparation', NULL, '2026-01-01');",
    ).unwrap();
}

#[test]
fn imports_the_bundle_by_the_rules_and_a_second_run_changes_nothing() {
    let mut c = init_connection(&tmp("db")).unwrap();
    seed(&c);
    let opts = ImportOptions {
        onedrive_root: None, library_dir: None, today: "2026-09-22".into(), remove_company_records: false,
        removals: [(12, Removal::Remove { proposal_status: Some("Lost".into()) }), (15, Removal::OnHold)].into_iter().collect(),
        add_skipped_with_billing: true, default_business_entity: true,
    };
    let r = run(&mut c, &bundle(), &opts).unwrap();

    // Companies: aliases on the matched company, a new one created, groups, skip does nothing.
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM company_aliases WHERE company_id = 1"), 2); // Contoso KSA, CONTOSO LOGISTICS LLC
    let intl: i64 = one(&c, "SELECT id FROM companies WHERE name = 'Globex International — KSA Branch'");
    let group: i64 = one(&c, "SELECT id FROM companies WHERE name = 'Globex Group'");
    assert_eq!(one::<Option<i64>>(&c, "SELECT parent_company_id FROM companies WHERE id = 2"), Some(group));
    assert_eq!(c.query_row("SELECT parent_company_id FROM companies WHERE id = ?1", params![intl], |r| r.get::<_, Option<i64>>(0)).unwrap(), Some(group));
    // Skipped as dormant but invoiced: added, so its invoicing loads (owner decision).
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM companies WHERE name = 'Initech'"), 1);

    // MERGE: the draft keeps its id and proposal, and takes the current link's data.
    let (status, service, fee, basis, sig, renew, auto): (String, String, f64, String, String, String, i64) = c.query_row(
        "SELECT status, service_status, monthly_fee, fee_basis, signature_status, renewal_rule, auto_renew FROM agreements WHERE id = 10", [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).unwrap();
    assert_eq!((status.as_str(), service.as_str(), basis.as_str(), sig.as_str(), renew.as_str(), auto), ("Client Signature", "Active", "invoiced", "MENA-SIGNED", "auto", 1));
    assert_eq!(fee, 5300.0, "billed service counted once, on the current link; one-time work isn't a monthly fee");
    assert_eq!(one::<Option<i64>>(&c, "SELECT proposal_id FROM agreements WHERE id = 10"), Some(70));
    assert_eq!(one::<String>(&c, "SELECT type FROM agreements WHERE id = 10"), "Administration", "the draft's type is kept when the review has none");
    // The superseded principal: ended, no fee, same chain; exactly one current link.
    let principal: i64 = one(&c, "SELECT id FROM agreements WHERE import_key = 'C1'");
    assert_eq!(c.query_row("SELECT service_status, chain_root_id FROM agreements WHERE id = ?1", params![principal], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).unwrap(), ("Ended".into(), principal));
    assert_eq!(one::<i64>(&c, "SELECT chain_root_id FROM agreements WHERE id = 10"), principal);
    assert_eq!(one::<i64>(&c, "SELECT parent_agreement_id FROM agreements WHERE id = 10"), principal);
    // Lines replaced by the reviewed ones; per-action kept as such (not in monthly totals).
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM agreement_lines WHERE agreement_id = 10"), 2);
    assert_eq!(one::<String>(&c, "SELECT billing FROM agreement_lines WHERE agreement_id = 10 AND service_name = 'Visa processing'"), "per_action");

    // ABSORB kept and marked; REMOVE per the owner: deleted with its proposal Lost, or kept On Hold; REVIEW left alone.
    assert_eq!(one::<Option<i64>>(&c, "SELECT absorbed_into_id FROM agreements WHERE id = 11"), Some(10));
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM agreements WHERE id = 12"), 0);
    assert_eq!(one::<String>(&c, "SELECT status FROM proposals WHERE id = 71"), "Lost");
    assert!(!r.removed[0].would_be_recreated);
    assert_eq!(one::<String>(&c, "SELECT status FROM agreements WHERE id = 15"), "On Hold");
    // All under MENA: the entity for the currency.
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM agreements WHERE import_key IS NOT NULL AND business_entity_id IS NULL"), 0);
    assert_eq!(one::<String>(&c, "SELECT status FROM agreements WHERE id = 13"), "In Preparation");
    assert_eq!(r.review.len(), 1);

    // Exposure: the chain's current link (matched by reference to app row 14) is Signed · Active with a past end.
    assert_eq!(c.query_row("SELECT status, service_status, end_date FROM agreements WHERE id = 14", [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).unwrap(),
        ("Signed".into(), "Active".into(), "2025-09-19".into()));
    assert_eq!(one::<String>(&c, "SELECT service_status FROM agreements WHERE import_key = 'G1'"), "Ended", "the superseded principal isn't exposure too");
    // In term, not invoiced now: service left unset; no reference → the stem; the review's app type wins.
    assert_eq!(r.types_mapped.get("Recruitment → Workforce"), Some(&1));
    assert_eq!(c.query_row("SELECT agr_ref, service_status, type FROM agreements WHERE import_key = 'G3'", [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?))).unwrap(),
        ("GLXI_WF_0824".into(), None, "Workforce".into()));

    // Billing: one row per Finance row (two rows for one service in one month), the added client's too.
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM billing"), 4);
    assert_eq!(one::<f64>(&c, "SELECT SUM(amount) FROM billing WHERE company_id = 1"), 5300.0);
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM documents WHERE agreement_id = 10"), 1);

    // Exposure carries what is still invoiced for it.
    assert_eq!(one::<f64>(&c, "SELECT monthly_fee FROM agreements WHERE id = 14"), 40000.0);
    // Contracted MRR: today's rule prefers the lines (900) and drops a past end date; after §5.6
    // the invoiced fee wins (5,300) and a past-term agreement still invoiced counts (40,000).
    assert_eq!(active_mrr(&c, "2026-09-22").unwrap(), (900.0, 45300.0));

    // A second run: same rows, nothing doubled.
    let counts = |c: &Connection| ["agreements", "agreement_lines", "billing", "documents", "company_aliases", "companies"].map(|t| one::<i64>(c, &format!("SELECT COUNT(*) FROM {t}")));
    let before = counts(&c);
    run(&mut c, &bundle(), &opts).unwrap();
    assert_eq!(counts(&c), before);
    assert_eq!(one::<i64>(&c, "SELECT COUNT(*) FROM (SELECT chain_root_id FROM agreements WHERE carries_current_terms = 1 AND chain_root_id IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1)"), 0);
}
