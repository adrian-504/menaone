# Database audit

Audited commit `4975b1c`. Evidence comes from `src-tauri/src/db.rs`, the migration code, and a **read-only copy** of the live database (schema 31, 2.4 MB). The copy is not stored in the repository.

## 1. Overview

- SQLite via rusqlite 0.32 (bundled), one connection behind `Mutex`, `PRAGMA foreign_keys=ON`.
- Default rollback journal: no WAL and no `busy_timeout`. That's fine for one process.
- 49 application tables (plus FTS5 shadow tables), 103 indexes, 108 triggers.
- Migrations:
  - `SCHEMA_V1` → `FOUNDATION_LOCK_MIGRATION` → `run_migrations` over SQL `MIGRATIONS` (2–16, 18–21, 23) and `CODE_MIGRATIONS` (17, 22, 24–31). Version is stored in `app_meta.schema_version` (= 31).
  - A pre-migration snapshot goes to `backups/`. Rehearsal tests run against DB copies (`foundation.rs`, `records_and_sync.rs`, `v2_migration.rs`, `company_migration.rs`).
- Backups: daily (keep 14), pre-migration, and manual `pre-*` copies beside the DB (16 such files in the app-data folder, 81 MB total). **Plaintext, unencrypted, same disk.**

## 2. Table inventory, classified

| Class | Tables |
|---|---|
| Core business (shared company data) | companies, company_industries, company_aliases, company_review_queue, contacts, opportunities, proposals, proposal_lines, proposal_documents, agreements, agreement_lines, projects, project_milestones, services, rate_cards, business_entities, proposal_templates, team_members |
| Work (shared or personal, undecided) | meetings, notes, note_folders, note_links, note_attachments, note_templates, todos, areas, inbox_items, company_notes, saved_lists, company_list_members, contact_list_defs, contact_list_members, entity_tags |
| Relationship | entity_links |
| Activity / history | activity (96), opportunity_activity (24), project_activity (1), proposal_activity_notes (24) |
| Microsoft cache (personal) | emails (225), email_completed_log, microsoft_account (single row, CHECK id=1), microsoft_files (163) |
| Intelligence | intelligence_items |
| Sync scaffolding | sync_tombstones (30) |
| Search (derived) | search_index + FTS5 shadow tables |
| Settings / state | app_meta |
| Unused | documents (0 rows, no frontend caller) |

**Three activity mechanisms coexist:** the unified trigger-written `activity`, plus the older `opportunity_activity` (stage log), `project_activity` and `proposal_activity_notes` (user-typed notes). The stage log and proposal notes have legitimate distinct meanings. `project_activity` overlaps with `activity`.

## 3. Company identity: "company id = identity, name = attribute"

**Verdict: achieved for company links.**

- Every record with a company carries `company_id` (proposals, contacts, agreements, opportunities, projects, meetings, notes, todos, intelligence_items, emails, microsoft_files via entity_links).
- Live copy: **0 rows** have a company name but no `company_id`, across all tables. `real_database_copy_passes_the_integrity_checks` → `IntegrityReport { issues: [] }`.
- Aliases and a review queue handle ambiguous names. `company_for_save` / `link_company` resolve on save.
- Text copies remain (`proposals.client`, `agreements.client`, `contacts.company`, etc.) as display snapshots. The Foundation Lock tests keep them from being used for identity.

**Remaining name-keyed structures (not company identity, but name-as-key):**

| Table | Key | Risk |
|---|---|---|
| `company_notes` | PK `company_name` (with `company_id` from migration 30) | A rename relies on the id column; the PK is still the name. |
| `note_folders` | PK `name` | Renaming a folder rewrites notes; two users naming folders alike would collide. |
| `contact_list_defs` / `contact_list_members` | `name` / `list_name` | Unused (0 rows). |
| `app_meta.company_domains`, `dismissed_people` | JSON blobs | Not relational. |

## 4. Relationships and IDs

- **All primary keys and foreign keys are local `INTEGER`s.** That includes `entity_links.from_id/to_id` and `activity.entity_id`.
- IDs are assigned in two ways:
  - **In the frontend (max+1):** proposals, contacts, agreements, todos, notes, proposal/agreement lines, proposal documents (`src/lib/utils.ts` and entity modules).
  - **By SQLite AUTOINCREMENT / rowid:** opportunities, projects, meetings, companies, and most newer tables.
