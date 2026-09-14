"""Slides every proposal has: cover, letter, agenda, section dividers, general
terms, acceptance, about MENA BIG, references and the back cover."""

from __future__ import annotations

from design import *  # noqa: F401,F403
from pptxkit import Cell, Para, Run, Slide


def notes(*tags: str) -> str:
    return " ".join(tags)


def cover() -> Slide:
    s = Slide("Cover", notes=notes("[always]", "[role: cover]"))
    s.image("cover_photo.png", 0, 0, 1920, 1080, name="Photo", alpha=30)
    s.rect(0, 0, 1920, 1080, gradient=((36, NAVY, 100), (80, BLUE, 55), (100, BLUE, 18), 20), name="Overlay")
    s.image("logo_white.png", MARGIN, 72, 92, 70, name="Logo")
    s.text(1300, 84, 516, 30, [Para([label_run("Proposal · {{entity_region}}", color=WHITE, size=14.5)], align="r")], anchor="ctr", name="Region")
    eyebrow(s, "Proposal for providing", y=360, color=CORAL_LT, bar=CORAL)
    s.text(MARGIN, 410, 1500, 250, [Para([Run("{{services_title}}", size=79, color=WHITE, bold=True, font="+mj-lt")], line=0.92)], anchor="t", title=True, name="Services")
    s.text(MARGIN, 690, 1400, 44, [Para([R("Prepared for ", size=26.5, color=WHITE), R("{{client_name}}", size=26.5, color=WHITE, bold=True)])], anchor="ctr", name="Client")
    s.rect(MARGIN, 752, 60, 2, fill=CORAL)
    s.text(MARGIN, 770, 800, 36, [Para([R("{{proposal_date}}", size=20.5, color="C9D3E0")])], anchor="ctr", name="Date")
    s.text(MARGIN, 980, 1200, 30, [Para([label_run("MENA Business Investment Group, S.L. · KSA Branch", color="9FB0C4", size=13)])], anchor="ctr", name="Entity")
    return s


def letter() -> Slide:
    s = Slide("Content with side panel", notes=notes("[always]", "[role: letter]"))
    eyebrow(s, "Cover letter")
    s.text(MARGIN, TOP + 40, 1100, 110, [Para([Run("Proposal for Providing {{services_title}}", size=38.5, color=BLUE, bold=True, font="+mj-lt")], line=0.95)], title=True, name="Title")
    body = [
        Para([R("Dear {{client_name}},", size=20.5)], space_after=14),
        Para([R("Thank you for giving us the opportunity to present our proposal for providing ", size=20.5), R("{{services_title}}", size=20.5, color=INK, bold=True),
              R(". We have developed this proposal based on our understanding of your requirements, and we feel that we are well-positioned to deliver professional solutions in line with your needs.", size=20.5)], line=1.18, space_after=16),
    ]
    s.text(MARGIN, 270, 1080, 220, body, name="Letter")
    s.rect(MARGIN, 500, 3, 190, fill=CORAL)
    s.text(MARGIN + 28, 500, 1050, 30, [Para([label_run("Our approach", color=CORAL_DK)])], anchor="ctr", name="Label")
    s.text(MARGIN + 28, 538, 1050, 160, [Para([R("We aim to develop a thorough understanding of each client's business to ensure that our recommendations support the business's needs and reinforce success. Our experience and uniquely customized approaches enable us to provide high-quality and effective advice.", size=20.5)], line=1.18)], name="Approach")
    s.text(MARGIN, 730, 1080, 40, [Para([R("We look forward to partnering with your esteemed organization on this project.", size=20.5)])], name="Close")
    s.text(MARGIN, 830, 1080, 120, [Para([R("Yours sincerely,", size=19)], space_after=6), Para([R("MENA Business Investment Group, S.L. — KSA Branch", size=20.5, color=BLUE, bold=True)], space_after=4), Para([R("{{proposal_date}}", size=17, color=MUTED)])], name="Signature")
    s.image("logo_color.png", 1370, 80, 92, 70, name="Logo")
    y = 210
    for lab, lines in [("Attn", [("{{client_name}}", BLUE, True, 23), ("{{client_country_line}}", TEXT, False, 19)]), ("Subject", [("Proposal for Providing {{services_title}}", TEXT, False, 19)])]:
        s.text(1370, y, 460, 24, [Para([label_run(lab)])], anchor="ctr", name="Label")
        paras = [Para([R(t, size=sz, color=c, bold=b)], space_after=4) for t, c, b, sz in lines]
        s.text(1370, y + 32, 460, 110, paras, name="Value")
        y += 170
    s.text(1370, 820, 460, 24, [Para([label_run("Contact")])], anchor="ctr", name="Label")
    s.text(1370, 852, 460, 100, [Para([R("Hassan Balaghi", size=19, color=INK, bold=True)], space_after=4), Para([R("+966 55 66 62 781", size=18)], space_after=2), Para([R("hasbalaghi@mena-big.com", size=18)])], name="Contact")
    return s


