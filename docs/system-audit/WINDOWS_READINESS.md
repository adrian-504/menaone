# Windows readiness

Audited commit `4975b1c`. **No Windows build or test has ever run.** `.github/workflows/ci.yml` defines `windows-latest` test and installer jobs, but the workflow is `workflow_dispatch` only and GitHub reports **0 runs**. Everything below comes from reading the code.

Classes: **Windows-safe** / **Windows-risky** / **macOS-specific**.

## Inventory

| Area | Class | Evidence |
|---|---|---|
| Rust core (SQLite, commands, migrations, generator, pptx zip handling) | Windows-safe | Pure Rust, rusqlite bundled, `zip` crate, no POSIX calls. |
| App data location | Windows-safe | Tauri `app_data_dir()` → `%APPDATA%\com.menabig.tracker`. |
| Attachment names | Windows-safe | `safe_file_name` strips both `/` and `\` (tested). |
| Generated file names | Windows-safe | `generator.rs:563`, `commercial.rs:1198` strip `/ \ : * ? " < > \|`. |
| Credential storage | Windows-safe (in code) / untested | `keyring` 3 with `windows-native` on non-macOS (`auth.rs:321+`, `Cargo.toml:66`). |
| Global quick-capture shortcut | Windows-safe | `lib.rs:244-247` uses `SUPER` on macOS, `CONTROL` elsewhere. |
| Menu accelerators | Windows-safe | `CmdOrCtrl`; the macOS-only app menu items are gated (`lib.rs:68`). |
| Open / reveal files | Windows-safe | `tauri_plugin_opener::open_path` / `reveal_item_in_dir` (no `open` shell calls). |
| Frontend keyboard handlers | Windows-risky | 12 `metaKey` checks vs 13 `ctrlKey`; not every handler was confirmed to accept Ctrl. |
| OneDrive discovery | Windows-risky | `localfiles.rs` `onedrive_dirs` reads `OneDriveCommercial` / `OneDrive` / `OneDriveConsumer` env vars. That's plausible, but SharePoint libraries synced via "Add shortcut" land under `%USERPROFILE%\<Tenant>\…`, which it won't detect. |
| `is_within_onedrive` canonicalisation | Windows-risky | `std::fs::canonicalize` returns `\\?\C:\…` verbatim paths on Windows; comparing against non-canonical roots may fail. Untested. |
| Stored absolute paths (`microsoft_files.path`, `proposals.folder_path`, `proposal_documents.path`, `proposal_templates.path`, `app_meta.proposals_root`, `proposal_master_path`, `msfiles_pinned/recent`) | macOS-specific (data) | They're `/Users/<name>/Library/CloudStorage/OneDrive-…/…`. A Windows machine (or another Mac user) can't resolve any existing link. |
| Frontend path splitting | Windows-risky | `templates.ts:82, 393` use `path.split('/')` to get a file name (display only). |
| Loopback sign-in | Windows-risky | Binds `127.0.0.1:18473`, redirect `http://localhost:18473`. Windows Firewall prompt and IPv6 `localhost` resolution are unverified. |
| Overlay title bar, `hiddenTitle`, `mac-window-chrome` CSS, traffic-light spacing (sidebar padding-left 72px), `#window-drag-strip` | macOS-specific | `tauri.conf.json:21-22`, `src/styles.css`. On Windows, the Overlay title bar is ignored (normal decorations), so the CSS must not apply there. It's only applied under a `mac-window-chrome` class; confirm the class is platform-gated. |
| Capture window `transparent: true`, `decorations: false`, `shadow: true` | Windows-risky | WebView2 transparency works but renders differently (no vibrancy; shadow/rounding differ). |
| UI wording "Show in Finder" (4 places), ⌘ glyphs in hints | macOS-specific (cosmetic) | Should read "Show in Explorer" / Ctrl on Windows. |
| Fonts | Windows-safe | Stack includes `"Segoe UI"`. |
| Scrollbars, `-webkit-` styling, `overscroll-behavior` | Windows-risky (cosmetic) | WebView2 is Chromium, so mostly fine; overlay scrollbars look different. |
| PPTX output opened in PowerPoint for Windows | Windows-risky | Validated only in PowerPoint for Mac. |
| Installer (NSIS / MSI), WebView2 bootstrap, code signing | Unverified | Configured in CI but never built; no Windows certificate (SmartScreen warnings expected). |

## Verdict

**The Rust core is likely portable. The data is not.** A Windows build will probably compile and run with small cosmetic issues. But a Windows user opening a *copy of today's database* would find every file and folder link broken, and couldn't share data with the Mac anyway (see CLOUD_READINESS).

**Score: 4 / 10**, a starting point rather than a product.

## Smallest next step (not done)

Run the existing `ci.yml` once manually (or once on a branch) to learn whether the Windows test job and installer build succeed. That turns every "unverified" above into evidence, at the cost of a few Actions minutes. The workflow comment says macOS minutes count ten times on private repos; the repo is public, so standard runners are free.
