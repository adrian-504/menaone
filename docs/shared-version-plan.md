# The shared version — plan for path A

**Written 3 October 2026, for the owner's decision. Nothing here is built.** It builds on `docs/sync-architecture.md` (the recommendation: our own small sync layer in Rust) and replaces its estimate and its scope. Every statement about the code in section 1 was checked against the code and the live schema (46) on 3 October 2026, not taken from the older documents.

## The paths

| Path | What it is | Status |
|---|---|---|
| **A. You, everywhere** | Ahmad's own data on a server; his Mac, and later the iPhone, kept in step through it. One user. No colleagues, no department data | **Planning may start** (owner, 3 October: "ok we can possibly start with A") |
| B. Colleagues on sales | The sales records shared with colleagues, each with their own sign-in | Later, on top of A |
| C. One department | A department's own module and data, seen only by those it concerns | Later, on top of B |
| D. Client portal | A client sees its own records | Later, on top of C |

Path A is the smallest step that is still real: it needs the server, the sign-in, and changes moving both ways, but only one person's edits, so almost nothing can conflict and nobody else's work depends on it.

## 1. What the code already has

### In place

| What | State today |
|---|---|
| A global identity on each record | **32 tables** carry a `uuid`, a change counter (`row_version`) and a change time, kept current by database triggers. No record in the live data is without one. The tables: proposals and their lines, documents, revisions and notes; agreements and their lines; companies; contacts; opportunities and their history; projects, milestones and their history; meetings; tasks and areas; notes, their attachments and templates; inbox; promises; follow-up entries; documents; links between records; Watch items; services, rate cards, entities, team, proposal templates; saved lists |
| Deletions are recorded | A trigger writes every deleted record's table, identity and time to `sync_tombstones` (104 so far) |
| A save touches only what changed | The interface sends only the records that changed; the backend writes a record only when a column differs, so an unchanged save does not bump its counter. The parts of a record (a proposal's lines, documents, revisions and notes; a project's milestones) are compared one by one: a line that stays keeps its identity |
| Whole-table replace is gone from the app | The old "delete the table and write it all back" functions are now called only by tests. A backup restore goes record by record and keeps identities |
| One place that announces "these records changed" | The interface has a change bus (`src/lib/changes.ts`), written with remote changes in mind; seven modules use it |
| Who is using the app | A team directory, the signed-in Microsoft account linked to one member by its permanent Microsoft id, owners as ids on companies, opportunities, projects, proposals and tasks, and the actor stamped on the activity log |
| Microsoft sign-in | The app already signs in to MENA BIG's Microsoft 365 with its own app registration (for mail and calendar). The same sign-in can identify the user to our server |
| A daily check | The integrity check already verifies that identities exist and are unique |

### Missing, or would break merging

