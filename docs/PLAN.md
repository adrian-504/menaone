# MENA One — the plan

**One page, kept current. Written 20 September 2026; the facts below as of 2 October 2026 (1.67).** A session picking the work up reads `docs/HANDOVER.md` first. It replaces the 15–19 week roadmap, the sprint and phase numbering (both restarted twice), and every earlier plan. If something isn't here, it isn't planned.

## Where the app is

| | |
|---|---|
| Runs on | One Mac, one user. Version 1.67, schema 46. Data and backups stay on that Mac |
| Holds | ~170 companies · 104 contacts · 269 proposals · 107 agreements · 14 opportunities · 10 projects · 476 Watch items · 224 flagged emails |
| Tests | 899 frontend (Vitest) · 259 backend (Rust), plus opt-in tests on copies of the real templates. CI green on macOS **and Windows**, and it builds a Windows installer |
| Connected to | Microsoft 365 (flagged mail, calendar, Teams meetings) and OneDrive for client files |
| Repository | `adrian-504/menaone`, public by the owner's choice. No client data in it, ever |

**The honest position: the app is ahead of both the data and the organisation.** What's missing isn't features — it's the agreements data (other departments), the master proposal deck (owner), and colleagues actually using it (Azure's Saudi region opens November 2026). Building more modules would not help.

## What's built and working

Client 360 and contact pages · proposals with lines, versions and an internal review step · agreements with service lines, dates and MRR · opportunities and the pipeline board · projects with milestones · meetings with Outlook sync, client linking and meeting briefs · Notes · Tasks with natural-language quick add · Watch (regulatory and market news, rules only, no AI) · Files · clean-up queues · My Day with office clocks, weather and holidays · reminders · the service catalogue, rate cards and KSA/Europe entities · identity, owners and activity · commitments (`>>` we owe, `<<` they owe) and what each opportunity is waiting on · the engagement thread and one timeline per record · Company 360 as a briefing, with a printable Brief · the Focus pass: pages read first and edit on demand, one blue button per screen, filters folded, `npm run focus-check`.

## Waiting on someone else — do not start

| Work | Waiting on | Then |
|---|---|---|
| Agreements: amendment chains, import, renewal and notice dates | Other departments (on hold since 17 Sep) | Re-run the trial import, then the real one |
| Dashboard, Reports, Analytics revamp | The agreements and sales-report data | Rebuild on real figures |
| Active clients and renewal alerts | The sales report spreadsheet | One-time import |
| Proposal generator earning its keep | The master deck with tagged slides | Generate a real proposal end to end |
| Cloud, colleagues, shared data | Azure Saudi Arabia East — **November 2026**, and the legal brief | Identity, API, migration |
| Phone app (the old skeleton and API contract are in history at 6e45525; the current plan is OneDrive phone sync, branch `phone-sync`, paused) | The cloud | Wrap the screens, TestFlight |
| Windows rollout | Someone with a Windows PC | Install the CI artefact and test |
| HR Advisory deck conversion | Owner — parked | — |

## Open, and small

0. **Proposal requests (built 27 Sep, branch `proposal-requests`, awaiting review and install):** a request is a proposal, nothing else — several proposals from one create form (one per block, sharing a request group), `>> Proposal for …` lines that become requests instead of tasks, and a promised-by date on My Day, Coming up and the proposal header.

1. **Owners are empty.** No company, opportunity or project has an owner, so "Mine" shows nothing. A bulk assign fixes it.
2. **Five questions in `docs/data-classification.md`** — what is personal, what is shared. Shapes the database before the cloud, cheap now and expensive later.
3. **Code signing** — Apple Developer ID, about $99/year. Removes the Keychain compromise (SECURITY_AUDIT S1) and lets colleagues install without warnings.
4. **Watch depth** — 476 items, but news-search stories arrive headline-only. Worth improving only if the owner finds them thin in daily use.
5. **Retire the single-template path.** Move the proposal document-versioning tests (`tests/proposal_documents.rs`) onto the template library, then delete the deprecated single-template branch in `generator.rs` and its commands.

## How we work now

- **Product slices, since 21 September 2026.** A product review with the owner agreed seven slices, each reviewed before the next: 1 visual consolidation (done), 2 commitments and waiting-on (done), 3 engagement thread (done), 4 Company 360 as a briefing (done), then a Focus pass — every page says where to look, mostly by removing (done) — 5 the meetings loop and My Day regrouping, 6 proposals (diff, rhythm, handover), 7 search and sidebar consolidation. Between slices, what irritates in daily use still gets fixed first.
- **No sprint or phase numbers.** Work is named for what it does.
- **Every install needs the owner's word in the build chat.** A relay from another session is not that. Tell the Proposals workshop before and after.
- **Light checks every stage, heavy checks once per wave** (agreed 2 October 2026). Every stage: tsc, vitest, motion-check, release-check, and cargo test only when Rust changed. Once per wave, before the install: the full Rust suite, focus-check on the built front end, the full screenshot set, the real-template tests on copies, and the migration rehearsal. The review session audits the same way: per stage only the pages that changed, the full render once before install.
- **Full install when the schema changes:** back up the live database in three places, rehearse the migration on a copy, install, then compare the real data column by column with the backup (rows unchanged, new columns empty).
- **Light install when it does not** (agreed 2 October 2026): one pre-install backup with its integrity check, quit, archive the old app, install to the three places, reopen, confirm the version and a quick_check. No column-by-column comparison and no three-place backup copies.
- **A stage's scope is fixed when it starts** (agreed 2 October 2026). A request that arrives mid-stage goes to the next stage unless the owner says it is urgent; the review session holds them and says which is which.
- **Not a CRM.** The app never alerts on a lack of contact and never asks for contact to be logged for its own sake; proposal follow-ups stay, and the common case is one click.
- **Rules, not AI**, everywhere — proposals and Watch included. The owner's standing decision.
- **No client data in the repository**; fictional names in code, tests and docs.

## Decisions already made (don't reopen)

- Windows matters more than phones; phones are a companion later.
- Data stays in Saudi Arabia: Microsoft 365 is already provisioned there, and Azure's Saudi region opens in November. A GCC region only if a service we need is missing there, and only with legal sign-off.
- One tenant, MENA BIG only. Everyone sees company records; personal tasks and notes stay private.
- Pending/Follow-Up and Dashboard/Reports/Analytics stay separate — deliberately.
- Service catalogue: renames and merges agreed 16 Sep (`docs/service-catalog-decisions.md`).

## Where the detail lives

`docs/HANDOVER.md` — where everything is, how to check, build and install, the rules, the open items · `docs/system-audit/` — the September audit and its 13 architecture decisions · `docs/data-classification.md` — personal vs shared, draft · `docs/service-catalog-decisions.md` · `docs/work-graph.md` · `docs/ux-conventions.md` · `docs/proposal-template-guide.md` · `docs/sync-architecture.md` · `docs/mobile-skeleton.md` · `ARCHITECTURE.md` · `USER_GUIDE.md`.
