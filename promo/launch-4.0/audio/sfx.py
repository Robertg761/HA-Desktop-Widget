"""Sound design for the 4.0 spot, placed on the picture's event times. Writes out/sfx.wav."""
import os
import sys
import numpy as np
import pedalboard as pb
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from engine import *  # noqa

OUT = os.path.join(os.path.dirname(__file__), 'out')
DUR = 63.0
tr = Track(DUR)
dry = Track(DUR)  # clicks and keys stay close and dry


def switch(t, vel=0.55):
    """A light switch: a small press and release."""
    dry.add(t, keyclack(vel * 0.7), 1.0)
    dry.add(t + 0.035, click(1800, vel * 0.5), 1.0)


def mouse(t, vel=0.6):
    dry.add(t, click(2600, vel), 1.0)
    dry.add(t + 0.06, click(2200, vel * 0.45), 1.0)


def key(t, vel=0.6, big=False):
    dry.add(t, keyclack(vel, big=big), 1.0)


def swish(t, dur=0.5, f0=500, f1=6000, gain=0.35, direction=1):
    tr.add(t, whoosh(dur, f0, f1, direction), gain)


# Opening: a switch for every tile that lights.
for t in (1.5, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.25, 7.5):
    switch(t - 0.02, 0.5 if t > 1.6 else 0.7)

# Title zoom-through and the window's swoop
swish(9.55, 0.8, 300, 7000, 0.55, 1)
swish(9.9, 1.0, 200, 3000, 0.35, -1)
# Macro cards: whip from clock to media
swish(12.0, 0.45, 600, 5000, 0.18, 1)
swish(12.82, 0.5, 900, 8000, 0.3, -1)
# Live status: a tick as each tile changes
swish(14.0, 0.4, 500, 4000, 0.18, 1)
for t, f in ((14.52, 2400), (15.02, 2700), (15.52, 2100)):
    dry.add(t, click(f, 0.5), 1.0)
    tr.add(t, bell(88, 0.5, index=0.6, vel=0.25), 0.25)
# Pages: two clicks and the tiles sliding in
swish(16.0, 0.4, 500, 4000, 0.18, -1)
for t in (16.5, 17.3):
    mouse(t)
    swish(t + 0.02, 0.35, 1200, 7000, 0.14, 1)
# Icons glowing on
swish(18.0, 0.35, 400, 3000, 0.15, 1)
for t in (18.5, 19.5):
    switch(t - 0.02, 0.6)
    tr.add(t, sparkle(91, 4, 0.15), 0.25)
swish(18.98, 0.3, 800, 6000, 0.2, -1)
# Theme wipes
swish(19.98, 0.4, 400, 3000, 0.18, 1)
for t in (20.42, 20.92, 21.42):
    swish(t - 0.05, 0.42, 900, 9000, 0.3, 1 if t != 20.92 else -1)
# Accent cuts
for t in (22.0, 22.5, 23.0, 23.5):
    dry.add(t, click(3000, 0.35), 1.0)
# Holiday cuts
for t in (28.5, 29.0, 29.5, 30.0, 30.5, 31.0):
    swish(t - 0.08, 0.22, 1500, 9000, 0.16, 1 if int(t * 2) % 2 else -1)
# Ctrl + K
key(32.0, 1.0, big=True)
key(32.5, 1.0, big=True)
tr.add(32.0, impact(1.0) * 0.15, 1.0)
tr.add(32.5, impact(1.0) * 0.15, 1.0)
swish(32.82, 0.55, 300, 5000, 0.35, 1)
# Typing "movie", ArrowDown, Enter, lights dim
for k in range(5):
    key(33.25 + k * 0.12, 0.45 + 0.1 * (k % 2))
key(34.15, 0.5)
key(34.5, 0.85, big=True)
dim = sine(np.linspace(220, 110, n(0.6)), 0.6) * np.exp(-tvec(0.6) / 0.25) * 0.25
tr.add(34.55, dim, 1.0)
swish(34.85, 0.5, 300, 2500, 0.18, -1)
# Settings: gear, search field, typing "theme", the result
swish(35.98, 0.4, 500, 4000, 0.18, 1)
mouse(36.45)
mouse(37.25)
for k in range(5):
    key(37.45 + k * 0.12, 0.45 + 0.1 * (k % 2))
mouse(38.75)
swish(38.78, 0.4, 600, 5000, 0.16, -1)
# Cloud Sync
swish(39.98, 0.5, 300, 4000, 0.25, 1)
tr.add(41.0, sparkle(86, 5, 0.25), 0.4)
tr.add(41.3, bell(93, 1.2, index=1.0, vel=0.6), 0.35)
tr.add(41.75, sparkle(88, 5, 0.25), 0.35)
tr.add(42.5, sparkle(90, 5, 0.25), 0.35)
swish(43.2, 0.8, 300, 3000, 0.2, 1)
# Pins
swish(43.98, 0.4, 500, 4000, 0.18, 1)
for k, t in enumerate((44.0, 44.25, 44.5, 44.75)):
    dry.add(t + 0.03, pop(0.7), 1.0)
    tr.add(t + 0.03, bell(86 + 3 * k, 0.6, index=0.5, vel=0.3), 0.25)
# Omarchy
swish(45.98, 0.4, 500, 4000, 0.2, -1)
mouse(46.5)
swish(46.52, 0.45, 2000, 600, 0.2, 1)
# Rapid cuts
for t in (48.5, 49.0, 49.5, 50.0, 50.5, 51.0):
    swish(t - 0.08, 0.2, 1500, 9000, 0.18, 1 if int(t * 2) % 2 else -1)
swish(50.0, 0.35, 400, 5000, 0.25, 1)

wet = pb.Pedalboard([pb.HighpassFilter(120), pb.Reverb(room_size=0.55, damping=0.5, wet_level=0.22, dry_level=0.9, width=1.0)])
dryfx = pb.Pedalboard([pb.HighpassFilter(150), pb.Reverb(room_size=0.18, damping=0.7, wet_level=0.08, dry_level=1.0)])
mix = wet(tr.buf.astype(np.float32), SR) + dryfx(dry.buf.astype(np.float32), SR) * 0.8
sf.write(os.path.join(OUT, 'sfx.wav'), mix.T, SR, subtype='FLOAT')
print('sfx peak', np.abs(mix).max())
