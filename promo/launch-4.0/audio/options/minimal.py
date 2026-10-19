"""MINIMAL soundtrack option: elegant modern minimal, a keynote product-reveal cue in E major.

A clean piano 8th-note figure in 3+3+2 groupings falling from a tonic pedal E5 (the motif), a soft synth pulse
with a marimba answering in 16ths, an airy pad, a soft sine sub that walks the bass line, tight
minimal percussion (soft kick, rim, snaps, shaker) that grows section by section, and a big
emotional lift in the hook and finale (string ensemble, violin counter-line, piano melody in
octaves, wider stereo).
  intro    the piano figure alone in space (one note, then the figure), celesta pings for the
           tiles rising up the E major scale, an air swell and a reversed piano into the drop
  drop     piano/sub hit on the title; the figure and left hand carry on over sub, pulse and a tight
           kick; a high marimba glint from bar 7; rims, snaps, hats, shaker 16ths, celesta glints on
           the picture cuts and a celesta teaser of the hook join every four bars
  seasonal Halloween: C#m9 -> Am6 (the borrowed 'magic' iv), ticking rims, marimba in minor;
           then the montage: glockenspiel hook, sleigh bells (16ths on the Christmas sleigh)
  features pulled back to piano and pulse; the music dims with the lights at 47.75, then the
           strings creep in
  hook     the main melody (piano in octaves) over the figure an octave lower, strings, violin
           counter-line; bar 34 dips then climbs (snap crescendo, reversed piano) into the rapid cuts
  rapid    melody again, string/piano stabs on every cut; the drums breathe 75.5-76
  finale   the widest moment: strings in octaves, melody up high, four-on-the-floor
  end      piano/sub hit and a sustained E major chord; strings, pad and sub fade under the piano
Render: python3 audio/options/minimal.py && python3 audio/master.py minimal && python3 audio/check_option.py minimal
"""
import os
import sys

import numpy as np
import pedalboard as pb

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from engine import SR, crash, glow, hat, n, pan, sosfilt, Track  # noqa
from instruments import marimba, glock, rim, shaker, snap, spiccato, strings, taiko  # noqa
from inst_minimal import (air_pad, celesta, hall, hall_ir, min_hit, piano, piano_chord,  # noqa
                          pingpong, pulse, reverse_swell, section, sleigh, soft_kick, sub, tick)
from opt_common import bus, sidechain, track, write  # noqa
import cues  # noqa
from cues import BEAT, BAR, bar_t  # noqa

NAME = 'minimal'
rng = np.random.default_rng(2026)
NS = int(cues.DUR * SR)


def hum(t, sd=0.0028):
    """A few ms of human timing; callers skip it for downbeats and hits."""
    return max(0.0, t + float(np.clip(rng.normal(0, sd), -0.007, 0.007)))


def hv(v, sd=0.07):
    return float(np.clip(v * (1 + rng.normal(0, sd)), 0.05, 1.1))


def at(bar, beat):
    return bar_t(bar) + beat * BEAT


def tm(bar, beat):
    """Humanised time unless it is a downbeat."""
    return at(bar, beat) if beat == 0 else hum(at(bar, beat))


# ------------------------------------------------------------------ harmony (E major)
# pad: rootless 4-note voicing (moves by step); fig: the piano's 8 eighths (3+3+2 cells falling
# from a tonic pedal E5, the 2-group lifts);
# pulse: [low, high, mid]; slo/shi: low and high string voicings; bass: sub root (E2 = 40)
C = {
    'E':     dict(bass=40, pad=[56, 59, 64, 66], fig=[76, 71, 68, 76, 71, 68, 76, 78], pulse=[52, 64, 59], slo=[52, 59], shi=[68, 71, 76]),
    'B/D#':  dict(bass=39, pad=[54, 59, 63, 66], fig=[75, 71, 66, 75, 71, 66, 75, 76], pulse=[47, 59, 54], slo=[51, 59], shi=[66, 71, 75]),
    'C#m7':  dict(bass=37, pad=[56, 59, 64, 68], fig=[76, 71, 68, 76, 71, 68, 76, 80], pulse=[49, 61, 56], slo=[49, 56], shi=[68, 71, 76]),
    'A':     dict(bass=33, pad=[57, 61, 64, 68], fig=[76, 73, 69, 76, 73, 69, 76, 80], pulse=[45, 57, 52], slo=[52, 57], shi=[69, 73, 76]),
    'Bsus4': dict(bass=35, pad=[54, 59, 64, 66], fig=[76, 71, 66, 76, 71, 66, 76, 75], pulse=[47, 59, 52], slo=[47, 54], shi=[66, 71, 76]),
    'B':     dict(bass=35, pad=[54, 59, 63, 66], fig=[75, 71, 66, 75, 71, 66, 75, 78], pulse=[47, 59, 54], slo=[47, 54], shi=[66, 71, 75]),
    'F#m9':  dict(bass=42, pad=[57, 61, 64, 68], fig=[76, 73, 69, 76, 73, 69, 76, 80], pulse=[54, 66, 61], slo=[54, 61], shi=[68, 73, 76]),
    'Amaj9': dict(bass=45, pad=[56, 59, 61, 64], fig=[76, 71, 68, 76, 71, 68, 76, 73], pulse=[45, 57, 52], slo=[52, 57], shi=[68, 71, 76]),
    'E/G#':  dict(bass=44, pad=[56, 59, 64, 66], fig=[76, 71, 68, 76, 71, 68, 76, 78], pulse=[56, 68, 59], slo=[56, 59], shi=[68, 71, 76]),
    'C#m9':  dict(bass=37, pad=[52, 56, 59, 63], fig=[64, 59, 56, 64, 59, 56, 63, 64], pulse=[49, 61, 56], slo=[49, 56], shi=[63, 64, 68]),
    'Am6':   dict(bass=33, pad=[52, 57, 60, 66], fig=[64, 60, 57, 64, 60, 57, 66, 64], pulse=[45, 57, 52], slo=[52, 57], shi=[60, 64, 66]),
}
LOOP = ['E', 'B/D#', 'C#m7', 'A']
CHART = {1: 'E', 2: 'E', 3: 'C#m7', 4: [(0, 'A'), (2, 'Bsus4')]}
for b in range(5, 17):
    CHART[b] = LOOP[(b - 5) % 4]
