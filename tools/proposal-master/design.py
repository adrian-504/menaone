"""MENA BIG 2026 proposal design system: colours, type, layouts and the
components every slide is built from (eyebrow + title, numbered lists,
panels, fee tables, stats, chips). Mirrors the 2026 redesign decks, in Aptos.
"""

from __future__ import annotations

import math

from pptxkit import Cell, Para, Run, Slide, emu

# ── Palette (from the 2026 redesign) ──
NAVY = "0A2033"
BLUE = "014B8C"
CORAL = "F07058"
CORAL_DK = "CC4E37"
CORAL_LT = "F8AC9D"
PANEL = "EEF4FA"
LINE = "E1E3E5"
TEXT = "676A6C"
INK = "1F2124"
MUTED = "83868A"
WHITE = "FFFFFF"
PINK = "FDF1EE"

COLORS = dict(dk1=INK, lt1=WHITE, dk2=NAVY, lt2=PANEL, accent1=BLUE, accent2=CORAL, accent3=CORAL_DK, accent4=TEXT, accent5=MUTED, accent6=LINE)

MARGIN = 104
CONTENT_W = 1920 - 2 * MARGIN
TOP = 76
FOOT_Y = 1000

BODY = 19
SMALL = 16
LABEL = 14


def R(text, size=BODY, color=TEXT, bold=False, **kw):
    return Run(text, size=size, color=color, bold=bold, **kw)


def label_run(text, color=MUTED, size=LABEL):
    return Run(text, size=size, color=color, bold=True, spacing=160, caps=True)


def _char_em(ch: str) -> float:
    """Approximate Aptos advance widths, in em."""
    if ch == " ":
        return 0.24
    if ch in "il.,;:'|!j":
        return 0.25
    if ch in "frt()[]-":
        return 0.34
    if ch in "mwMW@%":
        return 0.82
    if ch.isupper():
        return 0.63
    if ch.isdigit():
        return 0.56
    return 0.52


def lines_needed(text: str, size_pt: float, width_px: float, factor: float = 1.0, spacing_pt: float = 0.0) -> int:
    """Line count by simulating word wrap with approximate glyph widths."""
    em_px = size_pt * 96 / 72
    spc_px = spacing_pt * 96 / 72
    total = 0
    for part in text.split("\n"):
        lines, cur = 1, 0.0
        for word in part.split(" "):
            w = sum(_char_em(c) * em_px * factor + spc_px for c in word)
            space = _char_em(" ") * em_px
            if cur and cur + space + w > width_px:
                lines += 1
                cur = w
            else:
                cur = cur + (space if cur else 0) + w
        total += lines
    return total


def text_height(text: str, size_pt: float, width_px: float, line: float = 1.2, factor: float = 1.0, spacing_pt: float = 0.0) -> float:
    return lines_needed(text, size_pt, width_px, factor, spacing_pt) * size_pt * 96 / 72 * line


# ── Layouts ──

def slide_number_shape(x, y, w, color=MUTED, align="r") -> str:
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="90" name="Page number"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(26)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>'
            f'<a:p><a:pPr algn="{align}"/><a:fld id="{{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}}" type="slidenum"><a:rPr lang="en-US" sz="1300" b="1" spc="150" dirty="0"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US" sz="1300"/></a:p></p:txBody></p:sp>')


def layouts():
    content = Slide("Content")
    content.text(MARGIN, FOOT_Y, 900, 26, [Para([label_run("MENA BIG · Proposal", size=12.5)])], anchor="ctr", name="Footer")
    content.shapes.append(slide_number_shape(1560, FOOT_Y, 120))
    content.image("logo_color.png", 1742, FOOT_Y - 12, 66, 50, name="Logo")

    panel_right = Slide("Content with side panel")
    panel_right.rect(1296, 0, 624, 1080, fill=PANEL)
    panel_right.rect(1296, 0, 1, 1080, fill=LINE)
    panel_right.text(MARGIN, FOOT_Y, 900, 26, [Para([label_run("MENA BIG · Proposal", size=12.5)])], anchor="ctr", name="Footer")
    panel_right.shapes.append(slide_number_shape(1100, FOOT_Y, 120))

    dark = Slide("Section", background=NAVY)
    dark.image("cover_photo.png", 0, 0, 1920, 1080, name="Photo", alpha=30)
    dark.rect(0, 0, 1920, 1080, gradient=((30, NAVY, 100), (75, BLUE, 60), (100, BLUE, 25), 20), name="Overlay")
    dark.image("logo_white.png", 1742, FOOT_Y - 12, 66, 50, name="Logo")

    divider = Slide("Service divider", background=PANEL)
    divider.rect(0, 0, 1920, 6, fill=CORAL)
    divider.image("m_mark.png", 1580, 360, 150, 314, name="Mark")
    divider.shapes.append(slide_number_shape(1560, FOOT_Y, 120))

    cover = Slide("Cover", background=NAVY)
    back = Slide("Back cover", background=NAVY)
    return [("Cover", cover), ("Content", content), ("Content with side panel", panel_right), ("Section", dark), ("Service divider", divider), ("Back cover", back)]


# ── Components ──

def eyebrow(s: Slide, text: str, x=MARGIN, y=TOP, color=CORAL_DK, bar=CORAL, width=1200):
    for i in range(3):
        s.rect(x, y + 4 + i * 10, 42, 4, fill=bar, name="Bar")
    s.text(x + 60, y, width, 30, [Para([Run(text, size=15, color=color, bold=True, spacing=180, caps=True)])], anchor="ctr", name="Eyebrow")


