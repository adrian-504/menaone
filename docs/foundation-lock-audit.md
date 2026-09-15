# Foundation Lock audit

Audit of MENA One's data foundation at schema 28 → 29, 14 September 2026. Records what was found, what changed, and what remains. Real data was only ever read from copies.

## 1. Tables

Legend — **UUID/ver**: `uuid`, `row_version`, `row_updated_at` with triggers and tombstones on delete. **Writes**: R = record-level, W = whole set (named cases only).

| Table | Rows (live) | UUID/ver | Company | Writes | Role |
|---|---|---|---|---|---|
| companies | 167 | yes | — (is the identity) | R (`save_company`, rename, merge) | Source of truth |
| company_aliases (new) | 0 | no | `company_id` FK cascade | R (rename, merge, review queue) | Former names → company |
| company_industries | 149 | no | `company_id` FK cascade | R per company | Source of truth |
| company_notes | 107 | no | keyed by **name** | R per company (was W) | Legacy-shaped, active |
| contacts | 100 | yes | `company_id` + `client_name` text | R | Source of truth |
| contact_list_defs / _members | 0 | no | — | W (list names, queued) / R | Active |
| saved_lists / company_list_members | 0 | yes / no | FK cascade | R | Active |
| opportunities | 11 | yes | `company_id` only | R | Source of truth |
| opportunity_activity | 24 | yes | via opportunity | R (append) | Specialised history (stage durations) |
| projects | 9 | yes | `company_id` + `company_name` | R | Source of truth |
| project_activity / project_milestones | 1 / 0 | yes | via project | R | Active |
| proposals | 252 | yes | `company_id` + `client` | R | Source of truth |
| proposal_lines / proposal_documents / proposal_activity_notes | 249 / 3 / 24 | yes | via proposal (cascade) | R (diffed per proposal) | Active |
| agreements / agreement_lines | 106 / 103 | yes | `company_id` + `client` | R | Source of truth |
| meetings | 14 | yes | `company_id` + `company_name` | R; Outlook upsert by `outlook_event_id` | Source of truth |
| todos | 10 | yes | `company_id` + `client` | R | Source of truth |
| notes / note_attachments / note_links | 4 / 0 / 0 | yes / yes / no | `company_id` + `client_name` | R; `note_links` derived | Source of truth |
| documents | 0 | yes | `company_id` + `company_name` | R | Active (little used) |
| emails / email_completed_log | 225 / 1 | no | `company_id` + `company_name` | Outlook upsert by `message_id` | Cache of Outlook |
| microsoft_files | 163 | no | via links | R (find-or-create by absolute path) | Local OneDrive path registry |
| intelligence_items | 64 | yes | `company_id` + `company_name` | R; feed dedup index | Active |
| activity | 96 | no | `company_id` | Triggers (append) | Canonical cross-entity history |
| entity_links | 165 → 164 | yes | polymorphic | R (`set_links_from`) | Relationships with no direct column |
| entity_tags | 0 | no | polymorphic | R per record | Active |
| services / rate_cards / business_entities / team_members / proposal_templates | 22 / 14 / 2 / 7 / 0 | yes | — | R | Configuration |
| sync_tombstones | 29 | — | — | Triggers | Deletion record for future sync |
| search_index* | — | — | — | Rebuilt at start | Derived |
| app_meta, note_folders | — | no | — | R / W (queued) | Settings |

Every business table has `INTEGER PRIMARY KEY` local ids plus a unique `uuid`. Foreign keys are enforced (`PRAGMA foreign_keys = ON`). `deleted_at` columns do not exist by design (tombstone table instead, decided in Sprint 0).

## 2. Company identity

> Superseded by section 12 (second pass): an unchanged company text now keeps the record's `company_id`; only edited text is resolved.

`company_id` is authoritative. Records keep the company name as text for forms, lists, exports and generated documents. Every save resolves that text with one function, `opportunities::resolve_company_ref`:

