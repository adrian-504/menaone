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
