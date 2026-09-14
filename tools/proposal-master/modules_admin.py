"""Service modules: Administration & PRO, Payroll & GOSI (tranche-priced)."""

from __future__ import annotations

from design import *  # noqa: F401,F403
from pptxkit import Para, Run, Slide


def tags(module: str, role: str, *extra: str) -> str:
    return " ".join([f"[module: {module}]", f"[role: {role}]", *extra])


def divider(module: str, title: str, description: str) -> Slide:
    s = Slide("Service divider", notes=tags(module, "divider"))
    eyebrow(s, "Service", y=360)
    s.text(MARGIN, 408, 1300, 220, [Para([Run(title, size=74.5, color=BLUE, bold=True, font="+mj-lt")], line=0.95)], anchor="t", title=True, name="Title")
    s.text(MARGIN, 640, 900, 120, [Para([R(description, size=23)], line=1.2)], name="Description")
    s.rect(MARGIN, 790, 110, 5, fill=CORAL)
    s.rect(MARGIN + 126, 790, 60, 5, fill="7FA3CC")
    s.rect(MARGIN + 202, 790, 30, 5, fill="BFD1E6")
    return s


def payment_terms(s: Slide, x, y, w, items, title="Payment terms"):
    y = section_label(s, title, x, y, w)
    return bullets(s, items, x, y, w, size=BODY, gap=8)


def tranche_fees(module: str, eyebrow_text: str, title: str, intro: str) -> Slide:
    s = Slide("Content", notes=tags(module, "fees"))
    y = heading(s, eyebrow_text, title, intro, width=1200)
    left_w = 900
    bottom = fee_table(s, MARGIN, y + 6, [620, 280], ["Category — tranches", "Monthly package"],
                       [[[R("{{row.label}}", size=20, color=INK)], [price_run("{{row.price}}")]]], row_h=66)
    payment_terms(s, MARGIN, bottom + 36, left_w, [
        "Invoices are paid 30 days from the invoice date.",
        "Invoices follow the tranches above; the first tranche is the minimum monthly fee.",
        "Service is for a minimum of {{term}}.",
    ])
    px, pw = MARGIN + left_w + 70, 1712 - left_w - 70
    dark_panel(s, px, y + 6, pw, 600)
    s.text(px + 44, y + 44, pw - 88, 24, [Para([label_run("How tranches are invoiced", color=CORAL_LT)])], anchor="ctr")
    yy = y + 96
    for ex, lines in [("Example — 10 employees in total", ["5 employees at the Tranche 1 rate", "5 employees at the Tranche 2 rate"]),
                      ("Example — 15 employees in total", ["15 employees at the Tranche 2 rate"])]:
        s.text(px + 44, yy, pw - 88, 30, [Para([R(ex, size=18, color="C9D3E0")])], anchor="ctr")
        s.text(px + 44, yy + 40, pw - 88, 90, [Para([R(l, size=23, color=WHITE, bold=True)], space_after=4) for l in lines])
        yy += 170
        s.rect(px + 44, yy - 24, pw - 88, 1, fill="3A4B63")
    s.text(px + 44, y + 510, pw - 88, 80, [Para([R("All fees exclude VAT and WHT, and exclude governmental expenses and taxes.", size=17, color="9FB0C4")], line=1.15)])
    return s


def admin_pro() -> list:
    m = "admin_pro"
    slides = [divider(m, "Administration & PRO Services", "PRO representation, government portals and employee services, managed for you month by month.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · Admin and PRO services", "Objective & employee services",
                "During the term of this agreement {{client_name}} uses the administration and governmental services stated below, under the terms and conditions of this proposal. Requests are made by purchase order specifying the full details of the required services.")
    left_w = 900
    section_label(s, "PRO representation", MARGIN, y, left_w)
    numbered(s, [
        "PRO representative for employee services at immigration and passport departments, the labor office, GOSI and Qiwa, and any other authority required.",
        "Manage and control online systems — Muqeem, Labor Office, Qiwa, GOSI, COC and Mudad.",
        "Issuance of new labor cards and Iqamas, and renewal of existing labor cards and Iqamas.",
        "Claims and complaints filing and follow-up, with a monthly review and report.",
    ], MARGIN, y + 44, left_w)
    px, pw = MARGIN + left_w + 70, 1712 - left_w - 70
    panel(s, px, y, pw, 640)
    section_label(s, "Management of employee services", px + 36, y + 30, pw - 72)
    bullets(s, ["Exit re-entries & amendments", "Family visas and family Iqamas", "Driver license", "GAZT / tax certificate", "Criminal records & other certificates",
                "Unified contracts, kept current in the system", "Employment contracts & e-contracts", "Saudi Council of Engineers & of Accountancy"],
            px + 36, y + 80, pw - 72, cols=2, gap=12, color=INK)
    slides.append(s)
    slides.append(tranche_fees(m, "Project fees · Administration & government services", "Fee structure — PRO services",
                               "Fee arrangements should help you achieve your expectations — value is defined, tracked, measured and communicated throughout the engagement."))
    return slides


def gosi_payroll() -> list:
    m = "gosi_payroll"
    slides = [divider(m, "Payroll & GOSI Services", "Payroll preparation, wage protection and social insurance administration, reconciled every month.")]
    s = Slide("Content", notes=tags(m, "approach"))
    y = heading(s, "Detailed approach · GOSI and payroll services", "GOSI and payroll main tasks",
                "Administration and governmental services management for payroll and social insurance, requested by purchase order as required.")
    left_w = 900
    numbered(s, [
        ("Payroll management & preparation", "Monthly payroll cycle prepared, reviewed and reported."),
        ("Wages Protection System control", "WPS compliance monitored and maintained each month."),
        ("Adding, deleting & modifying employment", "Across GOSI and the Labor Office."),
        ("Social insurance monthly match", "GOSI calculations reconciled with payroll, with a monthly GOSI report."),
        ("Terminations and end of service", "End-of-service clarification and calculations, including social insurance treatment."),
    ], MARGIN, y + 4, left_w, gap=18)
    px, pw = MARGIN + left_w + 70, 1712 - left_w - 70
    panel(s, px, y, pw, 520)
    section_label(s, "Option · GOSI without payroll", px + 36, y + 30, pw - 72, color=CORAL_DK)
    s.text(px + 36, y + 70, pw - 72, 50, [Para([Run("Social insurance services only", size=29, color=BLUE, bold=True, font="+mj-lt")])], anchor="ctr")
    bullets(s, ["Adding, deleting and modifying employment in GOSI and the Labor Office", "Monthly GOSI report and costs report", "Terminations and end of service"], px + 36, y + 140, pw - 72, gap=12, color=INK)
    s.text(px + 36, y + 380, pw - 72, 100, [Para([R("Available where {{client_name}} keeps payroll in-house and requires social insurance administration only.", size=BODY)], line=1.15)])
    slides.append(s)
    slides.append(tranche_fees(m, "Project fees · GOSI and payroll services", "Fee structure — GOSI and payroll",
                               "Priced on the same tranche model, and billable alongside or independently of administration and PRO services."))
    return slides
