# Phone app — skeleton and the road to iOS

> **Now (24 Sep 2026):** the iPhone app is being built as a SwiftUI companion that syncs through a OneDrive folder — see [phone-sync.md](phone-sync.md).
> `mobile/` and `mobile-api/` stay in the repo but are superseded until the Azure server arrives.

What exists today, what it is standing in for, and what has to be true before this becomes an app on a phone. Written 16 September 2026 after the owner interview.

## What the owner asked for

| Question | Answer |
|---|---|
| When is the phone used | At a client's office, travelling, evenings, away from the desk — all four |
| What it must do | Look things up · capture quickly · respond and tick off. **Not** full editing |
| Data freshness | Live, both ways |
| Server | Willing to pay for a small cloud service now |
| Hosting | Azure, inside the company's Microsoft tenant |
| Users | Just the owner for now, colleagues later |
| What syncs | Business records only — no mail cache, no calendar copy |
| Offline | **Read offline, capture needs a connection** |

That last answer is the most valuable one. Allowing edits offline means two copies of a record changing in two places, which is the hardest part of any sync system. Reading offline and refusing to write offline removes it entirely.

## What is built

**`mobile/`** — the phone interface. Four screens, plain HTML and JavaScript, no framework and no build step:

- **Today** — meetings, agreements running out (with notice dates), what is due.
- **Clients** — search, then the page you want sixty seconds before walking in: contacts with call/WhatsApp/email, latest notes, live agreements, recent proposals, open tasks.
- **Tasks** — what is open.
- **Capture** — a task or a note, dictation-friendly.

**`mobile-api/`** — the API those screens talk to. Runs on the Mac today, opens the database **read-only**, and serves the routes the real backend will serve:

```
GET  /api/me            who is signed in            (stub — Entra sign-in not built)
GET  /api/today         meetings, attention, tasks
GET  /api/clients       the lookup list
GET  /api/clients/:id   one client
POST /api/capture       a task or note written on the phone
```

## Running it

```bash
sqlite3 "file:$HOME/Library/Application Support/com.menabig.tracker/menabig.sqlite3?mode=ro" ".backup /tmp/phone.sqlite3"
cd mobile-api && cargo run -- --db /tmp/phone.sqlite3
```

Then open `http://<this Mac's address>:1421` on a phone on the same wifi. On iOS, *Share → Add to Home Screen* gives it an icon and a full screen, which is close enough to an app to judge whether the screens are right.

## What is real and what is pretend

**Real:** the screens, the data (your own records), the API shape, the offline reading fallback, the refusal to capture without a connection.

**Pretend, deliberately:**
- **Sign-in.** `/api/me` returns a stub. Real identity is Microsoft Entra, and it is the first thing the cloud work must deliver.
- **Capture is held, not written.** The skeleton keeps a captured note in memory and says so. Writing it for real belongs to a backend that can decide whether the writer is allowed to write.
- **The Mac is standing in for the server.** Same routes, different machine.

A skeleton that faked the writes would feel more finished and teach us less.

## What this told us on day one

- **Missing phone numbers break the best use case.** The client page offers Call and WhatsApp when a contact has a number. Most contacts have only an email, so the "ring them from the car" moment does not work yet. That is a data problem, not an app problem, and it is cheap to fix.
- **Agreements with no dates produce an empty Today.** The attention list is driven by end dates and notice periods. Until the contract review lands, that section is mostly empty — the phone makes the gap obvious in a way the desktop does not.
- **Meeting locations are unreadable on a phone** — Outlook sends a full postal address and a joining link. The phone shows the first part, or "Online".

## The road to an app on the phone

1. **Decide the tenant and region** (Azure inside the Microsoft tenant, region to confirm). Nothing real can leave this Mac before this is settled.
2. **Identity first.** Entra sign-in, a user record, and every record carrying who owns it. This is the audit's recommended foundation and the phone needs it anyway.
3. **The API in Azure**, serving these same routes against a central database, with the desktop app writing there too.
4. **Then the phone app**: wrap these screens (Tauri iOS or a native shell), add the offline read cache, add the Apple Developer account, and distribute through TestFlight.

Steps 1–3 are the cloud project. Step 4 is a few weeks. Anyone who tells you the phone app is the hard part has not looked at where the data lives.
