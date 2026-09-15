# Product audit

Audited commit `4975b1c` (2026-09-15). Classifications: **COMPLETE**, **PARTIALLY COMPLETE**, **WEAK**, **BROKEN**, **NOT NEEDED**, **FUTURE**.

## How the product is actually used

This is the live database profile, taken from a read-only copy of the installed app's database at schema 31:

| Area | Rows | Reading |
|---|---:|---|
| proposals / proposal_lines | 252 / 249 | Heavy, real use. The core of the product today. |
| companies / contacts | 167 / 100 | Real use. Every row is linked by `company_id`. |
| agreements / agreement_lines | 106 / 103 | Real use. |
| emails (flagged Outlook cache) | 225 | Real use (Action Required). |
| microsoft_files / entity_links msfile→company | 163 / 159 | Real use (company folders). |
| intelligence_items | 64 | Used. |
| opportunities / projects / meetings / notes / todos | 11 / 9 / 14 / 4 / 10 | Light. The Work Graph was finished days ago; adoption isn't proven yet. |
| proposal_documents | 3 | The Phase 4 flow has only just shipped. |
| documents, areas, project_milestones, note_links, entity_tags, saved_lists | 0 | Unused. |

**The honest summary.** MENA One is in production use as a proposal, agreement and client tracker with Outlook follow-up. The broader workspace (Work Graph, notes, tasks, projects) is built and tested, but has no usage history yet.

## Area classifications

| Area | Class | Evidence and notes |
|---|---|---|
| My Day | COMPLETE | `src/tabs/myday.ts` and `src/lib/myday.ts` (ranked attention list, timeline, snooze), with `myday.test.ts`. Snooze state lives in `app_meta.myday_snoozed`, which is per-user state stored in the shared DB. |
| Companies / Company 360 | COMPLETE | `src/tabs/companies.ts` (1,465 lines): sections, relationship tiles, key facts, activity and aliases. Identity is by id everywhere. |
| Contacts | COMPLETE | `src/core/contacts.ts`, `src/tabs/contactPage.ts`. Contact lists are **name-keyed** (`contact_list_defs.name`, `contact_list_members.list_name`) and unused (0 rows). |
| Opportunities | COMPLETE | `src/tabs/opportunities.ts`: board, list, detail, stage log, Tasks, Files. Its **owner field is still free text** (`opportunities.owner`). |
| Projects | COMPLETE | `src/tabs/projects.ts`: detail, origin chain, milestones. Milestones and areas are unused. |
| Tasks | COMPLETE | `src/tabs/todo.ts`: smart lists, quick-add parser, detail panel, recurrence. |
| Notes | COMPLETE | `src/tabs/notes.ts`: CodeMirror markdown, wikilinks, action items to tasks. Attachments are stored on the local disk (`attachments.rs`). |
| Meetings | COMPLETE | Manual and Outlook meetings in one `meetings` table. Company, project, opportunity and note links. Attendee to contact is **matched when read, not stored** (`meetingClient.ts`). |
| Proposals | COMPLETE | Builder, proposal page, lines, review step and statuses (`proposalPage.ts`, `core/proposals.ts`). Legacy columns remain: `date_sent_to_hassan`, `hubspot`, `finance`, and free-text `owner` (14 rows have owner text with no `owner_id`). |
| Agreements | PARTIALLY COMPLETE | Page, lines, service status, dates. Agreements are auto-created from won proposals on **every app start** (`main.ts:213` → `sync_agreements_from_proposals`). That is locally idempotent, but a multi-device hazard (see CLOUD_READINESS). `agreements.proposal_id` has **no foreign key**. There is no direct agreement↔project link; it's derived via proposal→opportunity→project. |
| Services / Rate cards | COMPLETE | `commercial.rs`, `pricing.rs`, `src/tabs/pricing.ts`, `settingsCommercial.ts`; 22 services and 14 rate cards. |
| Microsoft Files | PARTIALLY COMPLETE | `localfiles.rs` reads the **locally synced OneDrive folder** through the filesystem, not Graph. Links store **absolute macOS paths** (`microsoft_files.path`). Works on this Mac only. |
| Intelligence (Watch) | COMPLETE for scope | `intel.rs`: RSS/Atom feeds via `feed-rs`, deduplication, manual items. Feed sources are hard-coded (`intel.rs:202`). |
| Search | COMPLETE | FTS5 `search_index` (`v2_search.rs`), rebuilt in full at every startup (`lib.rs:217`), and the palette search in `commandPalette.ts`. |
| Activity | COMPLETE for single user | Written by SQLite triggers (`activity.rs`, 18 `act_*` triggers). **`actor` is always NULL** (0 of 96 rows), because there is no user. |
| Command palette | COMPLETE | Records, recents, navigation, context actions (`core/commandPalette.ts`, `core/contextActions.ts`). |
| Contextual +New | COMPLETE | One list in `core/contextActions.ts` feeds the header New menu, sidebar +New and the palette. |
| Proposal generation | COMPLETE | `generator.rs`, `pptx.rs`, `smartfill.rs`, `feefill.rs`, `master.rs`, `proposal_library.rs`: 2026 master, service-template composition, smart fill. |
| Document generation / versions | COMPLETE | Phase 4: `generate_proposal` records versions transactionally; version history on the proposal page. |
| Action Required (flagged mail) | COMPLETE for single user | `ms365_sync_flagged_emails`: a full resync of the flagged set, complete/unflag written back. |
| Calendar | PARTIALLY COMPLETE | Creating, updating and cancelling Teams meetings works. The sync **upserts only**, so an event deleted in Outlook (not cancelled) stays in MENA One. `$top=250` with no paging (`graph.rs:263`). |
| Inbox / Quick Capture | COMPLETE | A global shortcut window (`capture.ts`, `lib.rs` global-shortcut). |
| Clean-up | COMPLETE | `src/lib/cleanup.ts`, `src/tabs/cleanup.ts` (data-quality queue). |
| Reminders / notifications | COMPLETE | `src/tabs/reminders.ts`. The sent log is in `app_meta.reminders_sent`. |
| Dashboard / Reports / Analytics | WEAK (deliberately) | Kept by owner decision (see memory). They wait on the sales-report import and still carry one-off styling. |
| Documents module (`documents` table) | NOT NEEDED | `get_documents`, `save_document` and `delete_document` are registered IPC commands, but **no frontend code calls them**. 0 rows. |
| Areas | NOT NEEDED (today) | `get_areas` is read by Tasks; `save_area` has no callers; 0 rows. |
| Users / roles / permissions | FUTURE | There is no users table and no roles. `team_members` is a directory (7 rows) with an email per person. |
| Sales report import, renewals | FUTURE | On the roadmap; blocked on the owner's Excel file. |