def heading(s: Slide, eyebrow_text: str, title: str, intro: str | None = None, width=CONTENT_W, x=MARGIN) -> float:
    eyebrow(s, eyebrow_text, x=x)
    th = text_height(title, 41, width, 1.05, factor=1.04)
    s.text(x, TOP + 40, width, th + 6, [Para([Run(title, size=41, color=BLUE, bold=True, font="+mj-lt")], line=0.95)], title=True, name="Title")
    y = TOP + 40 + th + 16
    if intro:
        ih = text_height(intro, BODY, width, 1.25)
        s.text(x, y, width, ih + 4, [Para([R(intro)], line=1.15)], name="Intro")
        y += ih + 22
    return y


def section_label(s: Slide, text: str, x, y, w, color=MUTED):
    h = text_height(text.upper(), LABEL, w, 1.15, factor=1.08, spacing_pt=1.6)
    s.text(x, y, w, max(24, h), [Para([label_run(text, color=color)], line=1.05)], anchor="t", name="Label")
    return y + max(24, h) + 12


def numbered(s: Slide, items, x, y, w, size=BODY, gap=16, start=1, title_color=INK):
    """items: str or (title, text). Returns the y after the list."""
    for i, item in enumerate(items):
        n = f"{i + start:02d}"
        title, body = (item if isinstance(item, tuple) else (None, item))
        s.text(x, y + 1, 40, 24, [Para([Run(n, size=15, color=CORAL_DK, bold=True, spacing=60)])], name="Number")
        paras = []
        h = 0
        if title:
            paras.append(Para([R(title, size=size + 0.5, color=title_color, bold=True)], space_after=3))
            h += text_height(title, size + 0.5, w - 52, 1.2) + 4
        if body:
            paras.append(Para([R(body, size=size)], line=1.12))
            h += text_height(body, size, w - 52, 1.2)
        s.text(x + 52, y, w - 52, h + 4, paras, name="Item")
        y += h + gap
    return y


def bullets(s: Slide, items, x, y, w, size=BODY, gap=6, color=TEXT, cols=1, col_gap=40):
    col_w = (w - col_gap * (cols - 1)) / cols
    per_col = math.ceil(len(items) / cols)
    y_end = y
    for c in range(cols):
        cy = y
        for item in items[c * per_col:(c + 1) * per_col]:
            h = text_height(item, size, col_w - 26, 1.2)
            s.text(x + c * (col_w + col_gap), cy, col_w, h + 2, [Para([R(item, size=size, color=color)], bullet="•", indent=22, line=1.1)], name="Bullet")
            cy += h + gap
        y_end = max(y_end, cy)
    return y_end


def panel(s: Slide, x, y, w, h, fill=PANEL, top=CORAL):
    s.rect(x, y, w, h, fill=fill, name="Panel")
    if top:
        s.rect(x, y, w, 3, fill=top, name="Panel rule")


def dark_panel(s: Slide, x, y, w, h):
    s.rect(x, y, w, h, fill=NAVY, radius=0, name="Dark panel")


def chips(s: Slide, items, x, y, w, size=SMALL, pad=14, gap=10, height=38, fill=PANEL, color=INK):
    cx, cy = x, y
    for item in items:
        cw = len(item) * size * 96 / 72 * 0.5 + pad * 2
        if cx + cw > x + w:
            cx = x
            cy += height + gap
        s.text(cx, cy, cw, height, [Para([R(item, size=size, color=color)], align="ctr")], anchor="ctr", fill=fill, name="Chip")
        cx += cw + gap
    return cy + height


def stat(s: Slide, value, caption, x, y, w, color=BLUE):
    s.rect(x, y, w, 2, fill=CORAL)
    s.text(x, y + 14, w, 60, [Para([Run(value, size=43, color=color, bold=True, font="+mj-lt")])], name="Stat")
    s.text(x, y + 74, w, 26, [Para([R(caption, size=SMALL, color=MUTED)])], name="Stat caption")


# ── Tables ──

def header_cell(text, align="l"):
    return Cell([Para([label_run(text, size=13)], align=align)], fill=PANEL, border_bottom=CORAL, margin=(20, 10, 20, 10))


def body_cell(runs, align="l", fill=None, border=LINE, margin=(20, 10, 20, 10), anchor="ctr"):
    if isinstance(runs, str):
        runs = [R(runs, size=BODY, color=INK)]
    return Cell([Para(runs, align=align, line=1.05)], fill=fill, border_bottom=border, margin=margin, anchor=anchor)


def price_run(text, size=21.5):
    return Run(text, size=size, color=BLUE, bold=True)


def fee_table(s: Slide, x, y, col_widths, headers, rows, aligns=None, row_h=62, header_h=48):
    """rows: list of lists of cell contents (str or [Run]). Returns bottom y."""
    aligns = aligns or ["l"] + ["r"] * (len(col_widths) - 1)
    table_rows = [{"height": header_h, "cells": [header_cell(h, a) for h, a in zip(headers, aligns)]}]
    for row in rows:
        table_rows.append({"height": row_h, "cells": [body_cell(c, a) for c, a in zip(row, aligns)]})
    return y + s.table(x, y, col_widths, table_rows)
