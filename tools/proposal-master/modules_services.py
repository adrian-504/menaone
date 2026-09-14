"""Service modules for every other service. Terms, durations, percentages and
penalties come from the templates in use (Proposals New Logo); the 2026
redesign decks only set tone and layout."""

from __future__ import annotations

from design import *  # noqa: F401,F403
from modules_admin import divider, payment_terms, tags
from pptxkit import Cell, Para, Run, Slide

SPLIT_L = 940
SPLIT_X = MARGIN + SPLIT_L + 70
SPLIT_W = 1712 - SPLIT_L - 70


def side_panel(s: Slide, y, h, label, items, title=None, dark=False, label_color=None):
    if dark:
        dark_panel(s, SPLIT_X, y, SPLIT_W, h)
    else:
        panel(s, SPLIT_X, y, SPLIT_W, h)
    lc = label_color or (CORAL_LT if dark else MUTED)
    yy = section_label(s, label, SPLIT_X + 40, y + 30, SPLIT_W - 80, color=lc)
    if title:
        s.text(SPLIT_X + 40, yy - 4, SPLIT_W - 80, 60, [Para([Run(title, size=30, color=WHITE if dark else BLUE, bold=True, font="+mj-lt")])], anchor="ctr")
        yy += 66
    return bullets(s, items, SPLIT_X + 40, yy, SPLIT_W - 80, gap=10, color="DDE5EF" if dark else INK)


def single_fee_slide(module, eyebrow_text, title, intro, label, notes_items, side=None, headers=("Category", "Monthly fees"), price="{{fee.price}}"):
    s = Slide("Content", notes=tags(module, "fees"))
    y = heading(s, eyebrow_text, title, intro, width=1300)
    bottom = fee_table(s, MARGIN, y + 6, [640, 300], list(headers), [[[R(label, size=20, color=INK)], [price_run(price)]]], row_h=70)
    payment_terms(s, MARGIN, bottom + 40, SPLIT_L, notes_items, title="Payment & terms")
    if side:
        side(s, y + 6)
    return s


# ── Accountancy & VAT ──

