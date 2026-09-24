# Phone sync over OneDrive — the contract (v1)

Two apps, one folder, no server. The Mac (MENA One) writes one file the phone reads; the phone writes small files the Mac imports. Nothing is edited in two places, so nothing conflicts. Both sides read this document; neither may change the shapes below without changing the version string and telling the other.

## The folder

Default: `~/Library/CloudStorage/OneDrive-MENABusinessInvestmentGroup/MENA One Phone/` on the Mac. It appears in the iPhone Files app under OneDrive → MENA One Phone. The Mac stores the chosen path in `app_meta` under `phone_root`; it must be inside a synced OneDrive root (the same rule as the proposals folder). The same layout works unchanged in an iCloud Drive folder if OneDrive's Files provider misbehaves.

```
MENA One Phone/
  snapshot.json              Mac → phone. Rewritten whole, atomically (write .tmp, rename).
  inbox/                     phone → Mac. One file per capture, named <id>.json.
  inbox/done/YYYY-MM/        Mac moves an imported file here.
  inbox/failed/              Mac moves an unreadable/unapplicable file here, with <id>.error.txt beside it.
```

## snapshot.json  (`"format": "mena-one-phone/1"`)

Small (target under 500 KB; warn above 2 MB). Dates are `YYYY-MM-DD`; times are ISO 8601 with offset. Ids are the Mac's record ids and are stable for this Mac. Every array may be empty; every nullable field is present with `null`.

```jsonc
{
  "format": "mena-one-phone/1",
  "generatedAt": "2026-09-24T09:12:03+03:00",
  "today": "2026-09-24",                       // the Mac's local date when written
  "mac": "Ahmad's MacBook Pro",
  "importedCaptureIds": ["b7e1…", "…"],        // last 200 capture ids the Mac has applied
  "failedCaptures": [ { "id": "…", "error": "Unknown company" } ],   // still in inbox/failed

  "attention": [                               // My Day → Attention, same rules, same order
    { "key": "proposal:41:approved", "kind": "review", "tone": "amber", "score": 86,
      "title": "Logitech", "companyId": 174, "companyName": "Logitech",
      "reason": "Approved by Hassan — send it to the client · Admin & PRO",
      "when": null, "record": { "kind": "proposal", "id": 41 }, "commitmentId": null,
      "children": [] }                         // group rows carry their folded items here
  ],

  "meetings": [                                // not cancelled, last 30 days + next 30 days
    { "id": 88, "title": "Kick-off", "date": "2026-09-25", "startAt": "2026-09-25T10:00:00+03:00", "endAt": "2026-09-25T11:00:00+03:00",
      "companyId": 174, "companyName": "Logitech",
      "attendees": ["Sara Haddad"], "attendeeEmails": ["sara@logitech.com"],
      "location": "Riyadh, KAFD Tower 2", "isOnline": false, "onlineMeetingUrl": null,
      "agenda": "…", "decisions": null, "actionItems": null, "followUp": null }
  ],

  "tasks": [                                   // open todos
    { "id": 91, "title": "Send revised fee schedule", "dueDate": "2026-09-26", "priority": "High",
      "companyId": 174, "companyName": "Logitech", "projectId": null, "commitmentId": 44 }
  ],

  "promises": [                                // commitments: open, plus kept/dropped in the last 30 days
    { "id": 44, "direction": "ours", "text": "Send revised fee schedule", "dueDate": "2026-09-26",
      "status": "open", "closedAt": null,
      "companyId": 174, "companyName": "Logitech",
      "contactId": 12, "contactName": "Sara Haddad", "contactEmail": "sara@logitech.com",
      "sourceType": "meeting", "sourceId": 88, "todoId": 91 }
  ],

  "companies": [                               // not archived
    { "id": 174, "name": "Logitech", "industries": ["Technology"], "country": "Saudi Arabia", "city": "Riyadh", "status": "Client",
      "relationship": { "label": "Client", "tone": "green" },
      "brief": [ "Client since Mar 2026 on Admin & PRO — SAR 18,500 a month.",
                 "In flight: Payroll proposal in internal review.",
                 "Last spoke 6 days ago (meeting)." ],   // companyBrief clauses as plain text, same order
      "threads": [ { "kind": "proposal", "label": "Payroll proposal", "stand": "In internal review since 18 Sep" } ],
      "lastContact": { "date": "2026-09-18", "label": "Meeting · Kick-off", "kind": "meeting" },
      "contacts": [ { "id": 12, "name": "Sara Haddad", "role": "HR Director", "email": "sara@logitech.com",
                      "phone": "+966501234567", "whatsapp": "+966501234567", "isDecisionMaker": true } ],
      "pinnedNotes": [ { "id": 7, "body": "Prefers WhatsApp; no calls before 10.", "createdAt": "2026-08-02" } ],
      "recentMeetingIds": [88], "openTaskIds": [91], "openPromiseIds": [44] }
  ],

  "comingUp": [                                // next 7 days, My Day → Coming up
    { "date": "2026-09-25", "entries": [ { "kind": "meeting", "id": 88, "label": "Kick-off · Logitech", "time": "10:00" } ] }
  ]
}
```