CHART.update({17: 'C#m9', 18: 'Am6', 19: 'E', 20: 'B/D#', 21: 'A', 22: [(0, 'Bsus4'), (2, 'B')],
              23: 'Amaj9', 24: 'E/G#', 25: 'F#m9', 26: 'E', 27: 'Amaj9', 28: [(0, 'Bsus4'), (2, 'B')],
              29: 'E', 30: 'B/D#', 31: 'C#m7', 32: 'A', 33: 'F#m9', 34: [(0, 'Bsus4'), (2, 'B')],
              35: 'E', 36: 'B/D#', 37: 'C#m7', 38: 'Amaj9',  # IV -> I into the finale; harmony carries the breath
              39: 'E', 40: [(0, 'A'), (2, 'B')], 41: 'E', 42: 'E', 43: 'E'})
# bass register overrides so the line moves by step (features walk A-G#-F#-E, hook rises F#-B-E)
BASS_OVR = {(22, 'B'): 47, (22, 'Bsus4'): 47, (27, 'Amaj9'): 33, (28, 'Bsus4'): 35, (28, 'B'): 35,
            (33, 'F#m9'): 30, (38, 'Amaj9'): 33}


def segs(bar):
    c = CHART[bar]
    if isinstance(c, str):
        return [(0, 4, c)]
    return [(b, c[i + 1][0] if i + 1 < len(c) else 4, ch) for i, (b, ch) in enumerate(c)]


def bass_of(bar, ch):
    return BASS_OVR.get((bar, ch), C[ch]['bass'])


SEC = {}
for nm, b0, b1, _ in cues.SECTIONS:
    for b in range(b0, b1):
        SEC[b] = nm

SCALE = {4, 6, 8, 9, 11, 1, 3}

# ------------------------------------------------------------------ tracks
pno, pno_sp, pno_lh, mel, cel, glk, pul, mar, pad, strg, vln, subT, kik, rimT, snp, shk, hhT, slg, fxs, imp = (track() for _ in range(20))
kick_times = []

# ------------------------------------------------------------------ piano figure (the motif)
for bar in range(1, 41):
    sec = SEC[bar]
    for b0, b1, ch in segs(bar):
        fig = C[ch]['fig']
        for p in range(int(b0 * 2), int(b1 * 2)):
            # intro: one note in space (bar 1), then the figure fills in
            if bar == 1 and p not in (0, 3, 6):
                continue
            if bar == 2 and p in (2, 5):
                continue
            m = fig[p]
            acc = p in (0, 3, 6)
            base = {'intro': 0.4 + 0.04 * bar, 'drop': 0.68, 'seasonal': 0.56, 'features': 0.52,
                    'hook': 0.38, 'rapid': 0.42, 'finale': 0.36}[sec]
            v = hv(base * (1.0 if acc else 0.78))
            if sec in ('hook', 'rapid', 'finale'):
                m -= 12  # under the tune: the figure drops an octave so the melody owns E5-C#6
            t0 = at(bar, p * 0.5)
            end = at(bar, b1)
            dur = max(0.3, min(0.95 if acc else 0.6, end - t0 + 0.04))
            dst = pno_sp if sec == 'intro' else pno
            dst.add(t0 if p == 0 else hum(t0), piano(m, dur, v), 1.0)

# left hand: soft root + fifth/third on the downbeats, from bar 3 (not in the Halloween bars)
for bar in range(3, 41):
    if bar in (17, 18):
        continue
    sec = SEC[bar]
    for b0, b1, ch in segs(bar):
        r = bass_of(bar, ch)
        while r < 45:
            r += 12
        mid = C[ch]['pulse'][2]
        while mid <= r:
            mid += 12
        v = {'intro': 0.3, 'drop': 0.32, 'seasonal': 0.36, 'features': 0.3, 'hook': 0.46, 'rapid': 0.5, 'finale': 0.6}[sec]
        notes = [r, mid]
        pno_lh.add(at(bar, b0), piano_chord(notes, (b1 - b0) * BEAT + 0.1, v, roll=0.012), 1.0)

