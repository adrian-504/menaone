# Architecture notes

## Porting strategy

The original `MENA_BIG_Tracker_24.html` is a single 4,815-line file: ~390 lines of CSS, ~770 lines of HTML, and ~3,650 lines of vanilla JavaScript implementing 209 functions across 12 tabs and 10 modals, all reading/writing 8 `localStorage` keys directly.

Rather than redesigning this as a component framework app (React/Vue), the port keeps the same imperative, DOM-manipulation style, split into ES modules, for one reason: **fidelity risk**. A framework rewrite touches every line of business logic — status-transition rules, the pricing engine, HubSpot field mappings, agreement auto-sync, MRR calculations — and each line touched is a chance to silently change real business behavior the company already depends on. Porting 1:1 into modules, and only changing the persistence layer, keeps the diff against the original reviewable function-by-function.

Concretely:
- Every original function became an exported TS function in the module matching its section of the original file (see the file-by-file map in `README.md`).
- Original inline `onclick="fn(...)"` handlers in the HTML were kept as-is (not rewired to `addEventListener`) — each module calls `expose('fnName', fn)` to attach itself to `window`, so the ported markup keeps working unchanged. This was a deliberate pragmatic call: rewriting hundreds of handler wire-ups for no functional benefit would have been pure risk for zero gain.
- All business constants (statuses, types, pricing tiers, HubSpot stage map, agreement status colors) were copied verbatim from the original source, not re-derived.

## What changed on purpose

1. **Persistence**: `localStorage.getItem/setItem` → SQLite via Rust commands (see `PERSISTENCE.md`-equivalent section in README). Every `save*()` function still does a full-array replace, matching the original's behavior, but now targets a real relational table instead of a JSON blob in the browser.
2. **The `init()` duplicate-declaration bug is fixed.** The original file defines `function init(){...}` twice in the same scope (JS function-declaration hoisting means the *second* one silently wins). The first, more complete `init()` called `loadTodos()`, `loadNotes()`, `loadNoteFolders()`, `loadContactLists()`, `loadCompanyNotes()`; the second never did. That means in the original app, **Notes, To-Do, Note Folders, Contact Lists, and Company Notes were never actually loaded into memory on page load**, and saving a new item in any of those areas silently overwrote the corresponding `localStorage` key with just the new item(s) — a real, live data-loss bug. `main.ts`'s `init()` here does the full, correct load-everything sequence once.
3. **File downloads → native Save As dialogs.** The original used `Blob` + a synthetic `<a download>` click for every CSV/JSON export, which doesn't map onto a desktop app (there's no "Downloads folder" convention to lean on, and no dialog for the user to pick where files land). All exports now go through `@tauri-apps/plugin-dialog`'s save dialog, with the actual file write done by a trusted Rust command (`write_text_file`) — the frontend never gets raw filesystem access.
4. **Re-render dispatch centralized.** The original called specific `renderX()`/`updateYBadge()` combinations after each mutation, and these were inconsistent in places (some mutations forgot to refresh a badge, or refreshed the wrong tab). `lib/registry.ts` provides `refreshAll()` (re-render whichever tab is active + refresh all badges) as a single safe default; at this data scale (hundreds of rows) re-rendering the whole active tab on every edit is cheap, so this trades a theoretical bit of perf for removing a whole class of stale-UI bugs.
5. **Dead code dropped**: the orphaned "Roadmap/Suggestions" feature and `exportForClaude()` (both fully unreachable — no button or DOM element referenced either) were not ported. The three duplicate `renderStageMappingTable()` / `populateSelects()` definitions were collapsed into one each (they were identical or strict supersets).

## Module map

