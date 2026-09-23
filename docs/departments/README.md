# Department modules: how we'll discover them

**Status: exploration (23 September 2026). Nothing is being built.** Recruitment, Administration and PRO, Finance and Payroll will each get their own area in MENA One, one at a time, with no rush. The goal is that someone from a department opens the app and sees their own work.

## The idea in one paragraph

Today MENA One follows a client up to the signature. The departments do the work after it. So the modules are the second half of a client's life in **one** app, not four separate apps. They share the company, contacts, services and timeline that already exist. Each department gets a sidebar area and a home page of its own, like My Day. On Company 360 each department's work shows as one quiet line under Open threads.

## Owner decisions so far (23 Sep 2026)

1. **Finance covers both** MENA's own invoicing and collections **and** the Accountancy & VAT service we deliver to clients.
2. **Departments already use Excel, HR/payroll software and accounting software.** MENA One coordinates the work (the client, what they bought, what's due, who's on it, where it stands) and doesn't replace those systems.
3. **Each department's Director** is the first user and co-designer.
4. **Department staff see their own clients and work only**, not proposals or the pipeline. Whether each person has assigned clients or the whole team shares them **differs by department**. **Directors** also see a client once it's signed, with the proposal that was signed. **The owner and Hassan** see every department and every client.
5. **Admin & PRO goes first.** It also runs Business Setup, Company Maintenance and GM Representative.
6. **Employer of Record is split**: Admin & PRO handles visas, iqamas and mobilization, and Payroll handles salaries. There is no single owner.
7. **The app holds the personal data itself** (ID numbers, salaries, bank details), so staff don't need a second tool for it. See "Holding personal data" below.
8. **There's no handover system today.** A department may learn about a new client by email from Sales, at a kickoff meeting, informally, or from Finance.
9. **Scope is these four departments.** National Staffing, Manpower, Labour Law and HR Consultancy, and Training are not part of it.
10. **Clients will eventually see some of this themselves** (requests, expiring documents, invoices). This isn't planned yet, but records should be designed so that a client-facing view can be added later.
11. **Arabic** may be needed for Admin & PRO. Ask its Director.
12. About 10–25 people across the four departments. The owner runs the Director conversations with these guides. Anything built before the shared version is tried by the owner first, with fictional data.

## Order

Admin & PRO (decided) → Recruitment → Payroll → Finance.

- **Admin & PRO** is closest to what the app already does: requests, deadlines, clients and documents.
- **Recruitment** is a self-contained pipeline.
- **Payroll** holds the most sensitive data, so it comes after access rules are proven.
- **Finance** reads from the other three.

The discovery conversations may change the order after Admin & PRO.

## Things every department shares

- **The client's employees.** Admin & PRO holds their iqamas and visas. Payroll holds their salaries. For Employer of Record, MENA is the employer. So it's **one person record** per employee, with each department seeing its own part of it: documents for Admin & PRO, pay for Payroll.
- **Headcount per client per month.** It comes from Payroll's run. Admin & PRO bands and invoices depend on it.
- **The handover when a client signs.** Nothing exists for this today. It's one step that tells the right departments, with the signed proposal attached, and every module needs it. It could be the first thing built, and the owner could try it before any department module exists.
- **Each department's live-client list.** Each department confirms which clients it serves, which also gives MENA its register of live services.

## Holding personal data (owner decision 7)

Storing ID numbers, salaries and bank details in MENA One means these must come first:

- **Encryption.** Today the database and its automatic backups (on the Mac, in Documents and on the SSD) are unencrypted files. Personal data needs an encrypted database and encrypted backups.
- **Access by department.** It is enforced by the app, not just hidden from view. There's also a log of who opened which employee's record.
- **PDPL.** Why each item is kept and for how long, what happens when an employee leaves, and where the data is stored (Saudi Arabia).
- **Until then, fictional data only.** Real employee data waits for the encrypted, shared version, never on one laptop's copy.

## Before anyone outside the owner can use a module

- The shared version: Azure Saudi Arabia East (November 2026), each person signing in, and Windows.
- A new data kind, **restricted to a department**, for salaries, iqama and passport numbers and candidates' CVs. See `docs/data-classification.md`.
- Personal data about client employees and candidates falls under Saudi Arabia's PDPL, which goes into the legal brief.

## How each conversation runs

- **Who:** the Director, and if they choose, the person on their team who does the work every day.
- **Length:** about an hour.
- **Ask them to bring:** the spreadsheet or screen they use most, with a real week's work on it.
- **Walk through a real week**, not the ideal process. The questions in each guide are prompts, not a form.
- **Their notes stay outside this repository**, in OneDrive, because they will contain client names. Only an anonymised process summary comes back here, as `docs/departments/<department>.md`, next to its guide.
- **The Director reads that summary and corrects it** before anything is designed.

Guides: [Admin & PRO](guide-admin-pro.md) · [Recruitment](guide-recruitment.md) · [Payroll](guide-payroll.md) · [Finance](guide-finance.md)

## Questions every guide shares

1. **Your clients.** Which clients do you serve right now? Is the list written down anywhere, and who keeps it current?
2. **Your team.** Who does what? Does each person have their own clients, or does everyone share them?
3. **Your tools.** What lives in Excel, what lives in which program, and what lives only in email or WhatsApp? What do you copy from one to another by hand?
4. **What you chase.** What do you wait on from clients, from other departments, or from government portals? How do you remember to chase it?
5. **What goes wrong.** Think of the last three things that slipped, came late or annoyed a client. What would have caught them?
6. **What you report.** What do you tell the owner or other departments each week or month, and how long does it take to put together?
7. **The Director's view against the team's view.** What does the Director need to see at a glance, and what does the team need to work through? Does each person have their own clients?
8. **Sensitive data.** What personal data do you hold (IDs, salaries, bank details, CVs), and where? Who is allowed to see it today? When do you delete it?
9. **Handovers.** How did you learn about your last three new clients? What did you need to start, and what was missing? What do you pass to other departments?
10. **Leave alone.** What works well today and shouldn't be touched?
