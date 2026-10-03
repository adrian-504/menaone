# Data classification: shared, personal, or device-only

**Status: the owner answered the open questions on 3 October 2026 (see "The owner's answers"); drafted 17 September 2026.** Answers audit question Q5 (`docs/system-audit/ARCHITECTURE_DECISIONS_REQUIRED.md`). Nothing in the app enforces this yet; it decides what the shared version shares, keeps private, or never uploads. The plan it feeds is `docs/shared-version-plan.md`: in path A (one user) everything below except "Device" simply follows him; the split between shared and personal starts to matter in path B, when colleagues join.

Decisions it builds on: MENA BIG only (Q1); read offline, edit online (Q2); everyone sees all company records, personal tasks and notes stay private (Q8).

## The four kinds

| Kind | Meaning in the shared version |
|---|---|
| **Shared** | Company knowledge. Every MENA BIG user sees and edits it. |
| **Shared by relevance** | Seen by the people it concerns, not by everyone: who took part, and the departments that serve that client. From path B on. |
| **Personal** | Belongs to one person. Only they see it; it follows them across their own devices. |
| **Device** | Belongs to one laptop or phone. Never uploaded. |
| **Derived** | Rebuilt from other data. Not stored centrally as its own truth. |

## Tables

### Shared — company knowledge

| Table | Holds |
|---|---|
| `companies`, `company_aliases`, `company_industries` | Client companies, their names and industries |
| `company_note_entries`, `company_notes` | Company notes. **Every note shows who added it and when** (owner, 3 October 2026) |
| `company_list_members`, `contact_list_defs`, `contact_list_members` | Company and contact lists |
| `contacts` | Client contacts |
| `opportunities`, `opportunity_activity` | Pipeline |
| `projects`, `project_milestones`, `project_activity` | Delivery |
| `proposals`, `proposal_lines`, `proposal_documents`, `proposal_activity_notes` | Proposals and their versions |
| `agreements`, `agreement_lines` | Signed agreements and services on retainer |
| `services`, `rate_cards`, `business_entities`, `proposal_templates` | Catalogue, pricing, KSA/Europe entities, templates |
| `team_members` | The user list itself |
| `documents` | Links to client files |
| `intelligence_items` | Watch: regulatory and market news |
| `company_review_queue` | Company name matches waiting for review |
| `entity_links`, `entity_tags` | Links and tags between records (follow the records they join) |
| `activity` | Who changed what, on shared records |

### Shared by relevance

| Table | Holds | Who sees it |
|---|---|---|
| `meetings` linked to a client | A client meeting: agenda, decisions, follow-ups | The people who were in it, and the departments that serve that client |

### Personal — one person's

| Table | Holds | Why personal |
|---|---|---|
| `todos`, `areas` | Tasks and task areas | Owner decision Q8. A task has an owner, and can be assigned to a colleague or shared with one (3 October 2026) |
| `meetings` not linked to a client | Calendar events | Someone's own calendar |
| `notes`, `note_folders`, `note_links`, `note_attachments`, `note_templates` | Notes | Owner decision Q8 |
| `inbox_items` | Quick captures | Someone's own jottings |
| `emails`, `email_completed_log` | Flagged Outlook mail | Comes from one person's mailbox |
| `microsoft_account` | Connection status | One person's sign-in |
| `saved_lists` | Saved filters and views | A way of looking, not company data |

### Device — never uploaded

| Table / data | Holds |
|---|---|
| `microsoft_files` | Cache of local OneDrive paths on this laptop |
| `app_meta` (most keys) | View state, snoozes, pins, current user, migration flags |
| The refresh token in Keychain | Microsoft sign-in |
| Automatic backups | Copies of this device's database |

### Derived — rebuilt, not stored centrally

| Table | Rebuilt from |
|---|---|
| `search_index` (and its FTS tables) | The records it indexes |
| `sync_tombstones` | Deletions; becomes the sync server's job |

## The owner's answers (3 October 2026)

1. **Meetings: shared by relevance, not with everyone.** His words: "it depends on what department the teammate works in and if its relevant for them to know or if they're included in the call". So a meeting linked to a client is seen by the people who were in it and by the departments that serve that client; a calendar event with no client stays personal.
   - This makes **"relevant department"** something the shared version needs from path B on: a department for each user, and which departments serve a client. Neither exists today. Which departments serve a client could be read from its agreements and their services; that is a later decision.
   - Today a meeting records its attendees as names and email addresses from Outlook, not as team members. "Who was in it" needs those matched to the team directory.
2. **Tasks: personal by default; "you can delegate or share tasks".** A task has an owner and can be assigned to a colleague or shared with one.
   - Today a task has an owner (a name, and the team member it matches). It has no "assigned to" apart from that and no "shared with". Both are needed from path B on.
3. **Notes.** Company notes are shared, "specifying what user added a note": every company note shows its author and its date. Notes in the Notes module stay personal, including those linked to a client.
   - Today a dated company note has its date and no author. The older one-text-per-company notes (108 of them) have neither. An author column is needed before colleagues join; the notes that exist would show as his.
4. **Flagged emails linked to a company: personal.** The email lives in one mailbox.

## Still open

5. **Proposal templates.** The template list is shared, but each template's `path` points at a file on one laptop. That's decided by Q6 (OneDrive vs SharePoint), not here.

## Not decided here

- Where shared data is stored (Q4 — waiting on legal advice).
- Roles or restricted records beyond the answers above (Q8: everyone sees company records; meetings go by relevance).
- What a department is, and which departments serve a client (needed from path B; see answer 1).
- Files: OneDrive vs SharePoint and how they're referenced (Q6).
