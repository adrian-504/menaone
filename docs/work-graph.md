# Work Graph and core workflow (Phase 2)

How MENA One's records connect, how new work inherits context, and what was checked. Examples use fictional names.

## 1. Gap map (audit before implementation)

| # | Item | Before | Now |
|---|---|---|---|
| 1 | Company 360 sections (contacts, opportunities, proposals, projects, agreements, meetings, notes, tasks, files, activity) | COMPLETE | unchanged |
| 2 | Every record → company by `company_id` (names are attributes) | COMPLETE (Foundation Lock) | unchanged |
| 3 | Contact ↔ company | COMPLETE | new contact from a company page carries the company id |
| 4 | Contact ↔ opportunity (`entity_links`) | COMPLETE | unchanged |
| 5 | Opportunity → proposal inherits company and opportunity | PARTIAL (company by name) | company id carried |
| 6 | Won → explicit "Create Project" | COMPLETE (company by name) | company id carried; returns through the router |
| 7 | Proposal → agreement | COMPLETE | unchanged |
| 8 | Proposal / agreement → project shown | PARTIAL (proposal only) | agreement page shows opportunity and project |
| 9 | Project origin: opportunity, proposal, agreement, contacts | PARTIAL (opportunity only) | full chain |
| 10 | Project ↔ meetings; new meeting from a project | PARTIAL (no create) | "+ New" inherits company and project |
| 11 | Opportunity ↔ meetings; new meeting from an opportunity | PARTIAL (no create) | "+ New" inherits company and opportunity |
| 12 | Task from a project inherits the company | BROKEN (project only) | company id and project |
| 13 | Task ↔ opportunity | MISSING | `todos.opportunity_id` (schema 31), Tasks section on the opportunity, picker in the task panel |
| 14 | Task from a meeting inherits company, project, opportunity, meeting | PARTIAL (no company id / opportunity) | all four |
| 15 | Meeting → note inherits meeting, project, company, opportunity | PARTIAL (no opportunity link; links overwritten) | links added, never replaced; company id |
| 16 | Note project picker keeps the note's other links | BROKEN (wiped the opportunity link) | replaces only the project link |
| 17 | Note action item → task | MISSING | "Create tasks from action items" |
| 18 | Task panel: opportunity, meeting, source note | PARTIAL (meeting only) | all three, as links |
| 19 | Task completion activity | COMPLETE | now carries the opportunity |
| 20 | Activity as business memory | PARTIAL (no "meeting held" event) | unchanged — see §6 |
| 21 | Files as contextual references | COMPLETE | unchanged |
| 22 | Context-aware "+ New" and palette actions | PARTIAL (company and project task only) | one shared list for every record kind |
| 23 | Bidirectional navigation through the router | PARTIAL (new opportunity, meeting note, new notes opened outside the router) | all through `openRecord` |
| 24 | Search and palette discoverability | COMPLETE | context actions added |
| 25 | Integrity checks for the new relationship | MISSING | "tasks whose opportunity belongs to another company" |

## 2. Relationships (sources of truth)

| Relationship | Stored in |
|---|---|
| Record → company | `company_id` (text column is display only) |
| Opportunity → proposal / project | `opportunities.proposal_id` / `project_id` |
| Proposal → agreement | `agreements.proposal_id` |
| Meeting → project / opportunity / note | `meetings.project_id` / `opportunity_id` / `note_id` |
| Task → project / meeting / opportunity | `todos.project_id` / `meeting_id` / `opportunity_id` |
| Task → note (came from) | `entity_links` task → note |
| Note → project / opportunity | `entity_links` note → project / opportunity |
| Contact → opportunity | `entity_links` contact → opportunity |
| Commitment → company / opportunity / project | `commitments.company_id` / `opportunity_id` / `project_id` |
| Commitment → where it came from | `commitments.source_type` + `source_id` (meeting, note; capture and manual have none) |
| Commitment → its task (ours only) | `commitments.todo_id` |
| Commitment → person | `commitments.contact_id` (who promised it, or who we promised it to) |
| Opportunity → who it waits on | `opportunities.waiting_on` (`us` / `them`), `waiting_since`, `waiting_note` |