def agenda() -> Slide:
    s = Slide("Content", notes=notes("[always]", "[role: agenda]"))
    eyebrow(s, "Contents")
    s.text(MARGIN, TOP + 40, 1200, 70, [Para([Run("Agenda", size=48, color=BLUE, bold=True, font="+mj-lt")])], title=True, name="Title")
    y = 300
    for n, title, token in [("01", "Detailed Approach & Project Fees", "{{page.approach}}"), ("02", "Terms & Conditions, and Acceptance", "{{page.terms}}"), ("03", "About MENA BIG", "{{page.about}}")]:
        s.rect(MARGIN, y, 1712, 1, fill=LINE)
        s.text(MARGIN, y + 34, 80, 50, [Para([Run(n, size=19, color=CORAL_DK, bold=True, spacing=80)])], anchor="ctr", name="Number")
        s.text(MARGIN + 110, y + 30, 1300, 60, [Para([Run(title, size=36, color=BLUE, bold=True, font="+mj-lt")])], anchor="ctr", name="Entry")
        s.text(1600, y + 34, 216, 50, [Para([R("p. " + token, size=19, color=MUTED)], align="r")], anchor="ctr", name="Page")
        y += 118
    s.rect(MARGIN, y, 1712, 1, fill=LINE)
    return s


def section(number: int, title: str, role: str) -> Slide:
    s = Slide("Section", notes=notes("[always]", f"[role: {role}]"))
    s.text(1180, 560, 700, 520, [Para([Run(f"{number:02d}", size=360, color="FFFFFF", bold=True, font="+mj-lt")], align="r")], anchor="b", name="Big number")
    # The big number is a watermark: very light.
    s.shapes[-1] = s.shapes[-1].replace('<a:srgbClr val="FFFFFF"/>', '<a:srgbClr val="FFFFFF"><a:alpha val="7000"/></a:srgbClr>')
    eyebrow(s, f"Part {number:02d}", y=430, color=CORAL_LT)
    s.text(MARGIN, 478, 1300, 200, [Para([Run(title, size=69.5, color=WHITE, bold=True, font="+mj-lt")], line=0.95)], title=True, name="Title")
    return s