# ------------------------------------------------------------------ melody
HOOK = {
    29: [(0, 80, 1.5), (1.5, 78, 0.5), (2, 76, 1.0), (3, 71, 0.5), (3.5, 76, 0.5)],
    30: [(0, 78, 1.5), (1.5, 76, 0.5), (2, 75, 1.5), (3.5, 71, 0.5)],
    31: [(0, 76, 1.0), (1, 78, 0.5), (1.5, 80, 1.0), (2.5, 83, 1.5)],
    32: [(0, 85, 1.5), (1.5, 83, 0.5), (2, 80, 1.0), (3, 78, 1.0)],
    33: [(0, 81, 1.5), (1.5, 80, 0.5), (2, 78, 1.0), (3, 76, 0.5), (3.5, 78, 0.5)],
    34: [(0, 76, 2.0), (2, 75, 1.0), (3, 78, 0.5), (3.5, 83, 0.5)],
}
MELODY = dict(HOOK)
MELODY.update({35: HOOK[29], 36: HOOK[30], 37: HOOK[31],
               38: [(0, 85, 1.5), (1.5, 83, 0.5), (2, 80, 1.0), (3, 76, 0.5), (3.5, 78, 0.5)],
               39: [(0, 80, 1.5), (1.5, 78, 0.5), (2, 76, 1.0), (3, 83, 1.0)],
               40: [(0, 85, 1.0), (1, 83, 0.5), (1.5, 81, 0.5), (2, 78, 1.0), (3, 75, 1.0)]})
for bar, notes in MELODY.items():
    sec = SEC[bar]
    base = {'hook': 0.74, 'rapid': 0.8, 'finale': 0.86}[sec]
    for beat, m, d in notes:
        v = hv(base * (0.9 + 0.012 * (m - 76)), 0.05)
        t0 = tm(bar, beat)
        dur = d * BEAT + 0.12
        mel.add(t0, piano(m, dur, v), 1.0)
        mel.add(t0 + 0.004, piano(m + 12, dur, v * 0.72), 0.75)  # octave doubling

# teaser: the hook on celesta, an octave up, in the second half of the drop
for k, bar in enumerate(range(13, 17)):
    for beat, m, d in HOOK[29 + k]:
        cel.add(tm(bar, beat), celesta(m + 12, hv(0.42 + 0.03 * k)), 0.8)

# intro tile pings: celesta, rising through the scale, with a warm sine an octave below
PINGS = [83, 85, 88, 90, 92, 95, 97, 100, 102]
for i, (t, m) in enumerate(zip(cues.GLOW_TIMES, PINGS)):
    v = 0.62 + 0.035 * i
    x = celesta(m, v, 2.6)
    g = glow(m - 12, 1.6) * 0.5
    x[: len(g)] += g
    cel.add(t, pan(x, (-0.35 if i % 2 else 0.35) * (0.4 + 0.6 * i / 8)), 0.68 - 0.025 * i)

# theme accent cuts (29.0, 29.75, 30.5, 31.25): rising celesta colour pings
for t, m in zip(cues.ACCENT_CUTS, [80, 83, 85, 88]):
    cel.add(t, celesta(m + 12, 0.55), 0.8)

# ------------------------------------------------------------------ festive colour
# Halloween (bars 17-18): marimba in minor, a playful figure; the holiday montage gets the hook on
# glockenspiel, sleigh bells and a celesta sparkle on every cut
HALLOW = {17: [(0, 61), (0.75, 64), (1.5, 68), (2.5, 64), (3, 63), (3.5, 61)],
          18: [(0, 60), (0.75, 64), (1.5, 69), (2.5, 66), (3, 64), (3.5, 59)]}
for bar, notes in HALLOW.items():
    for beat, m in notes:
        mar.add(tm(bar, beat), marimba(m + 12, hv(0.7)), 0.9)
        mar.add(tm(bar, beat + 0.25), marimba(m + 12, hv(0.3)), 0.5)  # a ghost echo, playful
GLK = {19: [(0, 92, 1.5), (1.5, 90, 0.5), (2, 88, 1), (3, 83, 0.5), (3.5, 88, 0.5)],
       20: [(0, 90, 1.5), (1.5, 88, 0.5), (2, 87, 1.5), (3.5, 83, 0.5)],
       21: [(0, 88, 1), (1, 85, 0.5), (1.5, 88, 0.5), (2, 92, 1), (3, 90, 1)],
       22: [(0, 88, 1.5), (1.5, 90, 0.5), (2, 87, 1), (3, 90, 0.5), (3.5, 95, 0.5)]}
for bar, notes in GLK.items():
    for beat, m, d in notes:
        glk.add(tm(bar, beat), glock(m, hv(0.75)), 0.9)
