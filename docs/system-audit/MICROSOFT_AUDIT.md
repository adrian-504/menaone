# Microsoft 365 / Graph audit

Audited commit `4975b1c`. Files: `src-tauri/src/ms365/{auth.rs, graph.rs, commands.rs}`, `src-tauri/src/localfiles.rs`, `src/tabs/*` callers.

## 1. Current map

```
MENA One (desktop app, one Mac user)
  │
  ├─ Authentication ── ms365_connect (commands.rs:196)
  │     OAuth 2.0 authorization code + PKCE (S256) + state, public client (no secret)
  │     client_id + tenant_id: typed by the user in Settings → app_meta
  │     tenant fallback: /common
  │     system browser (tauri-plugin-opener) → loopback TcpListener 127.0.0.1:18473,
  │     redirect URI http://localhost:18473/callback, 180 s timeout
  │     scopes: offline_access User.Read Mail.ReadWrite Calendars.ReadWrite (auth.rs:56)
  │
  ├─ Token handling
  │     refresh token → macOS: /usr/bin/security add-generic-password -U … -w <token> -A
  │                     Windows: keyring crate (Credential Manager, windows-native)
  │     access token → memory only (Ms365State), refreshed 60 s before expiry
  │     ensure_access_token → refresh; failure → microsoft_account.status 'expired'/'error'
  │     account row: microsoft_account (single row, CHECK id = 1) — display name, email, status
  │
  ├─ Graph client ── graph.rs
  │     reqwest::Client::new() per call (graph.rs:12), no timeout, rustls
  │     base https://graph.microsoft.com/v1.0
  │     401 → UNAUTHORIZED_MARKER → refresh path; no 429 / Retry-After / 5xx retry
  │     graph_get_all follows @odata.nextLink up to a page cap (graph.rs:165)
  │
  └─ Services
        Profile   GET  /me
        Mail      GET  /me/messages?$filter=flag/flagStatus eq 'flagged' (paged)
                  PATCH /me/messages/{id} (flag complete / unflag)
                  open: web_link via opener (Outlook on the web)
        Calendar  GET  /me/calendarView?…&$top=250 (single page — graph.rs:263)
                  POST/PATCH/DELETE /me/events (Teams meeting via isOnlineMeeting)
        OneDrive  NOT via Graph — local sync folder on disk (localfiles.rs):
                  macOS ~/Library/CloudStorage/OneDrive*; Windows OneDriveCommercial/OneDrive env
        SharePoint / Teams channels / People / Contacts: not used
```

## 2. Findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| M1 | **No HTTP timeout** on any Graph or token request. A stalled network call keeps its async task pending; the UI shows a spinner indefinitely. | HIGH (reliability) | `graph.rs:12`, `auth.rs:194`, `intel.rs:243` |
| M2 | **The refresh token is passed as a command-line argument** to `/usr/bin/security` (`-w <token>`), where local processes can briefly see it in the process list. `-A` grants any application on this user account read access to the item. This was deliberate, to survive ad-hoc code-signing changes (comment at `auth.rs:255-270`), but it is a real weakening. | HIGH | `auth.rs:277-280` |
| M3 | **Calendar sync doesn't reconcile deletions.** It upserts by `outlook_event_id`; an event deleted in Outlook stays in `meetings` indefinitely (cancelled events are marked). | MEDIUM (correctness) | `commands.rs:543-562`; no DELETE for meetings |
| M4 | **The calendar window isn't paged** (`$top=250`, no nextLink); a busy range can silently truncate. | LOW | `graph.rs:263` |
| M5 | No throttling handling (429 / Retry-After) and no backoff. | LOW today (one user) / IMPORTANT for several | `graph.rs` |
| M6 | The sign-in error page reflects `error` / `error_description` from the redirect query **unescaped** into HTML served on localhost. It's only reachable during a live sign-in; no cookies or secrets on that origin. | LOW | `auth.rs:130-135` |
| M7 | The listener binds IPv4 `127.0.0.1` while the redirect URI says `localhost`. If the browser resolves localhost to `::1` first, the callback can fail. It works on macOS today; unverified on Windows. | LOW / Windows-risky | `auth.rs:46, 101` |
| M8 | **A single account** per installation (`microsoft_account` CHECK id=1, one keychain item). Personal Graph data (flagged mail, calendar) is written into the same DB tables as company data. | Architectural | `db.rs` microsoft_account; `emails`, `meetings` |
| M9 | Client ID and tenant ID are **entered per installation** in Settings and stored in `app_meta`. There's no organisational app registration baked in. Fine for one person; friction for a team. | Architectural | `commands.rs:107-128` |
| M10 | Scopes are delegated `Mail.ReadWrite` + `Calendars.ReadWrite`. They're the minimum for flag-completion and meeting creation; there's no narrower scope for either. | INFORMATIONAL | `auth.rs:49-56` |
| M11 | OneDrive is accessed through the local sync client, not Graph. That is simple, offline-friendly and needs no Files scope, **but** it ties every file reference to one machine's absolute path and to that user's OneDrive account. | Architectural | `localfiles.rs` |

