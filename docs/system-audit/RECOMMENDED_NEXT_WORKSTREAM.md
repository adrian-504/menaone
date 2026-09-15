# Recommended next workstream

## Identity & Data Ownership Foundation (local-first; no cloud yet)

### Objective

Make every record in MENA One answer three questions **inside today's single desktop app**, without adding a server:

1. *Which record is this, globally?*
2. *Who owns it and who changed it?*
3. *Is it company data or one person's data?*

Also close the small reliability and security gaps found in this audit.

### Why now

- The product workflow is complete for one user (PRODUCT_AUDIT), and Phases 2–4 are closed. There's no product reason to keep adding modules.
- Every future direction the owner has mentioned (Windows colleagues, 5–10 users, cloud data, Microsoft sign-in) is blocked by the **same five data-ownership issues** (CLOUD_READINESS C1–C5). The blockers apply equally to online and offline designs (SYNC_READINESS), so this work doesn't depend on the undecided hosting and sync questions.
- The dataset is still small (about 1,500 business records, one user, one device). Changing identity and ownership is cheapest now; every month of real use by more people makes it more expensive.

### The problem, precisely

- Records are identified by device-local integers.
- Relationships point at those integers.
- There is no user.
- Saves overwrite whole records.
- Personal Microsoft data sits in the same tables as company data.
- Files are referenced by one Mac's absolute paths.

### What must happen first

1. **Owner answers the decisions that shape the foundation** (ARCHITECTURE_DECISIONS_REQUIRED): Q1 tenant model, Q5 data classification, Q6 file architecture direction, Q8 roles (coarse). Q2 (online vs offline), Q4 (hosting) and Q13 (sync build vs buy) can wait.
2. **Run the existing CI once** (macOS and Windows jobs), so the workstream starts from evidence rather than assumption.

### What NOT to do yet

- No server, API, Postgres, Azure resources or hosting.
- No sync engine, outbox or conflict-resolution UI; no offline replication.
- No SharePoint migration or moving client folders.
- No Windows UI redesign; no rewrite of the frontend `expose()` / inline-handler style.
- No new product modules, reports, AI features or dashboard work.
- No change to company identity, the Work Graph model, migrations or the proposal generator (DO NOT TOUCH list in SYSTEM_AUDIT §20).

## Sprints (narrow; each ends with tests, a DB-copy rehearsal, commit and push)

### Sprint 0: Decisions record (docs only)
- Write short ADRs from the owner's answers to Q1, Q5, Q6 and Q8.
- Classify every table as shared / personal / derived / config. That output is the input to Sprint 4.
- **Exit:** ADRs committed; table classification approved by the owner.

### Sprint 1: Hardening (small, independent fixes)
- Add connect and request timeouts to the reqwest clients (`graph.rs`, `auth.rs`, `intel.rs`).
- Keychain write without the token on argv (stdin or the Security API), keeping cross-rebuild sign-in working.
- Restrict `set_app_meta` to an allow-list of UI-state keys; config keys only via validated commands.
- Calendar sync: remove or mark meetings whose Outlook events disappeared inside the synced window; page `calendarView`.
- Escape the sign-in error page.
- **Exit:** tests for each fix; no behaviour change visible to the user except fixed hangs and stale calendar items.

### Sprint 2: User identity (local)
- Request `openid`; persist `tid` + `oid` from the ID token.
- A `users` row (or extend `team_members`) mapping `oid` to the directory entry.
- Key `microsoft_account` by user instead of `id = 1`.
- Actor on activity (`activity.actor` = user id).
- Owner fields become user or team-member IDs (keep text as display); map the 14 text-only proposal owners.
- **Exit:** every new activity row has an actor; every owner resolves to an id; real-DB-copy rehearsal passes.

### Sprint 3: Global record identity
- Backend-assigned IDs for the seven entities still using frontend max+1.
- Make `uuid` present on every shared table (including aliases, company notes, list members).
- Relationships (FKs, `entity_links` endpoints) carry or resolve uuids in the write path, and the integrity report checks both.
- `next_agreement_ref` and agreement auto-creation moved off app startup into an explicit, idempotent action.
- **Exit:** no id is allocated in the frontend; the integrity report covers uuid consistency; agreement creation happens once, at the moment a proposal is won.

### Sprint 4: Data ownership partition
- Apply the Sprint 0 classification: personal Microsoft caches (emails, synced calendar events) and personal preferences (`myday_snoozed`, `pinned_records`, `reminders_sent`, `msfiles_*`) separated from shared company data. Separate tables or an explicit owner-user column; no data loss.
- Org configuration isolated from personal settings in `app_meta`.
- **Exit:** every table and `app_meta` key is labelled and enforced; rehearsal on a copy.

### Sprint 5: Safe writes
- Optimistic concurrency on record saves: send the base `row_version`, refuse on mismatch, with a clear message.
- Child collections (lines, documents, links) saved as add/update/remove instead of replace-all.
- `row_version` bumped only by user writes (derived updates don't count).
- **Exit:** tests simulate two writers against one DB, and neither loses data silently.

### Sprint 6: Portability
- File references stored relative to a named root (OneDrive or library root + relative path), resolved per machine, with absolute paths migrated.
- `templates.ts` path splitting made platform-neutral.
- Windows labels ("Show in Explorer"), `metaKey`/`ctrlKey` parity.
- CI running on each push to `main` (tests only) for macOS and Windows.
- **Exit:** Windows CI green; a DB copy opened with a different OneDrive root resolves its links.

**Only after these:** a time-boxed architecture spike on the cloud API and on the online vs offline decision (Q2, Q4, Q7, Q13), using the answers and the now-clean data model.
