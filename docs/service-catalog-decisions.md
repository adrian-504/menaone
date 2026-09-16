# Service catalogue: decisions

Owner session, 16 September 2026. This records **what each service is and what it is called**, so the catalogue, proposals and the commercial module stop carrying the same service under several names.

Prices are deliberately **not** in this file: the repository is public. Amounts, bands and rate cards stay in the pricing workbook and in the app's rate cards.

Nothing here is implemented yet.

## The catalogue after this session (19 services)

| # | Service | Shape | Notes |
|---|---|---|---|
| 1 | Business Setup | One-time (milestone payments) | Renamed from **Company Constitution**. |
| 2 | Company Maintenance | Monthly retainer, 12-month minimum | Maintains the company's documents, licences, certificates and government portals. Sold on its own as well as in the package. |
| 3 | Business Setup and Maintenance Package | Monthly, 12 months | Business Setup is **included at no charge**; its cost sits inside the monthly maintenance fee for the first year. Requires a 12-month term. |
| 4 | Company Liquidation | One-time (milestones) | Kept, though unused so far. |
| 5 | Administration and PRO | Monthly, employee bands | Administration and PRO are always one service, never sold apart. |
| 6 | Payroll | Monthly, employee bands | **GOSI option on the line, on by default.** Off for the rare client who wants payroll without GOSI. |
| 7 | GM Representative | Monthly retainer | MENA provides a Saudi GM to act as GM for a company being established that has not yet appointed its own. |
| 8 | Employer of Record | Monthly per person, by employee type, 12-month minimum | Renamed from **Workforce**. |
| 9 | National Staffing | Monthly per person | MENA's **own trained Saudi employees** contracted out to clients for work they are experienced in. Similar to EOR, different offering: the people are MENA's. |
| 10 | Manpower | Project-based | Project-based labour. |
| 11 | Recruitment | Percentage of annual package, by staff type | |
| 12 | Dedicated Recruiter | Monthly retainer | A recruiter assigned to the client; separate from percentage-based Recruitment. |
| 13 | Mobilization | Per visa / per country | Sellable on its own, not only alongside EOR. |
| 14 | Accountancy | Monthly packages | **VAT option on the line.** Package depends on whether the company has projects. A VAT return on its own is a one-time line, not a service. |
| 15 | Labour Law Consultancy | Monthly retainer | The main consultancy service (was simply "Consultancy"). |
| 16 | HR Consultancy | **Project with selectable tasks** | No standard proposal yet; see below. |
| 17 | Manpower Consultancy | Monthly retainer | Less demand than Labour Law. |
| 18 | Training Services | Customised | Live but low demand; proposal normally written for the client. |
| 19 | Other (Check Remarks) | — | Catch-all. Kept. |

## Renames and merges

Every old name stays as an **alias**, so proposals already sent keep reading exactly as they were written while pointing at the merged service.

| Old name | Becomes |
|---|---|
| Company Constitution | Business Setup (1) |
| Company Constitution & Maintenance Package | Business Setup and Maintenance Package (3) |
| PRO | Administration and PRO (5) |
| Admin PRO | Administration and PRO (5) |
| Admin PRO and Payroll | Two lines: Administration and PRO (5) + Payroll (6) — a usual combination, not a discounted package |
| Payroll and GOSI | Payroll (6) with the GOSI option on |
| Accountancy and VAT | Accountancy (14) with the VAT option on |
| Workforce | Employer of Record (8) |
| Consultancy | Labour Law Consultancy (15) |

## Rules agreed

- **One name per service.** No separate internal and client-facing names.
- **A package is a service** only when something changes commercially (Business Setup free inside the maintenance package). Services that merely tend to be sold together stay separate lines.
- **Options belong on the line, not in the catalogue** (GOSI on Payroll, VAT on Accountancy). The proposal line already carries this kind of flag for recruitment.

## HR Consultancy: a fifth pricing shape

The owner's HR Advisory master deck is a **project**, not a retainer: nine selectable tasks (Project Initiation, Organisation Structure, Job Descriptions, Grading Structure, Reward Structure, Annual Incentive Plan, Performance Management Framework, HR Policies & Processes, HR Delegation of Authority, Implementation Support), each with its own duration, delivered over about twelve months for one professional fee.

Every other service is monthly-by-band, per person, a percentage, or one-time. So HR Consultancy needs a line where you pick the tasks and quote one fee.

That deck also uses `[CLIENT]`-style markers rather than the `{{...}}` placeholders MENA One fills, and has no slide tags. Until it is converted it stays a manually written proposal.

## Consequences to work through (not done)

1. **Catalogue migration** with a review queue, in the same pattern as the company merges: each merge is confirmed, not guessed. Historic `proposal_lines.service_name` values are left untouched.
2. **Line options** for GOSI and VAT, including how they read on the generated deck.
3. **"Admin PRO and Payroll" lines** (7 of them) become two lines each — a decision per proposal, so they go through the review queue too.
4. **Deck wording:** renaming Workforce to Employer of Record and Company Constitution to Business Setup affects the master deck and the service templates. The decks must be updated in PowerPoint; MENA One does not rewrite slide text.
5. **Add a service without leaving the proposal** (today: Services → Catalog → New service).
6. **HR Consultancy** template conversion and the project/task line shape.
7. **Agreement types** follow the merged services; the mapping is revisited when the merge is built.

## Still open

- The client-facing wording for service 3 now that "Business Setup" is the term ("Business Setup and Maintenance Package", or something shorter).
- Whether **National Staffing** and **Manpower** need their own decks in the template library, or extend existing ones.
- Master-deck facts to confirm with the owner: the company figures (templates say 50+ clients / 15+ countries; the design system says 80+ clients / 35+ countries / 1,500+ EOR) and which Barcelona phone number is current.
