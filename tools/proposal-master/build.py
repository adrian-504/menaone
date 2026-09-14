"""Builds "MENA BIG Proposal Master 2026.pptx": every service's slides in the
2026 design, tagged for MENA One's generator.

    python3 build.py --assets <folder with the 2026 redesign decks> --out <file.pptx>

Assets (logos, cover photo, reference logos) are read from the 2026 redesign
decks; nothing client-specific is written into the master.
"""

from __future__ import annotations

import argparse
import os
import re
import zipfile

import pptxkit
from design import COLORS, layouts
import shared
import modules_admin
import modules_people
import modules_services


def read_assets(folder: str):
    media = {}
    admin = zipfile.ZipFile(os.path.join(folder, "Admin_PRO_proposal_MENA_BIG_redesign.pptx"))
    media["cover_photo.png"] = admin.read("ppt/media/image-1-1.png")
    media["logo_white.png"] = admin.read("ppt/media/image-1-2.png")
    media["logo_color.png"] = admin.read("ppt/media/image-2-1.png")
    media["m_mark.png"] = admin.read("ppt/media/image-5-1.png")
    # Reference logos, at the positions the redesign placed them.
    bs = zipfile.ZipFile(os.path.join(folder, "MENA_BIG_Busines_Setup_Template.pptx"))
    pres = bs.read("ppt/presentation.xml").decode()
    rels = bs.read("ppt/_rels/presentation.xml.rels").decode()
    rid = {re.search(r'Id="([^"]+)"', r).group(1): re.search(r'Target="([^"]+)"', r).group(1) for r in re.findall(r"<Relationship\b[^>]*>", rels)}
    order = [rid[m] for m in re.findall(r'<p:sldId\b[^>]*r:id="([^"]+)"', pres)]
    part = next(p for p in order if "Selected References" in bs.read("ppt/" + p).decode())
    xml = bs.read("ppt/" + part).decode()
    srels = bs.read("ppt/slides/_rels/" + part.split("/")[-1] + ".rels").decode()
    targets = {re.search(r'Id="([^"]+)"', r).group(1): re.search(r'Target="([^"]+)"', r).group(1) for r in re.findall(r"<Relationship\b[^>]*>", srels)}
    group = re.search(r"(?s)<p:grpSp>.*?</p:grpSp>", xml).group(0)
    embeds = {}
    for e in set(re.findall(r'r:embed="([^"]+)"', group)):
        name = "ref_" + os.path.basename(targets[e])
        media[name] = bs.read("ppt/media/" + os.path.basename(targets[e]))
        embeds[e] = name
    pictures = (group, embeds)
    return media, pictures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="", help="comma-separated module keys for a quick build")
    args = ap.parse_args()
    media, pictures = read_assets(args.assets)

    modules = [
        ("admin_pro", modules_admin.admin_pro),
        ("gosi_payroll", modules_admin.gosi_payroll),
        ("accountancy", modules_services.accountancy),
        ("labor_law", modules_services.labor_law),
        ("hr_consultancy", modules_services.hr_consultancy),
        ("manpower", modules_services.manpower),
        ("maintenance", modules_services.maintenance),
        ("constitution", modules_services.constitution),
        ("constitution_maintenance", modules_services.constitution_maintenance),
        ("business_setup", lambda: modules_services.business_setup() + modules_people.business_setup_terms()),
        ("workforce", modules_people.workforce),
        ("recruitment", modules_people.recruitment),
        ("mobilization", modules_services.mobilization),
        ("liquidation", modules_services.liquidation),
        ("gm_representative", modules_services.gm_representative),
    ]
    only = [m for m in args.only.split(",") if m]
    approach, terms = [], []
    for key, fn in modules:
        if only and key not in only:
            continue
        for slide in fn():
            (terms if "[role: terms]" in slide.notes else approach).append(slide)
    slides = [shared.cover(), shared.letter(), shared.agenda(), shared.section(1, "Detailed Approach & Project Fees", "section-approach")]
    slides.extend(approach)
    slides.append(shared.section(2, "Terms & Conditions, and Acceptance", "section-terms"))
    slides.extend(shared.general_terms())
    slides.extend(terms)
    slides.append(shared.acceptance())
    slides.append(shared.section(3, "About MENA BIG", "section-about"))
    slides.append(shared.about())
    slides.append(shared.references(pictures))
    slides.append(shared.back_cover())
    pptxkit.write(args.out, layouts(), slides, media, COLORS, "MENA BIG Proposal Master 2026")
    print(f"{len(slides)} slides → {args.out}")


if __name__ == "__main__":
    main()
