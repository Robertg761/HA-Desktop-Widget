"""Sound design for the 4.0 spot, placed on the picture's event times. Writes out/sfx.wav.

Times below are the original edit's; T() moves each one to the retimed spot (comp/warp.json),
while each sound keeps its own length and inner timing."""
import os
import sys
import numpy as np
import pedalboard as pb
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from engine import *  # noqa
from warp import T, DURATION

OUT = os.path.join(os.path.dirname(__file__), 'out')
DUR = DURATION + 1
tr = Track(DUR)
dry = Track(DUR)  # clicks and keys stay close and dry


def switch(t, vel=0.55):
    """A light switch: a small press and release."""
    dry.add(T(t), keyclack(vel * 0.7), 1.0)
    dry.add(T(t) + 0.035, click(1800, vel * 0.5), 1.0)


def mouse(t, vel=0.6):
    dry.add(T(t), click(2600, vel), 1.0)
    dry.add(T(t) + 0.06, click(2200, vel * 0.45), 1.0)


def key(t, vel=0.6, big=False):
    dry.add(T(t), keyclack(vel, big=big), 1.0)


def at(track, t, x, gain):
    track.add(T(t), x, gain)


# Opening: a switch for every tile that lights.
for t in (1.5, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.25, 7.5):
    switch(t - 0.02, 0.5 if t > 1.6 else 0.7)

# Nothing on camera moves or cuts: the music carries the motion. Only things the viewer sees being
# switched, clicked, typed or popped make a sound.

# Live status: a tick as each tile changes
for t, f in ((14.52, 2400), (15.02, 2700), (15.52, 2100)):
    at(dry, t, click(f, 0.5), 1.0)
    at(tr, t, bell(88, 0.5, index=0.6, vel=0.25), 0.25)
# Pages: two clicks
for t in (16.5, 17.3):
    mouse(t)
# Icons glowing on
for t in (18.5, 19.5):
    switch(t - 0.02, 0.6)
    at(tr, t, sparkle(91, 4, 0.15), 0.25)
# Accent cuts
for t in (22.0, 22.5, 23.0, 23.5):
    at(dry, t, click(3000, 0.35), 1.0)
# Ctrl + K
key(32.0, 1.0, big=True)
key(32.5, 1.0, big=True)
at(tr, 32.0, impact(1.0) * 0.15, 1.0)
at(tr, 32.5, impact(1.0) * 0.15, 1.0)
# Typing "movie", ArrowDown, Enter, lights dim
for k in range(5):
    key(33.25 + k * 0.12, 0.45 + 0.1 * (k % 2))
key(34.15, 0.5)
key(34.5, 0.85, big=True)
dim = sine(np.linspace(220, 110, n(0.6)), 0.6) * np.exp(-tvec(0.6) / 0.25) * 0.25
at(tr, 34.55, dim, 1.0)
# Settings: gear, search field, typing "theme", the result
mouse(36.37)
mouse(37.17)
for k in range(5):
    key(37.45 + k * 0.12, 0.45 + 0.1 * (k % 2))
mouse(38.67)
# Cloud Sync
at(tr, 41.0, sparkle(86, 5, 0.25), 0.4)
at(tr, 41.3, bell(93, 1.2, index=1.0, vel=0.6), 0.35)
at(tr, 41.75, sparkle(88, 5, 0.25), 0.35)
at(tr, 42.5, sparkle(90, 5, 0.25), 0.35)
# Pins
for k, t in enumerate((44.0, 44.25, 44.5, 44.75)):
    at(dry, t + 0.03, pop(0.7), 1.0)
    at(tr, t + 0.03, bell(86 + 3 * k, 0.6, index=0.5, vel=0.3), 0.25)
# Omarchy
mouse(46.5)

wet = pb.Pedalboard([pb.HighpassFilter(120), pb.Reverb(room_size=0.55, damping=0.5, wet_level=0.22, dry_level=0.9, width=1.0)])
dryfx = pb.Pedalboard([pb.HighpassFilter(150), pb.Reverb(room_size=0.18, damping=0.7, wet_level=0.08, dry_level=1.0)])
mix = wet(tr.buf.astype(np.float32), SR) + dryfx(dry.buf.astype(np.float32), SR) * 0.8
sf.write(os.path.join(OUT, 'sfx.wav'), mix.T, SR, subtype='FLOAT')
print('sfx peak', np.abs(mix).max())
