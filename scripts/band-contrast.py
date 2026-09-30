#!/usr/bin/env python3
"""My Day's band (brand slice): is the white greeting and date at 4.5:1 or more
on every bundled photo, under each time-of-day scrim, at the band's narrowest
(1,080 window) and a wide (1,440) width? Reads the scrims from
src/lib/appearance.ts, so it follows any change there. Needs Pillow.
`python3 scripts/band-contrast.py` — exits 1 if any is under 4.5."""
import glob, re, sys, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
src = open(os.path.join(ROOT, 'src/lib/appearance.ts')).read()
body = src[src.index('export function scrimFor'):]
grads = {}
for part in ('morning', 'evening'):
    grads[part] = re.search(rf"part === '{part}'\) return '([^']+)'", body).group(1)
grads['afternoon'] = re.findall(r"return '(linear-gradient[^']+)'", body)[2]

def stops(g):
    return [(float(p) / 100, (int(r), int(gg), int(b), float(a))) for r, gg, b, a, p in re.findall(r'rgba\((\d+),(\d+),(\d+),([\d.]+)\) (\d+)%', g)]

def at(st, f):
    for (a, ca), (b, cb) in zip(st, st[1:]):
        if a <= f <= b:
            t = (f - a) / (b - a)
            return tuple(ca[i] + (cb[i] - ca[i]) * t for i in range(4))
    return st[-1][1]

def lum(c):
    ch = lambda v: (v / 255) / 12.92 if v / 255 <= 0.03928 else ((v / 255 + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])

files = sorted(glob.glob(os.path.join(ROOT, 'src/assets/band/*.webp'))) + [os.path.join(ROOT, 'src/assets/brand/office-band.jpg')]
low = False
for fn in files:
    im = Image.open(fn).convert('RGB'); W, H = im.size
    row = []
    for part, g in grads.items():
        st = stops(g); worst = 99
        for bw in (786, 1146):  # the band's width in a 1,080 and a 1,440 window
            scale = max(bw / W, 180 / H)
            px, py = (0.6, 0.55) if 'office' in fn else (0.5, 0.5)
            ox, oy = (W * scale - bw) * px, (H * scale - 180) * py
            vals = []
            for y in range(62, 152, 4):          # the date line and the greeting
                for x in range(26, 430, 4):
                    p = im.getpixel((min(W - 1, int((x + ox) / scale)), min(H - 1, int((y + oy) / scale))))
                    r, gg, b, a = at(st, x / bw)
                    c = tuple(a * s + (1 - a) * q for s, q in zip((r, gg, b), p))
                    vals.append(1.05 / (lum(c) + 0.05))
            vals.sort(); worst = min(worst, vals[int(len(vals) * 0.02)])
        low |= worst < 4.5
        row.append(f'{part} {worst:.2f}{" LOW" if worst < 4.5 else ""}')
    print(f'{os.path.basename(fn):18} ' + ' · '.join(row))
sys.exit(1 if low else 0)