def general_terms() -> list:
    s = Slide("Content", notes=notes("[always]", "[role: terms]"))
    y = heading(s, "Terms & conditions · Assumptions and limitations", "General terms", "The stated scope of work consists of the following assumptions and limitations.")
    left_w = 1000
    numbered(s, [
        "All agreement fees exclude governmental expenses and taxes. All taxes are as per current country laws and regulations.",
        "All fees exclude VAT and WHT, which are added to our invoices according to country law.",
        "All fees exclude employee and company taxes and expenses, which are borne by {{client_name}}.",
        "Rates reflect current governmental expenses. Any change in governmental or other expenses, or in Saudization rates, is invoiced to {{client_name}} at cost as per the payment receipt; any additional expenses arising during the process are paid by {{client_name}}.",
        "In case of termination, unless otherwise agreed by the parties, MENA BIG may finalize all services agreed under the last purchase orders. {{client_name}} pays for all services provided up to the completion of the purchase orders outstanding at the date of termination.",
    ], MARGIN, y + 4, left_w)
    px = MARGIN + left_w + 60
    pw = 1712 - left_w - 60
    panel(s, px, y, pw, 560)
    s.text(px + 36, y + 34, pw - 72, 24, [Para([label_run("Duration & minimum term")])], anchor="ctr")
    s.text(px + 36, y + 70, pw - 72, 70, [Para([Run("{{term}}", size=48, color=BLUE, bold=True, font="+mj-lt")])], anchor="ctr", name="Term")
    s.text(px + 36, y + 150, pw - 72, 200, [Para([R("Unless previously terminated, this agreement runs for an initial minimum duration of {{term}} from the date of signature. Service-specific durations and notice periods are stated with each service's fees.", size=BODY)], line=1.15)], name="Term text")
    s.rect(px + 36, y + 360, pw - 72, 1, fill=LINE)
    s.text(px + 36, y + 384, pw - 72, 150, [Para([label_run("Prices")], space_after=8), Para([R("All our prices exclude VAT, which is added to our invoices according to the VAT law, and exclude any governmental expenses.", size=BODY)], line=1.15)], name="Prices")

    s2 = Slide("Content", notes=notes("[always]", "[role: terms]"))
    y = heading(s2, "Terms & conditions · Assumptions and limitations", "Confidentiality, breaches & governing law")
    col = (1712 - 60) / 2
    left = [
        ("Confidentiality", "MENA BIG acknowledges that in the course of this agreement it will have access to confidential information and accepts the restrictions in this clause. MENA BIG shall not, during this engagement or at any time after the termination date, use or disclose to any third party any confidential information relating to the business, customers, products, affairs and finances of {{client_name}}, in any form or medium."),
        ("Exceptions", "This restriction does not apply to any use or disclosure authorized by {{client_name}} in writing or required by law, or to information already in the public domain other than through MENA BIG's unauthorized disclosure. On request, MENA BIG promptly returns all confidential information and company property in its possession."),
    ]
    right = [
        ("Material breaches", "If either party breaches the contract or fails to meet its obligations, the affected party gives written notice stating the breach, and the other party has fourteen (14) working days to remedy it. Either party may terminate with immediate effect if the other commits a material breach."),
        ("Applicable law", "This agreement is governed, construed and takes effect in accordance with the laws of the Kingdom of Saudi Arabia, in Riyadh."),
        ("Dispute resolution", "Any dispute, controversy or claim arising out of or relating to this contract, or its breach, termination or invalidity, is heard in the courts of Saudi Arabia under Saudi law. The language of the resolution is English and Arabic."),
    ]
    for x, items in [(MARGIN, left), (MARGIN + col + 60, right)]:
        yy = y + 4
        for title, body in items:
            s2.text(x, yy, col, 28, [Para([R(title, size=20.5, color=BLUE, bold=True)])], anchor="ctr", name="Clause title")
            h = text_height(body, BODY, col, 1.2)
            s2.text(x, yy + 36, col, h + 6, [Para([R(body)], line=1.15)], name="Clause")
            yy += h + 36 + 34
    return [s, s2]


def acceptance() -> Slide:
    s = Slide("Content", notes=notes("[always]", "[role: acceptance]"))
    y = heading(s, "Terms & conditions · Acceptance", "Acknowledgement & acceptance",
                "We believe that this proposal is in accordance with your expectations, and we look forward to the opportunity of working with {{client_name}} on this important project. This proposal sets forth the scope, overall approach, timing and fee arrangements for our services. Please indicate your acceptance by signing this page and returning a copy of the proposal to MENA BIG.")
    col = (1712 - 60) / 2
    for i, (who, fill, dark) in enumerate([("{{client_name}}", PANEL, False), ("MENA BIG", NAVY, True)]):
        x = MARGIN + i * (col + 60)
        s.rect(x, y + 10, col, 600, fill=fill)
        if not dark:
            s.rect(x, y + 10, col, 3, fill=CORAL)
        c1, c2 = (WHITE, "C9D3E0") if dark else (BLUE, TEXT)
        s.text(x + 44, y + 50, col - 88, 24, [Para([label_run("Accepted by", color=CORAL_LT if dark else MUTED)])], anchor="ctr")
        s.text(x + 44, y + 84, col - 88, 50, [Para([Run(who, size=31, color=c1, bold=True, font="+mj-lt")])], anchor="ctr")
        s.text(x + 44, y + 140, col - 88, 30, [Para([R("Acknowledged and accepted by:", size=BODY, color=c2)])], anchor="ctr")
        yy = y + 280
        for field in ["Name", "Title", "Date"]:
            s.rect(x + 44, yy, col - 88, 1, fill="3A4B63" if dark else "C6C9CC")
            s.text(x + 44, yy + 10, 300, 24, [Para([label_run(field, color="9FB0C4" if dark else MUTED)])], anchor="ctr")
            yy += 100
    return s