## inbox/<id>.json  (`"format": "mena-one-capture/1"`)

One capture per file, written once, never edited. `id` is a UUID the phone generates; the Mac uses it to import each file exactly once.

```jsonc
{
  "format": "mena-one-capture/1",
  "id": "b7e1c2d4-…",
  "createdAt": "2026-09-24T14:05:11+03:00",
  "device": "Ahmad's iPhone",
  "kind": "commitment",                        // commitment | task | note | keep | done

  "text": "Send the revised fee schedule",     // commitment, task, note
  "direction": "ours",                         // commitment only: ours (we owe) | theirs (they owe)
  "companyId": 174, "companyName": "Logitech", // either may be null; id wins when both are given
  "contactId": 12,                             // commitment only, optional
  "dueDate": "2026-09-30",                     // optional

  "commitmentId": null,                        // keep: the promise to mark kept
  "todoId": null                               // done: the task to complete
}
```

## What the Mac does with each kind

| kind | Mac action | Then |
|---|---|---|
| `commitment` | `commitments_add` with `sourceType: "capture"`, `sourceKey: "phone:<id>"`, company/contact/due as given. `ours` gets its task through the existing trigger. | appears in Promises and, if ours, in Tasks |
| `task` | new open todo, `client` = company name | appears in Tasks |
| `note` | with a company: a company note entry; without: `inbox_items` (`item_type: note`) | appears on the company page or in Inbox |
| `keep` | commitment → `kept` (its task closes by trigger) | |
| `done` | todo → done (its commitment is kept by trigger) | |

Rules: import is idempotent (`phone_imports.capture_id` primary key); each file is applied in one transaction; unknown `companyId` with a `companyName` falls back to name matching, and with neither match the capture still lands, unlinked; unparsable files go to `inbox/failed/` and are listed in the next snapshot's `failedCaptures`; the snapshot is rewritten after every import so the phone sees its capture confirmed by `importedCaptureIds`.

## Timing

- Mac writes the snapshot at launch, ten seconds after the last data change, after every import, and at least hourly. It skips the write when the content is unchanged.
- Mac scans `inbox/` at launch, on window focus and every 60 s. Files younger than 2 s are left for the next scan.
- Phone re-reads the snapshot on foreground, on pull-to-refresh and every 5 min while active, and always keeps the last good copy for offline reading. It shows "Updated on the Mac 3 min ago" from `generatedAt`.
- A capture shows on the phone as "Sending to Mac" until its id is in `importedCaptureIds`, or "Could not be added" if it is in `failedCaptures`.

## What v1 does not do

No editing of records on the phone, no proposals, no agreements, no emails, no files, no notifications, no sign-in (the phone reads only what the owner's own OneDrive holds). When the Azure server arrives, the phone swaps `snapshot.json` for `GET /snapshot` and the inbox folder for `POST /capture`; the screens do not change.
