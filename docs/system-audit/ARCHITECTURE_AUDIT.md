# Architecture audit: frontend, backend, Work Graph

Audited commit `4975b1c`. Backend classes: **KEEP** / **IMPROVE** / **REFACTOR** / **REPLACE**.

## 1. Shape of the system today

```
┌──────────────── Tauri 2 app (one process, one window + capture window) ────────────────┐
│ WebView: vanilla TypeScript (Vite 8)                                                    │
│   main.ts → get_all_data → global state S (proposals, contacts, agreements, todos,      │
│   notes, lists, company notes, services, entities, team)                                │
│   core/router.ts (openRecord / PAGES / NavHistory) · core/nav.ts · lib/registry.ts           │
│   lib/changes.ts (emitChange/onChange) · persist.ts (per-record diff → upsert_* batches) │
│   tabs/*.ts (49 renderers)  · core/contextActions.ts · lib/workGraph.ts                 │
│   572 expose()d window functions · 814 inline on*= handlers                             │
│                                   │ invoke (124 #[tauri::command])                        │
│ Rust: commands.rs, v2_commands.rs, opportunities/projects/meetings.rs, commercial.rs,   │
│   company_identity / company_migration, work graph links, activity.rs, backups.rs,      │
│   generator.rs + pptx/smartfill/feefill/master, localfiles.rs, intel.rs, ms365/*        │
│                                   │ Mutex<rusqlite::Connection>                         │
│ SQLite (bundled) — ~/Library/Application Support/com.menabig.tracker/menabig.sqlite3    │
│   schema 31 · FK on · sync triggers (uuid/row_version/tombstones) · activity triggers   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
   Filesystem: OneDrive (local sync folder) · attachments/ · backups/
   Network: Microsoft identity + Graph v1.0 (reqwest) · RSS feeds
```

It's a local-first, single-process, single-connection desktop app. There is no server.

## 2. Frontend

**Verdict: Adequate, improving.** It works, and the Phase 1–3 refactors introduced real seams: a router, a change bus, per-record persistence, a shared Work Graph helper and shared context actions. The underlying style is still a global-state, string-HTML application.

| Question | Finding |
|---|---|
| Is the architecture coherent? | **Mostly.** Newer modules (opportunities, projects, meetings, proposal page) follow router + change bus + `loadInto`. Older modules (Companies 1,465 lines, Tasks 1,414, Notes 1,162) mix rendering, state and IPC in one file. |
| State management | One mutable global `S` loaded at startup, plus per-module caches (`cache` in opportunities/projects/meetings) refreshed via `onChange`. Simple and fast at today's volume (under 1,500 records). **It can't hold a multi-user dataset**, has no notion of stale data from elsewhere, and invalidation is manual per module. |
| Persistence model | `persist.ts` diffs every tracked record against its last saved JSON and sends `upsert_*` batches, with no version/ETag. Newer entities (opportunity, project, meeting, company) use single-record save commands. **Two persistence styles coexist.** |
| Duplicated logic | Company matching exists in `clientMatch.ts`, `companyFromForm`, `meetingClient.ts`, and in Rust `company_identity`. They agree today (tests cover `clientMatch` 6 and foundation 22), but there are four places to keep aligned. ID generation (`nextId`, `nextCtId`, `nextAgrId`, `nextTodoId`, `nextNoteId`, `nextLineId`, `nextDocumentId`) is duplicated per entity in the frontend. |
| Separation of concerns | `src/lib/` holds pure, tested logic (workGraph, myday, commercial, statusTone, proposalDocuments, persist). `src/tabs/` mixes view and controller. `src/lib/db.ts` is the single IPC seam, which is good. |
| Frontend business rules | Status transitions, won/lost rules, agreement auto-creation trigger (`syncAgreementsFromProposals` called from `main.ts:213`), next reference numbers and version suggestions (`nextDeckFileName`) run client-side. **Those would have to move server-side for multiple users.** |
| Global `window` usage | 572 `expose()`, 107 `window as any`, 814 inline handlers. This is the largest structural debt. It is **not a blocker** for the next stage and should **not** be rewritten wholesale. |
| HTML injection | 312 `innerHTML` assignments; interpolations reviewed use `escHtml` consistently. The risk is carried by convention, not the type system. |
| Can it evolve? | Yes, for a single user, and for a thin multi-user client if the data layer behind `db.ts` changes. A real-time multi-user UI would need S replaced by a query/cache layer, which is a large refactor. |

**Can the frontend support the next stage without a rewrite?** It can support *identity, ownership and a remote API behind `db.ts`* without a rewrite. It can't support live collaborative editing without major rework. That isn't required.

## 3. Backend (Rust)

