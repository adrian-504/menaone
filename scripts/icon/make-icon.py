#!/usr/bin/env python3
"""The MENA One app icon (identity slice): the MENA "m" traced from the brand
logo (logo-primary.png, the first letter, pixel-exact), white on brand blue
#014B8C, with the three coral bars in the letterhead mark's proportions
(logo-mark-on-blue.jpg: gap 0.10, bar 0.044, pitch 0.113 of the m's height),
inside Apple's macOS icon grid — an 824 px continuous-corner squircle centred
on a 1024 canvas (macOS does not round a bundle's icon for it). Writes the
1024 master and the 28-px sidebar tile source; `npx tauri icon` makes the set.
`python3 scripts/icon/make-icon.py <brand-assets dir> <out dir>`"""
import sys, os, math
from PIL import Image, ImageDraw

assets, out = sys.argv[1], sys.argv[2]
BLUE, WHITE, CORAL = (1, 75, 140, 255), (255, 255, 255, 255), (240, 112, 88, 255)
S = 4  # supersampling

logo = Image.open(os.path.join(assets, 'logo-primary.png')).convert('RGBA')
m = logo.split()[3].crop((0, 197, 574, 1074))  # the "m": columns 0–573, rows 197–1073

def squircle(size, n=5.0):
    """A superellipse (|x|^n + |y|^n = 1), close to Apple's continuous corners."""
    r = size / 2
    pts = []
    for i in range(720):
        t = 2 * math.pi * i / 720
        c, s = math.cos(t), math.sin(t)
        pts.append((r + r * math.copysign(abs(c) ** (2 / n), c), r + r * math.copysign(abs(s) ** (2 / n), s)))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    return mask

def mark(height):
    """The m and its bars, white and coral, `height` px tall overall (transparent ground)."""
    mh = height / (1 + 0.0995 + 2 * 0.113 + 0.044)
    mw = mh * m.width / m.height
    g = Image.new('RGBA', (round(mw), round(height)), (0, 0, 0, 0))
    mm = m.resize((round(mw), round(mh)), Image.LANCZOS)
    g.paste(Image.new('RGBA', mm.size, WHITE), (0, 0), mm)
    d = ImageDraw.Draw(g)
    bar = mh * 0.044
    for k in range(3):
        y = mh * (1 + 0.0995 + 0.113 * k)
        d.rounded_rectangle([0, y, mw, y + bar], radius=bar / 3, fill=CORAL)
    return g

def tile(size, mark_frac, pad_frac=0.0):
    """A blue squircle `size` px (inside a canvas with `pad_frac` margin) with the mark centred."""
    big = size * S
    canvas = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    inner = round(big * (1 - 2 * pad_frac))
    off = (big - inner) // 2
    ground = Image.new('RGBA', (inner, inner), BLUE)
    canvas.paste(ground, (off, off), squircle(inner))
    g = mark(inner * mark_frac)
    canvas.alpha_composite(g, ((big - g.width) // 2, (big - g.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)

def small(size):
    """16 and 32 px, drawn on the pixel grid: whole-pixel bars with whole-pixel gaps, so the three
    lines stay three lines (a downscaled master blurs them into one)."""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # Measured by hand per size: margin, the m's height and width, bar thickness (gaps equal the bar).
    # The m is drawn on the grid too: three legs joined by a top bar (the logo's proportions: legs ~1.7× the gaps).
    # 28/56: the sidebar tile (full-bleed squircle), at 1× and 2×.
    margin, mh, mw, bt, leg, cap = {16: (1, 5, 5, 1, 1, 1), 32: (2, 11, 10, 2, 2, 2), 28: (0, 12, 8, 1, 2, 2), 56: (0, 24, 16, 2, 4, 4)}[size]
    inner = size - 2 * margin
    canvas.paste(Image.new('RGBA', (inner, inner), BLUE), (margin, margin), squircle(inner * S).resize((inner, inner), Image.LANCZOS))
    total = mh + bt + 5 * bt           # the m, a gap, bar-gap-bar-gap-bar
    top = (size - total) // 2
    left = (size - mw) // 2
    d = ImageDraw.Draw(canvas)
    d.rectangle([left, top, left + mw - 1, top + cap - 1], fill=WHITE)
    gap = (mw - 3 * leg) // 2
    for x in (left, left + leg + gap, left + mw - leg):
        d.rectangle([x, top, x + leg - 1, top + mh - 1], fill=WHITE)
    for k in range(3):
        y = top + mh + bt + k * 2 * bt
        d.rectangle([left, y, left + mw - 1, y + bt - 1], fill=CORAL)
    return canvas

os.makedirs(out, exist_ok=True)
small(16).save(os.path.join(out, 'icon-16.png'))
small(32).save(os.path.join(out, 'icon-32.png'))
tile(1024, 0.60, pad_frac=100 / 1024).save(os.path.join(out, 'app-icon-source.png'))
small(28).save(os.path.join(out, 'mark-tile-28.png'))  # the sidebar tile, 1× and 2×
small(56).save(os.path.join(out, 'mark-tile-56.png'))
print('ok')
