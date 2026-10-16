"""Make the demo home's images: album art and the porch camera's frames.

The camera picture is a CC0 photo from Wikimedia Commons, cropped below the house number, given a
wide-angle lens and a dusk grade, with a ticking timestamp, as a doorbell camera would show it.
"""
import math
import os
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PORCH_URL = (
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/'
    '137_Marshall_Avenue%2C_Perry_Hilltop%2C_2025-04-26%2C_porch_and_front_door.jpg/'
    '1280px-137_Marshall_Avenue%2C_Perry_Hilltop%2C_2025-04-26%2C_porch_and_front_door.jpg'
)


def album():
    W = 600
    y, x = np.mgrid[0:W, 0:W] / W
    top = np.array([18, 20, 58])
    mid = np.array([196, 72, 120])
    bot = np.array([255, 170, 90])
    t = y[..., None]
    img = np.where(t < 0.55, top + (mid - top) * (t / 0.55), mid + (bot - mid) * ((t - 0.55) / 0.45))
    cx, cy, r = 0.5, 0.62, 0.22
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    sun = np.clip((r - d) / 0.004, 0, 1)[..., None]
    suncol = np.array([255, 214, 150]) + (np.array([255, 120, 90]) - np.array([255, 214, 150])) * (
        (y - 0.4) / 0.45
    ).clip(0, 1)[..., None]
    stripes = ((np.sin((y - 0.62) * 120) > 0.55) & (y > 0.64)).astype(float)[..., None]
    img = img * (1 - sun) + suncol * sun * (1 - stripes) + img * sun * stripes
    glow = np.exp(-((d - r).clip(0)) ** 2 / 0.01)[..., None] * 0.35
    img = img + np.array([255, 140, 120]) * glow
    for k, (h, amp, col) in enumerate([(0.78, 0.05, (40, 24, 70)), (0.86, 0.04, (22, 14, 44))]):
        ridge = h - amp * np.abs(np.sin(x * math.pi * (2 + k) + k)) - 0.02 * np.sin(x * 31 + k)
        img = np.where((y > ridge)[..., None], np.array(col), img)
    img = np.clip(img + np.random.default_rng(3).normal(0, 6, (W, W, 1)), 0, 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(HERE, 'album.jpg'), quality=92)


def camera():
    porch = os.path.join(HERE, 'porch.jpg')
    if not os.path.exists(porch):
        req = urllib.request.Request(PORCH_URL, headers={'User-Agent': 'HADW-promo/1.0'})
        with urllib.request.urlopen(req) as r, open(porch, 'wb') as f:
            f.write(r.read())
    src = Image.open(porch).convert('RGB')
    crop = src.crop((0, 960, 1280, 1680)).resize((1280, 720), Image.LANCZOS)
    a = np.asarray(crop).astype(float) / 255
    H, Wd = 720, 1280
    yy, xx = np.mgrid[0:H, 0:Wd]
    nx = (xx - Wd / 2) / (Wd / 2)
    ny = (yy - H / 2) / (Wd / 2)
    rr = nx**2 + ny**2
    k = 0.12
    f = (1 + k * rr) / (1 + k * (1 + 0.5625**2))
    sx = np.clip(nx * f * (Wd / 2) + Wd / 2, 0, Wd - 1).astype(int)
    sy = np.clip(ny * f * (Wd / 2) + H / 2, 0, H - 1).astype(int)
    a = a[sy, sx]
    a = a**1.3 * 0.72 * np.array([0.86, 0.94, 1.1])
    g = np.exp(-(((xx - 610) / 430) ** 2 + ((yy - 120) / 250) ** 2))[..., None]
    a = a + g * np.array([0.30, 0.19, 0.07])
    a = np.clip(a * (1 - 0.5 * np.clip(rr * 0.85, 0, 1)[..., None]), 0, 1)
    base = ImageEnhance.Color(Image.fromarray((a * 255).astype(np.uint8))).enhance(0.8)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 26)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 22)
    os.makedirs(os.path.join(HERE, 'cam'), exist_ok=True)
    for i in range(60):
        im = base.copy()
        d = ImageDraw.Draw(im)
        ts = f'2026-10-30  19:42:{i:02d}'
        d.text((36, 30), ts, font=font, fill=(0, 0, 0))
        d.text((36, 674), 'PORCH  CAM 01', font=small, fill=(0, 0, 0))
        d.text((34, 28), ts, font=font, fill=(235, 235, 235))
        d.text((34, 672), 'PORCH  CAM 01', font=small, fill=(235, 235, 235))
        im.save(os.path.join(HERE, 'cam', f'{i:02d}.jpg'), quality=90)


def brand():
    """The compositor's fonts and icon, copied from the repository."""
    import shutil

    repo = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
    out = os.path.join(HERE, '..', 'comp', 'assets')
    os.makedirs(out, exist_ok=True)
    for src, name in (
        ('fonts/plus-jakarta-sans-latin.woff2', 'plus-jakarta-sans-latin.woff2'),
        ('fonts/inter-latin.woff2', 'inter-latin.woff2'),
        ('build/icons/512x512.png', 'icon.png'),
    ):
        shutil.copyfile(os.path.join(repo, src), os.path.join(out, name))


if __name__ == '__main__':
    album()
    camera()
    brand()
