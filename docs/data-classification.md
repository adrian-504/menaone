# Data classification: shared, personal, or device-only

**Status: draft for the owner's review (17 September 2026).** Answers audit question Q5 (`docs/system-audit/ARCHITECTURE_DECISIONS_REQUIRED.md`). Nothing in the app enforces this yet; it decides what the cloud version shares, keeps private, or never uploads.

Decisions it builds on: MENA BIG only (Q1); read offline, edit online (Q2); everyone sees all company records, personal tasks and notes stay private (Q8).

## The four kinds

| Kind | Meaning in the shared version |
|---|---|
| **Shared** | Company knowledge. Every MENA BIG user sees and edits it. |
| **Personal** | Belongs to one person. Only they see it; it follows them across their own devices. |
| **Device** | Belongs to one laptop or phone. Never uploaded. |
| **Derived** | Rebuilt from other data. Not stored centrally as its own truth. |

## Tables

### Shared — company knowledge

| Table | Holds |
|---|---|
| `companies`, `company_aliases`, `company_industries`, `company_note_entries`, `company_notes` | Client companies, their names, industries and dated notes |
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

### Personal — one person's

| Table | Holds | Why personal |
|---|---|---|
| `todos`, `areas` | Tasks and task areas | Owner decision Q8 |
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

## Decisions needed

1. **Meetings (`meetings`).** Today they're copied from one person's Outlook calendar, but a client meeting's agenda, decisions and follow-ups are team knowledge. Proposed: a meeting linked to a company, opportunity or project is **shared**; an unlinked calendar event stays **personal**.
2. **Tasks on client work.** A task created from a client email or meeting is still personal under Q8. Should a colleague covering an account see open tasks on that client? Proposed: personal by default, with an explicit "share with team" later if asked for.
3. **Company notes vs personal notes.** Company notes (`company_note_entries`) are proposed as shared. Notes in the Notes module linked to a client stay personal. Confirm that split.
4. **Flagged emails linked to a company.** Proposed: personal. The email lives in one mailbox; a colleague can't open it anyway.
5. **Proposal templates.** The template list is shared, but each template's `path` points at a file on one laptop. That's decided by Q6 (OneDrive vs SharePoint), not here.

## Not decided here

- Where shared data is stored (Q4 — waiting on legal advice).
- Roles or restricted records (Q8: everyone sees everything for now).
- Files: OneDrive vs SharePoint and how they're referenced (Q6).
