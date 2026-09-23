# MENA One — User Guide

Plain-English guide for using and maintaining the app day to day. No technical background needed.

## 1. Launching the app

Double-click **MENA One** in your Applications folder (there are copies on the Desktop and in the MENA App OneDrive folder too). It opens like any other Mac app — its own window and Dock icon, no browser involved.

**First launch only:** the app isn't notarized by Apple yet (see §8), so macOS may warn you the very first time. Right-click (or Control-click) the app → **Open** → **Open** again. After that it opens normally.

## 2. Where your data lives

Everything — companies, contacts, opportunities, proposals, agreements, projects, meetings, tasks, notes, commitments and settings — is in one database file on this Mac:

```
~/Library/Application Support/com.menabig.tracker/menabig.sqlite3
```

You never need to open it. It survives app updates and restarts. Microsoft 365 sign-in details are kept in the Mac's Keychain, not in this file.

**Automatic copies:** the app saves a copy of the database every day (the last 14 are kept), before every update that changes the database, and before any restore, import or wipe. Settings → Data Backup shows them and opens their folder.

## 3. Importing from the old HTML tracker (one-time, already done)

The data from the old `MENA_BIG_Tracker_24.html` was brought over in September 2026. If you ever need to do it again: in the old file click **Backup Data**, then in MENA One use **Settings → Data Backup → Restore from backup…** and pick that `.json` file. It replaces the proposals, contacts, agreements, tasks and notes with the old file's (commitments are cleared, since the old tracker had none).

## 4. Backing up your data

**Settings → Data Backup → Save a backup file…** writes one file (`MENA One backup <date>.sqlite3`) wherever you choose. It is a complete copy of everything in MENA One: every record, list and setting, including anything added in later versions.

**Keep it in the MENA BIG OneDrive only.** The file contains client correspondence — cached Outlook data such as flagged emails, meeting attendees and invite text — so treat it like the client files themselves: not on a personal drive, a USB stick or in email.

Saving over an older backup file is safe: the new file is written first and only then replaces the old one, so a failed save never loses the backup that was there.

**Recommendation:** save one weekly, in the MENA BIG OneDrive, in addition to the automatic daily copies on this Mac (they don't help if the Mac itself is lost).

## 5. Restoring a backup

**Settings → Data Backup → Restore from backup…** and pick a backup file. MENA One checks the file first (that it opens, isn't damaged, is a MENA One backup and isn't from a newer version of the app) and shows what it holds before you confirm. Restoring **replaces everything currently in the app**; a copy of your current data is saved first, and if the restore fails part-way the app puts your data back by itself. A backup from an older version is brought up to date automatically. Older `.json` backups also restore.

**Restoring on another Mac:** the backup also holds settings that belong to one computer — the Proposals and client-files folder locations and the reminders already shown. After restoring on a different Mac, open **Settings** and point the folder locations at that Mac's OneDrive, and sign in to Microsoft 365 again.

## 5a. A client's page, pinned notes, decision makers and the Brief

**Where we stand.** A company's page opens with a few plain sentences: the relationship and what they pay, what's in flight and who it's waiting on, when you last met or emailed, who owes what, and any pinned notes. Below them are the open threads, the people, the timeline and the company notes, then every kind of record the company has — proposals, agreements, opportunities, projects, meetings, tasks, commitments, notes, files and linked emails — each open with its count. Kinds with nothing yet are one line at the bottom with their **+ New**.

**Pinning a note.** In **Company notes**, click the pin beside a note to show it at the top of the page and in the Brief. Click it again to unpin. Pinning doesn't change the note's date.

**Decision maker.** On a company's People list, open a person's **…** menu and choose **Decision maker** (or use the **…** menu on the contact's own page). Decision makers are listed first. It's the only tag — everything else comes from the person's job title.

**The Brief.** Click **Brief** on a company's page, or press ⌘K and type "brief" and the company name. It's one page to read before a meeting: where you stand, open threads, people, open commitments and the next meeting. **Print or save as PDF** prints just that page, always in Light.

## 6. Exporting data (CSV / HubSpot)

All the export buttons that existed in the old tracker are still here and work the same way — Database tab CSV export, Reports tab CSV export, Agreements CSV, the ActiveCampaign contacts export, and the two HubSpot exports (Deals CSV and Companies CSV) on the Reports tab. Each one now opens a native "Save As" dialog instead of silently dropping a file in your Downloads folder — pick where you want it saved.

## 7. Rebuilding the app (if a developer needs to)

See `README.md` for full build instructions. Short version, from a Terminal, inside the project folder:

```bash
npm install
npm run tauri build
```

The finished app appears at `src-tauri/target/release/bundle/macos/MENA One.app`. Use `scripts/build-and-sign.sh` so the Microsoft 365 sign-in survives the update.

## 8. What's needed for a fully "no warnings" build

Right now the app is signed well enough to run on this Mac and on other Macs (after the one-time right-click-Open step above), but it isn't Apple-notarized, so other Macs will show a Gatekeeper warning on first launch. Getting rid of that warning entirely requires a paid Apple Developer account (~$99/year) — see the **Code signing / notarization** section of `README.md` for the exact steps once that's available. Nothing about the app itself needs to change for that; it's purely a certificate/notarization step.
