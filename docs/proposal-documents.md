# Proposal documents (Phase 4)

How a proposal becomes a deck, and how its versions are kept.

## Flow

Opportunity → Proposal (created from the opportunity, linked by `opportunities.proposal_id`) → review → **Generate proposal** → a new deck in the client's OneDrive folder → recorded in `proposal_documents` → shown under **Proposal documents** on the proposal page, newest first.

- **Entry points:** the proposal page toolbar and the "Proposal documents" section header both open the Generate dialog.
- **The dialog shows:**
  - the template (2026 master, service templates, or a saved template);
  - the file name;
  - the version it will save as;
  - errors and warnings;
  - the slides, the filled values, and the folder it writes to.
- **Source data:** the generator reads the proposal, its lines, company, contact, owner and entity from the database (`deck_values`). Nothing is copied into another structure. Before generating, the dialog saves pending proposal edits and waits for them, so the deck matches the page.

## Recording and versions (`generator.rs`)

- `generate_proposal` writes to `.<name>.partial`, renames it into place, then records the deck in one transaction (`record_generated_document`). If recording fails, the new file is removed.
- A name that already exists is refused: nothing is overwritten.
- **Version:** one past the highest `proposal` version recorded on the proposal, or the `_V<n>` in the file name when that is higher (`next_document_version`).
- **Next file name:** the dialog suggests the next file name past both the client folder's files and the recorded versions (`nextDeckFileName`). The dialog's "Will be saved as V<n>" note follows the name as it's typed.
- **Stored per document:** proposal id, kind (`proposal`), version, file name, path, notes ("Generated from …"), created date. No schema change.
- **Folder:** the client folder is saved on the proposal when it has none.
- **Earlier versions:** never changed. Removing a version from the proposal keeps its file. A deck added from the folder keeps the version in its name unless that number is already taken.
- **Writes:** decks are only written inside OneDrive (`OutputPolicy::OneDriveOnly`), however the client folder was found. Tests use `AnyFolder` with a temporary folder.

## Validation

- **Errors block generation.** The dialog's Generate button is disabled, and a real run returns "Cannot generate the proposal. Missing: …". Errors are:
  - the proposal has no client;
  - the template uses fields MENA One can't fill (they would stay in the deck as `{{placeholders}}`, from the build report's `missing_tokens`), labelled by field.
- **Warnings don't block.** They are:
  - known fields that are blank on this proposal ("Valid until is blank…");
  - no primary contact;
  - no slides known for a service;
  - rows without prices;
  - a long client name;
  - term-dependent Business Setup wording.
- No new mandatory fields were invented: only what the template itself needs.

## Failure

- A failed generation creates no document record and uses no version number. Examples: an existing name, an unreadable template, a folder that can't be written, or a folder outside OneDrive.
- It leaves no partial file and keeps every earlier version and its file.
- The dialog stays open with the error so the user can fix it and retry.

## Page

- **Section order:** Details (side) → Internal review → Commercials (summary and lines) → **Proposal documents** (version history) → Supporting documents (commercials, other files, the client folder) → Linked records → Notes → Activity.
- **Each version row shows:**
  - the version and full file name;
  - a Latest badge (newest only);
  - the status: Generated, Added from folder, or File missing (checked with `files_stat_paths`);
  - the type and date, and where it came from;
  - Open, Show in Finder, and Remove (the file stays).
- **After a successful generation:** the new version appears immediately with a "V<n> generated" message and an Open action.
- **Opportunity page:** its Files section lists the proposal's versions, so Opportunity → Proposal → Document is navigable both ways.

## Tests

- `src-tauri/tests/proposal_documents.rs`:
  - V1 then a separate V2;
  - failed generations record nothing and keep V2;
  - errors vs warnings;
  - version numbering;
  - document ↔ proposal ↔ opportunity links;
  - integrity report clean.
- The opt-in `real_proposal_workflow_on_a_database_copy` runs the same flow on a copy of a real database with the real templates, writing to a temporary folder.
- `src/lib/proposalDocuments.test.ts`: the version history after generation (Latest, order, file missing, no duplicates).
- `src/lib/commercial.test.ts`: next file name past recorded versions.
