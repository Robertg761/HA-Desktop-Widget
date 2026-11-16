"""Turn the raw 2x captures into the website's images: windows on a desktop wallpaper, feature crops."""
import os, sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

def wallpaper(w, h, seed=0):
    """The site's demo-stage wallpaper: three soft glows over a dark diagonal gradient."""
    y, x = np.mgrid[0:h, 0:w].astype(float)
    nx, ny = x / w, y / h
    t = (nx * 0.34 + ny * 0.94) / 1.28
    a, b, c = np.array([22, 28, 51]), np.array([13, 18, 32]), np.array([26, 20, 34])
    base = np.where(t[..., None] < 0.52, a + (b - a) * (t / 0.52)[..., None], b + (c - b) * ((t - 0.52) / 0.48)[..., None])
    def glow(cx, cy, rx, ry, col, alpha):
        d = np.sqrt(((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2)
        k = np.clip(1 - d / 1.0, 0, 1) ** 1.6 * alpha
        return k[..., None], np.array(col)
    img = base
    for g in [glow(0.12, 0.18, 0.62, 0.8, (98, 78, 178), 0.55), glow(0.88, 0.92, 0.52, 0.7, (232, 128, 82), 0.32), glow(0.72, 0.06, 0.72, 0.9, (38, 108, 162), 0.5)]:
        k, col = g
        img = img * (1 - k) + col * k
    rng = np.random.default_rng(seed)
    img = img + rng.normal(0, 2.2, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert('RGBA')

def load(name):
    return Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')

def on_desktop(win, pad=56, seed=0):
    W, H = win.size[0] + 2 * pad, win.size[1] + 2 * pad
    bg = wallpaper(W, H, seed)
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + 24, pad + win.size[0], pad + win.size[1] + 24), 10, fill=(0, 0, 0, 150))
    bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(34)))
    bg.alpha_composite(win, (pad, pad))
    return bg

def save(img, name, width, q=82):
    img = img.convert('RGB')
    if img.size[0] > width:
        img = img.resize((width, round(img.size[1] * width / img.size[0])), Image.LANCZOS)
    img.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=q, method=6)
    print(name, img.size, os.path.getsize(os.path.join(OUT, name + '.webp')) // 1024, 'KB')

# Gallery: whole windows on the wallpaper.
for i, n in enumerate(['camera-tile', 'main-light', 'full-halloween', 'graph']):
    save(on_desktop(load(n), seed=i), 'shot-' + n, 760)

# Feature tiles: crops of the window over the wallpaper, so the glass reads as glass.
def crop_on_wall(name, box, seed=0):
    win = load(name)
    bg = wallpaper(*win.size, seed)
    bg.alpha_composite(win)
    return bg.crop(box)

save(crop_on_wall('palette', (0, 0, 1000, 300)), 'feat-palette', 720)
save(crop_on_wall('main-dark', (12, 503, 988, 1024), 1), 'feat-quick-access', 720)
save(crop_on_wall('camera-live', (40, 290, 960, 1030), 2), 'feat-camera', 720)

# Themes: three whole windows side by side, light, dark and Halloween.
wins = [crop_on_wall(n, (0, 0, 1000, 1320), k) for k, n in enumerate(['main-light', 'main-dark', 'full-halloween'])]
W, H = 1000, 470
bg = wallpaper(W, H, 4)
tw = 296
th = round(1320 * tw / 1000)
gap = (W - 3 * tw) // 4
for k, w in enumerate(wins):
    x, y = gap + k * (tw + gap), 34
    small = w.resize((tw, th), Image.LANCZOS)
    mask = Image.new('L', (tw, th), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, tw, th), 12, fill=255)
    bg.paste(small, (x, y), mask)
save(bg, 'feat-themes', 720)

# Desktop pins: three pinned tiles on a strip of wallpaper.
pins = [load('pin-' + n) for n in ['light_living_room', 'climate_thermostat', 'lock_front_door']]
W, H = 1000, 440
bg = wallpaper(W, H, 3)
pw, ph = pins[0].size
gap = (W - 3 * pw) // 4
for k, p in enumerate(pins):
    x, y = gap + k * (pw + gap), (H - ph) // 2 + (-14, 18, -4)[k]
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x, y + 14, x + pw, y + ph + 14), 28, fill=(0, 0, 0, 140))
    bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(20)))
    bg.alpha_composite(p, (x, y))
save(bg, 'feat-pins', 720)