| Area | Class | Reason |
|---|---|---|
| Tauri shell, plugins, menu, capture window (`lib.rs`) | KEEP | Stable, minimal capabilities. |
| DB init and migrations (`db.rs`, SQL + code migrations, pre-migration backups) | KEEP | 31 migrations, rehearsal tests on copies, snapshot before migrate. |
| Company identity, aliases, review queue, integrity report | KEEP | Foundation Lock: 22 tests, and the live copy reports zero issues. |
| Work Graph (entity_links, `set_links_from`, record links) | KEEP | Correct and tested (`work_graph.rs`). See §4. |
| Opportunities / projects / meetings commands | KEEP | Single-record saves, activity via triggers. |
| Proposal generator (`generator.rs`, `pptx.rs`, `smartfill.rs`, `feefill.rs`, `master.rs`) | KEEP | Phase 4, validated against real templates on a DB copy. |
| Legacy batch commands (`upsert_proposals`, `upsert_contacts`, `upsert_agreements`, `upsert_todos`, `upsert_notes`) | IMPROVE | Whole-record last-write-wins with no version check; child lists replaced (`save_lines`, `save_documents`). Fine single-user. They must gain version checks before any second writer exists. |
| `write_*` replace-all functions (restore/import/wipe) | KEEP (restricted) | Only used through `restore_records_in` with a snapshot first. Keep them away from normal saves. |
| ID assignment (frontend max+1 for 7 entities) | REFACTOR | Must be backend-assigned before multiple writers or devices. |
| Startup side effects (`sync_agreements_from_proposals`, `rebuild_all`, `rebuild_note_links`) | IMPROVE | Idempotent locally. Agreement creation and `next_agreement_ref` (MAX-based sequence) must become a single-authority operation later. The full search rebuild is cheap at today's size. |
| `activity.rs` triggers | IMPROVE | Good capture mechanism. It needs an actor and stable (uuid) references to be meaningful beyond one user. |
| Sync scaffolding (migration 17 triggers: uuid, row_version, row_updated_at, tombstones) | IMPROVE | Useful groundwork but not a sync protocol. See SYNC_READINESS. |
| `ms365/auth.rs` | IMPROVE | PKCE and state are correct. Token-to-Keychain via CLI argv, loopback on a fixed port, no HTTP timeouts. See MICROSOFT_AUDIT. |
| `ms365/graph.rs`, `ms365/commands.rs` | IMPROVE | No timeout, no 429 handling, calendar deletions not reconciled. |
| `localfiles.rs` OneDrive via filesystem | KEEP now / REPLACE later | Right for a single Mac. The wrong primitive for shared, cross-device files. That decision is open (ARCHITECTURE_DECISIONS_REQUIRED Q6). |
| `intel.rs` | KEEP | Add a timeout. |
| `set_app_meta` generic key/value command | IMPROVE | Unrestricted keys bypass path validation. See SECURITY_AUDIT. |
| `documents` table and IPC (`get_documents`, `save_document`, `delete_document`), `save_area` | NOT NEEDED | No frontend callers. Removing them is optional cleanup, not urgent. |
| Single `Mutex<Connection>` | KEEP | Correct for one desktop process. It serialises Graph-triggered writes with UI writes, which is acceptable at this scale. |

**Nothing warrants REPLACE today.**

## 4. Work Graph

**Verdict: Good, and correctly shaped for its current purpose.**

| Criterion | Finding |
|---|---|
| Entities linked by stable IDs | Yes within the device: typed FKs (`company_id`, `opportunity_id`, `project_id`, `proposal_id`, `meeting_id`) plus `entity_links(from_type, from_id, to_type, to_id)` for many-to-many links. **They are local integers.** Rows have uuids, but links don't reference them. |
| Name-based relationships remaining | Company identity is ID-based (0 name-only rows). Remaining name keys: `company_notes` (PK `company_name`, company_id added in migration 30), `note_folders` (PK name), `contact_list_*` (name-keyed), `company_list_members`. **Stored `client`/`company` text columns remain as display copies.** |
| Context inheritance | Centralised: `workGraph.ts` (`contextFrom*`, `inheritCompany`, `taskFields`) and `core/contextActions.ts`. 19 Vitest cases plus Rust `work_graph.rs`. |
| Parent/child | Opportunity → proposal (`proposals.opportunity_id`), opportunity → project, project → meeting, meeting → note → task. Proposal → agreement uses `agreements.proposal_id` (**no FK constraint**). |
| Activity | One table, trigger-written, with typed context columns (`contact_id`, `opportunity_id`, `project_id`) that have **no FK**, plus `entity_type` / `entity_id` local integer. |
| Orphans | The integrity report on the live copy has none. Deleting an opportunity nulls children (FK `ON DELETE SET NULL` where declared); `entity_links` endpoints aren't FKs and rely on application cleanup. |
| Circular / polymorphic risk | Polymorphic `entity_links` can't be FK-enforced. That is an accepted trade-off, backed by the integrity report. There's no circular ownership. |
| Overbuilt? | No. Generic graph machinery is limited to `entity_links`. Everything else is typed columns. |

**What would break across users or devices?** Every relationship is a local integer. Two devices creating records independently will produce colliding IDs (max+1 in the frontend, AUTOINCREMENT in the backend), and any link sent to another device would point at a different record. This is the single largest structural gap between "Work Graph works" and "Work Graph can be shared". See DATABASE_AUDIT §4 and SYNC_READINESS.

## 5. Architectural verdict

**Good** for its current single-user, single-Mac scope. **Adequate** as a foundation for multi-user, cloud and Windows. **Keep and evolve; do not replace.** The weaknesses sit in the data-ownership layer (IDs, identity, concurrency, file references), not in the product or UI structure. They can be fixed incrementally behind existing seams (`db.ts`, the command layer, migrations).
