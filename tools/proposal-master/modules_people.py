"""Workforce and Recruitment Advisory modules, and Business Setup's own terms.
Figures and terms follow the templates in use (Proposals New Logo)."""

from __future__ import annotations

from design import *  # noqa: F401,F403
from modules_admin import divider, payment_terms, tags
from modules_services import SPLIT_L, SPLIT_W, SPLIT_X, side_panel
from pptxkit import Cell, Para, Run, Slide


def workforce():
    m = "workforce"
    slides = [divider(m, "Workforce Services", "Manpower under one employer — sponsorship, payroll, PRO and HR support for your project workforce.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Workforce services", "Objective & main terms",
                "During the term of this agreement {{client_name}} uses the workforce services stated below — visas and payroll — under the terms and conditions of this agreement. Employees work for {{client_name}} as per its policies and KSA labor law; requests are made by purchase order.")
    section_label(s, "Main terms", MARGIN, y, SPLIT_L)
    numbered(s, [
        "The agreement is for a minimum of {{term}}. Termination before that incurs early termination fees as stated in the terms and conditions.",
        "Conditions and terms stated are standard as per labor law; employment contracts and employment terms are defined as per {{client_name}}'s policy.",
        "Visa issuance or transfer needs 15 working days.",
        "Mobilization is processed as per each country's rules and regulations.",
    ], MARGIN, y + 44, SPLIT_L, gap=16)
    side_panel(s, y, 600, "Mobilization management · excluding agencies' expenses and fees", [
        "Preparation and management of visas", "Agencies management", "Visa stamping and clearance", "Mobilization follow-up", "Timeline and reporting",
    ])
    slides.append(s)

    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Workforce services", "Manpower solutions, under one employer",
                "We provide the manpower you need for the optimal completion of your plans, plus HR support and HR management under one employer — reducing your HR and logistics load with customizable solutions.", width=1150)
    bullets(s, ["Forecast your project mobilization", "Save cost in your Saudization", "Save cost in hiring and onboarding", "Detect specialized manpower by nationality, then select and recruit"],
            1330, TOP + 50, 486, gap=8, size=17, color=INK)
    w = (1712 - 2 * 40) / 3
    for i, (t, k, items, dark) in enumerate([
        ("Recruitment", "Extra cost & process", ["International & local recruitment", "Selection on behalf of the client", "Limited and project contract hiring"], False),
        ("Mobilization", "Extra cost & process", ["International mobilization", "Visa provision & procedures", "Stamping, clearance and follow-up"], False),
        ("Employ on behalf", "Core service", ["Employee sponsorship services", "Payroll, PRO and employee relations", "HR support under one employer"], True),
    ]):
        x = MARGIN + i * (w + 40)
        yy = y + 40
        if dark:
            s.rect(x, yy, w, 460, fill=BLUE)
        else:
            s.rect(x, yy, w, 460, fill=WHITE, line=LINE)
            s.rect(x, yy, w, 3, fill=CORAL)
        s.text(x + 34, yy + 34, w - 68, 40, [Para([Run(f"{i + 1:02d}  ", size=16, color=CORAL_LT if dark else CORAL_DK, bold=True), R(t, size=26, color=WHITE if dark else BLUE, bold=True)])])
        s.text(x + 34, yy + 88, w - 68, 26, [Para([label_run(k, color="BFD1E6" if dark else MUTED)])], anchor="ctr")
        bullets(s, items, x + 34, yy + 140, w - 68, gap=12, color=WHITE if dark else INK)
    slides.append(s)

    # Recruitment is proposed separately (owner, 22-Sep-2026): no recruitment process here.

    s = Slide("Content", notes=tags(m, "fees"))
    y = heading(s, "Project fees · Fee structure", "Value-based fee structure", width=1300)
    table_rows = [{"height": 50, "cells": [header_cell("Category"), header_cell("Monthly fees per person", "r"), header_cell("Minimum period", "r")]}]
    table_rows.append({"height": 72, "cells": [body_cell([R("{{row.label}}", size=19.5, color=INK)]), body_cell([price_run("{{row.price}}")], "r"), body_cell([R("{{term}}", size=19, color=INK)], "r")]})
    bottom = y + 6 + s.table(MARGIN, y + 6, [540, 270, 210], table_rows)
    yy = section_label(s, "Monthly fees include", MARGIN, bottom + 40, 1020)
    bullets(s, ["Saudization cost", "PRO services & administration management", "HR support and employee relations", "Mobilization management (excluding expenses and agencies' fees)"], MARGIN, yy, 1020, cols=2, gap=10, color=INK)
    px, pw = MARGIN + 1020 + 60, 1712 - 1080
    dark_panel(s, px, y + 6, pw, 680)
    s.text(px + 40, y + 36, pw - 80, 26, [Para([label_run("Monthly fees exclude — paid at cost", color=CORAL_LT)])], anchor="ctr")
    bullets(s, ["Salaries", "GOSI", "EOS and vacation salary", "Dependent fees", "Medical insurance", "Labor card & Iqama taxes", "Exit re-entry", "Vacation ticket",
                "Mobilization & demobilization ticket", "Visa or transfer cost", "Ajeer fees", "Agencies fees"], px + 40, y + 84, pw - 80, cols=2, gap=10, size=17, color="DDE5EF", col_gap=24)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "fees"))
    y = heading(s, "Project fees · Payment terms", "Payment terms")
    items = [
        ("Contract duration & salary deposit", "The contract lasts {{term}}. {{client_name}} pays a deposit equal to one month's full salary per employee, refunded or compensated at the end of the project."),
        ("Mobilization & related expenses", "All costs for mobilization, stamping, tickets and Iqama fees are paid in advance, on a proportional schedule per the mobilization plan."),
        ("Salary payments", "Salaries are paid in advance, before the 22nd of each month, and invoiced 30 days before (salaries for month X are invoiced on the 22nd of month X-1)."),
        ("Late payment penalty", "If {{client_name}} delays salary or expense payments, a 2% penalty is added to the invoice for each month of delay. Service fee invoices are paid within 30 days."),
        ("Taxes & additional charges", "All invoices — expenses, salaries, service fees — include VAT and/or WHT as required by law (currently 15% of the total invoice)."),
        ("Visa processing & grace period", "Visas are issued per {{client_name}}'s mobilization plan and must be stamped within 45 days of issuance; the grace period to mobilize after stamping is 15 days."),
        ("Service fee start dates", "Monthly service fees begin on arrival in KSA or 15 days after the visa is stamped, whichever comes first. Early termination fees apply to any employee after that."),
        ("Unused & cancelled visas", "A visa not used within 45 days incurs 60% of the monthly fee until arrival, unless agreed otherwise. A visa never used is billed at visa cost plus one month's fees; stamped but not mobilized adds agency and cancellation expenses."),
        ("Other payments", "Any allowances, benefits, extra payments or employee expenses not included in the agreed rate are invoiced separately."),
    ]
    col = (1712 - 2 * 50) / 3
    for i, (t, b) in enumerate(items):
        x = MARGIN + (i % 3) * (col + 50)
        yy = y + 4 + (i // 3) * 240
        s.text(x, yy, 50, 26, [Para([Run(f"{i + 1:02d}", size=15, color=CORAL_DK, bold=True)])])
        s.text(x, yy + 30, col, 34, [Para([R(t, size=19.5, color=BLUE, bold=True)])])
        s.text(x, yy + 70, col, 170, [Para([R(b, size=16.5)], line=1.12)])
    slides.append(s)

    # Terms
    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Workforce services", "Assumptions and limitations", "The stated scope of work consists of the following assumptions and limitations, with conditions and terms as per Saudi law.")
    col = (1712 - 60) / 2
    a = [
        "Employment conditions are based on labor law and client policies. Both parties agree to prepare a subcontract consultancy agreement.",
        "MENA BIG provides the necessary visa for each employee, taking into consideration the degree for skilled professions (skilled visa fees are defined later).",
        "All employee and mobilization costs — taxes, medical and other insurance, GOSI, family allowances, salary, vacations, air tickets, accommodation, transportation, end of service, visa stamping — are billed at actual to {{client_name}}.",
        "Any allowances to be paid by the employee are discussed with {{client_name}} in advance, including how they are deducted during employment with MENA BIG.",
        "Both parties define the salary scale for each employee, to be on payroll every month; any deduction or change is reported monthly.",
        "A mobilization and demobilization ticket from and to the home country on final exit is provided by {{client_name}}.",
        "Any legal violations by an employee are the sole responsibility of the employee or {{client_name}}; MENA BIG assists to the full extent possible.",
        "Employees are compensated in accordance with Saudi labor law, and this is billed to {{client_name}}.",
    ]
    numbered(s, a[:4], MARGIN, y + 4, col, gap=12, size=17)
    numbered(s, a[4:], MARGIN + col + 60, y + 4, col, gap=12, size=17, start=5)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Workforce services", "Assumptions and limitations (continued)")
    b = [
        "Contract terminations, notice period, probation period and working hours follow Saudi labor law; if the law changes, contracts change and both parties follow the new rules.",
        "Medical insurance and any other insurance, if applied or required, is billed to {{client_name}}.",
        "MENA BIG must be notified of all HR, payroll and employee services needed, and of each problem occurring at the work sites.",
        "Changing a profession follows the rules and conditions of the country; on request, rates may vary and are agreed between both companies.",
        "Any profession tests or other necessary expenses are billed to {{client_name}}.",
        "Any employee-related service — payments, sponsorship transfer, exit re-entries or similar — is approved in advance by {{client_name}}; any default by MENA BIG here is subject to the penalties clause.",
        "All mobilization follows each country's regulations and timeline.",
    ]
    numbered(s, b[:4], MARGIN, y + 4, col, gap=12, size=17, start=9)
    numbered(s, b[4:], MARGIN + col + 60, y + 4, col, gap=12, size=17, start=13)
    panel(s, MARGIN + col + 60, y + 470, col, 160)
    s.text(MARGIN + col + 100, y + 500, col - 80, 110, [Para([label_run("Note")], space_after=6), Para([R("Fees are based on current governmental taxes and Saudization percentages; if these change, all cost and additional expenses are billed to {{client_name}}.", size=17)], line=1.12)])
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Workforce services", "Early employee termination terms",
                "On any resignation or termination by {{client_name}}, early termination fees apply to cover the cost of Saudization and MENA BIG's administration, calculated per month per employee to complete the contract period.", width=1712)
    dark_panel(s, MARGIN, y + 6, 560, 600)
    s.text(MARGIN + 40, y + 36, 480, 26, [Para([label_run("Calculation examples", color=CORAL_LT)])], anchor="ctr")
    yy = y + 90
    for t, v in [("Terminated in month {{wf.m1}}", "Monthly fee × {{wf.r1}}"), ("Terminated in month {{wf.m2}}", "Monthly fee × {{wf.r2}}"), ("Replacement visa recovery", "1,800 SAR fixed")]:
        s.text(MARGIN + 40, yy, 480, 30, [Para([R(t, size=17, color="C9D3E0")])])
        s.text(MARGIN + 40, yy + 34, 480, 50, [Para([Run(v, size=28, color=WHITE, bold=True, font="+mj-lt")])])
        yy += 130
    s.text(MARGIN + 40, y + 480, 480, 110, [Para([R("Recovers the first visa's expenses when the replacement continues the previous employee's period; no visa expense if the replacement period is the full contract term.", size=15.5, color="9FB0C4")], line=1.12)])
    numbered(s, [
        "The penalty is calculated on the number of persons who resigned or were terminated by {{client_name}} — not on the remaining contract value or the maximum number of staff expected under this contract.",
        "The penalty is paid in addition to the normal monthly rate, only for the month the termination occurs. Maximum liability is limited to the total number of visas actually issued under this agreement.",
        "If {{client_name}} replaces a resigned or terminated employee at any stage, early termination fees do not apply and invoices continue monthly until the replacement joins; Schedule 4, Clause 3 (employee contract termination terms) still applies.",
        "Early termination terms apply to any employee, new or replaced.",
    ], MARGIN + 620, y + 10, 1712 - 620, gap=18, size=17.5)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Workforce services", "Estimated sponsorship expenses", "Per employee, inside KSA — billed at cost and payable to MENA BIG in advance.")
    headers = ["Description", "Qty", "L.C tax / yr", "Iqama / yr", "Medical test", "Medical ins. / yr", "Visa cost", "S.C engineers / yr"]
    rows = [["Employee", "1", "SAR 9,700", "SAR 650", "SAR 245", "At cost", "SAR 2,000", "SAR 0"], ["Engineer / Tech", "1", "SAR 9,700", "SAR 650", "SAR 245", "At cost", "SAR 2,000", "SAR 1,250"]]
    bottom = fee_table(s, MARGIN, y + 6, [300, 110, 210, 190, 210, 230, 210, 252], headers, [[[R(c, size=17.5, color=INK, bold=(i == 0))] for i, c in enumerate(r)] for r in rows], aligns=["l", "ctr", "r", "r", "r", "r", "r", "r"], row_h=64)
    col = (1712 - 60) / 2
    section_label(s, "Fixed service fee exclusions — billed at cost, paid in advance", MARGIN, bottom + 40, col)
    bullets(s, ["Salaries", "Visa cost", "Visa stamping / agent fees", "Medical test at home and in KSA", "Degree attestation", "Medical and site insurance", "Family taxes & dependent fees",
                "GOSI — 2% of basic + housing", "Labor card taxes & Iqama fees", "Transfer cost", "Flight ticket home to Saudi", "Demobilization tickets", "Vacation", "End of service & settlements"],
            MARGIN, bottom + 84, col, cols=2, gap=6, size=16, color=INK, col_gap=24)
    x2 = MARGIN + col + 60
    panel(s, x2, bottom + 40, col, 340)
    s.text(x2 + 40, bottom + 70, col - 80, 280, [Para([label_run("Penalties")], space_after=8), Para([R("Each party fulfils its part of this agreement. If MENA BIG breaches the contract or fails to fulfil its obligations, {{client_name}} gives written notice stating the breach and allows 20 days to remedy it; if not remedied, the penalty is a refund of all service-related cost by MENA BIG to {{client_name}}.", size=17)], line=1.12)])
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Workforce services", "Payment schedule by cost category")
    w = (1712 - 3 * 30) / 4
    for i, (t, k, items, dark) in enumerate([
        ("Upon visa issuance, before mobilization", "One time", ["Visa fees — 2,000 SAR", "Medical test — one time"], False),
        ("Immediately upon candidate arrival", "One time / year · 2 weeks before execution", ["L.C tax / year", "Iqama fees / year", "Medical insurance"], False),
        ("Monthly, before the 22nd", "And/or 5 days before salary payment date", ["Salary", "GOSI"], False),
        ("At cost, one week before execution", "Billed at actual", ["End of service benefit", "Vacation salary", "Exit re-entry", "Air tickets", "Overtime, if applicable", "Family expenses", "Any other insurance"], True),
    ]):
        x = MARGIN + i * (w + 30)
        if dark:
            dark_panel(s, x, y + 6, w, 620)
        else:
            s.rect(x, y + 6, w, 620, fill=WHITE, line=LINE)
            s.rect(x, y + 6, w, 3, fill=CORAL)
        s.text(x + 30, y + 36, w - 60, 26, [Para([Run(f"{i + 1:02d}", size=15, color=CORAL_LT if dark else CORAL_DK, bold=True)])])
        s.text(x + 30, y + 70, w - 60, 90, [Para([R(t, size=20, color=WHITE if dark else BLUE, bold=True)], line=1.05)])
        s.text(x + 30, y + 170, w - 60, 50, [Para([label_run(k, color="BFD1E6" if dark else MUTED, size=12.5)], line=1.1)])
        bullets(s, items, x + 30, y + 240, w - 60, gap=8, size=17, color=WHITE if dark else INK)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Workforce services", "Conditions")
    numbered(s, [
        ("Duration of this agreement", "Unless previously terminated, this agreement initially runs for {{term}}. Fees are based on current governmental taxes and Saudization percentages; if these change, all cost and additional expenses are billed to {{client_name}}."),
        ("Applicable law", "This subcontract is governed and construed, and all processes take effect, in accordance with the laws of the Kingdom of Saudi Arabia; {{client_name}} is notified of all changes in law and processes change accordingly."),
        ("Dispute resolution", "Any dispute, controversy or claim arising out of or relating to this contract, or its breach, termination or invalidity, is held in the courts of Saudi Arabia under Saudi law. The language of the resolution is English and Arabic."),
    ], MARGIN, y + 4, 1100, gap=30)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Medical insurance", "Medical insurance premiums", "BUPA medical insurance · annual premium per member as per the current policy (renewal date 8 February 2027). Rates and supplier may change.")
    prem = [["VIP", "6,899", "6,899", "27,598", "6,899"], ["A", "4,567", "4,567", "18,263", "4,567"], ["B", "3,282", "3,282", "13,131", "3,282"], ["C+", "1,937", "1,937", "8,714", "1,937"], ["D+", "1,007", "1,007", "4,533", "1,007"]]
    fee_table(s, MARGIN, y + 6, [412, 325, 325, 325, 325], ["Class", "E / C", "Wife / FE", "Senior", "Parents"], [[[R(c, size=19, color=INK, bold=(i == 0))] for i, c in enumerate(r)] for r in prem], row_h=70)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Medical insurance", "General coverage")
    cov = [["Annual limit", "SAR 1,000,000 — all classes", "", "", ""], ["Deductible", "20% up to 75-100-100 — all classes", "", "", ""],
           ["Assigned network", "NW7", "NW6", "NW5", "NW3 / NWS"], ["Room & board", "Standard suite", "Single room", "Single room", "Shared room"],
           ["Dental — annual limit", "SAR 5,000", "SAR 3,500", "SAR 3,000", "SAR 2,000"], ["Optical — annual limit", "SAR 1,000", "SAR 1,000", "SAR 750", "SAR 400"],
           ["Dental deductible", "Yes — as per the basic policy", "", "", ""]]
    bottom = fee_table(s, MARGIN, y + 6, [412, 325, 325, 325, 325], ["Benefit", "VIP", "A+ & A", "B", "C+ / D+"], [[[R(c, size=17.5, color=INK, bold=(i == 0))] for i, c in enumerate(r)] for r in cov], aligns=["l", "l", "l", "l", "l"], row_h=60)
    s.text(MARGIN, bottom + 30, 1712, 60, [Para([R("Territory: Kingdom of Saudi Arabia, extended worldwide for emergency treatment while travelling or on vacation — maximum 60 days per person per policy year.", size=17)], line=1.12)])
    slides.append(s)
    return slides