1. the company the record is already linked to, if the text is its name or a former name;
2. exact name, then the same name ignoring capitals;
3. a former name (`company_aliases`);
4. otherwise a new company.

Rename and merge write former names. An explicit "New company" (`create_company_named`) ignores former names. Similar names ("Acme" / "Acme LLC") are never joined; the Companies list's duplicate chip is the confirmation step, and merge is explicit.

Name-string uses, classified:

| Where | Class |
|---|---|
| `proposals.client`, `contacts.client_name`, `agreements.client`, `todos.client`, `notes.client_name`, `projects/meetings/documents/intelligence_items/emails.company_name` | B display + C compatibility (resolved to `company_id` on save) |
| `Opportunity.company_name` | B display (joined from `companies`) |
| `resolve_company` (find-or-create by exact name) | **D — fixed**: stale names re-created renamed/merged companies |
| Frontend `inCompany` / `sameCompany` | A by id, name only for a record not yet saved |
| `company_notes` keyed by name | C, follows renames in the backend now |
| Rename flow not updating `S.opportunities` | **D — fixed** |
| Review queue "select/confirm" | A, now also records the name as a former name |
| Folder-linking wizard (`files_resolve_company_id`) | A, explicit user choice |
| Company migration engine | C, one-time, uses the review queue |

## 3. Persistence

| Path | Class | Outcome |
|---|---|---|
| Proposals, contacts, agreements, tasks, notes (`persist.ts` change trackers → `upsert_*`/`delete_*`) | SAFE | Only changed records, queued in order, unchanged upserts skip the write |
| Opportunities, projects, meetings, milestones, companies, lists | SAFE | One record per call |
| `save_company_notes` (whole map; `UPDATE company_notes SET note_text = NULL` then re-insert) | RISKY | **Fixed**: `save_company_note` per company, diffed |
| `save_company_industries` (whole legacy map) | RISKY, unused data | **Removed** with the legacy frontend dictionary |
| `save_note_folders`, `save_contact_lists` (whole small lists) | RISKY-low (concurrent saves could land out of order) | **Queued**; justified: short name lists |
| `write_proposals/contacts/agreements/todos/notes` (DELETE all + INSERT) | IMPORT only → **no app path uses them now** | Restore, legacy import and wipe use `restore_records_in` (one transaction, by id) |
| Restore / legacy import | MUST FIX (not atomic; every record re-created with new uuids and tombstoned) | **Fixed** |
| `wipe_all_data` | IMPORT/RESET (not atomic) | **Fixed**: one transaction, snapshot first |
| Outlook meetings / emails re-sync | RISKY (every sync rewrote every row: version churn) | **Fixed**: unchanged rows untouched |
| `localStorage` | SAFE | Filters, columns, open list only |

Last-save-wins between records cannot happen: each save writes only the rows it names, and the upsert only updates columns of that row. Covered by `tests/foundation.rs` and `persist.test.ts`.

## 4. Deletion

| Entity | Behaviour | Tombstone |
|---|---|---|
| Companies | Archive; merge deletes the merged-away row | yes |
| Contacts | Delete with undo (undo re-inserts → new uuid) | yes |
| Opportunities, projects | Archive or delete; delete clears their links/tags | yes |
| Proposals | Archive or delete | yes |
| Agreements, tasks, notes, documents | Delete (links now cleaned) | yes |
| Meetings | Delete (Outlook meetings refused: cancel instead) | yes |
| Emails | Removed from cache when unflagged and unlinked | no (Outlook is the source) |

## 5. Activity

`activity` is the canonical cross-entity history, written by triggers (so no write path can forget it), muted during restores and migrations. `opportunity_activity` and `project_activity` stay as specialised histories (stage durations) and are mirrored into `activity` by trigger; `proposal_activity_notes` are proposal notes, also mirrored. Duplicate prevention: status triggers fire only on real changes; upserts skip unchanged rows; note edits at most every 30 minutes. `actor` is always empty (no users yet). `updated_at` is record freshness, not business activity. Live data: 0 duplicates.

