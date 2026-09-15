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

Derived, not stored: a project's proposal and agreement (through its opportunity), a proposal's project, an opportunity's tasks (direct or from its meetings), a note's tasks (linked, or from its meeting). All in `src/lib/workGraph.ts`.

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
- Action items: unchecked `- [ ]` lines; an item that already has a task with the same title (linked to the note or from its meeting) is skipped, so converting twice creates nothing.

## 4. Entry points

- Page sections: project Meetings "+ New"; opportunity Meetings and Tasks "+ New"; notes "Create tasks from action items"; note Connections show Opportunity and Tasks.
- `src/core/contextActions.ts`: one list per open record (company, opportunity, project, meeting, note) feeding the sidebar "+ New" menu and the command palette.
- Functions: `createMeetingForProject`, `createMeetingForOpportunity`, `createTodoForOpportunity`, `createTodoForMeeting`, `createTodoForNote`, `openMeetingNote`, `createTasksFromNoteActionItems`, `openTodoModal(null, ctx)`, `openMeetingModal(null, ctx)`, `openOpportunityModal(null, ctx)`, `openContactModal(name, companyId)`.

## 5. Verification

- `src-tauri/tests/work_graph.rs`: the acceptance scenario saved the way the app saves it, with a second company whose name differs only by capitals (anything resolved by name would be ambiguous). Every record keeps the company id; nothing goes to the look-alike or the review queue; the chain survives reopening; Company 360 queries find every record by id; activity has one meeting, note, task-created and task-completed event. Second test: task ↔ opportunity, explicit reassignment moves the task and reports the opportunity mismatch, a stale save never undoes it, rename keeps links, deleting the opportunity unlinks its tasks.
- `src/lib/workGraph.test.ts`: inheritance, explicit reassignment, link preservation, action items, derived relationships.
- `src/core/router.test.ts`: Project → Meeting → Note → Task → Company and back.
- Browser preview: the full scenario through the real dialogs and pages (company, contact, opportunity, proposal, won, project, kickoff meeting, meeting note, action item → task, complete, Company 360), plus back navigation and the note-replacement prompt.

## 6. Intentionally incomplete

- No "meeting held" activity event (a meeting's date passing isn't an event the app records); meetings log "created".
- Meeting → contact is still matched from attendee emails when read, not stored.
- Files stay path-based references (Foundation Lock §18).
- Converting action items writes one link per created task (bounded by the note's checklist); a batched link command can come with sync.
- Company pages are still keyed by name in `S.currentCompany`; context actions look the id up from that exact name.