def about() -> Slide:
    s = Slide("Content", notes=notes("[always]", "[role: about]"))
    y = heading(s, "About MENA BIG · Services overview", "Who we are, in numbers")
    w = (1712 - 3 * 50) / 4
    for i, (v, c) in enumerate([("50+", "Clients"), ("50+", "Services"), ("40+", "Employees"), ("15+", "Countries")]):
        stat(s, v, c, MARGIN + i * (w + 50), y, w)
    y += 150
    section_label(s, "Our services", MARGIN, y, 800)
    numbered(s, ["Workforce Services", "Human Resources Advisory Services", "Manpower Solutions", "Recruitment Advisory Services", "Training Services", "Business Advisory Services", "Governmental Relations and Sponsorship", "International Business Development"],
             MARGIN, y + 44, 760, size=18.5, gap=12)
    section_label(s, "Industries we serve", 960, y, 800)
    chips(s, ["Non-profit Organizations", "Manufacturing and Industrial", "Insurance", "Oil and Gas", "Financial Services and Investment", "General Trading and Contracting",
              "Professional Services", "Technology", "Multi-Activities", "Automotive and Transport", "Retail — F&B / Fashion", "Real Estate and Property Management", "FMCG", "Online Platforms"],
          960, y + 44, 856, size=16, height=42)
    return s


def references(pictures) -> Slide:
    s = Slide("Content", notes=notes("[always]", "[role: references]"))
    heading(s, "About MENA BIG", "Selected references", "Organizations across the region and Europe that trust MENA BIG with their market-entry, workforce and administration mandates.")
    group, embeds = pictures
    s.raw_group(group, embeds, box=(MARGIN, 290, 1712, 660))
    return s


def back_cover() -> Slide:
    s = Slide("Back cover", notes=notes("[always]", "[role: back]"))
    s.image("cover_photo.png", 0, 0, 1920, 1080, name="Photo", alpha=30)
    s.rect(0, 0, 1920, 1080, gradient=((36, NAVY, 100), (80, BLUE, 70), (100, BLUE, 40), 20), name="Overlay")
    s.image("logo_white.png", 1712, 72, 104, 79, name="Logo")
    eyebrow(s, "Contact information", y=190, color=CORAL_LT)
    s.text(MARGIN, 236, 1400, 180, [Para([Run("Let's build in Saudi Arabia, together.", size=67, color=WHITE, bold=True, font="+mj-lt")], line=0.95)], name="Title")
    col = (1712 - 80) / 2
    for i, (region, name, lines) in enumerate([
        ("Middle East & Gulf Region", "Hassan Balaghi", ["Almalqa, Anas bin Malik Rd, Al Riyadh 13524, Kingdom of Saudi Arabia", "+966 55 66 62 781", "hasbalaghi@mena-big.com"]),
        ("Spain & Europe", "Ahmad Abdallah", ["Gran Via Corts Catalanes, 630, 4, 08007 Barcelona, España", "+34 934 920 455", "a.abdallah@mena-big.com"]),
    ]):
        x = MARGIN + i * (col + 80)
        s.rect(x, 560, col, 1, fill="3A4B63")
        s.text(x, 586, col, 24, [Para([label_run(region, color=CORAL_LT)])], anchor="ctr")
        s.text(x, 624, col, 44, [Para([Run(name, size=29, color=WHITE, bold=True, font="+mj-lt")])], anchor="ctr")
        s.text(x, 680, col, 140, [Para([R(l, size=18.5, color="C9D3E0")], space_after=6) for l in lines], name="Contact")
    s.rect(MARGIN, 930, 1712, 1, fill="3A4B63")
    s.text(MARGIN, 952, 600, 30, [Para([R("www.mena-big.com", size=17, color="C9D3E0")])], anchor="ctr")
    s.text(760, 952, 400, 30, [Para([R("info@mena-big.com", size=17, color="C9D3E0")], align="ctr")], anchor="ctr")
    s.text(1316, 952, 500, 30, [Para([label_run("MENA-BIG · @mena_big", color="9FB0C4", size=13)], align="r")], anchor="ctr")
    return s
