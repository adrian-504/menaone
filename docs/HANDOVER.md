# MENA One — handover for the build session

Written 2 October 2026 by the build session that took the app from 1.0 to 1.67, for the session that takes over. Read this first; it is meant to be enough on its own. `docs/PLAN.md` says what is planned and how we work; `docs/ux-conventions.md` says how the app should look and behave.

**Who is who.** Ahmad is the owner and the only user: he runs MENA BIG's business development and uses MENA One all day. He is not a developer; write to him in plain words, lead with what he must decide or do. Hassan is his manager and reviews proposals by email; he does not use the app. Other Claude sessions work beside this one (see "Working with the other sessions").

## 1. State on 2 October 2026

| | |
|---|---|
| Installed | **MENA One 1.67** (see CHANGELOG.md for each version in two lines) |
| Code | `main` on GitHub `adrian-504/menaone` (public, by the owner's choice). The installed 1.67 is the merge `fb9553e`; everything after it on `main` is tests and docs |
| Database | SQLite, **schema 46**, WAL mode, on the Mac only |
| Real data, roughly | 269 proposals · 107 agreements · 16 proposal documents · 376 service lines · 7 follow-up entries |
| Tests | 899 frontend (Vitest, 133 files) · 259 backend (cargo), 26 more opt-in |

The last wave (1.64 notes, 1.65 follow-up, 1.66 generator, 1.67 a fix) is described in CHANGELOG.md and in `docs/ux-conventions.md` (search "1.65", "1.66").

## 2. Where everything is

| What | Where |
|---|---|
| Main repository (branch `main`) | `/Volumes/DevSSD/Developer/menabig-tracker` |
| Working copy for all building (a git worktree of the same repo) | `/Volumes/DevSSD/Developer/menabig-revision-actions` |
| The session's working directory (not a git repo) | `~/Library/CloudStorage/OneDrive-MENABusinessInvestmentGroup/MENA App` — it holds `.claude/launch.json` (the dev servers) |
| Live database | `~/Library/Application Support/com.menabig.tracker/menabig.sqlite3` (+ `-wal`, `-shm`) |
| The app's own backups | same folder, `backups/` (`daily-…`, `pre-migration-v<N>-…`), and a daily copy in OneDrive `MENA One/Backups/` |
| My pre-install backups | same folder, `menabig.sqlite3.pre-<what>-<YYYYMMDD-HHMM>` |
| Logs | same folder, `logs/` |
| Installed copies (three) | `/Applications/MENA One.app` · `~/Desktop/MENA One.app` · `~/Library/CloudStorage/OneDrive-MENABusinessInvestmentGroup/MENA App/MENA-BIG-Tracker-Desktop/MENA One.app` |
| Archive (never delete, archive here) | `/Volumes/DevSSD/MENA One Archive/` — `App versions/`, `DB backups/`, `Proposal templates/` |
| Second place for DB backups (full install only) | `~/Documents/MENA One Archive/DB backups/` |
| Proposal templates (owned by the Proposals workshop session and Ahmad; never edit) | OneDrive `MENA BD 2026/Proposals Templates/` — `Proposals New Logo/` (12 service templates, the "current design") and `MENA BIG Proposal Master 2026.pptx` (the "2026 design") |
| Clients' proposal folders (real client files; read only through the app) | OneDrive `MENA BD 2026/Proposals/` |
| Scratch | the session's scratchpad directory (given in the system prompt). Never the system temp folder, never OneDrive |
| Screenshots and Chrome profiles made by scripts | `<repo>/.cache/` (git-ignored, on the SSD) |
| Memory across sessions | `~/.claude/projects/-Users-ahmad-Library-CloudStorage-OneDrive-MENABusinessInvestmentGroup-MENA-App/memory/` (MEMORY.md is the index) |

**Branches.** One branch per stage, named for what it does (`notes`, `followup`, `generator`), stacked on each other in the worktree, merged into `main` with `--no-ff` only at install. One commit per item. Old branches are kept. Parked, do not merge: `phone-sync` (paused), `agreements-import` (cancelled).

**The stack.** Tauri 2: Rust + rusqlite in `src-tauri/`, plain TypeScript and Vite in `src/` (no framework: `src/lib` pure logic with tests, `src/core` shared behaviour, `src/tabs` one module per page, `index.html` all markup, `src/styles.css`). Pure logic goes in `src/lib` with a `.test.ts` beside it. The in-browser preview runs on sample data in `src/lib/devMock.ts` (fictional names only).

## 3. Checking, building, installing

All commands run in the worktree unless said otherwise.

### Every stage (cheap)

```bash
npx tsc --noEmit
npx vitest run
node scripts/motion-check.mjs      # radii 0/6/9/13/18/50%, weights 400/500/600, :active on clickables, data-tip not title
node scripts/release-check.mjs     # version has a CHANGELOG entry; no script launches Chrome on its own
```

Rust, only when Rust changed, and only the test binaries that matter while working:

```bash
cd src-tauri && CARGO_BUILD_JOBS=8 CARGO_TARGET_DIR=/Volumes/DevSSD/Developer/menabig-tracker/target/test-build \
  cargo test --test <name>
```

`CARGO_TARGET_DIR=…/target/test-build` is not optional: a test build and a `tauri build` in the same target folder overwrite each other.

**Full power is the default** (Ahmad, 2 October 2026): builds, tests and checks use every core. `~/.cargo/config.toml` still says 2 jobs, so set `CARGO_BUILD_JOBS=8` as above. **Gentle mode only when he says he is working on the Mac at that moment:** then put `taskpolicy -b nice -n 19` in front of the cargo or `npm run tauri build` command and leave the 2 jobs. In both modes the Mac has 8 GB: never a compile, a dev server and a Chrome check at the same time, and if a full-power build starts swapping or fails for memory, lower the job count and say what number holds.

To look at a change: `preview_start` with name `revision-actions-dev` (Vite on port 1423, sample data). Never start a dev server with Bash.

### Once per wave, before the install (heavy)

```bash
# 1. The full Rust suite
cd src-tauri && CARGO_BUILD_JOBS=8 CARGO_TARGET_DIR=/Volumes/DevSSD/Developer/menabig-tracker/target/test-build \
  cargo test --no-fail-fast

# 2. Focus check on the built front end (55 views; starts its own preview on port 1430)
npx vite build && node scripts/focus-check.mjs
#    in dev instead: FOCUS_URL=http://localhost:1423/ node scripts/focus-check.mjs ; ONLY=<view prefix> for one view

# 3. Screenshots (output in .cache/shots/<script>/)
FOCUS_URL=http://localhost:1423/ node scripts/pages-shots.mjs      # also record-shots, myday-shots, tools-shots, chrome-shots
#    ONLY=name,name  SIZE=1080x940  FULL=1 (whole page height)
```

4. **Real-template tests**, when the generator or anything it calls changed. They are `#[ignore]`d and read their inputs from the environment. Always on copies in the scratchpad:

```bash
S=<scratchpad>/tpl; T="$HOME/Library/CloudStorage/OneDrive-MENABusinessInvestmentGroup/MENA BD 2026/Proposals Templates"
mkdir -p "$S/Templates/Proposals New Logo" "$S/out"
cp "$T/Proposals New Logo"/*.pptx "$S/Templates/Proposals New Logo/"
cp "$T/MENA BIG Proposal Master 2026.pptx" "$S/Templates/"            # needs OneDrive running: the file is online-only otherwise (check the copy is not 0 bytes)
sqlite3 -readonly "$HOME/Library/Application Support/com.menabig.tracker/menabig.sqlite3" ".backup '$S/copy.sqlite3'"

cd src-tauri
export CARGO_BUILD_JOBS=8 CARGO_TARGET_DIR=/Volumes/DevSSD/Developer/menabig-tracker/target/test-build
run() { env "$@" MENA_DB_COPY="$S/copy.sqlite3" MENA_TEMPLATE_DIR="$S/Templates/Proposals New Logo" MENA_OUT="$S/out" \
  MENA_MASTER="$S/Templates/MENA BIG Proposal Master 2026.pptx" \
  MENA_WORKFORCE_TEMPLATE="$(ls "$S/Templates/Proposals New Logo"/Workforce*.pptx | head -1)" \
  MENA_SERVICES="$(sqlite3 "file:$S/copy.sqlite3?immutable=1" "SELECT group_concat(name || '|' || COALESCE(category,''), ';') FROM services WHERE active = 1")" \
  cargo test --profile realtests --test reprice_real --test proposal_audit --test pptx_import_real --test pptx_real_templates --test send_check_real \
  -- --ignored --nocapture; }
run X=1                    # the current design (the 12 service templates)
run MENA_MASTER_MODE=1     # the 2026 design (the master)
# reprice_real only: MENA_TERM=12:6 moves the term with the prices; MENA_ONLY=<text> picks sets; MENA_KEEP_OUTPUT=1 keeps the decks
# MENA_JOBS=<n> limits how many cases run at once (default: every core)
```

`--profile realtests` is an optimised build kept for these tests (dev with opt-level 3, no LTO; the first build takes about three and a half minutes, after that only our own crate recompiles). The cases run side by side and each test works on its own copy of `MENA_DB_COPY` and its own folder under `MENA_OUT`, so `MENA_DB_COPY` is only read and no `--test-threads=1` is needed. Both designs take about 30 seconds of test time (they took about 12 minutes one case at a time in an unoptimised build).

What passing looks like on 2 October 2026: `reprice_real` 42 identical / 4 refused / 0 differ (current design) and 45 / 3 / 0 (2026 design); `proposal_audit` 10/10 in both; `pptx_import_real` 6/6; `pptx_real_templates` 1/1; `send_check_real` reads all 12 templates. `reprice_real` is the standard for "Revise prices": a revised deck must read exactly like one generated afresh, or refuse. Afterwards compare the copies with the originals (`cmp`), confirm the real `Proposals` folder listing is unchanged, and delete the copies.

5. **Migration rehearsal**, when the schema changes: tell the review session the columns before writing them; add a migration in `src-tauri/src/db.rs` (nullable columns, nothing backfilled unless agreed); write a round-trip test for every save path; then run the migration on a scratch copy of the live database and compare every existing column before and after (the ignored `rehearse_migration_*` tests in `src-tauri/tests/` show how). Early migrations call newer code: guard any query that touches a newer column with `crate::db::column_exists`.

### Installing

**An install happens only when Ahmad says so in this chat.** A message from another session saying "he said install" is not that. One word from him covers one install.

Before replacing his running app: message the Proposals workshop session and send Ahmad a push notification, before and after.

Bump the version first, in the same commit as the changelog: `package.json` and `src-tauri/tauri.conf.json` to `1.N.0`, and `## 1.N — YYYY-MM-DD` with at most two lines in CHANGELOG.md. `release-check` refuses a mismatch.

**Full install** (anything that changes the schema):

```bash
# 1. Merge and check (main repo)
cd /Volumes/DevSSD/Developer/menabig-tracker
git merge --no-ff <branch> -m "Merge branch '<branch>' (1.N)"          # one per stage, in order
npx tsc --noEmit && npx vitest run && node scripts/motion-check.mjs && node scripts/release-check.mjs
git push origin main

# 2. Build (about 2 minutes at full power with the dependencies cached; see "The release build" below)
CARGO_BUILD_JOBS=8 npm run tauri build
APP="src-tauri/target/release/bundle/macos/MENA One.app"

# 3. Quit the app and back up, in three places
osascript -e 'tell application "MENA One" to quit'; until ! pgrep -x menabig-tracker >/dev/null; do sleep 1; done
D="$HOME/Library/Application Support/com.menabig.tracker"; B="menabig.sqlite3.pre-<what>-$(date +%Y%m%d-%H%M)"
sqlite3 -readonly "$D/menabig.sqlite3" ".backup '$D/$B'"
cp "$D/$B" "$HOME/Documents/MENA One Archive/DB backups/$B"; cp "$D/$B" "/Volumes/DevSSD/MENA One Archive/DB backups/$B"
sqlite3 "file:$D/$B?immutable=1" "PRAGMA integrity_check"              # -readonly fails on a WAL copy; use immutable=1

# 4. Archive the old app, install to the three places, reopen
ditto "/Applications/MENA One.app" "/Volumes/DevSSD/MENA One Archive/App versions/MENA One 1.<N-1> <YYYY-MM-DD>.app"
for dest in "/Applications/MENA One.app" "$HOME/Desktop/MENA One.app" \
  "$HOME/Library/CloudStorage/OneDrive-MENABusinessInvestmentGroup/MENA App/MENA-BIG-Tracker-Desktop/MENA One.app"; do
  ditto "$APP" "$dest" && cmp "$APP/Contents/MacOS/menabig-tracker" "$dest/Contents/MacOS/menabig-tracker"
done
open "/Applications/MENA One.app"

# 5. Verify on the real data
sqlite3 -readonly "$D/menabig.sqlite3" "SELECT value FROM app_meta WHERE key LIKE '%schema%'; PRAGMA journal_mode; PRAGMA quick_check"
ls -t "$D/backups" | head -2                                           # the app's own pre-migration backup is there
```

Then compare the real data with the pre-install backup: row counts, every existing column of every touched table unchanged (dump `SELECT <old columns> … ORDER BY id` from both and compare), every new column empty. Report to Ahmad, the review session and the workshop: the merged head and its checks, both backups, the schema, the counts.

**The release build** uses thin LTO and 16 codegen units (`[profile.release]` in `src-tauri/Cargo.toml`; Ahmad's decision, 2 October 2026, after measuring). At full power with the dependencies cached, as at an install, it takes about 2 minutes (2 min 3 s measured; the earlier profile, fat LTO with one codegen unit, took 4 min 40 s, and "about 25 minutes" was that profile in gentle mode: it no longer applies). The first build after a change to the profile or to a dependency rebuilds every dependency: about 4 minutes, once. The app's binary is 15.8 MB. What the app does at launch was measured the same under both profiles (`cargo test --release --test launch_work -- --ignored --nocapture` on a database copy: about 380 ms, nearly all of it SQLite rebuilding the search index); `scripts/launch-check.mjs` measures the front end only and never runs the binary.

`codesign -v` on the app prints "code has no resources but signature indicates they must be present". It always has (the build is ad-hoc signed); it is not a fault.

**Light install** (no schema change; agreed 2 October 2026): one pre-install backup in the app folder with its integrity check; quit; archive the old app; install to the three places; reopen; confirm the version (`defaults read "/Applications/MENA One.app/Contents/Info" CFBundleShortVersionString`), that the app is running, and `PRAGMA quick_check`. No column-by-column comparison and no three-place backup copies. The merge, the checks, the push, the build and the announcements are the same.

## 4. The rules

From Ahmad, standing. Each has cost something to learn.

- **His word for every install, in this chat.** Nothing reaches his running app otherwise.
- **Archive, never delete.** Old apps, old templates, old databases go to the SSD archive.
- **No client data and no real client or personal names in the repository** — code, tests, docs, commit messages. The repo is public. Sample data lives only in `src/lib/devMock.ts`, with fictional names. Tests that read real files are opt-in, print file names and numbers only, and work on copies.
- **Real records change only through the app.** The app keeps records in memory and saves whole records back: an edit made to the database from outside while it runs is lost. If a write is ever needed: quit, back up, write, reopen, and only when he asks.
- **The live database is only ever read** by this session, with `sqlite3 -readonly … ".backup '<scratch copy>'"`; work on the copy; delete it afterwards.
- **A database copy is not isolation.** An opt-in test must also point every path the app derives from `app_meta` (the proposals folder, the template library) at scratch, then prove the real OneDrive folders are unchanged.
- **Rehearse every migration on a copy**, with the launch backup first and a round-trip test for every save path.
- **A new column is lost unless it is everywhere a record is read and written.** The front end holds whole records and saves them back, and the backend writes every column of the record it is given (`upsert_sql` in `commands.rs`: `ON CONFLICT(id) DO UPDATE SET` every column; lines and documents are rewritten per parent). So a new column must be in the Rust model, the SELECT that reads it, the column list and every INSERT that writes it, and the TypeScript type — miss one and the next save of that record silently writes it back empty. That is what the round-trip test per save path is for (migration 44 taught it). Early migrations also call current code: guard a query that touches a newer column with `crate::db::column_exists`.
- **Scripts launch headless Chrome only through `scripts/lib/chrome.mjs`.** No script makes its own profile or temp folder (27 GB of leftover profiles filled his disk on 1 October). Do not delete temp profiles or kill Chromes you did not start.
- **Do not download files, and do not open apps on his screen** (PowerPoint included) without asking.
- **Not a CRM.** His words: "this is not an app that's like those CRMs where I'm supposed to log every call… i dont want clutter for no reason". The app never alerts on a lack of contact with a company or person and never asks him to log contact for its own sake. Proposal follow-ups stay. "Followed up" is one click; details are optional, never required. The common case is always one click.
- **Rules, not AI**, everywhere: proposals, the generator, Watch.
- **Proposals, his limits:** no version diffs; no price, discount or margin signals; no per-proposal terms field; no inbox parsing; the proposal page must not get longer. Only the final sent deck matters. Nudging Hassan only records the nudge (no email automation).
- **Kept on purpose, do not propose merging:** Pending and Follow-up; Dashboard, Reports and Analytics. The hidden modules (Action Required, Dashboard, Reports, Analytics, Watch) are out of scope until he says.
- **When he rejects a plan, it usually means "you are adding more".** Ideas he pastes from elsewhere may contradict the code or his own earlier decisions: check before building.
- **His Mac is small (8 GB), and full power is the default.** Use every core unless he says he is working on the Mac at that moment (then `taskpolicy -b nice -n 19` and 2 jobs). Either way, do not run a dev server, a Chrome check and a compile at once.
- **Design.** The whole app follows the My Day "pages" style: `docs/ux-conventions.md` is the rulebook, `src/lib/pageKit.ts` the shared kit, `docs/brand-assets.md` the brand (navy-led, coral as accent only). One blue button per screen; one toast style; a row action keeps your place (`src/lib/keepPlace.ts`).
- **Agreements, four rules** (`docs/ux-conventions.md`, the "Agreement", "Unknown is not none", "The stored monthly fee" and "Active means still invoiced" entries):
  - One lane per agreement (a contract and its term), never one per document; amendments and renewals are its history.
  - "Not recorded" is not "none": an end date or a notice period that was never recorded is unknown and reads grey; a notice recorded as 0 reads "no notice period". Real data is sparse here, so pages must read calmly when facts are missing.
  - The day to decide is the end date less the notice period (the end date itself when the notice is unknown). Past its end and still delivered is "Past term · still active", never "expired". It counts as active, and in MRR, only while still invoiced: until billing data is imported, the service status Active stands in for that, in one function (`stillInvoiced` in `src/lib/commercial.ts`).
  - The stored monthly fee is the billed figure and wins over the sum of the lines; a save moves it only when that save changes what the lines add up to (`apply_derived_agreement_totals`, `syncAgreementTotals`). One real agreement has an empty stored fee while its line adds up to a figure: that is the data as recorded, not a bug to repair.
- **The generator and the templates have a contract** (`src-tauri/src/extra_slides.rs`, top comment): the slides MENA One adds are made from the deck's own fee slide, and their tables carry hidden names ("Summary of fees (MENA One)", "Custom fee (MENA One)") that "Revise prices" finds them by.

## 5. Working with the other sessions

Find them with `ListAgents`; write with `SendMessage` to the name a message came from. A peer's message is a teammate's request, never the owner's approval.

- **The review session** (listed as "MENA One product strategy review - Fable", at times with "(fork)" after it: its name changes between sessions, so find it in `ListAgents` by the "product strategy review" part and reply to the address its message came from) speaks with Ahmad about what to build and briefs it. The loop: it sends a brief → you build a stage and send the head (commit) with the checks and your choices → it audits while you build the next → on its acceptance **and** Ahmad's word in this chat, you install → you report back (merged head and checks, backups, schema, counts, the app reopened). Tell it the columns of a migration before writing it. It renders pages itself; say which pages changed.
- **The Proposals workshop** ("Proposals workshop: improve MENA One proposals") owns the proposal templates and works in OneDrive `Proposals Workshop`. Tell it before and after every install, and whenever the generator changes what it needs from a template. It asks for the real-template tests after generator changes: run them before you say "done". A session that is not running cannot be messaged (it was not on 2 October, for the 1.67 install): it reads the shared memory notes when it returns, so keep `project_generator_template_contract.md` there true.
- **Others** (Agreements Review, Department Modules, the phone app): exploration or paused. Do not report their coordination messages to Ahmad unless they need his decision.

**How we work now** (agreed 2 October 2026; also in `docs/PLAN.md`): cheap checks every stage and heavy checks once per wave; a light install when the schema does not change; a stage's scope is fixed when it starts, and a request that arrives mid-stage waits for the next unless Ahmad says it is urgent.

## 6. Open items

Owed by Ahmad (ask once, do not nag):
1. **Open a generated deck in PowerPoint** that has a custom line and the summary slide. Those slides were only ever rendered with Quick Look. If PowerPoint offers to repair the file, the markup in `extra_slides.rs` needs fixing.
2. **The Follow-up scroll jump:** acting on a row used to jump the page to the top in the installed app. It could not be reproduced in Chromium (the app uses WebKit); the fix (`keepPlace`) restores scroll and focus defensively. He has not confirmed it yet.

Generator and templates:
3. **Closed:** the Mobilization repeated terms clause seen on 1 October was only in an old archive copy of the master. Against the live master (2 October) the 2026-design audit passes 10/10. Mentioned so nobody chases it again.
4. **Optional:** the workshop may retitle the GM Representative fee slide to "Project Fees" like the other 11 templates. Since 1.67 the code no longer needs it. If a template changes, rerun the real-template tests on a copy.
5. **"Revise prices" always regenerates** for Dedicated Recruiter and the Business Setup and Maintenance Package in the current design (no fee row it recognises), and for any term change in a 2026-design deck. Known and accepted; improve only if it bothers him.
6. **A proposal of custom lines only** generates in the 2026 design only.

Decisions that sit with Ahmad and the workshop (do not resolve them yourself):
- **The GM Representative penalty lines.** Ahmad decided on 22 September to keep the Business Setup penalty clauses in the GM Representative terms (the audit `terms_stay_in_their_own_deck` allows them there for that reason); the review session reports that Hassan asked on 28 September for them to be removed. The two contradict each other. Leave the template and the audit as they are until Ahmad says which stands.
- **Other template issues the workshop is putting to Ahmad** (reported by the review session; they are in the templates, not in the code): prices written with a dot ("3.550 SAR"), a blank Mobilization price, Recruitment at 9% against the 10% standard, and variants of the VAT sentence. The generator copies an amount's own style when it rewrites it (`format_like`), so a template fix needs no code change; rerun the real-template tests after any of them.

Waiting on others, do not start:
7. **The workshop's follow-up entries**: it has follow-up notes and status fixes from an email cross-check that it wants in the app. Real records change through the app, or with the app quit and a backup, and only when Ahmad asks.
8. **Agreements import**: parked on branch `agreements-import`; the first attempt was cancelled on 22 September while Ahmad rethinks the approach. The Agreements Review session holds the findings. Nothing is imported until he reviews and says so.
9. **Phone sync**: branch `phone-sync`, paused 24 September (it made the Mac lag). On resume: off by default until turned on in Settings, and its migration needs the next free number.
10. **Department modules** (Recruitment, Admin and PRO, Finance, Payroll): exploration only.
11. Everything under "Waiting on someone else" in `docs/PLAN.md`.

Small and loose:
12. `git status` in the main repo shows an untracked `target/` (the test build folder). Leave it.

## 7. Things that waste time if you do not know them

- The shell is zsh: an unquoted variable is not split into words (`$CMD args` runs nothing; use a function or an array), and globs like `--include=*.ts` need quotes.
- A Bash call has a 10-minute ceiling. Run long things with `run_in_background` and wait with `until …; do sleep 10; done` (a bare `sleep N; …` chain is blocked).
- `pgrep -x menabig-tracker` finds the running app; `pgrep -f` matches your own command line.
- Timing a command: `/usr/bin/time -p <command>`. Do not put `taskpolicy -b nice -n 19` in a variable and expand it (see the first point); write it out.
- A `pptx` is a zip. To look at one slide of a generated deck without opening PowerPoint: write a copy whose `ppt/presentation.xml` lists only that slide, then `qlmanage -t -s 1400 -o <dir> <file>` gives a PNG.
- TypeScript here has no `Array.at` and no Node types in tests: index instead, and use `import.meta.glob(..., { query: '?raw' })` to read files in a test. A test that touches the DOM starts with `// @vitest-environment jsdom`. `src/lib/dates.test.ts` forbids `toLocaleDateString` outside `dates.ts`.
- `tests/v2_migration.rs` hard-codes the schema number: bump it with each migration.
- A custom line's `billing` is the only thing totals read; its unit decides it (`src/lib/customLine.ts`, `normalize_custom_line` in Rust). Do not add a second place that sums prices.
