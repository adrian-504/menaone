# Testing and CI audit

Audited commit `4975b1c`. The commands below were **inspected** and their most recent results come from the Phase 4 verification run on this commit. **Nothing was re-run for this audit** (audit only).

## Commands

| Command | Where | Last known result (Phase 4, same commit) |
|---|---|---|
| `npm test` (= `vitest run`) | repo root | 24 files, 115 tests, all pass |
| `npx tsc --noEmit` (also part of `npm run build` = `tsc && vite build`) | repo root | clean |
| `npm run build` | repo root | OK |
| `cargo test` | `src-tauri/` | 92 passed, 0 failed, 10–11 ignored (opt-in) |
| `cargo clippy` | `src-tauri/` | 23 warnings (pre-existing, none new) |
| `MENA_REHEARSAL_DB=<copy> MENA_E2E_PROPOSAL=<id> cargo test --test proposal_documents -- --ignored --nocapture` | `src-tauri/` | passed on a copy of the live DB |
| `cargo test --test foundation -- --ignored` (real-DB integrity rehearsal) | `src-tauri/` | passed on a copy; `IntegrityReport { issues: [] }` |

## Coverage map

### Rust: 64 integration tests in 15 files, plus 39 unit tests in `src/`

| File | Tests (ignored) | Covers |
|---|---|---|
| `foundation.rs` | 22 (1) | Company identity lock, `company_for_save`, aliases, review queue, integrity report, real-copy rehearsal |
| `records_and_sync.rs` | 8 (1) | Single-record saves, uuid/row_version/tombstone triggers |
| `v2_features.rs` | 6 | Opportunities, projects, meetings, links |
| `pptx_import_real.rs` | 6 (6) | Real template import, env-gated |
| `proposal_documents.rs` | 5 (1) | Generation V1/V2, failure clean-up, validation, version numbering, real-copy E2E |
| `commercial.rs` | 4 | Services, rate cards, lines |
| `activity.rs`, `backups.rs`, `lists.rs`, `work_graph.rs` | 2 each | Activity triggers, snapshots/restore, lists, Work Graph links |
| `company_migration.rs`, `legacy_import.rs`, `v2_migration.rs` | 1 each | Migrations on fixtures (fictional seed data) |
| `insights_rehearsal.rs`, `pptx_real_templates.rs` | 1 (1) each | Env-gated real-data rehearsals |
| unit tests in `src/` | 39 | pptx parsing, smart fill, fee fill, attachments naming, OneDrive path checks, Microsoft auth helpers |

### Vitest: 24 files, 115 tests, pure logic in `src/lib` and `src/core`

- workGraph 19
- router 9
- myday 8
- commercial 7
- persist 6
- clientMatch 6
- taskParse 5, pricing 5, pipeline 5
- reminders 4, lists 4
- statusTone, navHistory, links, latest, companySelector, companyMatch, changes, agreements 3 each
- proposalDocuments, persistNotes, dnd, dayCounts, cleanup 2 each

## Gaps

| Gap | Impact |
|---|---|
| **CI has never run.** `.github/workflows/ci.yml` is `workflow_dispatch` only; GitHub reports 0 runs. All results come from local runs on one Mac. | There's no independent evidence that a clean checkout builds or passes, and **none at all for Windows**. |
| **No UI or end-to-end tests** (no Playwright, no tauri-driver). 49 tab renderers, 572 exposed functions and 814 inline handlers are verified only manually or in the browser preview. | UI regressions are caught by hand. |
| **No IPC contract tests.** TypeScript types in `src/lib/types.ts` and Rust serde structs are kept aligned by hand; `devMock.ts` (856 lines) is a third copy of the contract. | A drift shows up at runtime only. |
| **No concurrency or multi-writer tests.** | Expected: it's a single-user app. But this must exist before any shared-data work. |
| **No security regression tests** for escaping (S2) or `set_app_meta` keys (S3). | Relies on convention. |
| **Microsoft Graph not tested against recorded responses.** Auth helpers are unit-tested; sync logic (flag resync, calendar upsert) has no fixture tests. | Calendar deletion gap (M3) went unnoticed. |
| **Real-data rehearsals are opt-in and manual** (env vars). | Correct for PII reasons: real data must never reach the repo or CI. |
| **No coverage measurement.** | Unknown overall coverage; logic modules are well covered, tabs aren't. |

## Verdict

**Testing: 6.5 / 10.**
- **Strengths:** data integrity, migrations and business rules are tested seriously, including rehearsals on real-DB copies.
- **Weaknesses:** CI (declared but never executed), the UI layer, the IPC contract and Windows.

Do not describe the project as having CI until a run exists.
