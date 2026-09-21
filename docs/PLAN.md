# MENA One — the plan

**One page, kept current. Written 20 September 2026.** It replaces the 15–19 week roadmap, the sprint and phase numbering (both restarted twice), and every earlier plan. If something isn't here, it isn't planned.

## Where the app is

| | |
|---|---|
| Runs on | One Mac, one user. Schema 36. Data and backups stay on that Mac |
| Holds | ~170 companies · 104 contacts · 257 proposals · 107 agreements · 14 opportunities · 10 projects · 476 Watch items · 224 flagged emails |
| Tests | 141 frontend (Vitest) · 113 backend (Rust). CI green on macOS **and Windows**, and it builds a Windows installer |
| Connected to | Microsoft 365 (flagged mail, calendar, Teams meetings) and OneDrive for client files |
| Repository | `adrian-504/menaone`, public by the owner's choice. No client data in it, ever |

**The honest position: the app is ahead of both the data and the organisation.** What's missing isn't features — it's the agreements data (other departments), the master proposal deck (owner), and colleagues actually using it (Azure's Saudi region opens November 2026). Building more modules would not help.

## What's built and working

Client 360 and contact pages · proposals with lines, versions and an internal review step · agreements with service lines, dates and MRR · opportunities and the pipeline board · projects with milestones · meetings with Outlook sync, client linking and meeting briefs · Notes · Tasks with natural-language quick add · Watch (regulatory and market news, rules only, no AI) · Files · clean-up queues · My Day with office clocks, weather and holidays · reminders · the service catalogue, rate cards and KSA/Europe entities · identity, owners and activity · commitments (`>>` we owe, `<<` they owe) and what each opportunity is waiting on.

## Waiting on someone else — do not start

| Work | Waiting on | Then |
|---|---|---|
| Agreements: amendment chains, import, renewal and notice dates | Other departments (on hold since 17 Sep) | Re-run the trial import, then the real one |
| Dashboard, Reports, Analytics revamp | The agreements and sales-report data | Rebuild on real figures |
| Active clients and renewal alerts | The sales report spreadsheet | One-time import |
| Proposal generator earning its keep | The master deck with tagged slides | Generate a real proposal end to end |
| Cloud, colleagues, shared data | Azure Saudi Arabia East — **November 2026**, and the legal brief | Identity, API, migration |
| Phone app (skeleton and API contract are in `mobile/`) | The cloud | Wrap the screens, TestFlight |
| Windows rollout | Someone with a Windows PC | Install the CI artefact and test |
| HR Advisory deck conversion | Owner — parked | — |

## Open, and small

1. **Owners are empty.** No company, opportunity or project has an owner, so "Mine" shows nothing. A bulk assign fixes it.
2. **Five questions in `docs/data-classification.md`** — what is personal, what is shared. Shapes the database before the cloud, cheap now and expensive later.
3. **Code signing** — Apple Developer ID, about $99/year. Removes the Keychain compromise (SECURITY_AUDIT S1) and lets colleagues install without warnings.
4. **Watch depth** — 476 items, but news-search stories arrive headline-only. Worth improving only if the owner finds them thin in daily use.

## How we work now

- **Product slices, since 21 September 2026.** A product review with the owner agreed seven slices, each reviewed before the next: 1 visual consolidation (done), 2 commitments and waiting-on (done), 3 engagement thread, 4 Company 360 as a briefing, 5 the meetings loop and My Day regrouping, 6 proposals (diff, rhythm, handover), 7 search and sidebar consolidation. Between slices, what irritates in daily use still gets fixed first.
- **No sprint or phase numbers.** Work is named for what it does.
- **Every install:** back up the live database first, rehearse migrations on a copy, run the tests, then install and check against real data.
- **Rules, not AI**, everywhere — proposals and Watch included. The owner's standing decision.
- **No client data in the repository**; fictional names in code, tests and docs.

## Decisions already made (don't reopen)

- Windows matters more than phones; phones are a companion later.
- Data stays in Saudi Arabia: Microsoft 365 is already provisioned there, and Azure's Saudi region opens in November. A GCC region only if a service we need is missing there, and only with legal sign-off.
- One tenant, MENA BIG only. Everyone sees company records; personal tasks and notes stay private.
- Pending/Follow-Up and Dashboard/Reports/Analytics stay separate — deliberately.
- Service catalogue: renames and merges agreed 16 Sep (`docs/service-catalog-decisions.md`).

## Where the detail lives

`docs/system-audit/` — the September audit and its 13 architecture decisions · `docs/data-classification.md` — personal vs shared, draft · `docs/service-catalog-decisions.md` · `docs/work-graph.md` · `docs/ux-conventions.md` · `docs/proposal-template-guide.md` · `docs/sync-architecture.md` · `docs/mobile-skeleton.md` · `ARCHITECTURE.md` · `USER_GUIDE.md`.