## 6. Work graph

Direct columns are canonical where the relationship is one-to-one: record → company (`company_id`), opportunity → proposal/project, meeting → project/opportunity/note, task → project/meeting/parent, agreement → proposal, lines/documents/notes → proposal. `entity_links` holds only relationships with no column: file → company/project, note → project/file, contact → opportunity. Live data: no link contradicts a column. Deleting a record now removes its links (1 orphan found and removed by migration 29). Meeting → contact is by attendee email at read time (no stored link).

## 7. Migrations and backups

Before: a migration and its version bump were not atomic; a failure part-way left the schema half-changed and the app unable to start silently. Now each step runs in a savepoint (`db::atomic`), nested steps included. Before migrating, the database is snapshotted and startup stops with a visible error if that fails. Restores, imports and wipes snapshot first (`before-restore-*`, `before-import-*`, `before-wipe-*`) and refuse to go ahead without one. Tested: clean database, v1 database, fake legacy dataset, a copy of the live database (schema 28 → 29, counts unchanged except the orphan link), failed-step rollback, snapshot integrity and reopen.

## 8. External identifiers

Meetings: `outlook_event_id` (unique partial index), local `id` separate. Emails: `message_id` unique. Files: `microsoft_files.path` (absolute local path) — not a Graph id yet. Teams meetings are Outlook events with an online URL. Attendee and recipient addresses are stored as JSON. Re-sync is idempotent (test).

## 9. Security

| Finding | Severity | Outcome |
|---|---|---|
| Chart.js loaded from a CDN inside a window with full app access | High | Bundled |
| `write_text_file(path)` / `read_text_file(path)` callable with any path | High | Replaced by `save_text_file_dialog` (Rust shows the dialog); read command removed |
| Attachment file names could leave the attachments folder (`../`) | High | Only the name part is kept |
| No Content Security Policy; `withGlobalTauri` on | Medium | CSP set (no remote scripts, no remote connections); global off |
| Restore/wipe without a backup | Medium | Snapshot first, refuse on failure |
| Refresh token passed to `/usr/bin/security` on the command line; Keychain item readable by any app of this user (`-A`) | Medium | Unchanged — tied to code signing (D7) |
| `unsafe-inline` scripts still needed (inline handlers) | Low | Documented; removed only by moving handlers into modules |
| `template_inspect` reads any .pptx path given | Low | Unchanged (read-only, returns slide info) |
| Remote images allowed in notes (`img-src https:`) | Low | Needed for image links in notes |

## 10. Portability

| Item | Class |
|---|---|
| Keychain via `/usr/bin/security` | A (Windows uses Credential Manager via `keyring`, cfg-gated) |
| OneDrive folder detection | A (Windows branch exists) |
| `microsoft_files.path`, `proposals.folder_path`, settings paths stored as absolute `/Users/...` paths | **B — Windows/second-user blocker** (store OneDrive-relative paths or Graph ids; tied to D3 SharePoint) |
| "Finder" wording, ⌘ labels | C |
| Menu accelerators `CmdOrCtrl`, frontend `metaKey || ctrlKey` | C |
| Global shortcut | A (per-OS modifiers) |
| `scripts/build-and-sign.sh`, Swift/AppleScript verification tools | A (developer tools) |
| Windows build | Not tested in this sprint |

## 11. Legacy code