def accountancy():
    m = "accountancy"
    slides = [divider(m, "Accountancy & VAT Services", "Bookkeeping, financial statements, VAT, withholding tax and Zakat — kept compliant with ZATCA every month.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Accountancy services", "Accountancy & bookkeeping",
                "During the term of this agreement {{client_name}} uses the accountancy, VAT & WHT and auditing management services stated below. Requests are made by purchase order specifying the full details of the required services.")
    numbered(s, [
        ("Monthly closing", "Monthly closing in accordance with local Saudi accounting standards; journal, general and subsidiary ledgers maintained, with analytical P&L detail."),
        ("Bookkeeping & accounts management", "Daily accounting postings in line with Saudi accepted standards and IFRS where applicable; ledger management and reconciliation of statements."),
        ("Financial reporting & statements", "Trial balance, monthly revenue and expenditure reports, and monthly, quarterly and annual financial statements (income statement, balance sheet, cash flow)."),
        ("Compliance & audit coordination", "Compliance with the Saudi Companies Law and ZATCA record-keeping requirements; assistance with external audit coordination under Saudi Auditing Standards."),
        ("Bank & head office reporting", "Monthly bank and cash reconciliation, and liaison with head office for reports and financial information every month."),
    ], MARGIN, y + 4, SPLIT_L, gap=14)
    side_panel(s, y, 640, "E-invoicing compliance", [
        "Implementation of ZATCA's mandatory e-invoicing solutions",
        "Integration with ZATCA Phase 2 real-time reporting",
        "Validation of e-invoices, compliance standards and QR codes",
        "Cloud and desktop accounting software (e.g. QuickBooks, Zoho Books)",
        "{{client_name}} provides all required information and documents in time; final review and approval of the books remain with {{client_name}}.",
    ])
    slides.append(s)

    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Accountancy services", "VAT, withholding tax & auditing")
    numbered(s, [
        ("VAT return declaration", "VAT report prepared from the books, VAT return submitted and followed up with ZATCA; invoice compliance checks and audit support under the KSA VAT Law."),
        ("Withholding tax", "Monthly withholding tax declared on request: {{client_name}} provides the documents, MENA BIG processes and obtains the declaration, and {{client_name}} pays through SADAD. WHT calculations and documentation (forms 184/185)."),
        ("Corporate income tax & Zakat", "Preparation and review of the annual tax and Zakat returns, with dispute resolution support with ZATCA."),
    ], MARGIN, y + 4, SPLIT_L, gap=18)
    side_panel(s, y, 640, "Optional · Auditing management consultancy", [
        "Manage and follow up all actions of the auditors",
        "Observe the accounts, financial statements and related records",
        "Advise on actions needed in the auditors' workflow",
        "Keep the financial statements in line with the trial balance",
        "Follow up the final audited statement upload, payment timing and Zakat certificate",
    ])
    slides.append(s)

    s = Slide("Content", notes=tags(m, "fees"))
    y = heading(s, "Project fees · Accountancy and VAT services", "Fee structure — accountancy & VAT", width=1300)
    bottom = fee_table(s, MARGIN, y + 6, [640, 300], ["Category", "Monthly fees"], [[[R("{{row.label}}", size=20, color=INK)], [price_run("{{row.price}}")]]], row_h=70)
    payment_terms(s, MARGIN, bottom + 40, SPLIT_L, [
        "Invoices are paid at the beginning of every month.",
        "Service is for a minimum of {{term}}.",
        "{{accountancy.projects_note}}",
        "Accountancy fees exclude the issuing of invoices.",
    ], title="Payment & terms")
    side_panel(s, y + 6, 560, "Classification", [
        "No projects: an inactive company with a low number of invoices each month.",
        "Projects: an active, operational company with ongoing work.",
        "Monthly or quarterly VAT declarations follow the ZATCA classification, usually based on company income.",
        "Fees can increase with the workflow, by prior agreement between the parties.",
    ])
    slides.append(s)
    return slides


# ── Consultancy (Labor Law, HR, Manpower & Recruitment) ──

def consultancy_fee(m, title, label):
    return single_fee_slide(m, "Project fees · " + title, "Fee structure — " + title.lower(),
                            "Fee arrangements should help you achieve your expectations — value is defined, tracked, measured and communicated throughout the engagement.",
                            label, ["The fees are calculated for a minimum contract of {{term}}, starting from the date of signature of this proposal.", "Invoices are paid at the beginning of every month."])


def labor_law():
    m = "labor_law"
    slides = [divider(m, "Labor Law & Employment Consultancy", "Continuous legal and HR advisory on Saudi labor law, visas, Saudization and employee relations.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Labor law & employment consultancy", "Main tasks",
                "MENA BIG provides legal and HR labor law advisory, periodic quality assurance of HR guidelines, and continuous off-site support to the {{client_name}} HR team on general HR practices and local laws.")
    numbered(s, [
        ("Visas & Iqamas", "Due diligence so {{client_name}} always works within KSA law for visas and Iqamas; visa types for expats, requirements for all visa categories, and the risks in current visa types with a mitigation plan."),
        ("Saudization", "Saudization requirements and specialized categories, solutions and costs, cost sheet per position, expat mobilization vs. Saudization hiring, planning and forecast, and Nitaqat management."),
        ("Labor law advisory", "Working hours, employment liabilities, holidays and compensation, contractual matters, and how current and future labor law changes affect {{client_name}}."),
        ("Claims & improvement", "General laws and clarifications, employee claims and complaints advisory (excluding courts and related sessions), and areas for improvement against local law and leading practice."),
    ], MARGIN, y + 4, SPLIT_L, gap=16)
    side_panel(s, y, 560, "Deliverables & duration", [
        "Continuous labor law & employment consultancy services",
        "{{client_name}} HR team collaborates with the assigned resources",
        "Activity duration: {{term}}",
    ])
    slides.append(s)
    slides.append(consultancy_fee(m, "Labor law & employment consultancy", "Labor Law and Employment Consultancy Services"))
    return slides


def hr_consultancy():
    m = "hr_consultancy"
    slides = [divider(m, "HR Consultancy Services", "Review and preparation of HR policies and procedures aligned with your vision and Saudi law.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · HR consultancy", "Continuous HR consultancy",
                "The tasks below exclude implementing and developing new policies, or rewriting current ones.")
    numbered(s, [
        ("Review & assessment", "Review and assess any current or international policies, point by point."),
        ("Company direction", "Identify the company vision and mission, objectives and main factors, and discuss current policies where they exist."),
        ("HR policy & procedures", "Prepare HR policy and procedures according to the company vision and objectives, in compliance with Saudi law and regulations."),
        ("Handbook & forms", "Prepare the employee handbook if required, and draft HR applications, forms and offers."),
    ], MARGIN, y + 4, SPLIT_L, gap=18)
    side_panel(s, y, 640, "Core HR components covered", [
        "Organization structure", "Salary scale & grading", "Job descriptions", "Recruitment and selection policy", "Performance management policy", "Training and development policy",
        "Compensation & benefits policy", "Payroll management policy", "Working hours policy", "Leave management policy", "Employee relations policy", "Retention strategy",
    ])
    slides.append(s)
    slides.append(consultancy_fee(m, "HR consultancy", "HR Consultancy Services"))
    return slides


def manpower():
    m = "manpower"
    slides = [divider(m, "Manpower & Recruitment Consultancy", "Planning answers for your recruitment, local content and mobilization — before and during operations.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Manpower & recruitment consultancy", "An overview of what to plan",
                "All tasks relate to planning and answering what {{client_name}} should follow during constitution and operations; the plan does not include executing, developing or implementing it.")
    left = ["A comprehensive recruitment methodology to attract the right talent", "Local content plan through recruitment and mobilization", "Plan for expat and manpower positions, including timeline",
            "Selection approach and analysis to identify the most suitable candidates", "Recruitment and mobilization timeline, with estimated timeframes and potential delays", "Mobilization key milestones and potential challenges"]
    right = ["Overseas recruiting and nationalities based on expertise, with timelines", "Recruitment plan and methodology for white-collar, junior and senior positions", "Assessment methodology for skills and qualifications",
             "Plan for selecting blue-collar workers and technicians, with assessment and material testing if needed", "Employment solutions, cost efficiency and liabilities"]
    numbered(s, left, MARGIN, y + 4, SPLIT_L, gap=12)
    side_panel(s, y, 640, "Also covered", right)
    slides.append(s)
    slides.append(consultancy_fee(m, "Manpower & recruitment consultancy", "Manpower and Recruitment Consultancy Services"))
    return slides


# ── Company maintenance, constitution, packages ──

GOV_EXPENSES = [
    ("MISA Registration", "12,000 SAR", "62,000 SAR"),
    ("Commercial Registration (CR)", "1,200 SAR", "1,200 SAR"),
    ("Chamber of Commerce (estimated)", "—", "2,000 SAR"),
    ("Rent an office (standard)", "900–1,000 SAR / sqm", "900–1,000 SAR / sqm"),
    ("Civil Defense & Municipality License (estimated)", "5,000 / 12,000 SAR", "5,000 / 12,000 SAR"),
    ("QIWA System", "8,050 SAR", "8,050 SAR"),
    ("Wasel (Saudi Post)", "1,100 SAR", "1,100 SAR"),
    ("General Manager visa (excl. stamping in home country)", "2,000 SAR", "—"),
    ("GM Iqama taxes inside KSA (excl. medical insurance & test)", "10,350 SAR", "10,350 SAR"),
]


def gov_expenses(module, renewals_only=False):
    s = Slide("Content", notes=tags(module, "expenses"))
    y = heading(s, "Project fees · Associated costs", "Governmental expenses",
                "Estimated governmental expenses for the company in general, as per current regulations. These are paid at cost and are not part of MENA BIG's fees.")
    rows = []
    for label, setup, renewal in GOV_EXPENSES:
        if renewals_only and setup == "2,000 SAR":
            continue
        cells = [[R(label, size=18.5, color=INK)]]
        if not renewals_only:
            cells.append([R(setup, size=18.5, color=INK)])
        cells.append([R(renewal, size=18.5, color=INK)])
        rows.append(cells)
    widths = [1052, 330, 330] if not renewals_only else [1302, 410]
    headers = ["Category", "Constitution — taxes & expenses", "Yearly fees (renewals)"] if not renewals_only else ["Category", "Yearly fees (renewals)"]
    fee_table(s, MARGIN, y + 6, widths, headers, rows, row_h=58)
    return s


def maintenance_scope(s, y, width):
    areas = [
        ("Manage & maintain expiry / renewals", "Governmental certifications, portals & systems, portal updates, MISA and Ministry of Commerce services (excluding classification)."),
        ("Monthly renewal / issuance", "GOSI certificate, Saudization certificate, COC attestations."),
        ("Renewal and/or cancellation", "MISA license, CR, municipality license and all online portals."),
        ("Visit authorities on behalf of {{client_name}}", "Meetings on your behalf, assessment and reports, support to management on outcomes."),
        ("Assess & update company details", "Location, municipality license and national address, change of General Manager, board resolutions, powers of attorney, authorizations, drafting."),
        ("License-related services", "All services related to the license, except buying and selling shares, changing shareholders or the company's legal entity."),
        ("Monthly report", "Activities done this month and activities planned for next month."),
    ]
    col = (width - 40) / 2
    for i, (t, b) in enumerate(areas):
        cx = MARGIN + (i % 2) * (col + 40)
        cy = y + (i // 2) * 158
        s.rect(cx, cy, col, 2, fill=CORAL)
        s.text(cx, cy + 14, 50, 26, [Para([Run(f"{i + 1:02d}", size=15, color=CORAL_DK, bold=True)])])
        s.text(cx + 52, cy + 12, col - 52, 30, [Para([R(t, size=19, color=INK, bold=True)])])
        s.text(cx + 52, cy + 48, col - 52, 100, [Para([R(b, size=16.5)], line=1.1)])


def maintenance():
    m = "maintenance"
    slides = [divider(m, "Company Maintenance Services", "Your company's documents, licenses and online portals kept active and renewed, all year round.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Company maintenance", "What company maintenance covers",
                "The purpose of this service is to maintain the company's official documents and online portals after constitution, support all yearly renewals and system updates, and keep all company credentials and licenses active.")
    maintenance_scope(s, y + 4, 1712)
    slides.append(s)
    slides.append(single_fee_slide(m, "Project fees · Company maintenance", "Fee structure — company maintenance",
                                   "Fee arrangements should help you achieve your expectations — value is defined, tracked, measured and communicated throughout the engagement.",
                                   "Company Maintenance Fees", ["The fees are calculated for a minimum contract of {{term}}, starting from the date of signature of this proposal.",
                                                                "Monthly fees exclude any taxes and expenses paid to the government to renew licenses or registrations."]))
    slides.append(gov_expenses(m, renewals_only=True))
    return slides


def constitution_approach(m, eyebrow_text):
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, eyebrow_text, "Company constitution — scope of work",
                "Registering a new company in KSA (LLC entity; branch entity liability on the parent company only). License type: services. Requests are made by purchase order specifying the full details of the required services.")
    section_label(s, "Licensing steps", MARGIN, y, SPLIT_L)
    numbered(s, ["MISA license", "Commercial registration license", "Chamber of Commerce registration", "Governmental portals registration", "Municipality license registration", "Company taxes activation", "Complete company activation"],
             MARGIN, y + 44, SPLIT_L, gap=8)
    side_panel(s, y, 640, "Requirements · attested & translated to Arabic", [
        "Power of attorney for the General Manager",
        "Power of attorney for the MENA BIG representative to constitute the company",
        "Shareholders' passport copies, signed and stamped",
        "Partner company's commercial registration",
        "Board resolution showing the shareholders' decision to invest in the Kingdom",
        "Board resolution appointing the General Manager",
        "Last year's financial statement",
    ])
    s.text(SPLIT_X + 40, y + 560, SPLIT_W - 80, 60, [Para([label_run("Activity duration ≈ 3 months", color=CORAL_DK)])], anchor="ctr")
    return s


def milestone_fee_slide(m, eyebrow_text, title, label, milestones, notes_items, header="Constitution fees"):
    s = Slide("Content", notes=tags(m, "fees"))
    y = heading(s, eyebrow_text, title, "Fee arrangements should help you achieve your expectations — value is defined, tracked, measured and communicated throughout the engagement.", width=1300)
    table_rows = [{"height": 48, "cells": [header_cell("Category"), header_cell(header, "r"), header_cell("Payment terms")]}]
    ms = [Para([R(t, size=17, color=INK)], bullet="•", indent=20, line=1.05, space_after=4) for t in milestones]
    table_rows.append({"height": 60 + 34 * len(milestones), "cells": [body_cell(label), body_cell([price_run("{{fee.price}}")], "r"), Cell(ms, border_bottom=LINE, margin=(20, 14, 20, 14))]})
    bottom = y + 6 + s.table(MARGIN, y + 6, [520, 300, 892], table_rows)
    payment_terms(s, MARGIN, bottom + 40, 1712, notes_items, title="Notes")
    return s


def constitution():
    m = "constitution"
    slides = [divider(m, "Company Constitution Services", "Your company established in Saudi Arabia — licensing, registrations and activation, handled end to end.")]
    slides.append(constitution_approach(m, "Detailed approach · Company constitution"))
    slides.append(milestone_fee_slide(m, "Project fees · Company constitution", "Fee structure — company constitution", "Company Constitution",
                                      ["35% as advance payment on PO issuance", "35% when the Commercial Registration is obtained", "15% when governmental portals are completed", "15% when the company is fully activated and completed"],
                                      ["Full timeline and detailed roadmap to be defined once the proposal is signed.", "Above fees exclude taxes and expenses."]))
    slides.append(gov_expenses(m))
    return slides


def constitution_maintenance():
    m = "constitution_maintenance"
    slides = [divider(m, "Company Constitution & Maintenance Package", "Establish your company and keep it compliant, with one fixed monthly fee instead of a large upfront payment.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Package deal", "Why choose the constitution + maintenance package?")
    w = (1712 - 3 * 40) / 4
    for i, (t, d, a) in enumerate([
        ("Comprehensive services", "We handle the establishment of your company, keep it up to date with all necessary licenses, and manage governmental compliance.", "A full-service package for establishing and maintaining your company."),
        ("Continuous support", "Continuous communication and support throughout the contract, so your company stays well-maintained and compliant.", "Ongoing access to our team for any question or concern."),
        ("Lower overall cost", "The package reduces the overall cost compared to paying for constitution and maintenance separately.", "Save by reducing the constitution fee when combined with maintenance."),
        ("Monthly payments over {{term}}", "Manageable monthly payments of {{bundle.package}}, avoiding a single large payment.", "Spread the cost over the term instead of paying upfront."),
    ]):
        x = MARGIN + i * (w + 40)
        panel(s, x, y + 6, w, 560)
        s.text(x + 30, y + 40, w - 60, 70, [Para([Run(t, size=24, color=BLUE, bold=True, font="+mj-lt")], line=0.95)])
        s.text(x + 30, y + 130, w - 60, 220, [Para([R(d, size=17.5)], line=1.15)])
        s.rect(x + 30, y + 400, w - 60, 1, fill=LINE)
        s.text(x + 30, y + 420, w - 60, 130, [Para([label_run("Advantage", color=CORAL_DK)], space_after=6), Para([R(a, size=17, color=INK)], line=1.1)])
    slides.append(s)
    slides.append(constitution_approach(m, "Detailed approach · Company constitution"))
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Company maintenance", "What company maintenance covers")
    maintenance_scope(s, y + 4, 1712)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "fees"))
    y = heading(s, "Package deal · Fees", "Constitution + maintenance fees", width=1300)
    table_rows = [{"height": 50, "cells": [header_cell("Category"), header_cell("Cost without package", "r"), header_cell("Package deal (constitution + maintenance)", "r")]}]
    table_rows.append({"height": 70, "cells": [body_cell("Company Constitution"), body_cell([R("{{bundle.constitution}} (one time)", size=19, color=INK)], "r"), body_cell([price_run("{{bundle.package}} / month")], "r")]})
    table_rows.append({"height": 70, "cells": [body_cell("Company Maintenance"), body_cell([R("{{bundle.maintenance}} / month", size=19, color=INK)], "r"), body_cell([R("Included", size=19, color=MUTED)], "r")]})
    table_rows.append({"height": 70, "cells": [body_cell([R("Total cost over {{term}}", size=19, color=INK, bold=True)]), body_cell([R("{{bundle.without}}", size=19, color=INK, bold=True)], "r"), body_cell([price_run("{{bundle.with}}")], "r")]})
    table_rows.append({"height": 70, "cells": [body_cell([R("Savings", size=19, color=INK, bold=True)], fill=PINK), body_cell("—", "r", fill=PINK), body_cell([Run("{{bundle.savings}}", size=22, color=CORAL_DK, bold=True)], "r", fill=PINK)]})
    bottom = y + 6 + s.table(MARGIN, y + 6, [620, 520, 572], table_rows)
    payment_terms(s, MARGIN, bottom + 40, 1712, [
        "The fees are calculated for a minimum contract of {{term}}, starting from the date of signature of this proposal.",
        "Save {{bundle.savings}} by opting for the package, which includes both company constitution and maintenance services.",
        "Pay a fixed monthly fee of {{bundle.package}} instead of a large upfront constitution fee and higher maintenance costs.",
        "If {{client_name}} renews company maintenance for a subsequent year, the cost will be only {{bundle.maintenance}} per month.",
    ], title="Payment & terms")
    slides.append(s)
    slides.append(gov_expenses(m))
    return slides


def business_setup():
    m = "business_setup"
    slides = [divider(m, "Business Setup & Maintenance Services", "Full business setup free of charge with a 12-month company maintenance term — the entity we set up keeps operating.")]
    s = Slide("Content", notes=tags(m, "approach", "[when: term12]"))
    y = heading(s, "The reasoning behind our free business setup offer", "Why company maintenance matters",
                "MENA BIG provides business setup free of charge, conditional on a 12-month company maintenance term. A newly incorporated entity does not run itself — without active local oversight, it is exposed from day one.", width=1500)
    w = (1712 - 3 * 40) / 4
    for i, (t, d) in enumerate([
        ("Unfamiliar territory", "MISA, CR, GOSI, Qiwa and Wasel each run on separate renewal cycles with their own rules."),
        ("A new entity is most exposed", "In the first 12 months, one missed renewal can freeze a brand-new CR, visas or banking access."),
        ("No boots on the ground", "Without a Saudi-based team, an owner cannot monitor portals, attend visits or react to notices."),
        ("Rules change without warning", "Filings run through Arabic-language systems that update requirements with little or no notice."),
    ]):
        x = MARGIN + i * (w + 40)
        s.rect(x, y + 10, w, 2, fill=CORAL)
        s.text(x, y + 30, w, 40, [Para([R(t, size=21, color=BLUE, bold=True)])])
        s.text(x, y + 80, w, 160, [Para([R(d, size=17.5)], line=1.15)])
    dark_panel(s, MARGIN, y + 290, 1712, 250)
    s.text(MARGIN + 44, y + 320, 800, 30, [Para([label_run("Why it's a package offer", color=CORAL_LT)])], anchor="ctr")
    s.text(MARGIN + 44, y + 364, 740, 150, [Para([R("The 12-month maintenance term protects the entity we set up for you at no cost — MENA BIG acts as local agent, so the free setup keeps operating instead of being put at risk.", size=19, color=WHITE)], line=1.15)])
    s.text(960, y + 320, 820, 30, [Para([label_run("What company maintenance covers", color=CORAL_LT)])], anchor="ctr")
    chips(s, ["Expiry & renewals", "Monthly certificates", "Authorities representation", "Entity modifications", "License services", "Monthly reporting"], 960, y + 364, 820, size=16, height=44, fill="1D3654", color=WHITE)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Business setup", "Setup steps, documents & timeline",
                "Set up the company's official documents and online portals, and prepare all documentation for the company's establishment in KSA. License type: services.")
    col = (1712 - 2 * 50) / 3
    section_label(s, "Full business setup — 8 main steps", MARGIN, y, col)
    numbered(s, ["MISA license", "Commercial registration license", "Chamber of Commerce registration", "Governmental portals registration", "Municipality license registration", "Company taxes activation", "Complete company activation", "General Manager Iqama & registration"],
             MARGIN, y + 44, col, gap=6, size=18)
    x2 = MARGIN + col + 50
    section_label(s, "Documents · attested, in Arabic", x2, y, col)
    numbered(s, ["Partner company's commercial registration", "Board resolution from shareholders (establishment)", "Board resolution appointing the General Manager", "Last year's financial statement",
                 "Power of attorney for the General Manager", "Power of attorney for the MENA BIG representative", "Shareholders' passport copies (signed and stamped)"], x2, y + 44, col, gap=6, size=18)
    x3 = MARGIN + 2 * (col + 50)
    panel(s, x3, y, col, 600)
    section_label(s, "Estimated timeline — ~3 months", x3 + 34, y + 30, col - 68)
    yy = y + 90
    for n, (t, d) in enumerate([("Document preparation", "Gather and authenticate all required documents · ~1 month"), ("License registration", "File applications with MISA and all relevant authorities · ~1 month"), ("Company active", "All registrations complete — company fully operational · ~1 month")]):
        s.text(x3 + 34, yy, col - 68, 34, [Para([R(f"{n + 1:02d}  {t}", size=20, color=BLUE, bold=True)])])
        s.text(x3 + 34, yy + 38, col - 68, 80, [Para([R(d, size=17)], line=1.1)])
        yy += 140
    s.text(x3 + 34, y + 520, col - 68, 60, [Para([R("Full timeline and roadmap to be confirmed upon proposal signing.", size=15.5, color=MUTED)], line=1.1)])
    slides.append(s)

    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Company maintenance — full scope", "What company maintenance covers", "Seven activity areas MENA BIG manages on your behalf for the full term, so the entity stays compliant without local oversight from you.")
    maintenance_scope(s, y + 4, 1712)
    slides.append(s)

    for when, title_note in [("[when: term12]", True), ("[when: term_short]", False)]:
        s = Slide("Content", notes=tags(m, "fees", when))
        y = heading(s, "Fee structure · Package deal", "Business setup & maintenance fees", width=1300)
        rows = [{"height": 50, "cells": [header_cell("Category"), header_cell("Cost", "r")]}]
        if title_note:
            rows.append({"height": 70, "cells": [body_cell([R("Business Setup", size=20, color=INK), R("  —  free, conditional on 12-month maintenance", size=16, color=MUTED)]), body_cell([Run("FREE", size=22, color=CORAL_DK, bold=True)], "r")]})
        else:
            rows.append({"height": 70, "cells": [body_cell("Company Constitution (one time)"), body_cell([price_run("{{constitution.price}}")], "r")]})
        rows.append({"height": 70, "cells": [body_cell("Business Setup and Company Maintenance"), body_cell([price_run("{{fee.price}} / month")], "r")]})
        rows.append({"height": 70, "cells": [body_cell([R("Total cost over {{term}}", size=19, color=INK, bold=True)]), body_cell([price_run("{{fee.total}}")], "r")]})
        bottom = y + 6 + s.table(MARGIN, y + 6, [700, 400], rows)
        payment_terms(s, MARGIN, bottom + 40, 1100, [
            "Billed monthly for a minimum contract of {{term}}, starting from the date of signature.",
            "First invoice issued upon signature and payable immediately to commence the services.",
            "Second invoice issued at the same time, payable within thirty (30) days, covering the second month.",
            "Thereafter, invoices are issued monthly in advance.",
        ], title="Payment & terms")
        if title_note:
            px = MARGIN + 1100 + 70
            pw = 1712 - 1170
            s.rect(px, y + 6, pw, 340, fill=PINK)
            s.rect(px, y + 6, pw, 3, fill=CORAL)
            s.text(px + 36, y + 36, pw - 72, 70, [Para([R("Free constitution — conditional benefit", size=20, color=CORAL_DK, bold=True)], line=1.05)])
            s.text(px + 36, y + 120, pw - 72, 200, [Para([R("The company constitution service is provided free of charge, strictly conditional upon full completion of the twelve (12) month company maintenance term.", size=18)], line=1.15)])
        slides.append(s)
    slides.append(gov_expenses(m))
    return slides


# ── Mobilization, liquidation, GM representative ──

def mobilization():
    m = "mobilization"
    slides = [divider(m, "Mobilization Services", "Visa, stamping and mobilization managed country by country, from eligibility to arrival in KSA.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Mobilization services", "Objective & process",
                "A one-time payment service for in-country mobilization management. Mobilization is processed as per country rules and regulations; visa issuance follows country regulations and is confirmed according to degree and profession.")
    col = (1712 - 60) / 2
    section_label(s, "Process", MARGIN, y, col)
    numbered(s, [("Project initiation", "Understand the current status and business drivers; project plan and mobilization."), ("Phase 1", "Documentation verification, degree attestation and medical test."),
                 ("Phase 2", "Application, documentation attestation and visa stamping."), ("Project management", "Quality assurance and follow-up until mobilization.")], MARGIN, y + 44, col, gap=16)
    x2 = MARGIN + col + 60
    panel(s, x2, y, col, 560)
    section_label(s, "Required documents", x2 + 40, y + 30, col - 80)
    bullets(s, ["Visa copy", "E-Wakala", "Attested employment contract", "Degree (if available)", "Company CR", "Employee personal documents and contact details"], x2 + 40, y + 76, col - 80, gap=10, color=INK)
    s.text(x2 + 40, y + 470, col - 80, 60, [Para([label_run("Project duration ≈ 45 days", color=CORAL_DK)])], anchor="ctr")
    slides.append(s)

    s = Slide("Content", notes=tags(m, "fees"))
    y = heading(s, "Project fees · Mobilization services", "Fees per visa, per employee", width=1300)
    table_rows = [{"height": 50, "cells": [header_cell("Category"), header_cell("Fees per visa per employee", "r"), header_cell("Includes / excludes")]}]
    table_rows.append({"height": 150, "cells": [
        Cell([Para([R("Principal initial:", size=17, color=INK, bold=True)], space_after=4), Para([R("Eligibility assessment, documents preparation and submission at the KSA Embassy in {{row.label}}", size=17, color=INK)], line=1.1)], border_bottom=LINE, margin=(20, 14, 20, 14)),
        body_cell([price_run("{{row.price}}")], "r"),
        Cell([Para([R("Including: mobilization management, guidance and follow-up.", size=16, color=INK)], line=1.1, space_after=6), Para([R("Excluding: stamping expenses and embassy fees, medical test, vaccinations, tickets, transportation, translations.", size=16, color=MUTED)], line=1.1)], border_bottom=LINE, margin=(20, 14, 20, 14)),
    ]})
    bottom = y + 6 + s.table(MARGIN, y + 6, [700, 320, 692], table_rows)
    payment_terms(s, MARGIN, bottom + 40, 1712, ["50% payment in advance.", "50% immediately after visa stamping.", "Requirements: work visa and attested contract."], title="Payment terms")
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Mobilization services", "Mobilization fees — included and excluded")
    col = (1712 - 60) / 2
    _ly = section_label(s, "Fees include", MARGIN, y, col)
    bullets(s, ["All governmental expenses and/or taxes for the process"], MARGIN, _ly, col, gap=10, color=INK)
    section_label(s, "Fees exclude", MARGIN, y + 150, col)
    bullets(s, ["Medical test unfit", "Degree attestations", "Couriers", "Employee expenses", "Demand letters", "VAT or WHT, added according to country law"], MARGIN, y + 194, col, gap=10, color=INK)
    x2 = MARGIN + col + 60
    panel(s, x2, y, col, 420)
    section_label(s, "Termination", x2 + 40, y + 30, col - 80)
    s.text(x2 + 40, y + 76, col - 80, 300, [Para([R("In case of termination, unless otherwise agreed by the parties, MENA BIG may finalize all services agreed under the last purchase orders. {{client_name}} pays for all services provided up to the completion of the purchase orders outstanding at the date of termination.", size=18)], line=1.15)])
    slides.append(s)
    return slides


def liquidation():
    m = "liquidation"
    slides = [divider(m, "Company Liquidation Services", "Licenses cancelled and the company closed properly, with the documents and authorities handled for you.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Company liquidation", "Liquidation — scope of work",
                "Liquidating a foreign company in KSA. License type: services. Requests are made by purchase order specifying the full details of the required services.")
    _ly = section_label(s, "Cancellation steps", MARGIN, y, SPLIT_L)
    numbered(s, ["MISA license cancellation", "Commercial license cancellation", "Chamber of Commerce cancellation", "Governmental portals closing"], MARGIN, _ly, SPLIT_L, gap=10)
    side_panel(s, y, 640, "Requirements for license & company liquidation", [
        "Original documents", "Power of attorney for the MENA BIG representative to liquidate the company", "Board resolution as the company's decision to liquidate",
        "Clearance from all authorities", "Audited financial statements", "Valid licenses", "Latest ZATCA declaration proof", "List of employees",
    ])
    s.text(SPLIT_X + 40, y + 570, SPLIT_W - 80, 50, [Para([label_run("Activity duration ≈ 3 months", color=CORAL_DK)])], anchor="ctr")
    slides.append(s)
    slides.append(milestone_fee_slide(m, "Project fees · Company liquidation", "Fee structure — company liquidation", "Company Liquidation",
                                      ["50% as advance payment on PO issuance", "35% when licenses are cancelled", "15% when liquidation is completed"],
                                      ["Estimated time between 2 and 4 months according to the documents provided; full timeline and detailed roadmap defined once the proposal is signed and documents are provided.",
                                       "Above fees exclude taxes and expenses, and any process related to tax department clearance.", "The process requires valid documents."], header="Liquidation fees"))
    return slides


def gm_representative():
    m = "gm_representative"
    slides = [divider(m, "Temporary GM Representative Services", "A local representative to keep your company active and signed for, while your General Manager is appointed.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Temporary GM services", "Temporary GM representative",
                "The purpose of this service is to maintain the company's official documents and online portals after constitution, and keep company credentials and licenses active through a temporary representative.")
    numbered(s, [
        ("Temporary and without liabilities", "The service is temporary and carries no liability for company operations or projects."),
        ("Company kept active", "Support in keeping the company active on online portals, with the signatory required for company maintenance."),
        ("Authorized for constitution documents", "The representative is authorized to process all documents needed to complete the constitution, without responsibility for financial or contractual matters, and signs only with client approval."),
        ("Scope limits", "The representative is not responsible for renewals or for representing the company at any authority to renew."),
    ], MARGIN, y + 4, SPLIT_L, gap=18)
    side_panel(s, y, 520, "Service period", [
        "Minimum period of {{term}}, completed once the GM is replaced or when MENA BIG requests it.",
        "Any renewal of this service is for a minimum of {{term}}.",
        "Invoiced separately — not included in any package.",
    ])
    slides.append(s)
    slides.append(single_fee_slide(m, "Project fees · Temporary GM services", "Temporary GM services fees", None, "Temporary GM Representative",
                                   ["GM representative services are paid in separate invoices and are not included in any package.",
                                    "The first invoice is issued when the service starts and is paid within 60 days of the invoice date."]))
    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Temporary GM services", "Term & early termination")
    numbered(s, [
        ("Initial term", "This agreement is effective for a fixed and non-cancellable period of {{term.words}} from the effective date (the \"Initial Term\"). On expiry it renews automatically for the same duration and on the same terms, unless {{client_name}} gives written notice of non-renewal at least sixty (60) days before the end of the then-current term."),
        ("Early termination", "{{client_name}} may not terminate for convenience during the initial term. Any termination during the term is an early termination, and {{client_name}} remains liable for all amounts invoiced to date and all remaining fees for the unexpired portion of the initial term."),
    ], MARGIN, y + 4, 1712, gap=26)
    slides.append(s)
    return slides
