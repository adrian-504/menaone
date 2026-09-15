# Cloud readiness

Audited commit `4975b1c`. **Hypothetical target:** Mac and Windows desktop clients, 5–10 users, company data held centrally, personal data per user, Microsoft 365 sign-in, OneDrive/SharePoint documents, and one of offline / online / hybrid (undecided).

Blocker classes: **BLOCKER** (must be solved before any shared data) / **IMPORTANT** (must be solved before real use) / **MINOR** / **IRRELEVANT**.

## Findings

| # | Issue | Class | Evidence |
|---|---|---|---|
| C1 | **Integer IDs assigned on the device.** Frontend max+1 for proposals, contacts, agreements, todos, notes, lines, documents; AUTOINCREMENT for the rest. Two writers produce the same id for different records. | BLOCKER | `src/lib/utils.ts` `nextId` etc.; `db.rs` |
| C2 | **All relationships are local integers**, including `entity_links` endpoints and `activity.entity_id`. uuids exist on rows but nothing references them. | BLOCKER | DATABASE_AUDIT §4 |
| C3 | **No user identity.** No users table, `activity.actor` NULL, owner free text, one `microsoft_account` row, one keychain item. | BLOCKER | MICROSOFT_AUDIT M8; DATABASE_AUDIT §5 |
| C4 | **Last-write-wins whole-record saves** with no version check (`upsert_*`); child collections replaced wholesale (`save_lines`, `save_documents`, `set_links_from`). A second writer silently overwrites fields and deletes children. | BLOCKER | `commands.rs`, `persist.ts` |
| C5 | **Personal and company data share tables.** `emails` (personal mailbox cache), `meetings` (Outlook calendar sync mixed with project meetings), `app_meta` (personal state beside organisation config). | BLOCKER | DATABASE_AUDIT §2, §6 |
| C6 | **Absolute local file paths** as the file reference (`microsoft_files.path` UNIQUE, `folder_path`, document and template paths). | IMPORTANT (BLOCKER for shared Files) | WINDOWS_READINESS |
| C7 | **Business rules executed by each client at startup:** `syncAgreementsFromProposals` (`main.ts:213`) creates agreements; `next_agreement_ref` takes MAX+1. Several clients would duplicate agreements or references. | IMPORTANT | ARCHITECTURE_AUDIT §3 |
| C8 | **Full dataset loaded into memory at startup** (`get_all_data` → `S`). Fine at 5–10 users' worth of company data (thousands of rows); no pagination anywhere. | MINOR | `main.ts` |
| C9 | **Device clock timestamps** (`created_at` from JS, `row_updated_at` from the SQLite trigger); no server time. | IMPORTANT (for sync ordering) | DATABASE_AUDIT §5 |
| C10 | **Hard deletes;** tombstones exist locally but aren't consumed by anything. | IMPORTANT | `sync_tombstones` (30 rows) |
| C11 | **No authorisation model** (who may see or edit which records; personal notes and tasks vs shared). | IMPORTANT | — |
| C12 | **Attachments on local disk** (`app_data_dir/attachments`). | IMPORTANT | `attachments.rs` |
| C13 | **Per-install Microsoft app registration** (client ID typed in Settings). | MINOR | MICROSOFT_AUDIT M9 |
| C14 | **No crash reporting, no update channel, ad-hoc signing.** | IMPORTANT (operational) | SECURITY_AUDIT S10 |
| C15 | **Data residency / PDPL decision not taken.** | BLOCKER (non-technical) | ARCHITECTURE_DECISIONS_REQUIRED Q4 |
| C16 | **Search** is a local FTS5 index rebuilt at startup. Can be rebuilt from any local replica; not a cloud concern. | IRRELEVANT | `v2_search.rs` |
| C17 | **Frontend `expose()` / inline-handler style.** Doesn't affect where data lives. | IRRELEVANT | — |
| C18 | **Tauri itself.** A valid long-term client shell for Mac and Windows. | IRRELEVANT | — |

## What is already in the app's favour

- A single data seam in the frontend (`src/lib/db.ts`) and a command layer in Rust. Swapping or adding a remote data source doesn't require touching 49 renderers.
- Company identity is by id with an integrity report. Migrations to global identifiers can be rehearsed and checked the same way.
- Sync scaffolding already exists: `uuid`, `row_version`, `row_updated_at` on 30 tables via triggers, plus `sync_tombstones`. It's raw material, not a protocol.
- Newer entities already use single-record saves.
- Backups and pre-change snapshots are routine.

## Verdict

**Cloud readiness: 3 / 10.** There are five technical blockers (C1–C5) and one non-technical blocker (C15). None needs a rewrite. All are data-ownership issues and must be solved **before** choosing a server, a database or a sync engine. That's the point of the recommended next workstream.
