"""Motion schedule for the motion-blur render: how many sub-frame samples each 30 fps frame needs.

Measures image motion between consecutive frames of a 60 fps master (per tile, by phase
correlation, so zooms and partial moves count) and writes comp/samples.json: one sample count per
output frame, chosen so neighbouring samples sit no more than ~3 px apart on the 1920 px frame.
The master must cover the whole edit (comp/warp.json); otherwise samples.json is left as it is.
  python3 comp/motion_schedule.py out/master60.mkv
"""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 480, 270
SCALE = 1920 / W
CHOICES = [2, 3, 4, 6, 12]
STEP_PX = 3.0


def frames(src):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', src, '-vf', f'scale={W}:{H}:flags=area,format=gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    n = W * H
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(H, W).astype(np.float32)
    if p.wait() != 0:
        sys.exit(f'ffmpeg could not read {src}; samples.json is unchanged')


def shift(a, b):
    """Translation magnitude (px) between two tiles by phase correlation, or 0 if flat."""
    if a.std() < 4 or b.std() < 4:
        return 0.0
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fa = np.fft.fft2((a - a.mean()) * win)
    fb = np.fft.fft2((b - b.mean()) * win)
    r = fa * np.conj(fb)
    r /= np.abs(r) + 1e-6
    c = np.abs(np.fft.ifft2(r))
    if c.max() < 0.12:  # no clear peak: content changed rather than moved
        return 0.0
    y, x = np.unravel_index(np.argmax(c), c.shape)
    if y > a.shape[0] // 2:
        y -= a.shape[0]
    if x > a.shape[1] // 2:
        x -= a.shape[1]
    return float(np.hypot(x, y))


def motion(a, b):
    th, tw = H // 3, W // 4
    best = 0.0
    for i in range(3):
        for j in range(4):
            sa = a[i * th:(i + 1) * th, j * tw:(j + 1) * tw]
            sb = b[i * th:(i + 1) * th, j * tw:(j + 1) * tw]
            best = max(best, shift(sa, sb))
    return best * SCALE


src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'out', 'master60.mkv')
prev = None
m60 = []
for f in frames(src):
    if prev is not None:
        m60.append(motion(prev, f))
    prev = f
m60.append(m60[-1] if m60 else 0.0)
# One value per frame now. A short master (some chunks missing) would leave the rest of the spot at
# minimum sampling.
edit = json.load(open(os.path.join(HERE, 'warp.json')))['points'][-1][0]
if prev is None or len(m60) != round(edit * 60):
    sys.exit(f'{src} has {len(m60) if prev is not None else 0} frames; the {edit} s edit has {round(edit * 60)} at 60 fps. samples.json is unchanged')
# Output frame k exposes 60 fps frames 2k..2k+1 (a 180-degree shutter at 30 fps).
out = []
for k in range(len(m60) // 2):
    px = max(m60[2 * k], m60[2 * k + 1] if 2 * k + 1 < len(m60) else 0)
    need = px / STEP_PX
    out.append(next((n for n in CHOICES if n >= need), CHOICES[-1]))
json.dump({'fps': 30, 'samples': out, 'motion60': [round(v, 1) for v in m60]}, open(os.path.join(HERE, 'samples.json'), 'w'))
hist = {n: out.count(n) for n in CHOICES}
print('frames', len(out), 'histogram', hist, 'renders', sum(out), 'max px/60fps-frame', round(max(m60), 1))
