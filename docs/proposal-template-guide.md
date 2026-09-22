> **Superseded (22-Sep-2026):** MENA One builds proposals from the service templates in `Proposals New Logo` or the 2026 master; single saved templates are no longer offered. See [proposal-generation.md](proposal-generation.md). Kept for history.

# Preparing the master proposal deck

MENA One builds each client's proposal from one PowerPoint file. For every
proposal it keeps the slides that proposal needs, fills in the client's
details and the fee table, and saves the result in the client's OneDrive
folder as the next version (`<Client>_<Services> Proposal_<DD.MM.YYYY>_V<n>.pptx`).

> **Current templates work without placeholders.** MENA One already fills the
> existing decks the way the team does by hand: 'Client Name', cover and letter
> dates, the country under "Attn:", the client logo in the "Logo" box, agenda
> page numbers, and fee amounts on rows naming a proposal's service. Any other
> amount is listed for checking. The steps below make the master deck fully
> automatic (fee tables per service, totals, contact names).

## 1. One file with every slide

Put everything any proposal could need into a single deck, in the order it
should appear:

- Cover and letter
- Agenda (without typed page numbers — slides are removed per proposal)
- One module per service (overview, detailed approach, value, fees)
- Commercials / project fees
- Terms & conditions, confidentiality, acceptance
- About MENA BIG, references, back cover

Keep all slides in one file. Copying slides between decks later is much harder
than hiding them.

## 2. Say when each slide is used

Type a tag in the slide's **speaker notes**:

| Tag | Meaning |
|---|---|
| `[always]` | In every proposal |
| `[services: Payroll, PRO]` | Only when the proposal includes one of these services. Use names from **Services → Catalog**, or a category such as `Workforce Services` |
| `[entity: KSA]` or `[entity: EU]` | Only for that MENA BIG entity (can be combined with the others) |
| `[never]` | Kept in the file but never used |

A slide without a tag counts as `[always]`. Every rule can also be changed in
MENA One after the file is added (**Services → Proposal templates**).

## 3. Placeholders

Type these where the details go. Formatting of the first character is kept.

| Placeholder | Example |
|---|---|
| `{{client_name}}` | Acme Holdings |
| `{{client_legal_name}}` | Acme Holdings Co. Ltd (falls back to the name) |
| `{{client_city}}`, `{{client_country}}` | Riyadh, Saudi Arabia |
| `{{contact_name}}`, `{{contact_title}}`, `{{contact_email}}` | Jane Doe, HR Director |
| `{{proposal_ref}}` | SL# 214 |
| `{{proposal_date}}` | 13 September 2026 |
| `{{proposal_date_ordinal}}` | 13th September 2026 |
| `{{proposal_date_weekday}}` | Sunday, 13th September 2026 |
| `{{proposal_date_short}}` | 13.09.2026 |
| `{{valid_until}}` | 13 October 2026 |
| `{{services}}` | Payroll, PRO and Recruitment |
| `{{monthly_total}}`, `{{one_time_total}}`, `{{contract_value}}` | SAR 9,000 |
| `{{contract_term}}` | 12 months |
| `{{currency}}`, `{{vat_rate}}`, `{{entity_name}}` | SAR, 15%, MENA BIG KSA |
| `{{owner_name}}`, `{{owner_title}}`, `{{owner_email}}` | The proposal owner |

Write the date as one placeholder: a superscript "th" typed separately stays behind.

## 4. The fee table

Make a table with a header row and **one** data row containing line
placeholders. MENA One repeats that row once per service on the proposal:

| # | Service | Scope | Billing | Amount |
|---|---|---|---|---|
| `{{line.number}}` | `{{line.service}}` | `{{line.description}}` | `{{line.billing}}` | `{{line.amount}}` |

Also available: `{{line.quantity}}`, `{{line.unit_price}}`. Put totals such as
`{{monthly_total}}` in a row below the repeating row, or in a text box.

## 5. Small things that avoid surprises

- Set text boxes holding client names to **Shrink text on overflow**.
- Keep each placeholder in one text box; don't split it across boxes.
- The client logo box can't be filled automatically yet; leave it as a picture placeholder.
- Save as `.pptx` in OneDrive, then add it under **Services → Proposal templates**.
