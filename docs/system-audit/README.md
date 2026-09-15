# MENA One system audit: executive summary

*Audit of commit `4975b1c`, 15 September 2026. Documentation only; nothing in the app was changed.*

## What is MENA One today?

A desktop app on one Mac, used every day by one person to run MENA BIG's business development:
- companies and contacts;
- opportunities, proposals (including generating the PowerPoint deck into the client's OneDrive folder) and agreements;
- projects, meetings, notes and tasks;
- flagged Outlook emails and the Outlook calendar;
- market news.

All data sits in one SQLite database file on that Mac. There is no server.

## What is working well?

- **The full workflow is connected:** company → contact → opportunity → proposal → agreement → project → meeting → note → task, without re-typing.
- **Company identity is solid:** every record points to its company by id, and the integrity check on the real data finds no problems.
- **Proposal deck generation and version history work** on the real templates.
- **Data safety habits are good:** automatic daily backups, a snapshot before every risky change, and migrations rehearsed on copies of the real database.
- **The Microsoft sign-in uses the correct modern flow**, and the app asks for no more access than its features need.

## What is incomplete?

- **Agreements** only appear on the next app launch after a proposal is won.
- **Calendar sync** doesn't remove events deleted in Outlook.
- **Links to files and folders** only work on this Mac (they store full Mac paths).
- **Reports and dashboards** stay basic, by decision.
- **Nothing has been tested on Windows,** and the automated test pipeline has never actually run.

## What is risky?

- **Stalled connections:** a network call to Microsoft or a news feed can hang indefinitely (no timeouts).
- **Sign-in token storage:** the Microsoft token is stored in a way any app on the Mac could read.
- **An internal settings command** accepts any value, which weakens some safety checks.
- **The database and backups aren't encrypted** beyond the Mac's own disk encryption.
- **The public GitHub repository:** no automatic guard stops real client data from being committed by mistake.

None of these is an emergency for one user on one Mac. They're listed as MUST FIX because they're small.

## Is the architecture good enough?

**Yes, for today. Keep it and evolve it; don't rebuild.** The weak points aren't in the screens or the business logic. They're in how data is identified and owned, and that can be fixed step by step.

## Is it ready for cloud?

**No (3/10).** Records are numbered separately on each device. The app has no idea who the user is. Saving a record overwrites the whole thing. Personal email and calendar data is mixed with company data. File links are machine-specific. And the data-residency question (where client data may legally be stored) hasn't been answered.

## Is it ready for multiple users?

**No (2/10).** There are no user accounts, no record of who changed what, and no protection against two people editing the same record. **Do not share the database file between people.**

## Is it ready for Windows?

**Not yet (4/10).** The core code is probably portable. But it has never been built or tested on Windows, and every existing file link is a Mac path.

## What should happen next?

A workstream called **Identity & Data Ownership Foundation**, done inside the existing desktop app with no server:

1. The owner answers a few decisions (single company or several, what data is personal vs shared, where client files should live, basic roles).
2. Small hardening fixes: timeouts, token storage, settings restriction, calendar deletions.
3. The app learns who the user is (Microsoft sign-in identity), and records who owns and changes things.
4. Every record gets a global identity instead of a device-local number.
5. Personal data is separated from company data.
6. Saves stop silently overwriting other changes.
7. File links become portable, and Windows builds are checked automatically.

## What should not happen yet?

- No cloud server, database hosting or sync engine.
- No moving client folders to SharePoint.
- No Windows redesign, and no new product features.
- No rewrite of the frontend.

These come **after** the foundation, once the decisions in `ARCHITECTURE_DECISIONS_REQUIRED.md` are answered.

## Documents in this folder

| File | Contents |
|---|---|
| `SYSTEM_AUDIT.md` | Repo state, data ownership, multi-user, performance, verdict and scores, done/fix lists |
| `PRODUCT_AUDIT.md` | Every module classified; workflow completeness test |
| `ARCHITECTURE_AUDIT.md` | Frontend, backend (keep/improve/refactor/replace), Work Graph |
| `DATABASE_AUDIT.md` | Tables, identity, relationships, cloud-shape issues |
| `MICROSOFT_AUDIT.md` | Sign-in, tokens, Graph services, minimum identity architecture |
| `SECURITY_AUDIT.md` | Findings by severity |
| `CLOUD_READINESS.md` | Blockers for a shared, central dataset |
| `SYNC_READINESS.md` | Why the existing sync columns don't make it sync-ready |
| `WINDOWS_READINESS.md` | Windows-safe, Windows-risky and macOS-specific parts |
| `TESTING_AUDIT.md` | Test inventory, commands, CI status, gaps |
| `ARCHITECTURE_DECISIONS_REQUIRED.md` | Open questions for the owner, deliberately not answered |
| `RECOMMENDED_NEXT_WORKSTREAM.md` | Objective, preconditions, exclusions, sprints |
