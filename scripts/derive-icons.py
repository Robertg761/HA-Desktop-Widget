#!/usr/bin/env python3
"""Derive the packaging icon set from the application's artwork, build/icon.png (847 px).

Nothing is redrawn: every output is a resample, a crop or a mask of that image.

  build/icons/<n>x<n>.png     Linux hicolor sizes (16 ... 512): the artwork on a rounded square
  build/icon.ico              Windows: the frames it already had, kept as they are, plus the 20, 24
                              and 40 px ones Windows asks for at 125% and 150% scaling
  build/icon-mac.png          macOS: the artwork on Apple's icon grid (824 px body in 1024 px, with
                              continuous corners) and a soft shadow; electron-builder turns it into
                              the .icns, because macOS does not mask third-party icons
  build/trayTemplate.png      the macOS menu bar template image (22 px and, as @2x, 44 px): the
  build/trayTemplate@2x.png   house of the artwork as black with alpha, which the menu bar tints

Needs Python 3 with Pillow and NumPy. Run from anywhere: python3 scripts/derive-icons.py
"""
import io
import os
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / 'build' / 'icon.png'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'build'
OUT.mkdir(parents=True, exist_ok=True)

art = Image.open(SRC).convert('RGBA')
assert art.size == (847, 847)

def resample(image, size):
    return image.resize((size, size), Image.LANCZOS)

# --- Shapes. The artwork is a full-bleed black square, which looks out of place beside the rounded
# icons of macOS and of Linux icon themes, so those two get it clipped to a continuous-corner
# rounded square (a superellipse) with a margin. Windows keeps the square (see below).
def squircle_mask(size, exponent=5.0, supersample=4):
    n = size * supersample
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    half = n / 2
    inside = np.abs((xx + 0.5 - half) / half) ** exponent + np.abs((yy + 0.5 - half) / half) ** exponent <= 1.0
    return Image.fromarray(inside.astype(np.uint8) * 255, 'L').resize((size, size), Image.LANCZOS)

def masked_icon(canvas_size, body_size):
    """The artwork clipped to the shape, centred on a transparent canvas."""
    body = resample(art, body_size)
    body.putalpha(squircle_mask(body_size))
    canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.paste(body, ((canvas_size - body_size) // 2, (canvas_size - body_size) // 2))
    return canvas

# --- Linux hicolor sizes, at the sizes the icon theme looks up. The shape fills 94% of the square,
# the usual margin of an app icon in a GNOME or KDE grid.
linux_master = masked_icon(1024, 962)
os.makedirs(OUT / 'icons', exist_ok=True)
for size in (16, 32, 48, 64, 128, 256, 512):
    linux_master.resize((size, size), Image.LANCZOS).save(OUT / 'icons' / f'{size}x{size}.png', optimize=True)

# --- Windows .ico: the frames it already has stay exactly as they are; the sizes Windows asks for
# at 125% and 150% scaling (20 and 24 px for small icons, 40 px for taskbar icons) are added.
old_ico = Image.open(REPO / 'build' / 'icon.ico')
existing = {size[0]: old_ico.ico.getimage(size).convert('RGBA') for size in old_ico.ico.sizes()}
ico_sizes = (256, 128, 64, 48, 40, 32, 24, 20, 16)
frames = [existing[s] if s in existing else resample(art, s) for s in ico_sizes]
# The 256 px frame is PNG; the smaller ones are 32-bit BMP (with the empty AND mask), the encoding
# every Windows version reads for small icons.
def ico_frame(img):
    w, h = img.size
    if w >= 256:
        buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True); return buf.getvalue()
    rgba = np.asarray(img.convert('RGBA'))
    bgra = rgba[:, :, [2, 1, 0, 3]][::-1].tobytes()  # bottom-up rows
    mask_row = ((w + 31) // 32) * 4
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, len(bgra) + mask_row * h, 0, 0, 0, 0)
    return header + bgra + bytes(mask_row * h)

entries, payload = [], b''
header_size = 6 + 16 * len(frames)
for img in frames:
    data = ico_frame(img)
    w = img.size[0]
    entries.append(struct.pack('<BBBBHHII', w % 256, w % 256, 0, 0, 1, 32, len(data), header_size + len(payload)))
    payload += data
with open(OUT / 'icon.ico', 'wb') as f:
    f.write(struct.pack('<HHH', 0, 1, len(frames)) + b''.join(entries) + payload)

# --- macOS: the system no longer masks third-party icons, so the artwork gets Apple's icon grid
# (an 824 px body centred in 1024 px) and a soft shadow.
S, BODY = 1024, 824
mask_img = squircle_mask(BODY)
canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
shadow_alpha = Image.new('L', (S, S), 0)
shadow_alpha.paste(mask_img.point(lambda v: int(v * 0.30)), ((S - BODY) // 2, (S - BODY) // 2 + 10))
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
shadow.putalpha(shadow_alpha.filter(ImageFilter.GaussianBlur(10)))
canvas = Image.alpha_composite(canvas, shadow)
canvas = Image.alpha_composite(canvas, masked_icon(S, BODY))
canvas.save(OUT / 'icon-mac.png', optimize=True)

# --- macOS menu bar: a template image is a black shape with alpha, which the menu bar tints for
# light, dark and highlighted states. The shape is the white house of the existing artwork.
arr = np.asarray(art).astype(np.float64)
lo, hi = 110.0, 235.0
alpha = np.clip((arr[:, :, :3].min(axis=2) - lo) / (hi - lo), 0, 1)
ys, xs = np.where(alpha > 0.5)
box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
house = Image.fromarray((alpha * 255).astype(np.uint8), 'L').crop(box)
def template(px):
    SS2 = 8
    inner = round(px * 18 / 22)  # an 18 pt glyph in the 22 pt item, at either density
    big = px * SS2
    w, h = house.size
    scale = inner * SS2 / max(w, h)
    glyph = house.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    layer = Image.new('L', (big, big), 0)
    layer.paste(glyph, ((big - glyph.size[0]) // 2, (big - glyph.size[1]) // 2))
    out = layer.resize((px, px), Image.LANCZOS)
    rgba = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    rgba.putalpha(out)
    return rgba
template(22).save(OUT / 'trayTemplate.png', optimize=True)
template(44).save(OUT / 'trayTemplate@2x.png', optimize=True)
