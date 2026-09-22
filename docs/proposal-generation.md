# How MENA One builds a proposal

One page on what happens when you press **Generate**, the rules the templates follow, and what the tests guarantee. (Owner decisions of 22-Sep-2026; the per-deck detail is in `src-tauri/src/proposal_library.rs`, `smartfill.rs`, `feefill.rs` and `master.rs`.)

## Two designs

- **Current design (default):** built from the service templates in `Proposals Templates/Proposals New Logo`.
- **2026 design:** built from `Proposals Templates/MENA BIG Proposal Master 2026.pptx` (tagged slides and `{{fields}}`), generated from `tools/proposal-master`.

## The pipeline (current design)

1. **Lines → services.** Each proposal line's service maps to a module (Administration & PRO, Payroll & GOSI, Business Setup, Business Setup & Maintenance package, Company Maintenance, Employer of Record, Recruitment Advisory, Labor Law Consultancy, …).
2. **Lead deck.** The template of the **first line's** service leads: its cover, letter, agenda and **general terms** are the proposal's.
3. **Other services** bring in their own scope and fee slides from their template. The Business Setup and Maintenance package also shows Company Maintenance's detailed approach; its pricing stays the package's.
4. **Terms once.** The general terms come from the lead deck. Other services' clauses that aren't already there (compared sentence by sentence; clauses the decks word differently count as one) are gathered on labelled service-terms slides ("Recruitment Advisory · Early Termination"). One acceptance slide.
5. **Order and numbering.** Service sections follow the order of the lines; "PART n" dividers are renumbered; agenda page numbers are recounted.
6. **Cover and letter** name every service when there is more than one.
7. **Smart fill.** Client name (any case: 'CLIENT NAME' gets the name in capitals), dates, country, logo (letter slide), fee rows from the lines' priced rows, and the contract term: "1 year minimum" and similar wording follow the proposal's term. Amounts the fill can't place are listed as *check in PowerPoint*.
8. **File.** The deck is saved as the next version in the client's OneDrive folder and recorded on the proposal; a proposal at *Proposal Request Received* moves to *Drafting*.

The 2026 design follows the same rules with tags instead of templates: slides are chosen by `[module: …]`, sections are ordered by the lines, and `{{fields}}` are filled.

## Rules for the templates

- **Name:** only files named `… Template.pptx` are read. Other decks saved in the folder (sent proposals) are ignored and listed on the Services → Proposal templates page. The All Services deck is a reference copy, not a source.
- **Placeholders:** the client is written `'Client Name'` (or `'New Client'`), in any case.
- **No highlight** marks: they reached the client before. The template check refuses them.
- **Terms:** one general block per deck, plus that service's own clauses; a service's clauses stay in its own deck. Service-specific terms slides name the service in their subtitle ("Assumptions and Limitations – Recruitment Advisory Services").
- **Contract length** is written "Unless previously terminated, this Agreement will initially to complete duration of 1 year minimum." so the term rewrite finds it.
- **Fixed template figures** — the Employer of Record visa-recovery amount, the Business Setup early-termination penalties, and the figures on the Constitution / Maintenance fee slides — are owner-confirmed standards (22-Sep-2026), not placeholders. The fee on the Company Liquidation template is a sample: it is replaced by the proposal's line price, and flagged when no price is set.
- **Recruitment** is proposed separately; Employer of Record decks carry no recruitment slides.
- **Business Setup package** is free setup with a 12-month term; a shorter term charges the setup (the owner's rule of 14-Sep-2026) and drops the "free setup" slide.

## What the tests guarantee

`src-tauri/tests/proposal_audit.rs` (opt-in, on a database copy, output only in a scratch folder — the real Proposals folder is checked unchanged):

- `matrix_is_consistent` — every active service alone and the common combinations, at 6 and 12 months: cover and letter name every service; one notice period in the general terms; no repeated clause; PART numbers in order; agenda = section starts; no placeholder, highlight or leftover one-year wording; every priced row's amount on the deck; status *Drafting*.
- `mixed_proposal_is_consistent`, `generates_real_decks_on_a_database_copy` — the same checks on named cases, both designs.
- `keeps_terms_for_every_service`, `terms_stay_in_their_own_deck`, `templates_are_clean`, `lists_placeholder_like_text` — the template rules above.

## Adding or changing a template

1. Edit or add `<Service> … Template.pptx` in `Proposals New Logo` (archive the old file first).
2. Keep the rules above; run `templates_are_clean`, `keeps_terms_for_every_service` and `terms_stay_in_their_own_deck` on the folder, then `matrix_is_consistent` on a database copy.
3. For the 2026 design, change `tools/proposal-master` and rebuild the master.