def recruitment():
    m = "recruitment"
    slides = [divider(m, "Recruitment Advisory Services", "Local and international staff recruitment — from job description to offer acceptance, with a replacement guarantee.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Recruitment advisory services", "Objective & main tasks",
                "During the term of this agreement {{client_name}} uses MENA BIG's local and international staff recruitment services, under the terms and conditions of this agreement. Requests are made by purchase order specifying the full details of the required services.")
    numbered(s, [
        "Manage, control and organize the whole selection process; back-office recruiters manage all first interviews, filtering and sourcing.",
        "MENA BIG runs the necessary advertisements and announcements to ensure additional ready CVs and candidates for interviews.",
        "Identify and screen potential candidates, sharing profiles with {{client_name}} within 1–2 weeks of receiving the job description and all required information.",
        "Any problem that would delay deployment is brought to {{client_name}}'s attention immediately.",
        "Final interviews are conducted by {{client_name}}'s representative, face to face at its premises or online via Zoom/Teams.",
    ], MARGIN, y + 4, SPLIT_L, gap=14)
    panel(s, SPLIT_X, y, SPLIT_W, 640)
    section_label(s, "Recruitment in numbers", SPLIT_X + 40, y + 30, SPLIT_W - 80)
    cw = (SPLIT_W - 80 - 40) / 2
    for i, (v, c) in enumerate([("20+", "Recruiters"), ("15+", "Countries"), ("250k+", "Candidates"), ("12k+", "Recruitment & mobilization"), ("10+", "Customizable processes"), ("50+", "Satisfied clients"), ("35+", "Assessments & campaigns")]):
        stat(s, v, c, SPLIT_X + 40 + (i % 2) * (cw + 40), y + 80 + (i // 2) * 138, cw)
    slides.append(s)

    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Recruitment process", "MENA BIG recruitment flow — {{client_name}} project")
    steps = [("Receive requirements", "Recruitment requirements received from {{client_name}}"), ("Search data bank", "Potential candidates in our data bank"), ("Source candidates", "Newspaper ads, head hunting, job postings, job fairs, referrals"),
             ("First approach", "English, background experience and updated CV"), ("Initial interview", "By MENA BIG recruiters: English, experience, certificates, eligibility to hire and mobilize"),
             ("Shortlist", "Potential candidates for the final interview"), ("Final interview", "Organized with {{client_name}}"), ("Job offer", "For accepted candidates, and offer acceptance secured")]
    w = (1712 - 3 * 30) / 4
    for i, (t, d) in enumerate(steps):
        x = MARGIN + (i % 4) * (w + 30)
        yy = y + 20 + (i // 4) * 310
        last = i == len(steps) - 1
        s.rect(x, yy, w, 270, fill=CORAL if last else PANEL)
        s.text(x + 28, yy + 26, w - 56, 26, [Para([Run(f"{i + 1:02d}", size=16, color=WHITE if last else CORAL_DK, bold=True)])])
        s.text(x + 28, yy + 64, w - 56, 70, [Para([R(t, size=22, color=WHITE if last else BLUE, bold=True)], line=1.0)])
        s.text(x + 28, yy + 134, w - 56, 120, [Para([R(d, size=16.5, color=WHITE if last else TEXT)], line=1.12)])
    slides.append(s)

    s = Slide("Content", notes=tags(m, "fees"))
    y = heading(s, "Fee structure · Recruitment advisory services", "Project fees", width=1300)
    table_rows = [{"height": 50, "cells": [header_cell("Category"), header_cell("Package"), header_cell("Invoice %", "r")]}]
    table_rows.append({"height": 76, "cells": [body_cell([R("{{row.label}}", size=20, color=INK)]), body_cell("Any package"), body_cell([price_run("{{row.percent}}"), R(" of the annual package", size=17, color=INK)], "r")]})
    bottom = y + 6 + s.table(MARGIN, y + 6, [520, 360, 540], table_rows)
    payment_terms(s, MARGIN, bottom + 40, 1420, [
        "100% once the candidate is selected and the offer is accepted.",
        "All payments due for the performed services are made within thirty (30) days of {{client_name}} receiving an undisputed invoice.",
        "Timeline is defined later according to each position's budget and job description.",
        "Fees exclude any mobilization, visa stamping, travel expenses and other expenses related to the employee joining.",
        "{{recruitment.staff_note}}",
    ], title="Fees & payment terms")
    slides.append(s)

    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Terms & conditions · Recruitment advisory services", "Employee termination & early termination")
    col = (1712 - 60) / 2
    yy = section_label(s, "Employee termination terms", MARGIN, y, col, color=CORAL_DK)
    numbered(s, [
        "If an employee resigns or is terminated for any reason during the first 90 days (probation period), MENA BIG replaces the candidate through a new selection process, free of charge, once, within a reasonable time.",
        "{{client_name}} notifies MENA BIG of the replacement requirement and the reason for termination within the first 90 days; any notice after that is invalid.",
        "The commitment does not apply if the candidate is assigned to a position other than the one recruited for, unless agreed by both parties.",
        "All processes follow current laws and conditions; if laws change in any country, {{client_name}} is notified and process times may change.",
    ], MARGIN, yy + 4, col, gap=12, size=17)
    x2 = MARGIN + col + 60
    panel(s, x2, y, col, 640)
    s.text(x2 + 40, y + 30, col - 80, 24, [Para([label_run("Early termination & duration", color=CORAL_DK)])], anchor="ctr")
    s.text(x2 + 40, y + 76, col - 80, 540, [
        Para([R("By {{client_name}}", size=19, color=BLUE, bold=True)], space_after=4),
        Para([R("If this contract is terminated by {{client_name}} at any time, all payments for completed work are non-refundable.", size=17)], line=1.12, space_after=14),
        Para([R("By MENA BIG", size=19, color=BLUE, bold=True)], space_after=4),
        Para([R("If this contract is terminated by MENA BIG, MENA BIG refunds all pro-rata expenses already paid by {{client_name}} that have not yet been executed.", size=17)], line=1.12, space_after=14),
        Para([R("Duration & notice", size=19, color=BLUE, bold=True)], space_after=4),
        Para([R("Unless previously terminated, this agreement continues until {{client_name}}'s requirements stated in the purchase order are completed. {{client_name}} may terminate for convenience at any time with one (1) month's notice.", size=17)], line=1.12),
    ])
    slides.append(s)
    return slides


def business_setup_terms():
    m = "business_setup"
    s = Slide("Content", notes=tags(m, "terms"))
    y = heading(s, "Assumptions & limitations · Business setup", "Term, renewal & early termination")
    col = (1712 - 60) / 2
    numbered(s, [
        ("Fees include — support & advisory", "Renting an office; supporting the General Manager in activating the company and visiting authorities if required; support in hiring the first Saudi national."),
        ("Term & renewal", "This agreement is effective for a fixed and non-cancellable period of {{term.words}} from the effective date (the \"Initial Term\"). On expiry it renews automatically for the same duration and on the same terms, unless {{client_name}} gives written notice of non-renewal at least sixty (60) days before the end of the then-current term."),
    ], MARGIN, y + 4, col, gap=26, size=17.5)
    x2 = MARGIN + col + 60
    s.text(x2, y, col, 30, [Para([R("Early termination", size=20, color=BLUE, bold=True)])])
    s.text(x2, y + 40, col, 240, [Para([R("{{client_name}} may not terminate for convenience during the initial term. Any termination during the term is an early termination, and {{client_name}} remains unconditionally and irrevocably liable for all amounts invoiced and payable for services performed or committed up to the termination date, and all remaining fees for the unexpired portion of the initial term (based on the monthly fee).", size=17.5)], line=1.12)])
    for i, t in enumerate(["Before the entity's constitution is completed: 15,000 SAR + 50% of the remaining value.", "After the entity's constitution is completed: 40,000 SAR penalty + 60% of the remaining value."]):
        s.rect(x2, y + 300 + i * 96, col, 80, fill=PINK)
        s.text(x2 + 28, y + 300 + i * 96, col - 56, 80, [Para([R(t, size=17.5, color=CORAL_DK, bold=True)])], anchor="ctr")
    s.text(x2, y + 500, col, 120, [Para([R("Any committed expenses and other non-recoverable costs incurred by MENA BIG remain payable, and all payments made by {{client_name}} are strictly non-refundable.", size=17)], line=1.12)])
    return [s]