- Sync columns (migration 17) add `uuid`, `row_version`, `row_updated_at` to 30 tables via triggers. **No relationship references a uuid.** No table uses uuid as its key.
- Missing FK constraints (0 dangling rows today):
  - `agreements.proposal_id`
  - `activity.contact_id / opportunity_id / project_id / entity_id`
  - `entity_links` endpoints (polymorphic by design)
- Declared cascades are reasonable: lines and milestones CASCADE; context links SET NULL.

**Tables without a uuid column:** activity, app_meta, company_aliases, company_industries, company_list_members, company_notes, company_review_queue, contact_list_defs, contact_list_members, email_completed_log, emails, microsoft_account, microsoft_files, note_folders, note_links, entity_tags. Some are derived or local by nature (activity could be regenerated; emails are a personal cache). Others (aliases, company notes, list members) are shared business data that couldn't be synchronised as-is.

## 5. Other fields that matter for the next stage

| Field | State |
|---|---|
| Owner | `proposals.owner` free text + `owner_id` (14 rows with text only); `opportunities.owner` and `projects.owner` free text; `team_members` (7) is a directory with emails and no login link. |
| Actor | `activity.actor` exists and is NULL in every row. |
| Created / updated by | None. |
| Timestamps | Mixed formats: `created_at` strings from the frontend (local date or ISO), `row_updated_at` UTC milliseconds from triggers, Graph timestamps from Microsoft. The device clock is authoritative. |
| Soft delete | None. Deletes are hard, with a tombstone row written by trigger. |
| Paths | Absolute: `microsoft_files.path` (UNIQUE), `proposals.folder_path`, `proposal_documents.path`, `proposal_templates.path`, `note_attachments` on-disk names, `app_meta` path keys (`proposals_root`, `proposal_master_path`, `msfiles_pinned`, `msfiles_recent`). |
| Legacy columns | `date_sent_to_hassan`, `hubspot`, `finance` on proposals, kept for history. |

## 6. `app_meta` mixes three kinds of data

| Kind | Keys |
|---|---|
| Schema / system | `schema_version` |
| Organisation configuration | `ms365_client_id`, `ms365_tenant_id`, `proposals_root`, `proposal_library_dir`, `proposal_master_path`, `company_domains` |
| Personal state | `myday_snoozed`, `pinned_records`, `reminders_sent`, `dismissed_people`, `msfiles_pinned`, `msfiles_recent` |

A second, per-device store is `localStorage` (theme, sidebar, rail, recents, sidebar groups, filters, table columns, active company list, files preferences).

## 7. Is the schema cloud-ready?

**No, and it isn't meant to be yet.** The schema is internally consistent and has strong local integrity, but it is not ready to be the shape of shared or cloud data:

1. Integer identity and integer relationships (§4).
2. No user, ownership or actor columns (§5).
3. Personal and organisational data share tables (`meetings` mixes Outlook-synced personal calendar with shared project meetings; `emails` is personal; `app_meta` §6).
4. Machine-specific absolute paths (§5).
5. Hard deletes and trigger-generated local versions with no server authority.

**What is solid and should be preserved:** migrations with rehearsal, company identity by id, typed context FKs, integrity reporting, pre-change snapshots, and the trigger-maintained sync columns as raw material.

## 8. Recommendations (no action taken)

- **MUST FIX (before any second writer):** none in the schema today. The single-user product is safe.
- **SHOULD FIX (in the next workstream):**
  - Decide uuid-as-global-identity and write relationships by uuid (or map them).
  - Add owner/actor user IDs.
  - Split personal from organisational settings.
  - Store OneDrive-relative paths (or drive item IDs) instead of absolute ones.
- **OPTIONAL:**
  - Add the `agreements.proposal_id` FK.
  - Retire `project_activity` into `activity`.
  - Drop the `documents` table and its IPC.
  - Key `company_notes` by id.
- **DO NOT TOUCH:** company identity model, migration runner, integrity report, the entity_links design.