Derived, not stored: a proposal's waiting state (`proposalWaitingOn(status)`: sent → them; request, drafting, review, signed by the client → us; finished → nobody), a suggested "waiting on them" from the client's oldest open promise (`waitingFromCommitments`), a project's proposal and agreement (through its opportunity), a proposal's project, an opportunity's tasks (direct or from its meetings), a note's tasks (linked, or from its meeting). All in `src/lib/workGraph.ts`.

## 3. Context rules (`src/lib/workGraph.ts`)

Context is a default, never a lock: dialogs are prefilled and every field can be changed.

| Created from | Inherits |
|---|---|
| Company | company |
| Opportunity | company, opportunity |
| Project | company, project (its opportunity stays reachable through the project's origin) |
| Meeting | company, project, opportunity, meeting |
| Note | company (or its meeting's), linked project and opportunity, its meeting; the task is linked back to the note |

- `companyFromForm`: the context's `company_id` is sent only while the company field still shows that company's name (ignoring capitals). Another name is an explicit reassignment, resolved by the backend (`company_for_save`); an empty field clears it.
- `inheritCompany`: a new record with no company takes its project's, then its opportunity's. A set company is never replaced; a company the dialog offered and the person removed stays removed; editing an existing meeting never re-fills it.
- Changing a task's project or opportunity fills its company only when it has none.
- Filing meeting notes adds links to the meeting's project and opportunity and fills the note's company only when empty. It asks before replacing note text it didn't write.
- Action items: unchecked `- [ ]` lines; an item that already has a task with the same title (linked to the note or from its meeting) is skipped, so converting twice creates nothing. A `- [ ] >> …` line is a commitment, not an action item: one commitment, one task.
- Commitments (`src/lib/commitments.ts`, `src-tauri/src/commitments.rs`): a line starting `>>` (we owe it) or `<<` (the client owes it), after optional list or checkbox markers, inherits the context of where it was written — a meeting: company, opportunity, project, meeting; a note: as for tasks from the note; quick capture: the "@Company" or company named in the text. Lines are read when the text box loses focus, never mid-typing. The same line read again creates nothing (source + normalised text); an edited line is a new commitment and the old one stays open; removing a line never deletes one. An `ours` commitment gets one task with the same context; done ⇄ kept, reopened ⇄ open and the due date move together (triggers in the database, the same in memory). Deleting the task leaves the commitment open; deleting its opportunity, project, meeting, note, contact or company unlinks it.

## 3a. The engagement thread and record timeline (Slice 3)

- `engagementThread(record, data, today)` in `workGraph.ts` (pure, `engagementThread.test.ts`): opportunity → proposal → agreement(s) → project, from the ids already loaded (`Opportunity.proposalId / projectId`, `Agreement.proposalId`). The thread starts at the first record that exists — a proposal with no opportunity starts at the proposal, with no empty step in front; only later steps that are missing show as "Not yet". The project step is offered only when there is an opportunity (a project links through one). Several agreements show as one node — the active one, else the newest — with "+N" listing the others. Each node has one date (created, sent, signed, started); gaps are days between them, and the gap after the last node is how long it has waited and on whom (proposal: `proposalWaitingOn`; opportunity: its Waiting on). Late: with the client over 10 days (proposal) or 14 (otherwise), with us over 7. Lost, withdrawn or cancelled is closed: durations only, nothing next.
- `next` is one action and nothing is created without a click: an open opportunity with no proposal → Create proposal (the builder, prefilled); a proposal signed by both with no agreement → Draft agreement (`draft_agreement_for_proposal`, the same rule as the bulk sync, for that one proposal); a won opportunity, or a signed agreement whose opportunity has no project → Create project; a proposal otherwise → its own next step (the page's primary button).
- `buildRecordTimeline(records, input)` in `recordTimeline.ts` (pure, `recordTimeline.test.ts`): the past is the activity log for those records (`get_activity` with `records`: each record, plus rows tagged with an opportunity or project), newest first, deduplicated; the future is meetings, open tasks (direct and via the record's meetings), open commitments (a promise's task shows once, as the promise) and the records' own dates — expected close; proposal follow-up (sent + 11 days, or its snooze) and valid-until; agreement end and renewal notice; project target and open milestones. Overdue first, then soonest; undated in "No date". "Whole engagement" is the same list over every record in the thread.

## 3b. Company-level derivations (Slice 4)

- `buildCompanyState(input)` in `src/lib/companyBrief.ts` (pure, `companyBrief.test.ts`): the company's records by id, falling back to the name for records never linked. Clauses: relationship (active client from agreements that are active or signed and not ended; since = the earliest signed agreement's start; past client = signed agreements, none current, "Jan 2024 – Mar 2026"; otherwise the first contact date); in flight (`liveThreads`: one per engagement — seeds are open opportunities, live proposals, agreements not yet signed and active projects, deduplicated by the thread's first step, most recently dated first; dormant when nothing on the thread — step dates, the opportunity's last update — is newer than `DORMANT_DAYS` = 120, except an active project; a dormant proposal points at its Clean-up queue); rhythm (a meeting counts as held once its start time has passed; `NEGLECT_DAYS` = 45 for active clients); commitments (open, by company id; late = due before today) and overdue tasks; pinned notes (newest first, three, then "+N pinned"). The notice date is My Day's rule (`agreementRenewal` in `myday.ts`: the end less the notice period).
- People: last contact per person is the latest held meeting whose attendees include their email, or the latest email from them; decision makers first, then by that date.
- The meeting page's Client brief uses `meetingBrief`, whose clauses are exactly `buildCompanyState` for the same data (tested), plus the meeting's own previous meeting, follow-up and suggested agenda.
- The company timeline is `buildRecordTimeline` over every opportunity, proposal, agreement and project of the company with `company` set (also the company's own meetings, tasks and promises), the activity log by company, and proposal and agreement dates from before the log.

## 4. Entry points

- Page sections: project Meetings "+ New"; opportunity Meetings and Tasks "+ New"; notes "Create tasks from action items"; note Connections show Opportunity and Tasks.
- `src/core/contextActions.ts`: one list per open record (company, opportunity, project, meeting, note) feeding the sidebar "+ New" menu and the command palette. It includes "New Commitment" for a company, opportunity, project and meeting; the sidebar "+ New" and ⌘K also offer it without context.
- Commitments: `>>` / `<<` lines in meeting notes and notes, and at the start of My Day's quick add or the Inbox composer; Commitments sections (opportunity, project, meeting, company) with "+ New"; the opportunity's Waiting on control.
- Functions: `createMeetingForProject`, `createMeetingForOpportunity`, `createTodoForOpportunity`, `createTodoForMeeting`, `createTodoForNote`, `openMeetingNote`, `createTasksFromNoteActionItems`, `openTodoModal(null, ctx)`, `openMeetingModal(null, ctx)`, `openOpportunityModal(null, ctx)`, `openContactModal(name, companyId)`.

## 5. Verification

- `src-tauri/tests/work_graph.rs`: the acceptance scenario saved the way the app saves it, with a second company whose name differs only by capitals (anything resolved by name would be ambiguous). Every record keeps the company id; nothing goes to the look-alike or the review queue; the chain survives reopening; Company 360 queries find every record by id; activity has one meeting, note, task-created and task-completed event. Second test: task ↔ opportunity, explicit reassignment moves the task and reports the opportunity mismatch, a stale save never undoes it, rename keeps links, deleting the opportunity unlinks its tasks.
- `src/lib/workGraph.test.ts`: inheritance, explicit reassignment, link preservation, action items, derived relationships.
- `src-tauri/tests/commitments.rs`: a meeting's `>>` and `<<` lines saved the way the app saves them give one commitment each way and one task; re-saving creates nothing; task and commitment move together and the log records it; company merges keep them, deletes unlink them; the JSON backup round-trips them; waiting-on is saved; nothing reaches the look-alike company. `src/lib/commitments.test.ts`, `pipeline.test.ts`, `myday.test.ts`, `persist.test.ts`: parsing, the rules and the in-memory link.
- `src/core/router.test.ts`: Project → Meeting → Note → Task → Company and back; Proposal → Agreement → Project through the thread strip, one history step each.
- Browser preview: the full scenario through the real dialogs and pages (company, contact, opportunity, proposal, won, project, kickoff meeting, meeting note, action item → task, complete, Company 360), plus back navigation and the note-replacement prompt.

## 6. Intentionally incomplete

- No "meeting held" activity event (a meeting's date passing isn't an event the app records); meetings log "created".
- Meeting → contact is still matched from attendee emails when read, not stored.
- Files stay path-based references (Foundation Lock §18).
- Converting action items writes one link per created task (bounded by the note's checklist); a batched link command can come with sync.
- Company pages are still keyed by name in `S.currentCompany`; context actions look the id up from that exact name.