| Item | Class |
|---|---|
| Text company-name columns | COMPATIBILITY (display, exports, documents) |
| `company_notes` keyed by name; its `industries` column | ACTIVE / COMPATIBILITY (read by the company migration only) |
| `write_*` whole-table functions | COMPATIBILITY (tests of the original format) |
| One-time frontend migrations (Notes → Markdown, leads → opportunities) | COMPATIBILITY (flag-gated; matter when an old backup is restored) |
| Current-design proposal generator (`smartfill`, `feefill`, `proposal_library`, `pptx_import`) | ACTIVE (retire after the 2026 master is approved) |
| `normalize_commercial_data` legacy statuses | COMPATIBILITY |
| V1/V2 file split | ACTIVE (organisational only) |
| Frontend `nextId()` (max + 1 ids) | ACTIVE, **DANGEROUS for multi-device** (uuid is the future identity) |
| `get/save_company_industries`, `S.companyIndustries`, `read_text_file`, `pickAndReadJsonFile` | DEAD → removed |
| `write_text_file` | DANGEROUS → replaced |
| Pending/Follow-Up card styles (`wq-*`, `fu-*`) and other unused CSS | DEAD → removed (116 rules, 4 duplicates) |

---

# Second pass (15 September 2026)

## 12. Company identity map

Rule now: **IDs identify records, names are attributes.** `opportunities::company_for_save` decides a record's company on every save:

1. existing record, company text unchanged → keeps `company_id` (the id wins, even if the text alone would point elsewhere);
2. new record arriving with a `company_id` → that id;
3. company text edited, or no usable link → text resolved: current company if it is its name/legal name/former name → exact name → same name ignoring capitals → unique legal name → former name → new company.

A record whose text names a different company than its link is **kept as it is and reported** (`integrity_report`: "company text doesn't match its linked company") — never re-pointed silently.

