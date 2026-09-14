# Sync architecture: recommendation (Sprint 0 spike)

**Recommendation: build a small custom sync layer in Rust.** Each device keeps
its local SQLite database. It pushes changes to a Rust API (axum) in front of
managed PostgreSQL in the company's Azure tenant, and pulls everyone else's
changes back. Decide on an off-the-shelf sync service only if the checks in
"When to revisit" fail.

Status: recommendation for the owner; build scheduled for Sprint 5. Hosting
region (D1), tenant and billing (D2) are still open and do not change this design.

## Constraints

- **Local data layer is Rust + rusqlite** (`src-tauri/src`). The frontend never
  touches SQL; everything goes through `src/lib/db.ts` → Tauri commands.
- **Offline matters.** Laptops are used while travelling, and the app must stay
  instant.
- **Small team.** 3 users now, 5–6 later, ~20 synced tables, a few thousand rows.
  Throughput is not a concern; correctness and ease of operation are.
- **Microsoft world.** Sign-in with Entra ID, data residency (PDPL), Graph for
  mail, calendar and files. The server must live where the owner decides (D1).
- **Server-side rules.** Agreement reference numbers, agreement creation from
  proposals, permissions and the audit log must be decided in one place, not on
  each device.
- **Later: phone and iPad companion** on the same data.

## Options considered

| Option | Fit | Main concern |
|---|---|---|
| **A. Custom Rust sync (recommended)** | Reuses the rusqlite layer and the sync columns already added. One language end to end. Server rules, permissions and audit live in our API. | We own conflict handling and must test it well. |
| B. Hosted or self-hosted sync service (e.g. PowerSync) | Mature replication from Postgres to SQLite. | Clients write through their own SQLite wrapper, so the rusqlite command layer would need re-plumbing or a bridge. Writes still go through our own API for rules and permissions, so we'd build most of A anyway. Adds a service to run and pay for, and hosting-region questions for it too. **Verify its current Rust or Tauri support before ruling it in.** |
| C. Postgres-to-client replication (e.g. ElectricSQL) | Good read-path sync. | Same client-integration and write-path concerns as B. The product has changed direction in the past; check its current state. |
| D. CRDT SQLite (cr-sqlite and similar) | Automatic merge. | Every device can write everything, so permissions and server-side rules (reference numbers) don't fit naturally. Project maturity varies. |
| E. Embedded replicas (Turso/libSQL) | Simple replication. | Designed for a replica of one primary. Offline writes and hosting in the company tenant are the weak points. |
| F. Always online (no local copy) | Least to build (~1 week less). | No offline use; slower UI; the phone app is harder later. |

Ruled out in all cases: putting the SQLite file on OneDrive or SharePoint. File
sync corrupts live databases and gives no conflict handling.

## Design (option A)

### Identity
- Every synced row has a `uuid`, which is its global identity. Added in Sprint 0
  (schema v17) and backfilled.
- The local integer `id` stays device-local, so the hundreds of
  `onclick="fn(12)"` handlers keep working. Foreign keys travel as uuids and are
  mapped to local ids when a change is applied.
- New rows can still be created offline, since they get a uuid immediately.
- Values that must be unique across the company, such as agreement references
  (`next_agreement_ref`), are assigned or confirmed by the server on push.

### Change tracking (already in place)
- `row_version`: bumped by a trigger on every real change. Unchanged saves don't
  bump it, because upserts use `WHERE col IS NOT excluded.col`.
- `row_updated_at`: millisecond timestamp.
- `sync_tombstones`: a trigger records `(table, uuid, deleted_at)` on delete, so
  deletions can sync. This replaces a `deleted_at` column on every table
  (decision made in Sprint 0).
- Per-record upserts and deletes (Sprint 0) mean a save only touches what
  changed, the precondition for merging edits from several people.

### Outbox (build in Sprint 5)
The outbox is designed now and built once a server exists to drain it.
- Table: `sync_outbox(seq, table_name, row_uuid, op, changed_fields_json, base_version, created_at, attempts, last_error)`.
- Written in the same transaction as the change, by the Rust upsert and delete
  functions (not by triggers), so it can record *which fields* changed and the
  `row_version` the edit started from.
- Consecutive edits to the same row before a push are coalesced into one entry.

### Push
- `POST /sync/push` with a batch of outbox entries.
- For each entry the server checks the user's permission, then:
  - **Base version matches the server:** apply and bump the version.
  - **Version is stale, different fields changed:** merge both edits. Two people
    editing different fields of the same proposal both keep their changes.
  - **Version is stale, same field changed:** the server's value wins (the change
    already there), and the client shows "Alex changed Status from X to Y".
    Field-level last-writer-wins with a visible notice is simple to explain and
    enough for a 3–6 person team.
  - **Deleted on the server:** the edit is rejected with a "was deleted" notice,
    unless the owner prefers restore-on-edit.
- Every applied change is written to the audit log (who, what, when, before and
  after).

### Pull
- `GET /sync/changes?since=<server_seq>` returns rows and tombstones changed
  since the device's last pull, in server sequence order, paged.
- It runs on a timer, on window focus and right after a push. Updates later
  arrive over a websocket, with the timer as the fallback.
- Changes are applied inside one local transaction per page, which also updates
  the frontend's in-memory state through the change bus from Sprint 1.

### Server
- Rust (axum + sqlx) with PostgreSQL holding the same tables plus `users`,
  `roles`, `user_modules`, `audit_log` and `server_seq`.
- Entra ID sign-in; the API validates Microsoft tokens.
- Jobs that run only on the server: Microsoft Graph sync, PowerPoint generation
  (see `spikes/pptx-generator`), imports, reference numbering.

### Migration of the existing data
1. Upload Ahmad's local database (uuids already assigned) to Postgres.
2. Run a reconciliation report: row counts, fee totals, orphaned links.
3. Rehearse at least three times on copies.
4. Keep a rollback copy for 30 days.
5. Other devices start empty and pull.

## Testing plan
- Simulated devices in Rust tests: two or three local databases against a test
  Postgres, with scripted edits, offline periods and reconnection. Assert that
  all devices end up identical.
- Specific cases:
  - Same-field conflict.
  - Edit versus delete.
  - Create offline on two devices.
  - Reference-number collision.
  - A foreign key to a row that hasn't arrived yet.
  - A partial push followed by a network drop.

## When to revisit
Reconsider an off-the-shelf service (B or C) if either of these is true:
- A two-week spike of push, pull and the simulated-device tests is not converging.
- The owner wants the phone app before the desktop sync is stable.

## Estimate
About 2–2.5 weeks inside Sprint 5 (server, client sync, sign-in, data migration),
matching the roadmap.