| Concern | File(s) |
|---|---|
| Types | `src/lib/types.ts` |
| Constants (statuses, pricing, HubSpot map) | `src/lib/constants.ts` |
| In-memory state (replaces the original's bare `let` globals) | `src/lib/state.ts` |
| SQLite access (Tauri `invoke` wrappers) | `src/lib/db.ts` |
| Save-file / open-file dialogs, CSV building | `src/lib/files.ts` |
| Date/format helpers | `src/lib/utils.ts` |
| Global period filter (year/quarter) | `src/lib/period.ts` |
| Shared Database/Reports filter predicate | `src/lib/filters.ts` |
| Tab-render dispatch (replaces ad-hoc renderX() chains) | `src/lib/registry.ts` |
| Change tracking: saves only changed records, deletes removed ones, applies returned company links | `src/lib/persist.ts` |
| Proposal workflow, follow-up/snooze, add/edit modal | `src/core/proposals.ts` |
| Agreements (ref generation, auto-sync, CRUD, CSV) | `src/core/agreements.ts` |
| Contacts + contact lists + ActiveCampaign export | `src/core/contacts.ts` |
| `switchTab()` | `src/core/nav.ts` |
| Backup/restore (own format + legacy import) | `src/core/backup.ts` |
| Dashboard charts | `src/tabs/dashboard.ts` |
| Follow-up tab | `src/tabs/followup.ts` |
| Pending/work-queue tab | `src/tabs/pending.ts` |
| Database tab | `src/tabs/database.ts` |
| Reports tab | `src/tabs/reports.ts` |
| Analytics (conversion funnel, monthly report) | `src/tabs/analytics.ts` |
| Notes tab (rich-text editor, folders) | `src/tabs/notes.ts` |
| To-Do tab | `src/tabs/todo.ts` |
| Pricing reference tab + fee-suggestion engine | `src/tabs/pricing.ts` |
| Companies tab (derived cross-entity view) | `src/tabs/companies.ts` |
| HubSpot CSV export | `src/tabs/hubspot.ts` |

## SQLite schema

One table per real entity, matching the original's implicit data model:

- `proposals` (+ `proposal_activity_notes`, normalized out of the original's `p.notes[]` array — a genuine one-to-many the original just inlined)
- `contacts` (+ `contact_list_defs` / `contact_list_members`, normalized out of `contactLists[]` + `contact.lists[]`)
- `agreements`
- `todos`
- `notes` (+ `note_folders`)
- `company_notes` (keyed by company name, matching the original's `{ [companyName]: text }` dict — there is no separate "companies" entity; a company is still just a distinct client name across proposals/contacts/agreements, exactly as in the original)

Proposals, contacts, agreements, tasks and notes were originally saved by deleting and reinserting the whole table — mirroring the original's `save*()` functions. Sprint 0 replaced that with per-record writes (see "Per-record saves and sync groundwork" below). The whole-table `write_*` functions remain only for backup restore and legacy import.

This list is the original V1 schema only — see "V2 additions" below for `companies`, `opportunities`, `projects`, `meetings`, and everything else added since.

## V2 additions (Opportunities, Companies, Microsoft 365)

Everything above describes the original 1:1 port. A second wave of work layered genuinely new functionality on top — Opportunities/Pipeline as a first-class entity, a canonical Company entity, and Microsoft 365 integration — none of which existed in the original app at all. Rather than merge this into `commands.rs`/`models.rs`, it lives in parallel files (`v2_commands.rs`/`v2_models.rs`/`v2_search.rs`, `opportunities.rs`, `company_migration.rs`, `ms365/`): the V1 code is a faithful port of business logic the company already depends on, and mixing genuinely new features into those files would make it harder to tell "ported as-is" from "new behavior" at a glance. The split is purely organizational — everything shares the same SQLite connection, transaction model, and Tauri command registration in `lib.rs`.

| Concern | File(s) |
|---|---|
| Projects, Areas, Milestones, Meetings (per-row CRUD, not bulk-rewrite) | `src-tauri/src/v2_commands.rs`, `src/tabs/projects.ts`, `src/tabs/meetings.ts` |
| Opportunities / Pipeline | `src-tauri/src/opportunities.rs`, `src/tabs/opportunities.ts` |
| Full-text search index (`search_index`, per-entity `reindex_*`) | `src-tauri/src/v2_search.rs`, `src/core/commandPalette.ts` |
| Company Master Data migration engine | `src-tauri/src/company_migration.rs` |
| Microsoft 365 (OAuth/PKCE, Graph API, Action Required, Calendar sync) | `src-tauri/src/ms365/` (`auth.rs`, `graph.rs`, `commands.rs`, `models.rs`), `src/tabs/actionRequired.ts`, `src/tabs/calendar.ts` |
| Local/OneDrive file linking | `src-tauri/src/localfiles.rs`, `src/tabs/files.ts` |
| Intelligence feed ingestion (RSS/Atom) | `src-tauri/src/intel.rs`, `src/tabs/intelligence.ts` |
| Note attachments | `src-tauri/src/attachments.rs` |

### Opportunities / Pipeline

`opportunities` is a genuine per-row entity (`save_opportunity` does an UPDATE-or-INSERT-by-id, unlike Proposal/Contact/Agreement's bulk delete-and-reinsert — see below), moving through an 11-stage pipeline (Lead → Qualified → Discovery → Meeting → Solution Design → Proposal → Negotiation → Verbal Commitment → Won/Lost/On Hold) with a derived `status` rollup (Open/Won/Lost/On Hold) recomputed server-side from `stage` on every save. It introduced the app's first real `company_id` foreign key: the frontend only ever sends a plain typed `companyName` string, and `save_opportunity` resolves/creates the matching `companies` row itself via `resolve_company` (`opportunities.rs`) before persisting — the frontend never computes or sends a `company_id` directly. This find-or-create-by-exact-name pattern is the template every other entity's company resolution follows (see below). Projects and Meetings are the same per-row-upsert shape as Opportunity (`save_project`/`save_meeting` in `v2_commands.rs`), which matters because it's *why* those three could adopt `company_id` resolution with no bulk-rewrite complications, unlike Proposal/Contact/Agreement.

### Company Master Data & Relationship Layer

The original app (and Opportunity's first cut) both treated "a company" as nothing more than a distinct client-name string. This was replaced with `companies` as a real canonical entity: `id`, `name`, `legal_name`, `website`, `country`, `city`, `company_type`, `status`, `owner`, `description`, `archived`, plus a separate `company_industries(company_id, industry)` table (industries are multi-value, constrained to a fixed 16-category taxonomy defined in `company_migration.rs`'s `INDUSTRY_TAXONOMY` — not free text, and never inferred from the company name).

`contacts`, `proposals`, `agreements`, and `projects` all gained a nullable `company_id` column alongside their existing free-text company field (`client`/`client_name`/`companyName`). The free-text field stays what the UI actually edits; `company_id` is a read-only mirror resolved server-side on *every* save via the same `resolve_company` primitive Opportunity established — the per-record upserts (`upsert_proposal_rows`/`upsert_contact_rows`/`upsert_agreement_rows`, `commands.rs`) call it once per row, and `save_project` (`v2_commands.rs`) calls it inline. The frontend's `Company Selector` (`src/lib/companySelector.ts`) makes picking an existing company easier and warns before creating a likely duplicate, but it only ever sets the free-text field — resolution to an id is never done client-side.

`company_migration.rs` is the one-time (safely re-runnable) engine that backfills this for data that predates it: it backs up the live SQLite file first, then for every legacy free-text name with no `company_id` yet, either links it to an exact or unambiguous fuzzy-matched existing company, auto-creates a new one (only when zero existing companies plausibly match), or — for anything genuinely ambiguous (multiple plausible matches) or placeholder-like ("N/A", "No Client Name") — queues it in `company_review_queue` rather than guessing. It never merges or invents a company silently. The review queue is surfaced directly on the Companies tab (`src/tabs/companies.ts`), not a separate page, with Confirm/Pick-another/Create-new/Leave-unresolved actions per entry.

### Microsoft 365 integration

`ms365/auth.rs` implements the OAuth authorization-code + PKCE flow for a desktop "public client" (no client secret to protect) and stores the refresh token in the macOS Keychain via the `security` CLI directly — not the `keyring` crate, because ad-hoc code signing (no paid Apple Developer ID) makes keyring's Keychain ACL unstable across rebuilds. `scripts/build-and-sign.sh` re-signs the built `.app` with a fixed `--identifier` for the same reason: `tauri build`'s default ad-hoc signature hash changes on every rebuild, which macOS treats as a different app and revokes Keychain access to the previously-stored token. `ms365/graph.rs` wraps the actual Microsoft Graph API calls (mail, calendar, Teams); Outlook remains the source of truth — MENA One only caches what Action Required, Calendar, and Meetings need.

## Per-record saves and sync groundwork (Sprint 0)

- **Per-record writes.** `upsert_<entity>` / `delete_<entity>` commands (`commands.rs`, generated by `record_commands!`) replace the whole-table saves for proposals, contacts, agreements, tasks and notes. Upserts use `INSERT … ON CONFLICT(id) DO UPDATE … WHERE col IS NOT excluded.col`, so saving an unchanged row writes nothing. `src/lib/persist.ts` keeps a JSON snapshot per record of what was last saved, sends only records that differ plus the ids that disappeared, queues saves per entity so they land in order, and retries a failed batch on the next save. This also fixed a data-loss bug: deleting a whole table fired `ON DELETE SET NULL`/`CASCADE` on other tables, silently clearing `opportunities.proposal_id`, `meetings.note_id` and note attachments on every save (covered by `saving_one_entity_keeps_links_held_by_other_tables`).
- **Sync columns (schema v17, `db.rs` `add_sync_columns`).** Every table in `SYNC_TABLES` has `uuid` (global identity), `row_version` and `row_updated_at`, maintained by triggers. Deletes write `sync_tombstones(table_name, uuid, deleted_at)` instead of a `deleted_at` column per table. Migrations can be SQL (`MIGRATIONS`) or Rust functions (`CODE_MIGRATIONS`), run in version order.
- **Company by id everywhere (v18).** Meetings, notes, tasks, intelligence items, emails and documents gained `company_id`, backfilled by exact name. Every save resolves it through `opportunities::link_company` → `resolve_company`. The upsert commands return `{id, companyId}` pairs, which `persist.ts` copies onto the in-memory records. Company pages, lists, filters, merge and rename match records with `inCompany`/`sameCompany` (`src/lib/utils.ts`): by id whenever both sides have one, by name only for a record whose save hasn't returned yet.
- **Agreements from proposals** are created in Rust (`create_agreements_from_proposals`): idempotent (skips any proposal that already has its auto-created agreement), with reference numbers from the highest existing sequence (`next_agreement_ref`).
- **Microsoft 365 addresses (v19).** Meetings keep `organizer_email` and `attendee_emails_json`; emails keep `recipients_json`.
- **Automatic backups** (`backups.rs`). `VACUUM INTO` snapshots in `<app_data_dir>/backups`: one per day (last 14 kept, re-checked hourly), one before any pending migration runs (never pruned; startup refuses to migrate if this copy fails), and manual ones from Settings → Data Backup. Only files with those prefixes are ever pruned.
- **Windows portability.** Keychain on macOS / `keyring` (Windows Credential Manager) elsewhere; OneDrive folders resolved per platform (`localfiles.rs` `onedrive_dirs`); `tauri-plugin-opener` instead of `open`; `CommandOrControl` shortcuts; macOS-only menu items gated. Not yet built or run on Windows.
- **Next:** the push/pull design, outbox and server are in `docs/sync-architecture.md`. PowerPoint generation feasibility is in `spikes/pptx-generator/README.md`.

## App shell (Sprint 1)

- **Router** (`src/core/router.ts`). A *place* is a module plus, optionally, one open record (`src/lib/navHistory.ts`). Modules keep their own open/close functions; each calls `notifyNavigated()` (`registry.ts`) and the router reads the place back from state. It then records history, updates the location bar (`#loc-bar`: back/forward and breadcrumb, with the record's company as a link) and sets the window title. It also remembers scroll per place and keeps recently opened records (shown first in ⌘K).
  - Back/forward: ⌘[ / ⌘] (Ctrl on Windows), Alt+←/→ and the mouse side buttons.
  - Sidebar items call `navToModule`: another module opens as you left it; the current module returns to its list. "← Back" on record pages returns to wherever you came from.
  - Escape leaves the open record.
- **`openRecord(kind, key)`** is the single way to open any record from anywhere. Companies, projects, opportunities, meetings and notes have pages. Tasks, contacts, proposals and agreements open their edit dialog in their module until their own pages exist. Multi-step moves (switch module, then load the record) are recorded as one history step.
- **Change bus** (`src/lib/changes.ts`). `emitChange({kind, ids})` is raised by every save in `persist.ts`. Subscribers get one batch per tick. Today it keeps the location bar and titles current; in Sprint 5, incoming sync changes go through the same bus.
- **Record links** (`src/lib/links.ts`). `recordLink()` / `companyLink()` render every mention of a record as a link, with a hover preview of key facts. They are used in Proposals, Agreements, Contacts, Pending, Follow-Up, Reports, Analytics, My Day, Tasks, Notes, Projects, Opportunities, Meetings, Action Required and Watch.
- **Design system pieces** (`src/lib/ui.ts` + "Design system" in `styles.css`):
  - `toast()` replaces every `alert()`.
  - `undoToast()` backs reversible deletes; tasks delete immediately with Undo.
  - `emptyState()` and `skeleton()` provide empty and loading states.
  - `showConfirm` replaces the remaining native `confirm()` calls.
  - The "+ New" menu and ⌘K lead with actions for the company in view.
  - A dev-only **Component Gallery** (⌘K → Component Gallery, `src/tabs/gallery.ts`) shows every shared component in each theme; it is not included in production builds.

## Notes and Tasks (Sprint 2)

- **Workspace layout.** Tabs marked `ws-tab` (Notes, Tasks) switch `<main>` into `workspace` mode: full height below the location bar, with panes that scroll on their own (`.ws` grid in `styles.css`).
- **Tasks** (`src/tabs/todo.ts`):
  - **Lists.** Smart lists Today (with overdue first), Upcoming (a 7-day strip, then days, then months), Anytime, Someday and Completed, plus Projects, Clients and Tags in the sidebar. The list key is kept in `S.todoFilter`.
  - **Rows.** `taskRowHtml()` is the single row renderer, used by Tasks, company pages, project pages and the gallery.
  - **Detail panel.** Selecting a task opens `#task-detail` beside the list, and the router treats it as a record (`task` in `PAGES`).
  - **Keyboard.** ↑↓/⇧, Enter, Space, T, D, P, S, M, N and ⌫ work on the selection. Complete and delete offer Undo.
  - **Drag and drop.** Drop tasks on a sidebar list, an upcoming day or a calendar day to reschedule or move them.
  - **Quick add.** `src/lib/taskParse.ts` (pure, unit-tested) reads dates, times, `#project`/tag, `@company` or a company name in the text, `!priority`, "someday" and "every week". Recognised parts show as chips, and clicking a chip keeps that text as plain text.
- **Schema v20:** `todos.due_time` and `todos.someday`.
- **Notes** (`src/tabs/notes.ts`):
  - **Panes.** Library (All, Pinned, Recent, Linked to clients, folders, tags), the note list, and a document column (720px) with a large title.
  - **Properties.** Folder, client, project and tags are chips under the title that open pickers. Folder and client are set on the note directly; `saveCurrentNote` reads only title and body.
  - **Formatting.** A floating toolbar appears on text selection; the permanent formatting bar is optional (layout is saved in localStorage). The slash menu is unchanged.
  - **Focus mode** (⌘.). ⌘N creates a new note and ⌘⇧F searches notes.
  - **Connections** at the foot of each note: client, project, meetings, links to and linked from.
- **Local dates.** `today()` and date-only values use local time (`localIsoDate`); `toISOString()` gave the previous day in KSA before 3am.

## Company 360, contacts and activity (Sprint 3)

- **Unified activity (schema v21, `src-tauri/src/activity.rs`).**
  - **Storage.** One `activity` table (entity, action, summary, company/contact/opportunity/project ids, time). SQLite triggers write to it, so every path that saves a proposal, agreement, contact, task, note, meeting, company, or opportunity/project activity row records an event with no frontend code. Note edits are throttled to one event per 30 minutes. The migration backfills from `opportunity_activity`, `project_activity` and `proposal_activity_notes`.
  - **Muting.** Restores and "wipe all data" run inside `with_activity_muted` (`app_meta.activity_muted = '1'`), so they don't flood the log.
  - **Reading.** `get_activity(filter)` reads by company, contact or entity. `src/lib/activityFeed.ts` renders a feed grouped by day, used on company, contact, opportunity and project pages.
- **Company rename** (`rename_company`) renames in place and keeps every link. If the name is already taken it refuses and suggests Merge. `merge_company_links` now also re-points `company_id` on meetings, notes, tasks, intelligence items, emails, documents and activity.
- **Company page** (`src/tabs/companies.ts`): header, stats that jump to sections, key facts, editable company notes, section navigation with scrollspy, then contacts, opportunities, proposals, projects, agreements, meetings, notes, tasks, files and activity.
- **Contact page** (`src/tabs/contactPage.ts`, router page `contact`):
  - **Header.** Inline-editable fields, list chips, and call/email/WhatsApp/copy actions.
  - **Related.** Opportunities (entity links), meetings (by attendee email, captured on meetings since this sprint, or by name), emails (`ms365_get_emails_by_address`), and tasks and notes that mention the contact.
  - **History.** Activity and last interaction.
- **Drag and drop** (`src/lib/dnd.ts`): one pointer-events engine (not HTML5 drag, which is unreliable in WKWebView/WebView2).
  - **Markup.** Sources carry `data-drag-kind`/`data-drag-id`, targets `data-drop`/`data-drop-value`, sortable containers `data-sort`.
  - **Registration.** Modules call `registerDragSource` and `registerDropTarget`.
  - **Behaviour.** The engine handles the ghost, insertion line, auto-scroll, Escape and click suppression.
  - **Wired up:**
    - **Tasks:** onto lists, projects, companies, tags, days and board columns; reorder within groups; reorder subtasks.
    - **Notes:** onto folders, Pinned and tags; nest folders.
    - **Contacts:** onto lists.
    - **Opportunities:** onto board stages.
    - **Projects:** reorder milestones.
- **Legacy markup removed.**
  - **Record pages.** Detail pages (company, contact, project, opportunity, meeting) share the `rec-*` components.
  - **Page chrome.** Reports, Analytics, Pricing, Pending and Follow-Up use the shared page header.
  - **Styling.** Empty states use `emptyState()`. Inline styles remain only for display state and data-driven colours or widths. Unused legacy CSS was deleted.
  - **Settings.** Themes live in Settings, and the sidebar footer is a Settings item.

## Commercial core (Sprint 4)

- **Schema v22** (`src-tauri/src/commercial.rs`, code migration):
  - **New tables:** `services` (the catalog), `rate_cards` (tiers, packages, bundles and add-ons, seeded from `catalog_seed.json`), `business_entities` (MENA BIG KSA in SAR with 15% VAT; MENA BIG Europe in EUR), `team_members` (seeded with Hassan Balaghi as reviewer), `proposal_lines`, `agreement_lines` and `proposal_documents`. All of them have sync columns.
  - **Proposals gain:** entity, currency, one-time fee, primary contact, owner and reviewer (team ids), review state, valid-until, OneDrive folder and lead source.
  - **Agreements gain:** entity, currency, start and end dates, service status (Not started / Kickoff scheduled / Active / Ended), auto-renew, notice days and prepared-by (team id).
  - **Opportunities and client projects** gain an entity.
- **Statuses.** Proposals move through Proposal Request Received → Drafting → In Internal Review → Sent to Client → Signed by Client → Signed by Both Parties (won), or end as Lost or Withdrawn.
  - **Rules.** Rust `commercial::PROPOSAL_STATUSES` and TS `lib/commercial.ts` `PS` hold the list. Every module asks the helpers (`isWon`, `isOpenProposal`, `isInPreparation`…) instead of comparing strings.
  - **Agreement statuses.** "Under Process <name>" became "In Preparation", with the name moved to prepared-by.
- **Legacy clean-up** (`normalize_commercial_data`). It runs in the migration and after every restore or legacy import, and is idempotent.
  1. Won proposals without an agreement get one. "Service Started" and "Kickoff Meeting Set" become the agreement's service status.
  2. Lead rows that already exist as opportunities are archived with a note.
  3. Old statuses map onto the new list. Proposals that were with Hassan get him as reviewer, with the review pending.
  4. Agreement dates come from the proposal's kickoff date and term.
  5. Every legacy proposal and agreement gets one line. Old rows are not regrouped (owner decision).
  6. Everything is set to KSA/SAR.
  - The clean-up is not logged as activity.
- **Lines are the source of truth.** A proposal's `type`, `monthly_fee` and `one_time_fee` are derived from its lines, in Rust on save (`apply_derived_proposal_totals`) and in TS before saving (`syncProposalTotals`), so older screens and CSV/HubSpot exports keep working. Lines and documents are embedded in the Proposal/Agreement records and saved with them. Line and document ids are assigned in the frontend.
- **Agreements from won proposals** (`create_agreements_core`). The agreement copies the lines, entity, currency and term; its type comes from the first line's catalog service.
- **MRR and active clients.** MRR comes from agreements with an active service that hasn't ended, kept per currency (`MoneyByCurrency`). Totals convert to SAR only when Settings has a rate for every currency involved. "Active client", renewals (ending within 60 days) and company MRR all read agreements.
- **Proposal page** (`src/tabs/proposalPage.ts`, router page `proposal`, key `new` for the builder):
  - **Header.** Progress track and the next step for the current status.
  - **Tools.** Generate (disabled until the master deck, Sprint 7), open folder, open the latest deck, jump to commercials or documents.
  - **Details and review.** Inline details, and the internal review recorded on the reviewer's behalf.
  - **Commercials and documents.** Service-lines editor (`lib/linesEditor.ts`, shared with the new-proposal and agreement pages). Client folder via `proposal_folder_lookup`/`proposal_folder_create`: it finds `<OneDrive>/MENA BD <year>/Proposals/<Client>` by a loose name match and creates it only on request. The next deck file name is suggested (`<Client>_<Services> Proposal_<DD.MM.YYYY>_V<n>.pptx`).
  - **Related and history.** Linked records, notes and activity.
  - **Guards.** Won and Lost go through the reason dialog, and marking a proposal sent before approval asks first.
- **New proposal.** One page with client (existing-client summary, opportunity, contact or a new contact), service chips that become lines with rate-card hints, terms, workflow and the OneDrive folder. It replaces the old add modal; `openAddModal()` still works for every caller.
- **Agreement page** (`src/tabs/agreementPage.ts`, router page `agreement`): details, term and service status, lines, signature trail and activity. New agreements start from a short dialog.
- **Proposals module.** Database, Pending and Follow-Up share a view bar (All · In preparation · Follow-up · Won · Lost). Pending and Follow-Up sit under Proposals in the sidebar. Pricing became **Services** (catalog plus rate card).
- **Settings.** Team directory (with names found on older records), business entities and exchange rates, the Proposals folder, and a one-time owner tidy-up (mark each old owner value as a team member or a lead source).

## Pipeline, meetings linked to clients, proposal generator (Sprint 4b)

- **Schema v23/v24.** `opportunities.win_loss_reason`; `proposal_templates` (path to a .pptx, entity, default flag, `config_json` with per-slide rules and plain-text replacements), with sync columns.
- **Pipeline facts** (`insights.rs`, `get_pipeline_facts`): for each opportunity, the stage history rebuilt from `opportunity_activity` ("Lead → Qualified" rows), when it entered its current stage, and its last real activity. Activity means logged events on it or its company, plus meetings that have happened; a record being edited doesn't count.
- **`lib/pipeline.ts`** (pure, tested):
  - **Health:** a 0–100 score from fixed rules (no activity for 14 or 30 days, close date passed, no next action, long in stage, no value).
  - **Weighted value:** uses the opportunity's own probability, or the stage's default.
  - **By-stage table:** includes "won from here" for each stage.
  - **Win/loss:** grouped by any key, with deal-size bands and reason counts.
  - **Where it shows:** Analytics has Pipeline, Win & loss and Monthly views, and the opportunity board chips use the same health rules.
  - **Outcome reasons:** moving an opportunity to Won or Lost asks for a reason through the shared outcome dialog (`openOutcomeDialog`).
- **Client matching** (`lib/clientMatch.ts`, pure, tested):
  - **How a company is found:** a meeting attendee's exact contact email, the email domain (from contacts, company websites, or a domain the user confirmed before), or the company name in the title.
  - **What never counts:** personal mail providers and MENA BIG's own domains (Outlook account, team emails, `own_domains`).
  - **Automatic links:** only when a known contact attends and one company is clearly ahead. Everything else is a suggestion on the meeting page or the Meetings list.
  - **Saved choices:** confirmed domains and dismissed suggestions are stored in app_meta (`company_domains`, `dismissed_meeting_links`).
  - **Websites:** suggested from contacts' email domains, with a review dialog under Companies.
- **Meeting page client brief** (`tabs/meetingClient.ts`): the last meeting and its follow-up, open proposals, opportunities with their next action, agreements (service status, end date), open tasks and recent notes. It also builds a rule-based suggested agenda and lists attendees who aren't contacts yet.
- **Fixed:** Outlook stores attendees as `[{name, email}]`, but they were read as plain strings, so every meeting's attendee emails were empty. `parse_attendee_emails` now accepts both formats.
- **Companies filters:** relationship (active client / in discussion / prospect / past), open opportunity, industry, service on file (proposal and agreement lines), country or city, owner, contacts.
- **Deck engine** (`pptx.rs`, from the Sprint 0 spike):
  - **Reading a template:** each slide's title, text, speaker-note tags (`[always]`, `[services: …]`, `[entity: …]`, `[never]`) and `{{tokens}}`.
  - **Building a deck:** it keeps the chosen slides, removes parts nothing uses any more, fixes content types and the slide count, fills tokens (including ones split across runs) and plain-text replacements, and repeats `<a:tr>` rows containing `{{line.…}}` once per service line.
  - **Tested on the real templates** (opt-in `tests/pptx_real_templates.rs` with `MENA_TEMPLATE_DIR`): the output opens in PowerPoint for Mac without repair and exports to PDF.
- **Generator** (`generator.rs`):
  - **Values:** the proposal's values come from the database (`deck_values`), with dates in the user's time zone passed from the frontend.
  - **Slide choice:** by rules, matching service names or catalog categories and the entity (`choose_slides`); the user can change the choice in the dialog.
  - **Saving:** a dry run previews the result. The real run writes `<client folder>/<file name>` (creating the client folder under the Proposals root if needed; an existing file is never overwritten), and the frontend records it as a proposal document.
  - **Setup screens:** templates are managed under **Services → Proposal templates**. The guide for whoever prepares the master deck is `docs/proposal-template-guide.md`.
- **Smart fill** (`smartfill.rs`, on by default per template as `config.smartFields`): fills the current decks, which have no `{{tokens}}`, the way the team edits them by hand. Studied on real sent proposals.
  - **Client name:** every `'Client Name'` / `New Client` placeholder. On short lines the font shrinks only if the text no longer fits its box (width estimated per shape).
  - **Dates:** dates on short lines are rewritten in the template's own style (weekday, ordinal, "of", comma), e.g. "Date: 16th of May 2024" → "Date: 14th of September 2026".
  - **Letter and images:** the country line under "Attn:" is set from the company. The "Logo" box is replaced by the chosen client logo (PNG/JPEG, fitted), or removed. The "Photos" box is removed.
  - **Agenda:** page numbers are recounted from the section divider slides ("… | 1", "| 2", "| 3") after slides are removed.
  - **Fees:** a fee cell is updated when its row names one of the proposal's services. Every other amount and percentage is listed under "check them in PowerPoint", never guessed.
  - **Report:** the Generate dialog shows the report (`BuildReport.smart`) before saving. Each slide in the template editor shows what smart fill found on it.
  - **Known gaps:** the templates folder holds older versions of the letter and T&C slides than recent sent decks; "All Services" has no cover or letter; a superscript "th" becomes plain text.

## My Day (Sprint 4c)

- **Rules** (`lib/myday.ts`, pure and tested): the tab only renders.
  - **`buildAttention`:** one list ranked by a score. Each item has a record, a reason, a when label and one main action. It covers:
    - proposals: client-signed (older than 30 days counts as stale), review approved or changes requested, requests not started, drafting over 7 days, waiting on review for 3+ days, follow-ups after 10 days;
    - opportunities: at risk from `opportunityHealth`, or no next step;
    - agreements: ending within 90 days (with notice period), or kickoff date passed;
    - client meetings today or tomorrow with no agenda;
    - projects: at risk, late or due within 7 days;
    - flagged emails due, and unsorted Inbox items.
  - **Grouping:** low-urgency items of one kind fold into a group row that expands inline (old follow-ups, review queue, opportunities with no next step, recent follow-ups past 6). Urgent items stay visible.
  - **`buildTimeline`:** overdue tasks; today's meetings and timed tasks around a "now" marker (with the current meeting); untimed tasks due today, including ones completed today.
  - **`buildComingUp`:** the next 7 days of meetings, tasks, agreement end dates, expected close dates, project targets and proposal expiry.
- **Page** (`tabs/myday.ts`):
  - **Header:** greeting with a summary line.
  - **Today card:** complete, move to today or tomorrow, pick a date, Join/Prepare/Add notes on meetings, quick capture using the Tasks parser (defaults to today).
  - **Needs your attention:** one main action per row (e.g. "Mark as sent" and "Start drafting" change the proposal status). The "…" menu hides a row until tomorrow or for a week, saved in app_meta `myday_snoozed` with undo.
  - **Rail:** Coming up, Business figures (open and weighted pipeline, proposals out, active MRR), Watch, and recent activity from the unified log.
  - **Refresh:** the page re-renders on the change bus and every minute.
- **Fixed — Outlook times:** Graph is asked for UTC, but values came back without a zone and were read as local time, so meetings showed 2–3 hours early. New syncs store `…Z` (`ms365::commands::utc_instant`). Older rows are corrected on load by `lib/outlookTime.ts`, which also moves a meeting to its local calendar day.

## Working with lists, clean-up, people from meetings (Sprint 9b)

- **Clean-up** (`lib/cleanup.ts` pure and tested; `tabs/cleanup.ts`): queues of records whose status or details no longer match reality.
  - **Queues:**
    - proposals sent 45+ days ago, signed by the client 30+ days ago, in review 14+ days, requested or drafting 30+ days;
    - kickoff date passed, or ended but still active;
    - opportunities missing a value, next step or close date;
    - companies without an industry or owner;
    - old open tasks.
  - **Working through a queue:** one record at a time, with facts and last note, one-click fixes (keys 1–n, → to skip), or as a list with the same fixes on a selection.
  - **Undo and keep:** every fix can be undone. "Keep for 30 days" is saved in app_meta `cleanup_kept`.
  - **Where it's reached:** a sidebar badge, and My Day's folded rows ("proposals sent over 45 days ago", "opportunities with no next step").
- **People from meetings** (`lib/clientMatch.ts` `meetingPeople` / `guessCompany` / `suggestedContacts`, tested; `tabs/meetingClient.ts`):
  - **Sorting attendees:** every meeting page lists its attendees as MENA BIG colleagues, known contacts, or new people.
  - **Company guess for new people**, in order: a known email domain, the meeting's client, a company whose name matches the domain, or a name built from the meeting title and domain ("Woodgrove X MENA" + woodgrovemena.com → "Woodgrove MENA").
  - **Adding people:** "Add to contacts" (or "Add all") creates the company if needed, remembers the domain in `company_domains`, and links meetings automatically. Contacts shows a banner to review everyone from all meetings at once. "Not a contact" is saved in `dismissed_people`.
  - **Own domains:** a domain on at least 60% of synced meetings counts as MENA BIG's own.
- **Lists:**
  - **List beside the record** (`core/recordRail.ts`): companies, contacts, proposals, agreements, opportunities, projects and meetings. It filters, uses ↑/↓ to move between records, and can be toggled from the location bar (remembered per device).
  - **Pinned and recent records** in the sidebar (`router.ts`): pins in app_meta `pinned_records`, recents in localStorage.
  - **Bulk actions bar** (`lib/bulkBar.ts`):
    - Proposals: status, mark lost with reason, owner, archive, export.
    - Companies (list view): owner, industry, archive.

    One undo covers each batch.
  - **Remembered filters** (`lib/rememberFilters.ts`, localStorage): Companies, Contacts, Agreements, Proposals, Pending.
  - **Copy buttons:** contact email and phone in the list, agreement reference, proposal SL#.
  - **Duplicate:** opportunity, project with its milestones, and "Plan a follow-up meeting" (carries follow-ups into the agenda).
- **Fixed — flagged emails and calendar:** the Graph sync read only the first page (100 flagged emails / 250 events), so newer flagged mail was missing from Action Required. `graph_get_all` now follows `@odata.nextLink`. If the list is cut short it doesn't delete anything.

## Consistency, Files, reminders (Sprint 9c/9d)

- **Settings** (`index.html` `.settings-layout`, `tabs/settings.ts` `setSettingsPane`): a section list with one pane at a time — General (reminders, theme), Team, Business, Connections, Data. The chosen pane is remembered.
- **Editing on the page:**
  - **Companies:** edited in the Key facts card (`openEditCompanyModal` now opens the in-page form; the pop-up is gone).
  - **Contacts and agreements:** already edited in place; `editContact` opens the contact page.
- **Type scale:** every font size in `styles.css` uses a `--type-*` token. `--type-large`, `--type-stat`, `--type-display` and `--type-hero` were added for dialog titles, stat numbers, record titles and note titles.
- **Files** (`tabs/files.ts`), Finder-style:
  - **Places:** OneDrive, the Proposals folder, Favourites, Recent, Linked to records, and favourite folders.
  - **Toolbar:** up button, folder title, path bar, search, sort (name/date/size/kind, remembered) and list/icons view.
  - **List:** colour-coded kinds.
  - **Info panel:** open, show in Finder, copy path, favourite, link to company or project, notes.
  - **Behaviour:** single click selects, double-click or Enter opens, ⌘↑ goes up, ⌘F searches.
- **Watch:** list rows with an importance dot. Save and source stay visible on the row; task, note, link, edit and archive move to a "…" menu.
- **Calendar:** each day is one card with divided rows.
- **Page headers:** a header's action button always sits on the right.
- **Inbox:** "→ Task" runs the quick-add parser (date, time, priority, company). "…" turns an item into an opportunity (company and date from the text) or a contact (name, email and phone from the text).
- **Shortcut sheet** (`core/shortcuts.ts`): opened with "?" or ⌘/ (also Help → Keyboard Shortcuts). The current module's shortcuts are listed first. The Navigate menu's ⌘1 is now My Day, and Clean-up was added.
- **Reminders** (`lib/reminders.ts` pure and tested; `tabs/reminders.ts`; `tauri-plugin-notification`):
  - **What it sends:** meetings N minutes before, timed tasks at or before their due time, and a morning summary from My Day on workdays (Sunday–Thursday by default).
  - **Late reminders:** each can be up to 10 minutes late (the app was asleep), and the morning summary up to 3 hours.
  - **No repeats:** sent keys are kept in app_meta `reminders_sent`, and settings in `reminder_settings`.
  - **While the app is in front:** it also shows a toast with an "Open" action.

## Design clean-up and sidebar (Sprint 9e)

- **Sidebar:**
  - **Groups:** Home (My Day, Inbox, Action Required, Calendar), Work, Clients, Sales (Proposals with Pending and Follow-Up), Library, Insights. Clean-up and Settings are at the bottom.
  - **Collapsing:** sections collapse (remembered in localStorage `menaone.sidebarCollapsed`); a collapsed section still shows the page you're on.
  - **Removed:** the Pinned/Recent section and the location-bar pin. Recents are still used by ⌘K.
  - **Period filter:** no longer in the sidebar. It's a `.period-sel` select on Proposals, Pending, Follow-Up, Dashboard, Reports and Analytics, kept in sync by `setGlobalPeriod`.
- **Controls** (end of `styles.css`): one 30px style for search fields (magnifier icon), filter selects (custom chevron), segmented controls, toolbar buttons and counts, applied to every `.fbar`/`.toolbar`/page-header control.
  - **Contacts:** actions moved to the page header; the # column and per-row Open buttons are gone, with hover icon actions instead.
  - **Proposals and Agreements:** the Open column is gone (the row opens the record).
  - **Reports:** filters use the same bar.
  - **Inbox:** a single composer with kind chips; items sit in one list card.
- **Pending and Follow-Up** (`pq-*`): list rows with an age pill, client and services, meta line, progress dots, fee, one next action and a shared "…" menu (`pqMenu`: open, notes, won/lost, snooze, archive). KPI tiles and the colour legend were removed.
- **Record pages** (`.rec-layout`): Projects, Meetings and Opportunities show their sections on the left and a sticky Details panel on the right (inline-editable properties; projects gained start and target dates).
  - **Meeting header:** rarely used actions moved into "…".
  - **Opportunities:** a new Files section lists the linked proposal's documents and the client's proposal folder.

## Proposals built from the service templates, pricing ranges (Sprint 7)

- **Template library** (`src-tauri/src/proposal_library.rs`): reads every `.pptx` in `Proposals Templates/Proposals New Logo` (next to the Proposals folder, or `app_meta.proposal_library_dir`), cached by file time and size. `classify` labels each slide (cover, letter, agenda, section, service divider, approach, fees divider, fees, terms, acceptance, about, references, back cover) and the service module it is for; "Assumptions and Limitations – X" terms are service-specific. `plan` picks the base template covering most requested modules (sent proposals such as Al Faya last), keeps shared slides plus the wanted modules (a divider stays when a slide it introduces stays; the Constitution & Maintenance bundle includes its constitution and maintenance slides), and imports missing modules from the most focused template. `compose` removes the rest, imports module slides after the last service slide and service terms before acceptance, swaps a sent proposal's client name back to the placeholder, and retitles the cover and letter ("Accountancy & VAT and Labor Law Consultancy Services").
- **Slide import** (`pptx_import.rs`): copies slides with their media, notes, layout and master (layouts reused when identical by content fingerprint), registers content types, adds `sldId`s and section entries.
- **Generate dialog**: "Built from your service templates" is the default when the folder exists (`GenerateRequest.fromLibrary`); the preview lists each slide's source template; services with no template slides (GM Representative, Training) are warned about. Saved single templates still work.
- **Smart fill additions**: month-first dates ("June 28th 2026"); the yellow "to update" highlight is cleared from filled text; fee tables are filled from the rate card — employee-band tables show `showBands` (3) bands around the client's band, all priced at the client's place in its range and rows removed or repeated to fit; employee-type rows (Workforce) take each line's own price or the same relative level; "X% of the Annual Package" takes the line's percentage or the card's standard.
- **Pricing** (`src/lib/pricing.ts`, `src-tauri/src/pricing.rs`, same rules): options per card (bands, packages, bundles, single range, percent), standard price (card `standard` or mid-range rounded to 50), option matched from the line's scope text by words, range check, relative band prices, band window. The lines editor shows the band/package picker, "With commission", "Standard 3,550 · 3,300–3,750 · Use", and "Above/Below the rate card".
- **Migration 25** (`commercial::migrate_pricing_ranges`, data only): adds `standard`, `percent`, `milestones`, `showBands`, `perPerson`, `minimumMonths` to cards that lack them; Constitution minimum 55,000 → 45,000 only if unchanged; new cards Company Constitution & Maintenance Package (8,250–9,750, standard 9,500), Company Liquidation (20,000–35,000, standard 30,000), Recruitment (9–12%, standard 10%); new services for the package and Liquidation; Recruitment moves to its card only if still on Manpower.
- Opt-in real-template tests: `tests/pptx_import_real.rs` (`MENA_TEMPLATE_DIR` = a folder of copies) compose seven service mixes and fill fees; results checked in PowerPoint with `spikes/pptx-generator/verify`.

## Proposal generator refinements: price rows, contract term, template study (Sprint 7d)

- **Template study** (scratchpad guide shared with the owner): 12 templates + 39 recent decks compared line by line. Findings that drive the rules: three kinds of "duration" (contract term vs. how long the work takes vs. notice), 16 wordings of the contract term, rows/labels more flexible than the rate card, sentences that repeat prices or conditions, template inconsistencies (bundle 11,500 vs 8,250; Business Setup 8,000 × 12 ≠ 90,000; "15\ employees").
- **Price rows per line** (schema 26: `proposal_lines`/`agreement_lines` gain `rates_json`, `employee_count`, `with_recruitment`; carried onto agreements). `LineRate { label, from, to, price, percent, counts }`. Row kinds from the rate card (`pricing.ts` / `pricing.rs` `row_kind`): tranche (Admin & PRO, Payroll & GOSI — editable limits), category (Workforce), row (Accountancy & VAT presets; "In totals" marks the client's status), percent (Recruitment staff types), country (Mobilization, `perCountry`).
- **Line value**: tranche lines use the confirmed cumulative invoice (band 1 is a minimum; past a band add band price ÷ band upper limit per extra employee) when the employee count is known, else the lowest band as a minimum; Workforce and Recruitment are rates only; rows/countries sum the rows marked "In totals". `unitPrice` stays in step so totals, MRR and reports keep working. Lines created before 7d keep their single price until "Price by tranches/categories…" is clicked.
- **Rate cards** (migration 27 = `migrate_pricing_ranges` again): Accountancy rows and Recruitment staff types as `rows` presets, Business Setup & Maintenance Package (8,000), GM Representative (6,000), Mobilization (per country). Services → Rate cards is now editable (`save_rate_card`).
- **Deck filling** (`feefill.rs`, called from `smartfill::apply`): tranche tables list exactly the proposal's tranches in the template's label style ("Tranche 2 (26–35 employees)"); named rows are matched by words (`names_exactly`, so "Nationalized" never takes "Non-Nationalized"), unused template rows removed, extra rows copy the row above, tables left with no rows removed; Mobilization rows rewrite "KSA Embassy in <country>" and fill "SAR ___"; percentages rewrite "% of the Annual Package". `reflow` moves shapes below a table that grew or shrank. One-word services ("Consultancy") no longer price longer rows ("Optional Auditing and Management Consultancy").
- **Contract term** (`term_sentence`): only contract-length wordings change; process durations, notice periods and "the first 12 months" marketing lines are left alone; Workforce termination examples are recomputed; "Total Annual Cost" becomes "Total Cost (N Months)". Leftover year/12-month sentences are listed under "Check before sending".
- **Sentences**: Accountancy projects minimum follows the Projects row (removed without one); "only for professional staff" removed when Blue Collar is quoted; bundle comparison (table, savings, "fixed monthly fee", "monthly payments of", renewal price) recalculated from the package price with the template's constitution/maintenance figures unless the proposal has those lines; Business Setup under 12 months drops the free-constitution wording and slide, adds "Company Constitution (One Time)" at the rate-card standard and totals term + constitution, with a warning.
- **Automatic slide exclusions** (shown in the preview): Workforce "Only if recruitment required" slides unless the line includes recruitment; the free Business Setup reasoning slide under 12 months.
- **GM Representative template** written into *Proposals New Logo* from a sent GM Representative deck (client name back to the placeholder, clean cover from the Company Maintenance template); `gm_representative` module.

## 2026 proposal design: master deck (Sprint 7e)

- **Master deck** built by `tools/proposal-master` (see its README) from the owner's 2026 redesign (Claude Design, loose shapes, IBM Plex/Saira) into a proper PowerPoint: one slide master with named layouts, Aptos theme fonts, real tables, 15 service modules + shared slides (83 slides), every slide tagged in its notes and every variable written as a `{{field}}`. Saved as `Proposals Templates/MENA BIG Proposal Master 2026.pptx`.
- **Generator** (`master.rs`, `GenerateRequest.fromMaster`): chooses slides by tags (`[always]`, `[module]`, `[when: recruitment|term12|term_short]`), removes the rest, repeats `{{row.*}}` table rows per priced row (tranches as "Tranche N · from–to employees"), fills proposal, term, page, package and note fields, drops paragraphs whose only content is an empty field, and reflows shapes below tables that grew. Unfilled fields are reported. No wording is recognised — the fragile rules of Sprint 7/7d stay only for the current design.
- **Generate dialog**: "Design" offers "2026 design — MENA BIG Proposal Master" (default when the file exists) and "Current design — built from your service templates", plus any saved templates.
- The 2026 design has no client-logo box yet; a chosen logo gives a warning.

## Lists, ActiveCampaign, list columns (Lists & ActiveCampaign sprint)

- **Saved lists** (schema 28, `lists.rs`): `saved_lists` (name, `entity` company|contact, `filters_json`, sync columns) and `company_list_members` (cascades when a list or company is deleted; members follow a company merge). A list with filters is a **smart list**: the app works out its members from the saved filters each time. Hand-picked company lists keep members by company id. Hand-picked contact lists stay in `contact_list_defs`/`contact_list_members` by name; smart contact lists are `saved_lists` rows. Names are unique per module, ignoring case, and a smart contact list can't share a contact list's name. Commands: `get_saved_lists`, `save_saved_list`, `delete_saved_list`, `set_saved_list_companies`.
- **Companies**: a Lists bar under the filters (open a list, "…" menu: show their contacts, export, rename, use the current filters, delete), "+ New list" (hand-picked, from the selection, or smart from the filters), "Save these filters as a smart list". Bulk bar: Add to list, Remove from the open list, Export contacts. Right-click and the company page's More menu add a company to a list; Key facts show its lists. `matchingCompanyNames(filters)` is the one filter predicate for the list and smart lists.
- **Contacts**: the Lists bar shows contact lists (drop targets as before), smart lists and company lists (a company list shows the contacts at its companies, filter value `company:<id>`). Bulk bar: Add to list, Remove from the open list, Export to ActiveCampaign. "Manage lists" shows all three kinds; contact lists can be renamed.
- **ActiveCampaign export** (`core/lists.ts`): from a selection, the current view, any list's menu, or companies. One row per email address (duplicates merged with all their tags; rows without an email left out, and the confirmation says how many). Columns: Email, First Name, Last Name, Phone, Job Title, Organization, Industry, Account Owner, Country, Relationship, Tags. Tags: contact lists, company lists, the contact's services, the company's relationship, and the list exported from; comma-separated, with commas removed from tag names.
- **List columns** (`lib/tableColumns.ts`): sortable headers and a Columns picker, both remembered per device. Companies default: Company (industry underneath), Relationship, Services (on retainer highlighted, proposed quiet), MRR, Agreement ends (amber within 90 days, red within 30), Open deals (open opportunities and proposals), Contacts, Last activity (latest proposal, agreement, meeting, email, opportunity or project date); optional: Owner, Location, Website, Lists, Proposals, Agreements, Latest proposal, First proposal. Default sort: relationship. Contacts default: Name (role underneath), Company (relationship underneath), Email, Services, Lists, Last in touch (latest meeting or email with that address); optional: Phone, Industry. Call and WhatsApp buttons appear in the row when there's a number. Grid cards show the relationship instead of the latest proposal status.

## Foundation Lock

Full audit: `docs/foundation-lock-audit.md`.

- **Company identity, final closure**: an ambiguous name (several companies at the same match strength) keeps an existing link or goes to the company review queue unlinked — never a guess or a new company; former names are kept when a new company takes that name; company notes are stored against `company_id` (schema 30). See `docs/foundation-lock-audit.md`, Final closure.
- **Company identity** (`opportunities.rs`, second pass): IDs identify companies, names are attributes. `company_for_save`: an existing record whose company text is unchanged keeps its `company_id`; a new record keeps a `company_id` it arrives with; only edited text is resolved (also by a unique legal name). Text that disagrees with the link is reported by the integrity report, never silently re-pointed; look-alike names are listed by `possible_duplicate_companies`, never merged. Outlook meetings' title/date/attendees are not written by `save_meeting`. Earlier rule, still used for edited text — the current link if the text is that company's name or a former name, then exact name, same name ignoring capitals, a former name (`company_aliases`, schema 29, written by rename, merge and the review queue), else a new company. Explicit "New company" ignores former names. Similar names are never joined automatically.
- **Saves**: company notes save per company (`save_company_note`); the legacy name-keyed industries map is gone; folder and contact-list saves are queued. Restores, legacy imports and wipes run in one transaction and apply records by id (`restore_records_in`), so records that stay keep their uuid; they take a `before-*` snapshot first and refuse without one.
- **Migrations**: each step and its version bump run in a savepoint (`db::atomic`); a failure leaves the database at the last complete version. Startup failures (backup or migration) show a native error box (`rfd`) instead of quitting silently.
- **Work graph**: deleting a record removes its `entity_links`; migration 29 removed existing orphans. Outlook meeting and email re-syncs leave unchanged rows untouched.
- **Integrity report** (`integrity.rs`, command `get_integrity_report`): foreign keys, orphan links, unlinked or dangling company links, capital-only duplicate companies, uuids, stale tombstones, duplicate activity, dangling opportunity/agreement links, duplicate Outlook events.
- **Security**: Chart.js bundled (no CDN); `write_text_file`/`read_text_file` replaced by `save_text_file_dialog` (the Rust side shows the dialog); attachment names reduced to a file name; Content Security Policy set with `dangerousDisableAssetCspModification` for scripts/styles (inline handlers need `unsafe-inline`); `withGlobalTauri` off.
- **Tests**: `tests/work_graph.rs` (Phase 2 acceptance scenario), `tests/foundation.rs` (identity, persistence, versions, tombstones, activity, work graph end to end, restore, Outlook re-sync, migration rollback, backups, fake legacy data; opt-in run on a copy of a real database), `src/lib/persistNotes.test.ts`.

## Work Graph and core workflow (Phase 2)

Full notes: `docs/work-graph.md`.

- **Context**: `src/lib/workGraph.ts` holds the pure rules — what a record created from a company, opportunity, project, meeting or note inherits (`contextFrom*`, `taskFields`), when a context's `company_id` is sent (`companyFromForm`: only while the field still shows that company), when a missing company is inherited (`inheritCompany`, never replacing one), link merging (`replaceLinks`, `addLinks`), action items and derived relationships (`projectChain`, `proposalProject`, `opportunityTasks`).
- **Creation**: meetings from projects and opportunities, tasks from projects, opportunities, meetings and notes, notes from meetings (`openMeetingNote`), action items → tasks (`createTasksFromNoteActionItems`, linked task → note). Dialogs take a context and stay editable. `src/core/contextActions.ts` is the one list of create actions for the open record, used by "+ New" and the palette.
- **Schema 31**: `todos.opportunity_id` (SET NULL), task activity carries it; integrity check "tasks whose opportunity belongs to another company".
- **Pages**: opportunity Tasks section; project origin shows opportunity, proposal, agreement and contacts; agreement page shows opportunity and project; task panel shows opportunity, meeting and source note; note connections show opportunity and tasks. Filing meeting notes adds links instead of replacing them and asks before replacing note text it didn't write.

## UX and application coherence (Phase 3)

Conventions: `docs/ux-conventions.md`.

- **Window**: macOS title bar in Overlay style (hidden title, system traffic lights); `mac-window-chrome` class and drag regions (`data-tauri-drag-region`, `#window-drag-strip`) in `main.ts`/`index.html`.
- **Scrolling**: the company picker and context menus no longer close when they scroll themselves (`companySelector.ts`, `contextMenu.ts`); floating lists contain their scroll. Workspaces (Tasks, Notes) own pane scrolling; other pages scroll the document.
- **Creation**: record headers (company, opportunity, project, meeting) have a New menu from `contextActions.ts` — the same list as "+ New" and the palette. Dialog titles and buttons follow "New x / Edit x", "Create x / Save changes".
- **Company fields**: every company field uses the shared picker (all matches, keyboard navigation); the old `<datalist>` suggestions are gone.
- **States**: `loadInto`/`loadFailedState` (`lib/ui.ts`) for list loads; dialogs restore focus on close; global `:focus-visible` style.
- **Status and lists**: `lib/statusTone.ts` gives every status one colour meaning for badges; Meetings list has a filter/search toolbar; empty opportunity-board stages collapse; muted text colours meet contrast targets.
- **Fixes**: `daysSince`/`daysUntil` count calendar days (today was -1 before or after midday); one lifecycle badge on opportunities; Company 360 tiles show meetings and open tasks.

## Tests

- `npm test`: Vitest (`src/**/*.test.ts`), covering the company picker (scrolling, keyboard), day counts, change tracking, company matching, agreement references, the task quick-add parser, drag-and-drop reordering, and commercial rules (line totals, MRR, currencies, file names).
- `cargo test` in `src-tauri`: migration engine, per-record saves and sync columns, backups, the activity triggers and company rename, commercial lines, agreement creation and the legacy clean-up, Graph parsing. `rehearse_migrations_on_database_copy` is opt-in (`MENA_REHEARSAL_DB=<copy> cargo test -- --ignored rehearse`) and refuses paths under Application Support.
- `.github/workflows/ci.yml` runs both on macOS and Windows and builds the Windows installer. It is inactive until the repository is on GitHub.

## Security

- The frontend never touches the filesystem or the database directly. All of it goes through named Tauri commands in `src-tauri/src/commands.rs`, which validate/deserialize with `serde` before touching SQLite.
- File writes (backups, CSV exports) take a path *chosen by the user via a native dialog* and a content string — the Rust command does the actual `std::fs::write`, so the frontend is never granted a filesystem-access permission scope at all (no `tauri-plugin-fs`).
- `rusqlite` uses parameterized queries throughout — no string-concatenated SQL anywhere.
