# Sync readiness

Audited commit `4975b1c`. **Stance: skeptical.** The existence of `uuid`, `row_version` and `sync_tombstones` columns doesn't make the application sync-ready.

## What exists

- **Migration 17** (`db.rs:850-890`), on 30 tables:
  - `uuid` (random, set by an insert trigger);
  - `row_version` (incremented by an update trigger whenever the update didn't itself change `row_version`);
  - `row_updated_at` (UTC ms from the SQLite clock).
- **Delete triggers** write `sync_tombstones(table_name, uuid, deleted_at)`.
- **`records_and_sync.rs`** (8 tests, 1 ignored) verifies the triggers fire and tombstones appear.
- **No sync engine:** nothing reads tombstones, nothing exchanges changes, no outbox and no server.

## Assessment

| Question | Answer | Evidence |
|---|---|---|
| Are uuids used consistently? | **No.** Present on 30 tables and absent on 16 (DATABASE_AUDIT §4). **No foreign key or link references a uuid.** The UI and all commands address records by integer id. | `db.rs`, `entity_links` |
| Is `row_version` meaningful? | **Only as a local change counter.** It increments on *any* update, including derived and system updates (agreement auto-sync, activity-driven touches, migrations, `rebuild` steps), so it doesn't mean "user edit". It is per-device, with no causal or global ordering. **No write path checks it** (`upsert_*` doesn't send or compare a version). | migration 17 trigger; `commands.rs` |
| Are tombstones sufficient? | **No.** They record `(table, uuid, time)` only: no device, no user, no version at deletion. There's no retention or compaction. Tables without uuids (e.g. `company_aliases`, `company_notes`, list members) produce none, and child deletes via `save_lines` replace-all produce tombstones for children the user never deleted individually. | triggers; `save_lines` |
| Are timestamps reliable? | **No.** Device clock; `created_at` formats vary (JS local date strings, ISO, trigger ms); no server time or hybrid logical clock. | DATABASE_AUDIT §5 |
| Can records be created offline safely? | **No.** Integer ids collide across devices (C1). | CLOUD_READINESS |
| Can conflicts be detected? | **No.** No base version is carried with edits. | `persist.ts` |
| Can conflicts be resolved? | **No.** Whole-record upserts; child collections replaced; the frontend `S` has no concept of a remote change except manual reload. | `persist.ts`, `commands.rs` |
| Would sync corrupt relationships? | **Yes.** Links are integer ids that mean different records on different devices; `set_links_from` replaces a record's whole link set. | `entity_links` |
| Do startup routines cause duplicate side effects? | **Yes, in a multi-device world.** `syncAgreementsFromProposals` runs on every start on every device (idempotent only against the local DB); `next_agreement_ref` uses MAX; `rebuild_all` / `rebuild_note_links` are local and harmless. | `main.ts:213`, `lib.rs:217-218` |
| Do triggers create sync noise? | **Yes.** Activity triggers write `activity` rows (no uuid) on every change; `row_version` increments on derived updates; migrations touching rows bump versions and timestamps en masse. | `activity.rs`, migration 17 |
| Does the frontend depend on full local loading? | **Yes.** `get_all_data` → `S` at startup; modules read `S` synchronously. | `main.ts` |

## What sync would actually require (for decision-making, not a plan)

1. A global identity per record, used by relationships (uuid) or a reliable mapping layer.
2. A change log or outbox of user intents, not trigger-bumped versions.
3. Base-version checks on writes (optimistic concurrency) and an agreed conflict policy per entity: field-level merge, last-writer-wins with notice, or refuse.
4. Child collections expressed as individual add/remove operations, not replace-all.
5. Server-authoritative time or a hybrid logical clock.
6. Soft deletes (or tombstones with version and actor) and a retention policy.
7. Single-authority business rules (agreement creation, reference numbers) moved out of client startup.
8. A defined boundary between personal data (never synced to others) and shared data.
9. Actor identity on every change.

Items 1, 3, 4, 7, 8 and 9 are also needed for a **purely online multi-user** design. Only 2, 5 and 6 are specific to offline sync. That's why the decision *online vs offline* (ARCHITECTURE_DECISIONS_REQUIRED Q2) need not block the foundation work.

## Verdict

**Sync readiness: 2.5 / 10.** The scaffolding is useful raw material (uuids exist, deletes are observable), but the application's write model, identity model and relationship model are all local-only. **Do not build or adopt a sync engine against the current write model.**