for i, t in enumerate(cues.HOLIDAY_CUTS):
    bar = int(t // BAR) + 1
    ch = segs(bar)[0][2] if t % BAR == 0 else segs(bar)[-1][2]
    top = sorted(C[ch]['shi'])[-1] + 24
    cel.add(t, celesta(top, 0.45), 0.6)
    cel.add(t + 0.06, celesta(sorted(C[ch]['shi'])[-2] + 24, 0.35), 0.4)  # always a chord tone
for bar in range(19, 23):
    step = 0.25 if bar == 22 else 0.5
    for k in range(int(4 / step)):
        beat = k * step
        v = (0.95 if (beat % 1) == 0.5 else 0.6) if step == 0.5 else (0.55 + 0.45 * (k / 16) * (1 if k % 2 else 0.6))
        slg.add(tm(bar, beat), sleigh(hv(v * (1.25 if bar == 22 else 1.0)), rng), 1.0)
slg.add(at(22, 0), sleigh(1.2, rng), 0.8)

# ------------------------------------------------------------------ pulse + marimba ostinato
BRIGHT = {}
for b in range(5, 17):
    BRIGHT[b] = 0.42 + 0.3 * (b - 5) / 11  # the drop opens bright: the pulse carries presence
BRIGHT.update({17: 0.22, 18: 0.22, 19: 0.45, 20: 0.5, 21: 0.5, 22: 0.55,
               23: 0.38, 24: 0.36, 25: 0.14, 26: 0.2, 27: 0.3, 28: 0.42,
               29: 0.55, 30: 0.58, 31: 0.6, 32: 0.62, 33: 0.65, 34: 0.7,
               35: 0.72, 36: 0.74, 37: 0.76, 38: 0.78, 39: 0.8, 40: 0.8})
for bar in range(5, 41):
    sec = SEC[bar]
    sixteenths = sec in ('rapid', 'finale') or bar >= 31 and sec == 'hook'
    lvl = {'drop': 0.8, 'seasonal': 0.75, 'features': 0.85, 'hook': 0.8, 'rapid': 0.85, 'finale': 0.85}[sec]
    if bar in (17, 18):
        lvl = 0.6
    for b0, b1, ch in segs(bar):
        lo, hi, mid = C[ch]['pulse']
        step = 0.25 if sixteenths else 0.5
        for k in range(int(b0 / step), int(b1 / step)):
            beat = k * step
            pos = int(round(beat * 2)) % 4  # 8th index within a half bar
            m = [lo, hi, mid, hi][pos] if (beat * 2) % 1 == 0 else [hi, mid][k % 2]
            accent = 1.0 if beat % 1 == 0 else (0.72 if (beat * 2) % 1 == 0 else 0.5)
            dur = 0.17 if step == 0.5 else 0.09
            if bar in (17, 18):
                dur = 0.1
            pul.add(tm(bar, beat), pulse(m, dur, hv(lvl * accent), BRIGHT[bar]), 1.0)

MAR16 = [(0, 0), (3, 2), (6, 1), (8, 3), (11, 2), (14, 1)]
for bar in list(range(7, 17)) + list(range(19, 23)) + list(range(29, 41)):
    sec = SEC[bar]
    lvl = {'drop': 0.6, 'seasonal': 0.6, 'hook': 0.55, 'rapid': 0.6, 'finale': 0.55}[sec]
    for b0, b1, ch in segs(bar):
        pv = C[ch]['pad']
        for s16, idx in MAR16:
            beat = s16 * 0.25
            if not (b0 <= beat < b1):
                continue
            octv = 24 if sec == 'drop' else 12  # in the drop the marimba glints an octave above the piano figure
            mar.add(tm(bar, beat), marimba(pv[idx] + octv, hv(lvl * (1.0 if s16 % 4 == 0 else 0.8))), 1.0)

# ------------------------------------------------------------------ pad
PADLVL = {1: 0.0, 2: 0.32, 3: 0.48, 4: 0.62}
for b in range(5, 17):
    PADLVL[b] = 0.68
PADLVL.update({17: 0.5, 18: 0.55, 19: 0.6, 20: 0.6, 21: 0.6, 22: 0.62, 23: 0.5, 24: 0.5, 25: 0.42, 26: 0.45,
               27: 0.5, 28: 0.58, 29: 0.68, 30: 0.68, 31: 0.68, 32: 0.68, 33: 0.7, 34: 0.74,
               35: 0.72, 36: 0.72, 37: 0.72, 38: 0.76, 39: 0.85, 40: 0.85})
PADBR = {b: 0.4 for b in range(1, 44)}
PADBR.update({23: 0.3, 24: 0.3, 25: 0.18, 26: 0.22, 27: 0.28, 28: 0.34, 17: 0.25, 18: 0.28})
for b in range(29, 41):
    PADBR[b] = 0.5
for bar in range(2, 41):
    for b0, b1, ch in segs(bar):
        notes = C[ch]['pad']
        if SEC[bar] in ('hook', 'rapid', 'finale'):
            notes = notes + [notes[-1] + 12 if (notes[-1] + 12) % 12 != 1 else notes[-2] + 12]
        att = 1.4 if bar <= 3 else (0.6 if bar == 4 else 0.2)
        pad.add(at(bar, b0), air_pad(notes, (b1 - b0) * BEAT + 0.08, PADLVL[bar], attack=att, release=1.0, bright=PADBR[bar]), 1.0)

# ------------------------------------------------------------------ strings
SLVL = {27: 0.22, 28: 0.36, 29: 0.48, 30: 0.48, 31: 0.5, 32: 0.52, 33: 0.54, 34: 0.58,
        35: 0.62, 36: 0.63, 37: 0.64, 38: 0.66, 39: 0.7, 40: 0.72}
for bar in range(27, 41):
    sec = SEC[bar]
    for b0, b1, ch in segs(bar):
        notes = C[ch]['slo'] + C[ch]['shi']
        if sec == 'finale':
            notes = notes + [m + 12 for m in C[ch]['shi']]
        att = 1.8 if bar == 27 else (0.9 if bar == 28 else 0.22)
        dur = (b1 - b0) * BEAT + 0.06
        strg.add(at(bar, b0), section(notes, dur, SLVL[bar], attack=att, release=0.7, bright=0.42 if sec != 'finale' else 0.52), 1.0)
# bar 34 crescendo into the rapid cuts: an extra, slowly swelling upper octave
strg.add(at(34, 0), section([71, 76, 78, 83], 2.0, 0.42, attack=1.7, release=0.3, bright=0.55), 1.0)
# violin counter-line in the hook: half notes in thirds/sixths under the melody's dotted rhythm
COUNTER = {29: [(0, 71, 2), (2, 73, 2)], 30: [(0, 71, 2), (2, 66, 2)], 31: [(0, 73, 2), (2, 76, 2)],
           32: [(0, 76, 2), (2, 73, 2)], 33: [(0, 73, 2), (2, 69, 2)], 34: [(0, 69, 2), (2, 69, 2)],
           35: [(0, 68, 2), (2, 73, 2)], 36: [(0, 71, 2), (2, 66, 2)], 37: [(0, 73, 2), (2, 76, 2)],
           38: [(0, 76, 2), (2, 73, 2)]}
for bar, notes in COUNTER.items():
    for beat, m, d in notes:
        vln.add(at(bar, beat) + 0.01, section([m], d * BEAT + 0.12, 0.5, attack=0.16, release=0.45, bright=0.6), 1.0)
# finale: violins double the melody
for bar in (39, 40):
    for beat, m, d in MELODY[bar]:
        vln.add(at(bar, beat), section([m], d * BEAT + 0.1, 0.5, attack=0.08, release=0.5, bright=0.62), 1.0)
# stabs on the rapid cuts: spiccato chord + a bright piano chord
for t in cues.RAPID_CUTS:
    bar = int(t // BAR) + 1
    beat = (t - bar_t(bar)) / BEAT
    ch = [c for b0, b1, c in segs(bar) if b0 <= beat < b1][0]
    for m in C[ch]['shi'] + [C[ch]['shi'][-1] + 12]:
        strg.add(t, spiccato(m, 0.7, 0.65), 0.5)
    pno.add(t, piano_chord([m + 12 for m in C[ch]['shi']], 0.4, 0.62), 0.55)

# ------------------------------------------------------------------ sub bass
def approach(r1, r2):
    """A scale tone next to r2, on r1's side (or r1 itself)."""
    if r2 == r1:
        return r1 + 7 if r1 + 7 <= 47 else r1 - 5
    d = 1 if r1 > r2 else -1
    for k in (1, 2):
        c = r2 + d * k
        if c % 12 in SCALE:
            return c
    return r1


def next_root(bar, beat):
    for b, e, ch in segs(bar):
        if b > beat:
            return bass_of(bar, ch)
    nb = bar + 1
    return bass_of(nb, segs(nb)[0][2]) if nb in CHART else None


BASSPAT = {
    'drop': [(0, 0, 1.45), (1.5, 0, 1.4), (3, 0, 0.45), (3.5, 'app', 0.45)],
    'hallow': [(0, 0, 3.0), (3, 0, 0.45), (3.5, 'app', 0.45)],
    'festive': [(0, 0, 0.9), (1.5, 12, 0.4), (2, 0, 0.9), (3, 0, 0.45), (3.5, 'app', 0.45)],
    'features': [(0, 0, 3.9)],
    'hook': [(0, 0, 1.45), (1.5, 0, 0.45), (2, 0, 0.95), (3, 0, 0.45), (3.5, 'app', 0.45)],
}
for bar in range(5, 41):
    sec = SEC[bar]
    pat = BASSPAT['hallow' if bar in (17, 18) else 'festive' if sec == 'seasonal' else
                  'drop' if sec == 'drop' else 'features' if sec == 'features' else 'hook']
    if sec == 'features' and bar == 28:
        pat = BASSPAT['drop']
    if bar == 18:  # Am6 -> E: anticipate E2 from A1 (iv-I), no tritone leap to D#
        pat = [(0, 0, 3.0), (3, 0, 0.45), (3.5, 7, 0.45)]
    v0 = {'drop': 0.85, 'seasonal': 0.82, 'features': 0.58, 'hook': 0.9, 'rapid': 0.95, 'finale': 1.0}[sec]
    for b0, b1, ch in segs(bar):
        r = bass_of(bar, ch)
        for beat, what, d in pat:
            if not (b0 <= beat < b1):
                continue
            d = min(d, b1 - beat - 0.05)
            if what == 'app':
                nr = next_root(bar, beat)
                if nr is None or (b1 < 4):
                    m = r
                else:
                    m = approach(r, nr)
            else:
                m = r + what
            subT.add(at(bar, beat), sub(m, d * BEAT, hv(v0 * (1.0 if beat == 0 else 0.85), 0.04)), 1.0)
# the end: a long E with a sub octave under it
es = sub(40, 5.6, 0.62, attack=0.01) + sub(28, 5.6, 0.4)
es *= np.exp(-np.arange(es.shape[-1]) / SR / 1.6)  # dies away with the piano, no cut-off inside the fade
subT.add(cues.ENDCARD, es, 1.0)

# ------------------------------------------------------------------ drums
def kick_at(t, v):
    if cues.BREATH - 0.012 <= t < cues.FINALE or t >= cues.ENDCARD - 0.012:
        return
    kik.add(t, soft_kick(v), 1.0)
    kick_times.append(t)


def drum(trk, t, x, g=1.0):
    if cues.BREATH - 0.012 <= t < cues.FINALE or t >= cues.ENDCARD - 0.012:
        return
    trk.add(t, x, g)


for bar in range(5, 41):
    sec = SEC[bar]
    # kick pattern
    if sec == 'drop':
        kp = [0, 2] if bar < 13 else [0, 1.5, 2] + ([3.5] if bar % 2 == 0 else [])
    elif bar in (17, 18):
        kp = [0, 2]
    elif sec == 'seasonal':
        kp = [0, 2] + ([3.5] if bar == 22 else [])
    elif sec == 'features':
        kp = [0] if bar < 27 else ([0, 2] if bar == 27 else [0, 1, 2, 3])
    elif sec == 'hook':
        kp = [0, 1.5, 2] + ([3.5] if bar % 2 == 0 else []) if bar < 34 else [0, 1, 2, 3, 3.5]
    else:  # rapid, finale: four on the floor, the peak
        kp = [0, 1, 2, 3]
    kv = {'drop': 0.85, 'seasonal': 0.8, 'features': 0.52, 'hook': 0.9, 'rapid': 0.95, 'finale': 1.0}[sec]
    for b in kp:
        kick_at(at(bar, b), hv(kv * (1.0 if b in (0, 2) else 0.82), 0.04))
    # backbeat: rim (drop 5-8), rim + snap (from 9), clap-ish layered snaps in hook+
    if bar in (17, 18):
        for k in range(8):  # ticking clock under the witch
            drum(rimT, tm(bar, k * 0.5), tick(hv(0.75 if k % 2 == 0 else 0.5)), 1.0)
        drum(rimT, tm(bar, 3), rim(hv(0.45)), 0.8)
        continue
    if sec == 'features':
        if bar >= 24:
            drum(rimT, tm(bar, 3), rim(hv(0.38 if bar != 25 else 0.25)), 1.0)
        if bar >= 27:
            drum(snp, tm(bar, 1), snap(hv(0.4)), 1.0)
            drum(snp, tm(bar, 3), snap(hv(0.45)), 1.0)
    else:
        rv = 0.56 if (sec == 'drop' and bar < 9) else 0.6
        for b in (1, 3):
            drum(rimT, tm(bar, b), rim(hv(rv)), 1.0)
            if not (sec == 'drop' and bar < 9):
                sv = {'drop': 0.68, 'seasonal': 0.62, 'hook': 0.78, 'rapid': 0.85, 'finale': 0.9}[sec]
                drum(snp, tm(bar, b), snap(hv(sv)), 1.0)
                if sec in ('hook', 'rapid', 'finale'):
                    drum(snp, tm(bar, b) + 0.009, snap(hv(sv * 0.7)), 0.8)  # double the snap: a soft clap
    # ghost rims (16ths) from bar 13 and in the hook
    if (sec == 'drop' and bar >= 13) or sec in ('hook', 'rapid', 'finale'):
        for b in (0.75, 2.75) + ((1.75, 3.25) if sec in ('rapid', 'finale') else ()):
            drum(rimT, tm(bar, b), rim(hv(0.22)), 1.0)
    # shaker: 8ths at first, 16ths later
    if sec != 'seasonal':
        sixteenth = (sec == 'drop' and bar >= 9) or sec in ('hook', 'rapid', 'finale') or bar >= 27
        step = 0.25 if sixteenth else 0.5
        sl = {'drop': 0.6, 'features': 0.31, 'hook': 0.65, 'rapid': 0.72, 'finale': 0.74}[sec]
        if sec == 'features' and bar == 25:
            sl = 0.2
        for k in range(int(4 / step)):
            b = k * step
            acc = 1.0 if (b % 1) == 0.5 else (0.55 if (b % 0.5) == 0 else 0.7)
            drum(shk, hum(at(bar, b) + (0.012 if (b % 0.5) == 0.25 else 0.0)), shaker(hv(sl * acc), 0.07 if step == 0.25 else 0.09), 1.0)
    # closed hats on the offbeats from bar 13 and in the peak sections
    if (sec == 'drop' and bar >= 9) or sec in ('hook', 'rapid', 'finale'):
        hv_ = (0.26 if bar < 13 else 0.34) if sec == 'drop' else 0.4
        for b in (0.5, 1.5, 2.5, 3.5):
            drum(hhT, tm(bar, b), hat(False, hv(hv_)), 1.0)
    # fills: rims in 16ths, crescendo
    if bar in (16, 28):
        for k in range(8):
            drum(rimT, tm(bar, 2 + k * 0.25), rim(hv(0.25 + 0.06 * k)), 1.0)
    if bar == 34:  # the build into the rapid cuts: snaps 8ths then 16ths, crescendo
        for k in range(12):
            b = k * 0.5 if k < 4 else 2 + (k - 4) * 0.25
            drum(snp, tm(bar, b), snap(hv(0.35 + 0.06 * k)), 1.0)
    if bar == 40:
        for k in range(4):
            drum(rimT, tm(bar, 3 + k * 0.25), rim(hv(0.4 + 0.1 * k)), 1.0)
# accents on the drop's picture cuts: a soft low piano octave
for t in cues.DROP_CUTS:
    bar = int(t // BAR) + 1
    ch = segs(bar)[0][2]
    r = C[ch]['bass']
    pno_lh.add(t, piano_chord([r + 12, r + 24], 0.9, 0.42), 0.8)
    cel.add(t, celesta(sorted(C[ch]['shi'])[-1] + 24, 0.42), 0.5)  # a glint on the cut, high above

# ------------------------------------------------------------------ swells
# Reversed piano swells build into the hits. No noise risers: the spot has no whooshes.
IR_HALL = hall_ir(2.6, 0.022, 8500, 170, seed=5)
IR_BIG = hall_ir(3.4, 0.03, 7000, 160, seed=9, width=1.2)
IR_ROOM = hall_ir(0.7, 0.008, 9000, 200, seed=2)


def swell_into(t, notes, dur, g):
    x = piano_chord(notes, 2.5, 0.85)
    fxs.add(t - dur - 0.02, reverse_swell(x, IR_BIG, dur), g)  # stops 20 ms short so the hit punches


swell_into(cues.DROP, [64, 68, 71, 76], 1.6, 0.36)
swell_into(at(29, 0), [64, 68, 71, 76], 1.4, 0.28)
swell_into(at(35, 0), [64, 68, 71, 76, 80], 1.6, 0.36)
swell_into(cues.FINALE, [64, 68, 71, 76, 80], 1.8, 0.42)
swell_into(cues.ENDCARD, [64, 68, 71, 76], 1.2, 0.32)

# ------------------------------------------------------------------ hits (impact stem)
imp.add(cues.DROP, min_hit(28, 0.9, IR_HALL, (28, 40, 47, 52)), 1.0)
fin = min_hit(28, 1.25, IR_HALL, (28, 40, 47, 52, 56))
imp.add(cues.FINALE, fin, 1.0)
imp.add(cues.FINALE, crash(3.0), 0.28)
imp.add(cues.FINALE, taiko(41, 0.9), 0.5)
imp.add(cues.ENDCARD, min_hit(28, 1.0, IR_HALL, (28, 40, 47, 52)), 1.0)
imp.add(cues.DROP, crash(2.2), 0.2)

# ------------------------------------------------------------------ the end chord (in the music)
END = [40, 47, 52, 56, 59, 64, 66, 68, 71, 76]
pno.add(cues.ENDCARD, piano_chord([52, 59, 64, 68, 71, 76], 5.5, 0.72, roll=0.018), 1.1)
pno_lh.add(cues.ENDCARD, piano_chord([28, 40, 47], 5.5, 0.7), 0.9)
mel.add(cues.ENDCARD, piano(76, 5.5, 0.78), 1.0)
mel.add(cues.ENDCARD + 0.004, piano(88, 5.5, 0.55), 0.7)
# strings and pad decay under the piano so the piano is the last thing heard (no flat drone)
x = section([52, 59, 64, 68, 71, 76, 80], 5.6, 0.62, attack=0.12, release=2.0, bright=0.48)
x *= np.exp(-np.arange(x.shape[1]) / SR / 1.6)[None]
strg.add(cues.ENDCARD, x, 1.0)
x = air_pad([56, 59, 64, 66, 71], 5.6, 0.8, attack=0.15, release=2.0, bright=0.42)
x *= np.exp(-np.arange(x.shape[1]) / SR / 2.0)[None]
pad.add(cues.ENDCARD, x, 1.0)
cel.add(cues.ENDCARD + 0.5, celesta(88, 0.42, 3.0), 0.6)
cel.add(cues.ENDCARD + 1.0, celesta(92, 0.36, 3.0), 0.5)


# ------------------------------------------------------------------ mix
def auto(points):
    """Gain curve from (time, dB) points, linear in dB."""
    ts, ds = zip(*points)
    tt = np.arange(NS) / SR
    return 10 ** (np.interp(tt, ts, ds) / 20)


kick_times = sorted(kick_times)
EQ_PNO = [pb.HighpassFilter(110), pb.LowShelfFilter(280, -3.0, 0.7), pb.PeakFilter(3400, 3.5, 0.7), pb.HighShelfFilter(7000, 4.0, 0.7)]
pno_dry = bus(pno.buf + pno_sp.buf * 0.5, *EQ_PNO, pb.Compressor(threshold_db=-20, ratio=2.0, attack_ms=12, release_ms=160))
lh_dry = bus(pno_lh.buf, pb.HighpassFilter(60), pb.LowShelfFilter(220, -4.5, 0.7))
mel_dry = bus(mel.buf, pb.HighpassFilter(160), pb.PeakFilter(3800, 2.0, 0.9), pb.HighShelfFilter(8000, 2.0, 0.7), pb.Compressor(threshold_db=-18, ratio=2.2, attack_ms=8, release_ms=150))
keys = pno_dry * 0.85 + lh_dry * 0.7 + mel_dry * 1.3
keys = (keys + hall(keys, IR_HALL, 0.24) + pingpong(pno_dry * 0.85, 0.375, 0.38, 5, 4200, 400, 0.14)
        + pingpong(bus(pno_sp.buf, *EQ_PNO), 0.375, 0.42, 7, 4200, 350, 0.2) + hall(bus(pno_sp.buf, *EQ_PNO), IR_BIG, 0.18))

bells = cel.buf * 1.0 + glk.buf * 0.8
bells = bus(bells, pb.HighpassFilter(300), pb.HighShelfFilter(7000, -2.0, 0.7))
bells = bells + hall(bells, IR_BIG, 0.38) + pingpong(bells, 0.375, 0.45, 6, 6000, 600, 0.3)

pul_m = bus(pul.buf, pb.HighpassFilter(130), pb.LowShelfFilter(260, -2.0, 0.7), pb.PeakFilter(2600, 3.0, 0.8), pb.Compressor(threshold_db=-22, ratio=2.0))
pul_m = sidechain(pul_m, kick_times, depth=0.35, release=0.12)
pul_m = pul_m + pingpong(pul_m, 0.25, 0.3, 3, 3000, 300, 0.12) + hall(pul_m, IR_ROOM, 0.15)
pul_m = pul_m * auto([(0, 0), (47.7, 0), (48.1, -3.5), (52, -2), (56, 0), (87, 0)])
mar_m = np.vstack([mar.buf[0] * 0.8, mar.buf[1] * 1.15])
mar_m = bus(mar_m, pb.HighpassFilter(200)) + pingpong(mar.buf, 0.375, 0.35, 4, 5000, 400, 0.16)
mar_m = mar_m + hall(mar_m, IR_HALL, 0.22)

pad_m = bus(pad.buf, pb.Chorus(rate_hz=0.3, depth=0.25, centre_delay_ms=9, feedback=0.0, mix=0.5))
pad_m = sidechain(pad_m, kick_times, depth=0.18, release=0.2)
pad_m = (pad_m + hall(pad_m, IR_BIG, 0.42)) * auto([(0, 0), (47.7, 0), (48.1, -4), (52, -2), (56, 0), (87, 0)])

str_m = strg.buf + vln.buf * 0.9
str_m = bus(str_m, pb.HighpassFilter(110), pb.LowShelfFilter(250, -2.0, 0.7), pb.PeakFilter(3000, -1.0, 0.9), pb.HighShelfFilter(9000, -1.5, 0.7),
            pb.Compressor(threshold_db=-20, ratio=1.8, attack_ms=40, release_ms=300))
# widen: Haas-free M/S widening, more in the finale
mid_, side_ = str_m.mean(axis=0), (str_m[0] - str_m[1]) / 2
wid = auto([(0, 0), (75.8, 0), (76.2, 3.5), (87, 3.5)])
str_m = np.vstack([mid_ + side_ * wid * 1.2, mid_ - side_ * wid * 1.2])
str_m = str_m + hall(str_m, IR_BIG, 0.36)

sub_m = bus(subT.buf, pb.LowpassFilter(260))
sub_m = sidechain(sub_m, kick_times, depth=0.45, release=0.11)
sub_m = np.vstack([sub_m.mean(axis=0)] * 2)

dr = (kik.buf * 0.5 + pan(rimT.buf, -0.22) * 0.65 + pan(snp.buf, 0.12) * 0.8 + pan(shk.buf, 0.38) * 0.9
      + pan(hhT.buf, -0.35) * 0.55 + pan(slg.buf, 0.3) * 0.85)
dr = bus(dr, pb.Compressor(threshold_db=-16, ratio=2.5, attack_ms=6, release_ms=90))
dr = dr + hall(dr - kik.buf * 0.5, IR_ROOM, 0.18) + hall(slg.buf, IR_HALL, 0.25)

fx_m = bus(fxs.buf, pb.HighpassFilter(150)) + hall(fxs.buf, IR_BIG, 0.2)

G = dict(keys=1.0, bells=0.62, pulse=1.8, marimba=0.45, pad=0.65, strings=1.25, sub=0.27, drums=1.05, fx=0.9)
STEMS = dict(keys=keys, bells=bells, pulse=pul_m, marimba=mar_m, pad=pad_m, strings=str_m, sub=sub_m, drums=dr, fx=fx_m)
# bar 34 (66-68): the harmony dips on the downbeat, then climbs into the rapid cuts at 68.0
build = auto([(0, 0), (65.98, 0), (66.05, -3.0), (67.9, 0.8), (68.0, 0), (87, 0)])
for k in ('keys', 'pad', 'pulse'):
    STEMS[k] = STEMS[k] * build[None]
music = sum(STEMS[k] * G[k] for k in G)
music = bus(music, pb.HighShelfFilter(4500, 2.0, 0.6), pb.PeakFilter(300, -1.0, 0.8))
impact = bus(imp.buf, pb.HighpassFilter(28), pb.Limiter(threshold_db=-2, release_ms=200))

if __name__ == '__main__':
    stems = {k: STEMS[k] * G[k] for k in G}
    from scipy.signal import welch
    bands = [(20, 120), (120, 500), (500, 2000), (2000, 6000), (6000, 20000)]
    tot = {}
    for k, v in stems.items():
        f, P = welch(v.mean(axis=0)[::2], SR / 2, nperseg=8192)
        tot[k] = [P[(f >= lo) & (f < hi)].sum() for lo, hi in bands]
    allE = sum(sum(x) for x in tot.values())
    for k, x in tot.items():
        print(f'{k:8s} ' + ' '.join(f'{100 * e / allE:5.1f}' for e in x), f' total {100 * sum(x) / allE:5.1f}%')
    write(NAME, music, impact, {'lift_db': 4.0})
