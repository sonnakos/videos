#!/usr/bin/env python3
"""Builds fonts/glyphs.woff2 (the five symbols the Google fonts lack) and the
outlined REEL path used by the hero mask.

Why: Anton / Archivo / Playfair / Caveat have no -> , arrow NE, check, cross or
eight-spoked asterisk. Without our own glyphs the browser falls back to a system
font per OS, and on iOS U+2733 can come out as a green emoji. The REEL mask is
outlined from Anton so it never depends on webfont timing.

Needs: python3 -m pip install fonttools brotli
Run:   python3 tools/build-glyphs.py
"""
import math, pathlib
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = pathlib.Path(__file__).resolve().parent.parent
UPM, AXIS, STEM = 1000, 300, 84          # AXIS = vertical centre (Archivo maths axis)


def rect(cx, cy, length, thick, angle_deg):
    """Corners of a rectangle centred on (cx, cy), rotated by angle (counter-clockwise order)."""
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), math.sin(a)
    vx, vy = -uy, ux
    hl, ht = length / 2, thick / 2
    pts = [(-hl, -ht), (hl, -ht), (hl, ht), (-hl, ht)]
    return [(round(cx + x * ux + y * vx), round(cy + x * uy + y * vy)) for x, y in pts]


def poly(pen, pts):
    # TrueType wants clockwise outer contours
    pts = list(reversed(pts))
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def glyph(contours):
    pen = TTGlyphPen(None)
    for c in contours:
        poly(pen, c)
    return pen.glyph()


def arrow(angle):
    """Arrow pointing right, rotated by angle around its centre."""
    L, head = 760, 300
    cx, cy = 450, AXIS
    shaft = rect(0, 0, L - 40, STEM, 0)
    shaft = [(x - 20, y) for x, y in shaft]
    # head: two strokes meeting at the tip
    tip = (L / 2, 0)
    d = head / math.sqrt(2)
    s1 = rect(tip[0] - d / 2 + STEM * 0.18, tip[1] + d / 2 - STEM * 0.18, head + STEM * 0.5, STEM, -45)
    s2 = rect(tip[0] - d / 2 + STEM * 0.18, tip[1] - d / 2 + STEM * 0.18, head + STEM * 0.5, STEM, 45)
    a = math.radians(angle)
    rot = lambda p: (round(cx + p[0] * math.cos(a) - p[1] * math.sin(a)),
                     round(cy + p[0] * math.sin(a) + p[1] * math.cos(a)))
    return [[rot(p) for p in c] for c in (shaft, s1, s2)]


def asterisk():
    cx, cy = 400, AXIS + 40
    return [rect(cx, cy, 620, 78, a) for a in (0, 45, 90, 135)]


def check():
    # short stroke down-right, long stroke up-right, overlapping at the joint
    return [rect(235, 250, 300, STEM + 6, -45), rect(470, 390, 560, STEM + 6, 50)]


def cross():
    cx, cy = 360, AXIS + 40
    return [rect(cx, cy, 600, STEM, 45), rect(cx, cy, 600, STEM, -45)]


GLYPHS = {
    '.notdef': ([], 500),
    'arrowright': (arrow(0), 900),
    'arrownortheast': (arrow(45), 900),
    'checkmark': (check(), 820),
    'multiply.x': (cross(), 720),
    'asterisk8': (asterisk(), 800),
}
CMAP = {0x2192: 'arrowright', 0x2197: 'arrownortheast', 0x2713: 'checkmark',
        0x2715: 'multiply.x', 0x2733: 'asterisk8'}

fb = FontBuilder(UPM, isTTF=True)
order = list(GLYPHS)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(CMAP)
glyf = {n: glyph(c) for n, (c, _) in GLYPHS.items()}
fb.setupGlyf(glyf)
fb.setupHorizontalMetrics({n: (adv, 0) for n, (_, adv) in GLYPHS.items()})
fb.setupHorizontalHeader(ascent=878, descent=-210)
fb.setupNameTable({'familyName': 'Portfolio Glyphs', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=878, sTypoDescender=-210, usWinAscent=878, usWinDescent=210)
fb.setupPost()
fb.font.flavor = 'woff2'
out = ROOT / 'fonts' / 'glyphs.woff2'
fb.save(str(out))
print('wrote', out.relative_to(ROOT), out.stat().st_size, 'bytes')

# ---- masthead outline (SONNEVEND, edge to edge) ---------------------------------
def outline(word, view_w=1000, bleed=0.012, pad=0.0):
    """Anton outlines for `word`, scaled so the ink runs `bleed` past both edges of a
    view_w-wide viewBox. Returns (view_h, path d)."""
    anton = TTFont(str(ROOT / 'fonts' / 'anton-latin.woff2'))
    cmap, gs, hmtx = anton.getBestCmap(), anton.getGlyphSet(), anton['hmtx']
    track = -0.02 * anton['head'].unitsPerEm      # letter-spacing: -0.02em, as in the display spec
    names = [cmap[ord(c)] for c in word]
    xs, x = [], 0
    for i, n in enumerate(names):
        xs.append(x)
        x += hmtx[n][0] + (track if i < len(names) - 1 else 0)
    bp = BoundsPen(gs)
    for n, ox in zip(names, xs):
        gs[n].draw(TransformPen(bp, (1, 0, 0, 1, ox, 0)))
    xmin, ymin, xmax, ymax = bp.bounds
    s = view_w * (1 + 2 * bleed) / (xmax - xmin)
    cap = (ymax - ymin) * s
    top = round(cap * pad, 1)
    view_h = round(cap + 2 * top)
    spen = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    for n, ox in zip(names, xs):
        gs[n].draw(TransformPen(spen, (s, 0, 0, -s, (ox - xmin) * s - bleed * view_w, ymax * s + top)))
    return view_h, spen.getCommands()


h, d = outline('SONNEVEND')
(ROOT / 'tools' / 'masthead-path.txt').write_text(f'viewBox 0 0 1000 {h}\n{d}\n')
print(f'SONNEVEND viewBox 0 0 1000 {h}  path {len(d)} chars')
