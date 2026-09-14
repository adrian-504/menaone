# MENA BIG Tracker (Desktop)

A native macOS desktop rewrite of `MENA_BIG_Tracker_24.html` — the same proposals/contacts/agreements/notes/todo tracker, now backed by a real SQLite database instead of browser localStorage, packaged as a real `.app`.

This document is for whoever maintains the app next (developer-facing). For day-to-day usage instructions, see **[USER_GUIDE.md](USER_GUIDE.md)**.

## Stack & why

- **Tauri v2** (Rust backend + a plain TypeScript/vanilla-DOM frontend, not a JS framework) — chosen over Electron because it produces a much smaller, faster-starting binary and forces a clean split between trusted (Rust) and untrusted (webview) code, which suits a business-data app well. There was no dependency on Node/Electron-only APIs in the original app, so nothing was lost by not using Electron.
- **rusqlite (bundled SQLite)** for storage — no separate SQLite install needed, the database ships inside the binary.
- **Vite** for the frontend build.
- The frontend is intentionally **not** React/Vue — the original app's ~3,600 lines of DOM-manipulation JS were ported into typed ES modules with the same imperative style, rather than rewritten into a component framework. This was a deliberate fidelity/risk tradeoff: a framework rewrite would have touched every line of business logic and workflow, multiplying the chance of subtly breaking something the business depends on. See `ARCHITECTURE.md` for the full reasoning and module map.

## Project layout

```
src/                     Frontend (TypeScript, compiled by Vite)
  lib/                   Shared infrastructure: types, constants (pricing/status tables),
                          state, db (Tauri invoke wrappers), utils, CSV/file export, period
                          filter, and the tab-render registry that replaces the original
                          app's ad-hoc renderX() call chains.
  core/                  Cross-cutting business logic: proposals workflow, agreements
                          sync, contacts, navigation, backup/restore.
  tabs/                  One module per sidebar tab (dashboard, followup, pending,
                          database, reports, analytics, notes, todo, pricing, companies,
                          hubspot).
  styles.css             Ported CSS (near-verbatim from the original <style> block).
  main.ts                App bootstrap: loads data from SQLite, wires everything up.
index.html               Ported body markup (sidebar, tab containers, all 10 modals).

src-tauri/               Rust backend
  src/db.rs              SQLite schema + connection setup.
  src/models.rs          Row structs (serde) mirroring the frontend TS types.
  src/commands.rs         Tauri commands: get/save per entity, backup export/import,
                          legacy-format import, generic file read/write.
  src-tauri/tauri.conf.json  App metadata, window config, bundle targets.


```

## Building

```bash
npm install
npm run tauri build
```

Output: `src-tauri/target/release/bundle/macos/MENA BIG Tracker.app` and, if DMG bundling succeeds on your machine, `src-tauri/target/release/bundle/dmg/MENA BIG Tracker_1.0.0_*.dmg`.

For local development with hot reload:

```bash
npm run tauri dev
```

## Code signing / notarization

The build in this repository is **ad-hoc signed only** (no paid Apple Developer ID). That means:
- The `.app` runs fine once you right-click → Open the first time (or the Finder Gatekeeper prompt is dismissed), including on other Macs.
- It is not notarized, so macOS Gatekeeper shows a warning on first launch on any Mac other than the one it was built on. This is expected and does not indicate a broken build.

To ship a fully notarized build (no warnings at all, works via plain double-click on any Mac):
1. Enroll in the Apple Developer Program (paid, ~$99/year).
2. Create a "Developer ID Application" certificate in Xcode or the Apple Developer portal, installed in this Mac's login keychain.
3. Add signing identity + notarization credentials to `src-tauri/tauri.conf.json` under `bundle.macOS.signingIdentity` and set up `xcrun notarytool` credentials (Tauri's docs: https://tauri.app/distribute/sign/macos/).
4. Re-run `npm run tauri build` — Tauri will sign and you then run `xcrun notarytool submit` + `xcrun stapler staple` on the resulting `.dmg`.

This is the only thing standing between the current build and a fully polished, warning-free distributable — everything else (data, functionality, packaging) is done.

## Database

SQLite file location on this machine: `~/Library/Application Support/com.menabig.tracker/menabig.sqlite3`. See `USER_GUIDE.md` for backup/restore instructions aimed at a non-developer.