| Entity | Relationship | Authoritative | Legacy/display field | Write path | Read path |
|---|---|---|---|---|---|
| Contact | belongs to company | `contacts.company_id` | `client_name` | `upsert_contact_rows_in` → `company_for_save` | `inCompany(companyId, name)`, `companyLink` |
| Proposal | client | `proposals.company_id` | `client` (also file/folder names, documents) | `upsert_proposal_rows_in` | same; router `placeCompany` |
| Agreement | client | `agreements.company_id` | `client` (`agr_ref` prefix) | `upsert_agreement_rows_in`; `create_agreements_core` (proposal's id) | same |
| Opportunity | company | `opportunities.company_id` | none stored (name joined from `companies`) | `save_opportunity_row` | join |
| Project | client | `projects.company_id` | `company_name` | `save_project_row` | same |
| Meeting | client | `meetings.company_id` | `company_name` | `save_meeting_row`; Outlook sync never sets a company | same |
| Task | client | `todos.company_id` | `client` | `upsert_todo_rows_in` → `link_company` | same |
| Note | client | `notes.company_id` | `client_name` | `upsert_note_rows_in` → `link_company` | same |
| Document | company | `documents.company_id` | `company_name` | `save_document` → `link_company` | same |
| Intelligence item | company | `intelligence_items.company_id` | `company_name` | `save_intelligence_item` → `link_company` | same |
| Email | company | `emails.company_id` | `company_name` | `ms365_set_email_company` → `link_company` | same |
| Activity | company | `activity.company_id` (copied at event time, relinked on merge) | `entity_label` snapshot | triggers | activity feed |
| Company notes | company | **company name** (`company_notes.company_name`) | — | `save_company_note` (per company; rename moves it) | Company page |
| Company lists / industries / aliases | company | `company_id` FKs | — | lists.rs, `save_company`, rename/merge | Companies |
| File (OneDrive) | company/project | `entity_links` msfile → company | absolute path | folder-linking wizard | Files, company page |

Name-based occurrences, classified:

| Where | Class |
|---|---|
| `company_for_save` text resolution when the text was edited | A — safe fallback (the edit is the intent) |
| `resolve_company` for records with no link (imports, legacy import, folder wizard) | D — import/migration |
| `create_company_named` (explicit New company) | A |
| Text columns shown in lists, exports, generated documents | C — display |
| `company_notes` keyed by name | E — future migration to `company_id` |
| Frontend forms passing company text (+New, modals, company pickers) | A now (text edits resolve; unchanged text keeps the id); E — pickers should send ids (Work Graph) |
| Frontend `companyByKey(name)` for companies known only from proposals | C/E |
| Re-resolving unchanged text on every save (review-queue and folder links could be undone) | **B → fixed (F)** |
| Legal names ignored (a record typed with the legal name created a duplicate) | **F → fixed** (unique legal name only) |

## 13. Duplicate companies

- Exact and case-only duplicates: prevented (case-insensitive lookup before creating).
- Legal name: matched only when one company has it; two companies sharing a legal name are ambiguous and not guessed.
- Punctuation/legal-suffix look-alikes ("Acme LLC" / "ACME"): **not merged**. `integrity::possible_duplicate_companies` (same normalisation as the company migration) lists them; the Companies list's duplicate chip and Merge are the human step.
- Former names prevent re-creating renamed/merged companies.
- Live data: 0 look-alike groups, 0 case-only duplicates.

## 14. Persistent writers

| Writer | Class | Notes |
|---|---|---|
| Proposals, contacts, agreements, tasks, notes (`persist.ts` trackers → `upsert_*`/`delete_*`) | 1 record-level | changed records only, queued, unchanged upserts skipped |
| Opportunities, projects, meetings, milestones, companies, saved lists, rate cards, services, entities, team, templates | 1 record-level | one record per call |
| Company notes (`save_company_note`) | 1 | per company, queued |
| Note folders, contact-list names | 2 safe config | small name lists, queued in order |
| `app_meta` settings | 2 | per key |
| Outlook meeting/email sync | 1 | idempotent, unchanged rows untouched |
| Save of an Outlook meeting from a copy loaded before a sync | **3 → fixed**: title, date and attendees of Outlook meetings are owned by Outlook and no longer written by `save_meeting` |
| Record saves write every column of the record from the in-memory copy | 3 (accepted) | only one window edits; backend-side changes to these rows are derived values recomputed on every save; a future sync needs field-level changes (row_version is ready) |
| Restore / legacy import / wipe (`restore_records_in`) | 2 | one transaction, by id, snapshot first |
| `write_*` whole-table functions | 4 legacy | tests only |

## 15. Sync readiness

| Entity | UUID | Version | Updated at | Tombstone | Status |
|---|---|---|---|---|---|
| companies, opportunities, projects, meetings, notes, saved_lists, business_entities, team_members, rate_cards, services, proposal_templates | yes | `row_version` | `row_updated_at` (+ `updated_at`) | trigger | Ready |
| proposals, contacts, agreements, todos, proposal_lines, agreement_lines, proposal_documents, proposal_activity_notes, project_milestones, entity_links, documents, note_templates, note_attachments, inbox_items, intelligence_items, areas, opportunity_activity, project_activity | yes | `row_version` | `row_updated_at` only (no business `updated_at`) | trigger | Ready (identity + change detection) |
| activity | no | no | `created_at` | no | Not ready (append-only log; needs uuid before syncing) |
| company_industries, company_list_members, contact_list_members, entity_tags | no (composite keys) | no | no | no | Not ready (sync with their parent record) |
| company_notes, contact_list_defs, note_folders | no (keyed by name) | no | no | no | Not ready (name-keyed) |
| company_aliases | no | no | `created_at` | no | Not ready |
| emails, microsoft_files, email_completed_log | no | no | `last_synced_at`/`created_at` | no | Device cache (Outlook/OneDrive are the source) |
| app_meta | — | — | — | — | Device settings, never synced |

Verified by test: uuids stable across updates, restores and renames; version increments only on real changes; tombstones only for deleted rows.

## 16. Work graph sources of truth

| Relationship | Source of truth | Status | Risk |
|---|---|---|---|
| Record → Company | `company_id` | Enforced on save; conflicts reported | Text drift reported, not fixed automatically |
| Contact → Opportunity | `entity_links` | Works | No FK; cleaned on delete |
| Opportunity → Proposal / Project | `opportunities.proposal_id` / `project_id` (SET NULL) | Works | Company mismatch reported |
| Proposal → Agreement | `agreements.proposal_id` | Works | Company mismatch reported |
| Project → Meeting / Opportunity → Meeting | `meetings.project_id` / `opportunity_id` (SET NULL) | Works | Company mismatch reported |
| Meeting → Task | `todos.meeting_id` (SET NULL) | Works | — |
| Project → Task | `todos.project_id` (SET NULL) | Works | Company mismatch reported |
| Note → Project / File | `entity_links` | Works | Cleaned on delete |
| Meeting → Note | `meetings.note_id` (SET NULL) | Works | — |
| Meeting → Contact | attendee emails matched when read | Partial | No stored link (Work Graph) |
| File → Company / Project | `entity_links` from `microsoft_files` (absolute path) | Works on this Mac | Paths not portable |
| Proposal → Files | `proposals.folder_path` | Works on this Mac | Absolute path; generator now writes only inside OneDrive |
| Record → Activity | `activity.entity_type/entity_id` + `company_id` | Works | History kept after deletes (intended) |

Contradiction checks in `integrity_report`: company link vs `entity_links` → company; opportunity vs its proposal/project; agreement vs its proposal; meeting vs its project/opportunity; task vs its project. Live data: 0.

## 17. Activity

Canonical: `activity` (triggers on every module; muted during restore/migration). Derived/context: `opportunity_activity` (stage history used for stage durations) and `project_activity` (status history), each mirrored into `activity` by a trigger; `proposal_activity_notes` are proposal notes, mirrored. Duplicates: none possible from unchanged saves (tested; live 0). Stale: `entity_label` is the label at event time (intended history). Deletes: activity stays as history; `company_id` is re-pointed on merge and cleared if a company row is deleted. Not logged: contact/company updates, opportunity/project/agreement deletes (future).

## 18. Portability inventory

| Mac-specific | Abstraction needed | Current risk | Phase |
|---|---|---|---|
| OneDrive under `~/Library/CloudStorage` | Windows branch exists (`OneDriveCommercial` env); later Graph drive/item ids | Low today | Windows / SharePoint (D3) |
| Absolute paths stored in `microsoft_files.path`, `proposals.folder_path`, `proposal_documents`, `app_meta` (templates, master, proposals root) | Store OneDrive-relative paths or Graph ids | **High for Windows / second user** | Before Windows / multi-user |
| Keychain via `/usr/bin/security` (token on command line, `-A`) | Keyring crate everywhere once code-signed | Medium | Code signing (D7) |
| "Finder", ⌘ labels | Platform wording | Cosmetic | Windows |
| `CmdOrCtrl` menus, `metaKey || ctrlKey` handlers | Already portable | None | — |
| Global shortcut (per-OS modifiers) | Done | None | — |
| rfd startup error box | Cross-platform | None | — |
| Swift/AppleScript verification tools, `build-and-sign.sh` | Developer tools only | None for users | Windows build pipeline |
| Frontend max+1 local ids | UUIDs as identity when syncing | High for multi-device | Cloud/sync |

## 19. Security (second pass)

| Finding | Severity | Outcome |
|---|---|---|
| `is_within_onedrive` accepted `OneDrive/../../elsewhere` | High | `..` refused; existing paths resolved before comparing (test) |
| Proposal generator wrote into `proposal.folder_path` without checking it is inside OneDrive | Medium | Now only inside OneDrive |
| Logo path for generated proposals can be any readable PNG/JPEG | Low | Accepted (image only, embedded in a file the user saves) |
| `files_get_or_create_msfile` records any path string | Low | Accepted (opening/listing still validated) |
| `template_inspect(path)` reads any .pptx | Low | Accepted |
| First pass items (CDN script, any-path file commands, attachment names, CSP) | — | Verified still fixed |
