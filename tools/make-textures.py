#!/usr/bin/env python3
"""Print textures for the page: paper grain, stage (film) grain, halftone disc.

Grain tiles are alpha-only noise, laid over a flat colour with background layers,
so one tile works on the header (92% paper) as well as the page. Per-pixel noise
has no spatial correlation, so it tiles seamlessly; the soft mottling is blurred
with wrap-around so it tiles too.

Needs: python3 -m pip install pillow
Run:   python3 tools/make-textures.py
"""
import math, random, pathlib
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'tex'
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 256


def wrapped_blur(img, radius):
    """Gaussian blur that wraps around the edges, so the result still tiles."""
    big = Image.new(img.mode, (img.width * 3, img.height * 3))
    for x in range(3):
        for y in range(3):
            big.paste(img, (x * img.width, y * img.height))
    big = big.filter(ImageFilter.GaussianBlur(radius))
    return big.crop((img.width, img.height, img.width * 2, img.height * 2))


def grain(name, rgb, alpha_max, specks, mottle_alpha, seed):
    rnd = random.Random(seed)
    # soft mottling: blurred noise, a few percent at most
    low = Image.new('L', (SIZE, SIZE))
    low.putdata([rnd.randint(0, 255) for _ in range(SIZE * SIZE)])
    low = wrapped_blur(low, 6)
    lo = list(low.tobytes())
    lmin, lmax = min(lo), max(lo)
    px = []
    for i in range(SIZE * SIZE):
        m = (lo[i] - lmin) / max(1, lmax - lmin)            # 0..1
        a = m * mottle_alpha + rnd.random() ** 2.2 * alpha_max  # fine grain, skewed to faint
        if rnd.random() < specks:                            # occasional fibre / dust speck
            a = alpha_max * (1.6 + rnd.random())
        px.append((*rgb, max(0, min(255, round(a * 255)))))
    img = Image.new('RGBA', (SIZE, SIZE))
    img.putdata(px)
    path = OUT / name
    img.save(path, 'WEBP', quality=72, method=6)
    print('wrote', path.relative_to(ROOT), path.stat().st_size, 'bytes')


grain('grain-paper.webp', (26, 26, 24), 0.05, 0.004, 0.018, 11)    # ink specks on cream
grain('grain-stage.webp', (245, 241, 234), 0.05, 0.003, 0.02, 23)   # light specks on the projection room

# halftone disc: solid terracotta core that breaks into shrinking dots at the rim,
# screened at 45 degrees like a print plate
D, PITCH = 900, 15
disc = Image.new('RGBA', (D, D), (0, 0, 0, 0))
draw = ImageDraw.Draw(disc)
c, R = D / 2, D / 2 - 2
TERRA = (196, 86, 58, 255)
solid = 0.78  # fraction of the radius that is solid
draw.ellipse((c - R * solid, c - R * solid, c + R * solid, c + R * solid), fill=TERRA)
ang = math.radians(45)
n = int(D / PITCH) + 4
for i in range(-n, n):
    for j in range(-n, n):
        u, v = i * PITCH, j * PITCH
        x = c + u * math.cos(ang) - v * math.sin(ang)
        y = c + u * math.sin(ang) + v * math.cos(ang)
        d = math.hypot(x - c, y - c) / R
        if d > 1:
            continue
        t = 1 if d <= solid else max(0.0, 1 - (d - solid) / (1 - solid))
        r = PITCH * 0.72 * math.sqrt(t)
        if r > 0.6:
            draw.ellipse((x - r, y - r, x + r, y + r), fill=TERRA)
path = OUT / 'halftone-disc.webp'
disc.save(path, 'WEBP', quality=82, method=6)
print('wrote', path.relative_to(ROOT), path.stat().st_size, 'bytes')
