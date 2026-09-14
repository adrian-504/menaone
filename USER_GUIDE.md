# MENA BIG Tracker — User Guide

Plain-English guide for using and maintaining the app day-to-day. No technical background needed.

## 1. Launching the app

Double-click **MENA BIG Tracker.app** (in your Applications folder, or wherever you keep it). It opens like any other Mac app — its own window, its own icon in the Dock, no browser involved.

**First launch only:** because this build isn't notarized by Apple yet (see `README.md` if you want that fixed later), macOS may show a warning the very first time. If that happens: right-click (or Control-click) the app icon → **Open** → **Open** again in the dialog that appears. You only need to do this once; after that it opens normally with a plain double-click.

## 2. Where your data lives

Everything you enter — proposals, contacts, agreements, notes, tasks — is stored in one file on this Mac:

```
~/Library/Application Support/com.menabig.tracker/menabig.sqlite3
```

You do not need to open or manage this file directly. It's a real database, not a browser cache — it survives app updates, restarts, and (unlike the old browser version) it can't silently disappear if you clear your browser's history or switch browsers.

## 3. Importing your existing tracker data (one-time migration)

If you've been using the old `MENA_BIG_Tracker_24.html` file in a browser, bring that data into the new app once, like this:

1. Open `MENA_BIG_Tracker_24.html` in your browser (Safari or Chrome — whichever you normally used it in).
2. Click **Backup Data** in the left sidebar. This downloads a file named something like `MENABIG_Backup_2026-09-09.json`.
3. Open the new **MENA BIG Tracker** app.
4. In the left sidebar, click **Restore from backup** and select the file you just downloaded.
5. Confirm the prompt showing how many proposals/contacts/agreements/tasks/notes it found. Confirming **replaces everything currently in the app** with what's in that file — that's expected and correct for a first-time import into a brand-new, empty database.

**Important note about Notes / To-Do / Contact Lists / Company Notes:** the old HTML file had a bug (now fixed in this new app) where those four areas were never actually being loaded back into the page after the first time you opened it in a session — meaning if you added things there across multiple browser sessions, only the *last* session's worth of Notes/Tasks/Lists may have actually been saved, and earlier ones may have been silently overwritten. This is a pre-existing issue in the old file, not something the migration causes. Before you rely on the "Restore from backup" step above:
- Do it anyway — it will bring over whatever is currently sitting in your browser's storage for those sections, which is the best available copy.
- If something looks missing afterward (a note or task you remember adding), it likely didn't survive that old bug and unfortunately can't be recovered — there's no other copy to pull it from.
- Proposals, Contacts, and Agreements were **not** affected by that bug (they always loaded correctly), so those should come across complete.

**If you don't have your browser open or a recent backup handy:** a starter file built from the data embedded in the original `MENA_BIG_Tracker_24.html` (175 proposals, 59 contacts, 51 agreements) is kept outside the repository, because it holds real client data. Ask for it, and import it with **Restore from backup**. The browser export above is still the more complete option.

## 4. Backing up your data

Click **Backup Data** in the sidebar footer at any time. You'll get a native "Save As" dialog — choose wherever you want (Desktop, a shared drive, OneDrive, etc.) and it saves one JSON file containing everything: proposals, contacts, agreements, tasks, notes, folders, lists, and company notes.

**Recommendation:** do this weekly, and keep at least one copy somewhere other than this Mac (e.g. your OneDrive/MENA BIG shared drive) in case this computer is ever lost, stolen, or has a hard drive failure.

## 5. Restoring a backup

Click **Restore from backup**, pick a previously-saved `.json` file (either one made by this app, or the original `.html` tracker's own "Backup Data" export — both are supported). You'll see a summary of what it's about to restore, and restoring **replaces everything currently in the app** — so only do this if you're sure, or have your own backup of the current state saved first if you want to keep both.

## 6. Exporting data (CSV / HubSpot)

All the export buttons that existed in the old tracker are still here and work the same way — Database tab CSV export, Reports tab CSV export, Agreements CSV, the ActiveCampaign contacts export, and the two HubSpot exports (Deals CSV and Companies CSV) on the Reports tab. Each one now opens a native "Save As" dialog instead of silently dropping a file in your Downloads folder — pick where you want it saved.

## 7. Rebuilding the app (if a developer needs to)

See `README.md` for full build instructions. Short version, from a Terminal, inside the project folder:

```bash
npm install
npm run tauri build
```

The finished app appears at `src-tauri/target/release/bundle/macos/MENA BIG Tracker.app`.

## 8. What's needed for a fully "no warnings" build

Right now the app is signed well enough to run on this Mac and on other Macs (after the one-time right-click-Open step above), but it isn't Apple-notarized, so other Macs will show a Gatekeeper warning on first launch. Getting rid of that warning entirely requires a paid Apple Developer account (~$99/year) — see the **Code signing / notarization** section of `README.md` for the exact steps once that's available. Nothing about the app itself needs to change for that; it's purely a certificate/notarization step.
