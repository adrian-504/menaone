# MENA One: full system audit (architectural baseline)

**Audit only. No code, schema, configuration or dependency was changed.** The detail lives in the sibling documents; this file holds the cross-cutting sections, the verdict and the scores.

| Document | Sections |
|---|---|
| [PRODUCT_AUDIT.md](PRODUCT_AUDIT.md) | 2 product features, 3 workflow completeness |
| [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) | 4 frontend, 5 backend, 7 Work Graph |
| [DATABASE_AUDIT.md](DATABASE_AUDIT.md) | 6 database |
| [MICROSOFT_AUDIT.md](MICROSOFT_AUDIT.md) | 8 Microsoft Graph, 9 identity |
| [CLOUD_READINESS.md](CLOUD_READINESS.md) | 11 cloud |
| [SYNC_READINESS.md](SYNC_READINESS.md) | 12 sync |
| [WINDOWS_READINESS.md](WINDOWS_READINESS.md) | 14 Windows |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | 15 security |
| [TESTING_AUDIT.md](TESTING_AUDIT.md) | 16 testing / CI |
| [ARCHITECTURE_DECISIONS_REQUIRED.md](ARCHITECTURE_DECISIONS_REQUIRED.md) | 21 |
| [RECOMMENDED_NEXT_WORKSTREAM.md](RECOMMENDED_NEXT_WORKSTREAM.md) | 22 |

## 1. Repository state

| Item | Value |
|---|---|
| Repository | `github.com/adrian-504/menaone` (public), local `/Volumes/DevSSD/Developer/menabig-tracker` |
| Branch | `main`, in sync with `origin/main` |
| Commit audited | `4975b1c87cb1e204da54be5ab72720bedbb99e8a` (Phase 4, proposal document workflow) |
| Working tree at audit start | Clean (0 changed or untracked files) |
| Tracked files | 259 |
| Recent history | `7f24ab7` → `4fb2245` → `ee5d6dd` → `9531a08` → `1f10056` → `ab8a272` (Phase 2) → `cf2bd72`, `1863d51` (Phase 3) → `4975b1c` (Phase 4) |
| Stack | Tauri 2 · Rust (rusqlite 0.32 bundled, reqwest 0.12 rustls, zip, feed-rs, keyring on Windows) · vanilla TypeScript · Vite 8 · Vitest · CodeMirror 6 · chart.js |
| Size | Rust: largest files `commercial.rs` 1,335 lines, `commands.rs` 1,266, `generator.rs` 1,043, `db.rs` 1,031. TypeScript: `companies.ts` 1,465, `todo.ts` 1,414, `notes.ts` 1,162, `proposalPage.ts` 981 |
| Surface | 124 Tauri commands; 49 tab renderers; 572 `expose()` window functions |
| Schema | SQLite v31: 49 tables, 103 indexes, 108 triggers |
| Live DB | `~/Library/Application Support/com.menabig.tracker/menabig.sqlite3` (2.4 MB; not on OneDrive or the SSD) |
| CI | `.github/workflows/ci.yml` exists (macOS and Windows test jobs, Windows installer), manual trigger only; **0 runs ever** |

## 10. Local data ownership

Where each kind of data lives today and who it belongs to. Everything is on one Mac.

