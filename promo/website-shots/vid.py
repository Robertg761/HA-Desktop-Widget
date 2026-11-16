import os, sys, glob
# Usage: python3 vid.py <work dir>  (holds out/ from stills.cjs and loop/ from loop.cjs)
WORK = sys.argv[1] if len(sys.argv) > 1 else '.'
HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], os.path.join(WORK, 'out'), os.path.join(WORK, 'site')]
exec(open(os.path.join(HERE, 'compose.py')).read().split('# Gallery:')[0])
from PIL import Image
frames = sorted(glob.glob(os.path.join(WORK, 'loop', '*.png')))
os.makedirs(os.path.join(WORK, 'vframes'), exist_ok=True)
pad = 56
w0 = Image.open(frames[0]).size
bg = wallpaper(w0[0] + 2 * pad, w0[1] + 2 * pad, 7)
shadow = Image.new('RGBA', bg.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + 24, pad + w0[0], pad + w0[1] + 24), 10, fill=(0, 0, 0, 150))
bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(34)))
for k, f in enumerate(frames):
    img = bg.copy(); img.alpha_composite(Image.open(f).convert('RGBA'), (pad, pad))
    img = img.convert('RGB').resize((760, 979), Image.LANCZOS)
    img.save(os.path.join(WORK, 'vframes', '%05d.png' % k))
img = Image.open(os.path.join(WORK, 'vframes', '00000.png')); img.save(os.path.join(WORK, 'site', 'demo-loop-poster.webp'), 'WEBP', quality=80, method=6)
