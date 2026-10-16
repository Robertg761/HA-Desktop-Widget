"""Frames every 0.25 s from the master (out/master.mkv) and labelled contact sheets per shot, for review."""
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'out')
REV = os.path.join(OUT, 'review')
FR = os.path.join(REV, 'frames')
SH = os.path.join(REV, 'sheets')
os.makedirs(FR, exist_ok=True)
os.makedirs(SH, exist_ok=True)

SHOTS = [
    ('01-open', 0, 4), ('02-reveal', 4, 8), ('03-title', 8, 10), ('04-hero', 10, 12),
    ('05-cards', 12, 14), ('06-status', 14, 16), ('07-pages', 16, 18), ('08-icons', 18, 20),
    ('09-themes', 20, 24), ('10-halloween', 24, 28), ('11-holidays', 28, 32),
    ('12-palette', 32, 36), ('13-settings', 36, 40), ('14-sync', 40, 44), ('15-pins', 44, 46),
    ('16-omarchy', 46, 48), ('17-rapid', 48, 52), ('18-finale', 52, 56), ('19-end', 56, 62),
]

src = os.path.join(OUT, sys.argv[1] if len(sys.argv) > 1 else 'master.mkv')
tmp = os.path.join(REV, 'raw')
os.makedirs(tmp, exist_ok=True)
fps = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src], capture_output=True, text=True, check=True).stdout.strip()
rate = round(eval(fps))
# Pick frames by index (the first frame at or after each quarter second), so labels match the master.
sel = f"select='lt(mod(n*4\\,{rate})\\,4)'"
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vf', sel, '-fps_mode', 'passthrough', os.path.join(tmp, '%04d.png')], check=True)
names = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))
for i, f in enumerate(names):
    t = i * 0.25
    os.replace(os.path.join(tmp, f), os.path.join(FR, f't{t:05.2f}.png'))

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
TW, TH, COLS = 640, 360, 4
for name, a, b in SHOTS:
    times = [round(a + k * 0.25, 2) for k in range(int((b - a) / 0.25))]
    rows = (len(times) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * TW, rows * TH), (20, 20, 24))
    for k, t in enumerate(times):
        p = os.path.join(FR, f't{t:05.2f}.png')
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        d.rectangle((0, 0, 92, 30), fill=(0, 0, 0))
        d.text((6, 3), f'{t:05.2f}', font=font, fill=(255, 220, 80))
        sheet.paste(im, ((k % COLS) * TW, (k // COLS) * TH))
    sheet.save(os.path.join(SH, f'{name}.png'))
print(len(names), 'frames;', len(SHOTS), 'sheets ->', REV)

# One frame per second from the delivered file (graded, grain, 30 fps) to check the finish.
mp4 = os.path.join(OUT, 'HA-Desktop-Widget-4.0.mp4')
if os.path.exists(mp4):
    FI = os.path.join(REV, 'final')
    os.makedirs(FI, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=1', os.path.join(tmp, 'f%04d.png')], check=True)
    for i, f in enumerate(sorted(f for f in os.listdir(tmp) if f.startswith('f'))):
        os.replace(os.path.join(tmp, f), os.path.join(FI, f't{i:05.2f}.png'))
    print('final frames ->', FI)