| Data | Location | Belongs to (today → should) |
|---|---|---|
| Companies, contacts, opportunities, proposals, lines, agreements, projects, services, rate cards, business entities, templates | SQLite | implicitly the single user → **company** |
| Meetings created in-app | SQLite `meetings` | user → **company** (project context) |
| Outlook calendar events | SQLite `meetings` (same table, `source`) | user → **personal** |
| Flagged emails, completed log | SQLite `emails`, `email_completed_log` | user → **personal** |
| Notes, tasks, inbox items, note folders | SQLite | user → **undecided** (Q5) |
| Activity | SQLite `activity` (+ 3 older activity tables) | nobody (no actor) → **company**, with actor |
| Organisation config (client/tenant id, proposals root, master template path, company domains) | SQLite `app_meta` | mixed → **organisation** |
| Personal state (snoozes, pins, reminders sent, dismissed people, file pins/recents) | SQLite `app_meta` | mixed → **personal** |
| UI preferences (theme, sidebar, rail, recents, filters, columns, active list) | WebView `localStorage` | device → **personal/device** (correct today) |
| Microsoft refresh token | macOS Keychain (`com.menabig.tracker.ms365`) | user (correct) |
| Microsoft access token | process memory | user (correct) |
| Window state | `.window-state.json` in app data | device (correct) |
| Note attachments | `app_data_dir/attachments/` | user → **undecided** |
| Backups | `app_data_dir/backups/` + `pre-*` copies beside the DB (plaintext) | user → **organisation policy** |
| Client folders, proposal decks, templates | Local OneDrive sync folder (absolute paths in DB) | the user's OneDrive → **company library** (Q6) |
| Intelligence items | SQLite | company |

## 13. Multi-user readiness

**2 / 10.** Nothing in the app assumes a second person exists:

- no users, sign-in-as-identity, roles or actor;
- owners are text;
- one Microsoft account per install;
- whole-record last-write-wins saves;
- personal and company data mixed.

Two people sharing one database file (for example on a network drive or OneDrive) **would corrupt data** and must not be attempted. Two people each running their own copy works, but they share nothing.

What helps: `team_members` already lists the team with emails; company identity is robust; activity capture exists and only lacks an actor.

## 17. Performance

Measured facts are few; nothing was profiled for this audit.

| Area | Finding | Class |
|---|---|---|
| Startup | `get_all_data` loads all business data into `S`. `rebuild_all` re-indexes every proposal, contact, agreement, todo and note row by row, **outside an explicit transaction**, every launch (`lib.rs:217`, `v2_search.rs:246`). `rebuild_note_links` likewise. `syncAgreementsFromProposals` runs after load. | Fine at today's ~1,500 records; unmeasured. Wrapping the rebuild in one transaction is a cheap win if startup is ever slow. |
| Frontend bundle | `main.js` ≈ 1.3 MB unminified-size on disk (CodeMirror, chart.js, all tabs in one chunk); CSS 177 KB. | Irrelevant for a local desktop app. |
| Rendering | String-template `innerHTML` re-renders of whole tabs; `refreshAll` has 67 call sites; My Day re-renders every 60 s while visible; reminders poll every 30 s. | No reported slowness; would degrade with 10–50× data. |
| DB | One mutex-guarded connection; Graph sync and generation hold it only for their DB writes (network calls happen outside the lock). 103 indexes. | Fine. |
| Graph | No timeouts (a hang, not slowness); calendar single page of 250. | See MICROSOFT_AUDIT. |
| PPTX generation | Zip rewrite of the master deck in memory; completes in seconds on real templates. | Fine. |
| Premature optimisation to avoid | Virtualised lists, query caching layers, background indexers, a web worker. | Don't do these. |

## 18. Architectural verdict

**Good** for what MENA One is today: a single-user, single-Mac business workspace with a complete Company → Proposal → Agreement → Project workflow, solid company identity, and real-data rehearsed migrations.

**Adequate** as the foundation for multi-user, cloud and Windows: the gaps are concentrated in identity, IDs, write semantics, data ownership and file references. They are fixable incrementally without replacing the stack.

**Recommendation: keep and evolve. Do not replace. Do not add product scope before the foundation work.**

### Scores (out of 10)