## Is a genuinely important product capability missing?

**For the current single-user product: no.** The end-to-end workflow is covered (see the next section).

Gaps that matter for the *next* stage, and are not conventional-CRM wish-list items:

1. **A notion of "who"**: user identity for `activity.actor`, owners, reviewers and task assignees. Today it's free text or a team directory with no link to a login.
2. **Deletion propagation from Outlook** (calendar). This is a correctness gap, not a feature.
3. **Portable file references.** Absolute paths make every file link machine-specific.

Nothing else rises above "nice to have".

## Workflow completeness test

The scenario, run in the Phase 2 and Phase 4 acceptance tests and in the browser preview: *Contoso Logistics → contact → opportunity "Saudization" → proposal from the opportunity → Won → project from the opportunity → kickoff meeting from the project → meeting note → action item → task → complete → Company 360 → generate proposal V1/V2*.

| Step | Usable? | Duplication or broken context? |
|---|---|---|
| Company | Yes | None. The picker resolves by id; an ambiguous name goes to the review queue. |
| Contact | Yes | None. The company id is carried from the company page. |
| Opportunity | Yes | None. |
| Proposal | Yes | The company name is re-typed into `proposals.client` (text kept as a display copy). No user action is duplicated. |
| Won → Agreement | Partly | The agreement appears on the next app start (auto-sync), not at the moment the proposal is won. |
| Project | Yes | "Create Project" from a Won opportunity keeps company and opportunity. |
| Meeting / Note / Task | Yes | Context is inherited; action items convert to tasks. |
| Activity | Yes | One trigger-written table; no actor. |
| Files | Partly | Company and project folder links and proposal documents work, but only on this Mac (absolute paths). |
| Company 360 | Yes | Everything is visible by id. |

**Verdict:** the workflow is usable end to end without re-entering data. The rough edges are agreement creation timing and machine-bound files.