| # | What | Why it matters |
|---|---|---|
| 1 | **Nothing uses the global identity yet.** Every link between records (a proposal's company, an agreement's proposal, a task's meeting, the links table) is the Mac's own record number | The same number means a different record on another device. The sync layer has to translate numbers to identities on the way out and back on the way in |
| 2 | **New record numbers are made by the interface as "highest so far, plus one"** (proposals, contacts, lines, documents, revisions) | Two devices offline give two different records the same number. **SL# is that number**: a proposal's SL# is its record number on this Mac |
| 3 | **A save does not say which version it started from, and nothing checks it.** A save writes the whole record, every column | A device holding an older copy would overwrite a newer change in a field it never touched. Conflicts cannot be seen, so they cannot be handled |
| 4 | **No outbox.** Nothing records what changed for sending later | The change counter says "something changed", not what or when it was sent |
| 5 | **18 tables have no identity.** The ones that hold his data: company industries (215 rows), the one-text-per-company notes (108), dated company notes (2), former company names, list members, list names, tags, note folders, email templates, the activity log (768), and the settings that are really his data (My Day snoozes, pinned records). The rest are caches or belong to the device | These cannot travel until they have one |
| 6 | **Five small sets are still saved whole:** note folders and contact list names (delete all, write all), a company's industries, a record's tags, a record's outgoing links | Two devices changing the same set would undo each other. Small, but each needs a per-item save |
| 7 | **The change counter counts every update, not only his edits** (one meeting is at version 133 because each Outlook sync rewrites it) | Meetings copied from Outlook on two devices would send each other the same change for ever. Outlook copies must not count as edits |
| 8 | **Applying a change is treated like making one.** The activity log and the promise rules are triggers that fire on every write | A change arriving from the server would be logged again as if he had just made it. A switch to mute the log exists (used by restore); the sync layer must use it |
| 9 | **Agreement references are "highest so far, plus one" on this device** | Two devices drafting agreements offline could give the same reference. One place must decide |
| 10 | **Times come from the device's clock**, in more than one format | "Which change is later" cannot be trusted across devices. The server's order must decide |
| 11 | **File locations are full paths on this Mac** (decks on record, client folders, templates, the proposals folder) | They mean nothing on another device. For path A the phone only needs to know a file exists; a second Mac would need paths relative to OneDrive |
| 12 | **The interface loads everything at start and keeps it in memory** | A change arriving from the server must also replace the copy in memory, or the next save would write the old one back (see 3) |
| 13 | **Restoring a backup file replaces the whole database** | Once a server exists, going back in time on one device needs a rule: the restored device must not push its old state over the server |

The September audit scored sync readiness 2.5 out of 10. Since then, items that were wrong then are right now (per-part saves, restore by record, the change bus, identity). Items 1 to 4 are unchanged: the app's write path is still local-only.

## 2. What path A needs, in build order

Sizes are weeks of build work by a session like this one, with the usual checks. They are rough: the first three items decide how true the rest are.

| # | Work | What it is | Size | Needs the cloud? |
|---|---|---|---|---|
| 1 | Identity that travels | Give the remaining tables that hold his data an identity (item 5 above); a translation layer between record numbers and identities at the edge of the app, so the hundreds of places in the app that use numbers stay as they are | 1 | No |
| 2 | Numbers that are safe on two devices | SL# and agreement references become stored numbers given by one authority, not "highest plus one" on each device. A record made offline shows as new until it has its number | 0.5–1 | No |
| 3 | The outbox | Every save records, in the same step, which record changed, which fields, and the version it started from. Outlook copies and derived updates are kept out | 1–1.5 | No |
| 4 | Per-item saves for the five small sets | Folders, list names, industries, tags, links (item 6) | 0.5 | No |
| 5 | The server, running locally | A small Rust service with its own database (PostgreSQL) holding the same tables, the order in which changes arrived, and a log of every change with who made it | 1.5–2 | No |
| 6 | Push and pull | The Mac sends its outbox and fetches what it has not seen, in the server's order; applies it without logging it as his own edit; refreshes the copy in memory through the change bus | 2 | No |
| 7 | Conflict rules, one user on two devices | Different fields of the same record: both kept. The same field: the later one to reach the server wins and the app says so in one line. Edited on one device, deleted on the other: the deletion wins and the app says so (owner may prefer the edit to win; see section 4) | inside 6 | No |
| 8 | Simulated devices in tests | Two or three databases against a test server: edits, time offline, reconnecting, a push cut half-way. Every device must end identical. This is what proves 3, 6 and 7 | 1 | No |
| 9 | What the Mac app shows | Settings: sync on or off (off by default), signed in as, last synced, changes waiting. A quiet mark when offline, in the place "Last synced" shows today for Outlook. One line when a conflict was settled. A pause switch | 1 | No |
| 10 | First upload and the reconciliation report | Upload his database once; a report compares both sides: counts per table, fee totals, links that point nowhere. Rehearsed at least three times on copies. A rollback copy kept 30 days | 1 | Rehearsals no; the real one yes |
| 11 | Sign-in on the server | The server accepts only a Microsoft sign-in from MENA BIG's tenant, and in path A only Ahmad's account | 0.5–1 | The tenant, not the region |
| 12 | The server in Azure | Deploy to the Saudi region; daily backups with point-in-time restore; a restore drill before real data goes up; a health check that tells him if it is down | 1 | **Yes** |
| 13 | Restore and "this device is behind" rules | What happens after a backup restore or a long time offline (item 13 above) | 0.5 | No |

**About 12 to 14 weeks in all; about 10 to 11 of them need no cloud.** The older estimate of 2 to 2.5 weeks did not count items 1 to 4, which the audit showed are the real work.

**Not in this list:** the iPhone app itself. Path A makes the server the phone will talk to; the phone app is its own project and its own decision (the paused OneDrive phone sync on branch `phone-sync` solved a narrower problem with no server, and would be retired by this). Until there is a second device, path A gives one thing in daily use: his data safe on a server, with history, if the Mac is lost.

**When to stop and reconsider:** if items 3, 6 and 8 are not converging after about four weeks, look again at an off-the-shelf sync service before spending more (as `docs/sync-architecture.md` says).

## 3. What can be built now, and what has to wait

| Can be built and tested now, with no cloud | Has to wait |
|---|---|
| Items 1 to 9 and 13: all on this Mac and in CI, with a server running locally and simulated devices | Item 12: the server in Azure's Saudi region |
| Rehearsals of the first upload, on copies of his database, against the local server | The real first upload: his data leaves the Mac only after the legal brief says where it may be stored |
| The server's own tests against a real PostgreSQL (in CI; on the Mac it would need PostgreSQL installed, which is a download he must approve) | Server backups, the restore drill and the health check: they are settings of the hosted service |
| Registering the server with Microsoft sign-in can be done as soon as the tenant's administrator is known: it does not depend on the region | The monthly cost, known only once the region publishes its prices |

**Azure Saudi Arabia East, as of 3 October 2026:** not open yet. Microsoft confirmed on 31 August 2026 that the region will be available to customers in **November 2026** (three availability zones, in the Eastern Province). It has given no day. It has **not published which services are there on the first day**, so I cannot confirm that the two we need (managed PostgreSQL and a place to run a small container or web app) will be available at launch; that has to be checked when it opens. Source: Microsoft's announcement, <https://news.microsoft.com/source/emea/2026/08/microsoft-announces-saudi-arabia-east-datacenter-region-will-be-available-in-november-2026/>.

Nothing in items 1 to 9 depends on which region or even which provider is chosen: the server is an ordinary Rust service and an ordinary PostgreSQL database.

## 4. What Ahmad must provide or decide

**To provide**

1. **Who administers MENA BIG's Microsoft tenant.** That person creates the Azure subscription inside the company's tenant, lets the server use Microsoft sign-in, and holds the bill. Without them nothing can be hosted under MENA BIG's name.
2. **The legal brief on where data may be stored.** In writing: may client and contact data sit on Microsoft's servers in the Kingdom; is a GCC region allowed if a service is missing; does holding contacts' personal data on a server bring duties under the data protection law (registration, how long it is kept, what a contact may ask for).
3. **A monthly budget range.** A first guess for path A is USD 40 to 120 a month (a small managed database, a small service, backups). This is a guess: Saudi region prices are not published and new regions often cost more. A ceiling from him decides the size chosen.

**To decide**

4. **Editing while the server cannot be reached.** The earlier answer was "read offline, edit online" (given with colleagues in mind). Path A needs the opposite for him: the app keeps working fully, and changes wait and go up later. Recommended, and the plan above assumes it. With one user the cost is small.
5. **SL# and agreement references across devices.** Recommended: the server gives the number; a proposal made while offline shows "new" until the app is next online. The alternative, each device with its own block of numbers, leaves gaps.
6. **Edited on one device, deleted on the other.** Recommended: the deletion wins and the app says so. The alternative: the edit brings the record back.
7. **What the server keeps, and for how long.** Recommended: the history of every change for a year, deleted records for 90 days, daily backups for 30 days.
8. **The paused OneDrive phone sync.** Recommended: retire it when path A's server exists, rather than keep two ways for the phone to get his data.
9. **Whether to build before the region opens.** Items 1 to 9 can start now. They are worth building only if path A is going ahead: they change how every save works and must be rehearsed on his real data like a migration.

## 5. Risks, and how path A limits them

| Risk | What limits it |
|---|---|
| **The server is down, or there is no network** | The app never waits for the server. It reads and writes its own database as today; changes queue and go up later; a quiet mark says so. His daily use does not depend on the server |
| A sync fault damages his local data | Sync is off until he turns it on. A backup is taken before the first sync and the daily backups continue. A pause switch. Applying changes is tested with simulated devices before it ever touches his database, and rehearsed on copies like a migration |
| The first upload is wrong or incomplete | The reconciliation report compares both sides before anything else happens; three rehearsals; a rollback copy for 30 days |
| Conflicts lose his work | One user: a conflict needs the same record edited on two devices before either was online. When it happens the app says what it kept |
| Data stored where it must not be | Nothing leaves the Mac before the legal brief. Everything before that runs on this Mac |
| The Mac slows down (the phone sync was paused for this) | Sync off by default; small batches, away from the interface; measured on the 8 GB Mac before it is turned on |
| Someone else reaches the server | Microsoft sign-in from MENA BIG's tenant only, and in path A only his account; encrypted in transit and at rest; no secrets in the public repository |
| The Mac is lost | The data is on the server; his sign-in on that device is revoked from Microsoft's side |
| Cost creeps | The smallest sizes, a budget alert, and nothing running that path A does not need |
| It takes much longer than planned | The stop-and-reconsider point after about four weeks (section 2) |
| The region opens late, or without the services we need | Everything up to item 9 is independent of it; the legal brief decides whether a GCC region is an allowed fallback |

## 6. How A sets up B, C and D

Built in A, so the later paths add to it and do not rework it:

| Later path | Where it attaches | What A must already do |
|---|---|---|
| **B. Colleagues on sales** | Roles are a check the server makes on every change it receives and on every record it hands out. Who sees what follows `docs/data-classification.md`: shared records to every user, personal ones only to their owner, meetings by who was in them and which departments serve the client, a task to its owner and whoever it is assigned to or shared with, every company note with its author | Every change on the server carries the user who made it, from the first day, even with one user. The server checks permission on every change even when the answer is always yes. Merging by field (two people editing different fields both keep their change) is the same rule A uses for two devices |
| **C. One department** | A department is a property of a user and of a record. The server hands a department's records only to its members. A department's module brings its own tables, which join the same push and pull | Tables join the sync by being listed, not by new machinery. "Relevant department" first appears in B, for meetings |
| **D. Client portal** | A separate, read-only front on the same server, for a sign-in that is tied to one company and sees only that company's records marked for clients. Never the database directly | Every record already knows its company by id. The log of every change exists from A |

What A deliberately leaves out: any screen for users, roles or departments; any sharing; department data; anything a client sees.
