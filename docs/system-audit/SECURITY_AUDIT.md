# Security audit

Audited commit `4975b1c`. **Threat model today:** a single user on a personally managed Mac. No server, no inbound network surface except a temporary loopback listener during Microsoft sign-in. The realistic attackers are:

- other software on the same Mac;
- hostile *content* entering the app (email subjects and previews from external senders, RSS feed items, imported files);
- someone obtaining a copy of the database or backups;
- accidental publication (the GitHub repo is **public** by owner choice).

Severities: **CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL**.

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 4 |
| LOW | 5 |
| INFORMATIONAL | 5 |

## Findings

### HIGH

**S1. The Microsoft refresh token is written to Keychain with `-A` via the command line.**
- **Where:** `src-tauri/src/ms365/auth.rs:277-280`
- **Detail:** `/usr/bin/security add-generic-password … -w <token> -A`. The token appears in the argument vector of a child process, visible briefly to local process listing. `-A` lets *any* application running as this user read the item without a prompt.
- **Why it matters:** a long-lived delegated token with `Mail.ReadWrite` and `Calendars.ReadWrite`.
- **Why it's done this way:** it keeps sign-in alive across ad-hoc-signed rebuilds (comment at `auth.rs:255-270`, `Cargo.toml:52`).
- **Direction:** pass the secret via stdin or the Security framework, and restrict the ACL once the app has a stable signing identity. Proper code signing (ARCHITECTURE_DECISIONS_REQUIRED Q10) is the real fix.

### MEDIUM

**S2. Any HTML-injection bug becomes full data access.**
- **Where:** `tauri.conf.json` CSP `script-src 'self' 'unsafe-inline'`, plus 124 IPC commands granted to the main window
- **Detail:** the UI renders with `innerHTML` (312 sites) and 814 inline `on*=` handlers, so inline script can't be disallowed without a large refactor. External content (flagged email subject, sender and preview; RSS titles and summaries; imported file names) reaches these templates.
- **Mitigation in place:** a sample review found `escHtml` used consistently on those fields; notes render via CodeMirror (DOM, not HTML strings); `withGlobalTauri: false`.
- **Why it stays MEDIUM:** a single missed escape would let a hostile email subject call `wipe_all_data`, `import_backup_json` or `set_app_meta`. Safety rests on convention and no test enforces it.

**S3. `set_app_meta` accepts any key and value.**
- **Where:** `commands.rs:1244`
- **Detail:** it bypasses the validation in `set_proposals_root` (OneDrive check at `commercial.rs:1280`) for `proposals_root`, `proposal_library_dir`, `proposal_master_path` and `ms365_client_id` / `ms365_tenant_id`.
- **Impact:** limited, because generation still refuses non-OneDrive output (`OutputPolicy::OneDriveOnly`, Phase 4). But it widens what S2 could reach, e.g. repointing the sign-in client ID.
- **Direction:** an allow-list of UI-state keys; route config keys through validated commands.

**S4. The database, backups and attachments are stored in plaintext.**
- **Where:** `~/Library/Application Support/com.menabig.tracker/`
- **Detail:** live DB, 14 daily backups, about 16 manual `pre-*` copies, and `attachments/`. Contains client names, contacts, commercial terms and cached email metadata. Protection relies entirely on FileVault and the user account.
- **Acceptable single-user;** it becomes a policy question (PDPL, device loss) for a team.

**S5. The public repository versus client data.**
- **Detail:** the repo is public by owner choice. Tracked files contain no DB files, no `.env`, no GUID client or tenant IDs and no secrets (checked with `git grep`). `src-tauri/tests/legacy_seed_backup.json` is fictional.
- **Risk:** future commits (test fixtures, screenshots, docs) accidentally including real client names or data. There is **no automated guard** such as a pre-commit or CI PII scan.

### LOW

**S6. The sign-in error page reflects `error` / `error_description` unescaped.**
- **Where:** `auth.rs:130-135`
- **Detail:** only during a live sign-in, on a localhost origin with no cookies.

**S7. `template_inspect(path)` and `template_save` accept any filesystem path.**
- **Where:** `generator.rs:165, 182`
- **Detail:** they parse it as a pptx; read-only, returns slide text. The logo image path is read from anywhere.

**S8. No HTTP timeouts.**
- **Where:** `graph.rs:12`, `auth.rs:194`, `intel.rs:243`
- **Detail:** mainly reliability; a hostile or slow feed server can hang a fetch indefinitely.

**S9. Destructive commands are callable from the UI layer.**
- **Where:** `wipe_all_data`, `import_backup_json`
- **Detail:** both snapshot first (`backups::snapshot_before_change`).

**S10. The build is ad-hoc signed and not notarised, with no update channel.**
- **Detail:** users can't verify updates, and Gatekeeper and Keychain behaviour depends on this (see S1). There's no updater, so no update-channel attack surface either.

### INFORMATIONAL

- **S11. OAuth is done correctly for a public client:** PKCE S256, `state` checked, no client secret, system browser rather than an embedded webview.
- **S12. Scopes are the minimum for the features:** `Mail.ReadWrite` and `Calendars.ReadWrite` (flag completion and Teams meeting creation). Nothing broader, e.g. no `Files.*` or `Sites.*`.
- **S13. The Tauri capabilities are narrow:** `core:default`, set-title, start-dragging, `opener:default`, `dialog:default`, `notification:default`. The capture window has its own smaller set. No shell or fs plugin is exposed to JS.
- **S14. Path traversal is guarded where files are written or opened:**
  - `attachments.rs` `safe_file_name` (with tests)
  - `localfiles.rs` `is_within_onedrive` / `validate_within_onedrive` (rejects `..`, canonicalises)
  - proposal generation writes a `.partial` file, renames it, and checks the final folder
- **S15. There is no telemetry and no third-party network calls** beyond Microsoft identity/Graph and the configured RSS sources.

## Future multi-user security needs (not current defects)

- **Per-user identity:** activity actor, owner, created-by and updated-by.
- **Authorisation** enforced in the backend command layer, not the UI.
- **Separation of each user's personal data** (mail, calendar, preferences) from shared company data.
- **Encryption at rest policy** and backup retention; a data-residency decision (PDPL).
- **Audit log** that users cannot rewrite (today `activity` is written by local triggers and is fully editable by anyone with the file).
- **Revocation:** signing out a departed employee and removing their local copy.
