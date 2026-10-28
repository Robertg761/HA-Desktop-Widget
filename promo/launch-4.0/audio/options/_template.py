"""TEMPLATE soundtrack option: copy to audio/options/<name>.py and write the real arrangement.

Render and check:
  python3 audio/options/<name>.py && python3 audio/master.py <name> && python3 audio/check_option.py <name>

Conventions (see audio/cues.py for the cue sheet and what is on screen in each section):
- 120 BPM grid: bar_t(bar) is the start of 1-based bar `bar`; BEAT = 0.5 s. Every cut is on a beat.
- Put the three big hits (cues.HITS = 8.0, 76.0, 80.0) in the `impact` stem, not in `music`.
- Never mute the whole track before a hit; build into it (risers, swells, fills). The only rest is
  the drums dropping the last beat before the finale (75.5-76.0) while harmony carries on.
- The intro has a musical ping for each tile lighting (cues.GLOW_TIMES), in your key.
- End on one resolving chord at 80.0 that rings out; mastering fades 84.4-86.6.
- Instruments: engine.py (kick, clap, snare, hat, crash, tom, jingle, pad_chord, pluck, bass_note,
  lead_note, bell, glow, riser, impact, whoosh, reverse_crash, sparkle, supersaw, saw, sine, ...)
  and instruments.py (epiano, piano, guitar, strum, pick_bass, sub_bass, strings, spiccato,
  brass, choir, marimba, glock, taiko, boom_kick, crack_snare, rim, shaker, snap, gated_snare,
  vinyl, sub_drop, lofi).
"""
import os
import sys

import numpy as np
import pedalboard as pb

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from engine import *  # noqa
from instruments import *  # noqa
from opt_common import bus, sidechain, track, write  # noqa
import cues  # noqa
from cues import BEAT, BAR, bar_t  # noqa

NAME = os.path.splitext(os.path.basename(__file__))[0].lstrip('_')

keys, bass, drums, fxs, imp = track(), track(), track(), track(), track()
CHORDS = {'D': [62, 66, 69], 'A': [61, 64, 69], 'Bm': [62, 66, 71], 'G': [62, 67, 71]}
PROG = ['D', 'A', 'Bm', 'G']
ROOT = {'D': 38, 'A': 33, 'Bm': 35, 'G': 31}
for bar in range(1, 41):
    ch = PROG[(bar - 1) % 4]
    keys.add(bar_t(bar), epiano_chord := np.sum([epiano(m, BAR * 0.95, 0.6) for m in CHORDS[ch]], axis=0), 0.5)
    if bar >= 5:
        bass.add(bar_t(bar), sub_bass(ROOT[ch], BAR * 0.9), 0.8)
        for b in range(4):
            drums.add(bar_t(bar) + b * BEAT, boom_kick() if b % 2 == 0 else crack_snare(0.6), 0.6)
for t, m in zip(cues.GLOW_TIMES, [74, 76, 78, 81, 83, 86, 88, 90, 93]):
    keys.add(t, glock(m, 0.7), 0.4)
keys.add(cues.ENDCARD, np.sum([epiano(m, 4.0, 0.7) for m in [50, 57, 62, 66, 69]], axis=0), 0.5)
fxs.add(cues.DROP - 1.0, reverse_crash(1.0), 0.4)
for h in cues.HITS:
    imp.add(h, impact(3.0), 0.8)

music = (bus(keys.buf, pb.Reverb(room_size=0.6, wet_level=0.25, dry_level=0.85))
         + bus(drums.buf, pb.Compressor(threshold_db=-14, ratio=3))
         + bass.buf + bus(fxs.buf, pb.Reverb(room_size=0.8, wet_level=0.3)))
write(NAME, music, imp.buf, {'lift_db': 4.0})