| Area | Score | One-line reason |
|---|---:|---|
| Product architecture | 8 | Complete connected workflow; a few intentionally weak areas (reports) and some unused tables |
| Frontend | 6.5 | Real seams now (router, change bus, db.ts, workGraph) over a global-state, inline-handler base |
| Backend | 7 | Clean command layer, strong migrations and integrity; legacy batch upserts |
| Database | 7 | Consistent, FK-enforced, id-based company identity; local-only identity and paths |
| Work Graph | 8 | Typed context FKs + one link table, tested, no orphans; integer-bound |
| Microsoft integration | 5 | Centralised and correct OAuth; no timeouts, weak token storage, calendar deletions, single account |
| Authentication readiness | 4 | Entra sign-in exists but isn't used as app identity (no `openid`, no `oid`) |
| Cloud readiness | 3 | Five technical blockers + residency decision |
| Sync readiness | 2.5 | Scaffolding only; write, identity and relationship model all local |
| Multi-user readiness | 2 | No users, actor or concurrency control |
| Windows readiness | 4 | Portable core, macOS paths in data, never built |
| Security | 6.5 | Narrow capabilities, correct OAuth, path guards; token ACL, CSP inline, unrestricted meta writes |
| Testing | 6.5 | Serious data and rehearsal tests; no CI runs, no UI or IPC contract tests |
| Production readiness (current single-user use) | 7 | In daily use with backups and snapshots |
| Production readiness (team deployment) | 3 | Unsigned, no updates, no identity, no shared data |

## 19. Done: should not be reopened without new evidence

- **Company identity (Foundation Lock):** `company_id` everywhere, aliases, review queue, integrity report (0 issues on the live copy).
- **Work Graph (Phase 2):** context inheritance, `entity_links`, `contextActions`, opportunity → proposal → project chain.
- **UX coherence (Phase 3):**
  - router and history, change bus, `loadInto` states, dialog focus restore;
  - status tones, contrast tokens, day-count fix;
  - company picker scroll fix.
  - Traffic-light repositioning was abandoned by owner decision; don't revisit.
- **Proposal document workflow (Phase 4):** transactional version recording, OneDrive-only output, validation errors vs warnings, version history UI. The open condition is one owner generation in the live app.
- **Proposal generator and templates:** smart fill, fee fill, master deck composition.
- **Migrations runner** with pre-migration snapshots and rehearsal tests.
- **Backups:** daily, retention, pre-change snapshots, restore.
- **Owner decisions:** keep Pending, Follow-Up, Dashboard, Reports and Analytics as they are; keep all three Insights views.
- **The SSD move** (repo on DevSSD, DB in Application Support).

## 20. Action classification (conservative)

### MUST FIX (small, independent, low risk)

1. HTTP connect and request timeouts on all reqwest clients (`graph.rs`, `auth.rs`, `intel.rs`). An indefinite hang is possible today.
2. Refresh-token storage: stop passing the token as a command-line argument to `security` (SECURITY_AUDIT S1).
3. Restrict `set_app_meta` to allowed keys (S3).
4. Run the existing CI workflow once, on macOS and Windows, to establish a baseline.

### SHOULD FIX (next workstream)

- Calendar sync deletion reconciliation and paging (M3, M4).
- User identity (`oid`/`tid`), actor, owner IDs.
- Backend-assigned IDs; uuid-based relationships; single-authority agreement creation and reference numbers.
- Personal vs company data partition (emails, synced calendar, `app_meta`).
- Optimistic concurrency and child-collection operations.
- Relative or drive-item file references; Windows path and label fixes.
- Escape the sign-in error page (S6).
- A PII guard for the public repo (pre-commit or CI name/email scan against fixture allow-lists).

### OPTIONAL

- Remove the unused `documents` table and IPC and `save_area`.
- Retire `project_activity` into `activity`.
- Add the `agreements.proposal_id` FK; key `company_notes` by id.
- Wrap the startup search rebuild in a transaction.
- Graph 429 / Retry-After handling (becomes SHOULD with several users).
- IPC contract tests between `types.ts`, Rust structs and `devMock.ts`.

### DO NOT TOUCH

- Company identity model and Foundation Lock tests.
- The `entity_links` design and typed context FKs.
- The migration runner and backup/snapshot system.
- The proposal generator pipeline and OneDrive output policy.
- Router, change bus and `contextActions`.
- Tauri as the desktop shell; SQLite as the local store.
- The frontend `expose()` / inline-handler style (large debt, but no rewrite without a concrete need).
- Dashboard, Reports, Analytics, Pending, Follow-Up and Insights (owner decision).