## 3. Questions answered

| Question | Answer |
|---|---|
| Is Graph integration centralised? | **Yes.** All HTTP to Graph goes through `ms365/graph.rs`; all commands through `ms365/commands.rs`. |
| Is token handling robust? | **Mostly.** PKCE, state check, in-memory access token, refresh-on-demand and a status column are correct. Weak points: storage method (M2), no timeouts (M1). |
| Is auth coupled to one machine or user? | **Yes, both.** One keychain item, one account row, per-install client ID. |
| Can it support multiple users? | Not in one installation. With one installation per person it works *per person*, but each person's mail and calendar cache lands in their own local DB with nothing shared. That's acceptable only if company data isn't shared through that DB. |
| Delegated vs application permissions | Delegated only. **That is correct for mail, calendar and user files.** Application permissions would only suit a future server-side job and need tenant-admin consent. |
| Should Graph calls happen in the desktop app or a backend? | **Decision open** (ARCHITECTURE_DECISIONS_REQUIRED Q7). Personal mailbox and calendar reads can stay client-side under delegated auth. Anything shared (SharePoint document libraries, team calendars, org directory) is a candidate for a backend. |
| Is Microsoft identity suitable as the future app identity? | **Yes, and it's the obvious candidate.** The company already runs Microsoft 365 / Entra ID; the same sign-in can yield a stable user identifier (`oid` + `tid` from the ID token). Today the app **doesn't request `openid`** and doesn't keep `oid`; `/me` is used for display only. |

## 4. Minimum clean identity architecture (recommendation, not implemented)

The smallest design that separates the concerns without building a cloud:

1. **App user identity**
   - Sign in with Entra ID (`openid profile offline_access` plus the existing scopes).
   - Store `tenant_id` + `object_id (oid)` as the user key and UPN/email as attributes.
   - A local `users` (or extended `team_members`) row maps `oid` to the team directory.
2. **Organisation identity:** `tid` is the organisation. One tenant today; the key must still exist.
3. **Microsoft connection:** the delegated Graph token belongs to *that user* and is stored per user in the OS credential store, via the credential API rather than a CLI argument. The `microsoft_account` row gets keyed by `oid`, not `id = 1`.
4. **Authorisation:** simple roles (e.g. Admin / Member) on the user row, evaluated in the Rust command layer (and later, a server). No ACL engine.
5. **Session and device:** a device ID (random, stored locally) with the signed-in user ID. Actor on writes = user ID. Sign-out clears tokens and personal caches.
6. **What stays out of scope:** a custom password system, social logins, a hand-rolled JWT server. Entra ID provides the identity; the app only maps it.

**Separation of concepts:** *user* (oid) ≠ *Microsoft connection* (token set for that oid) ≠ *team member* (directory entry, may exist before the person signs in) ≠ *owner* (FK to user or team member on a record).

## 5. Classification

- **KEEP:** PKCE/state flow, centralised `graph.rs`, delegated scopes, flag-sync semantics, Teams meeting creation.
- **IMPROVE:** HTTP timeouts, Keychain storage method, calendar deletion reconciliation and paging, 429 handling, escaping on the error page.
- **DECIDE LATER:** Graph Files/SharePoint vs local OneDrive; backend-side Graph; organisational app registration.
