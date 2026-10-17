"""INDIE soundtrack option: feel-good indie pop in G major, 120 BPM.

Two strummed acoustics (L/R doubles: open 8th pattern with up-strokes, and a high-voiced part with
dead-string chops on the backbeat), a picked bass that walks into each chord, stomp kick, a gang of
handclaps on 2 and 4, tambourine 16ths, a glockenspiel/whistle hook, 'ooh' backing vocals and a
gang-vocal finale. Hits are a big double-tracked G strum + stomp + floor boom + crash.

  python3 audio/options/indie.py && python3 audio/master.py indie && python3 audio/check_option.py indie
"""
import os
import sys

import numpy as np
import pedalboard as pb

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from engine import *  # noqa
from instruments import *  # noqa
from inst_indie import ac_note, ac_strum, chop, claps, gang, indie_hit, reverse_strum, sleigh, stomp, tamb, whistle  # noqa
from opt_common import bus, sidechain, track, write  # noqa
import cues  # noqa
from cues import BEAT, BAR, bar_t  # noqa

NAME = 'indie'
rng = np.random.default_rng(1207)


def hum(t, sd=0.0035):
    """Humanised time: a few ms early/late. Downbeats and hits are placed without it."""
    return max(0.0, t + float(np.clip(rng.normal(0, sd), -0.008, 0.008)))


def hv(v, sd=0.07):
    return float(np.clip(v * (1 + rng.normal(0, sd)), 0.05, 1.15))


def at(bar, beat):
    return bar_t(bar) + beat * BEAT


# ------------------------------------------------------------------ harmony
DS = [(0, 'Dsus4'), (1.5, 'D')]  # the anchor-string Dsus4 that falls to D on the 'and' of 2
CHART = {
    1: 'G', 2: 'Cadd9', 3: 'Em7', 4: [(0, 'Dsus4'), (2, 'D')],                      # intro
    5: 'G', 6: DS, 7: 'Em7', 8: 'Cadd9', 9: 'G', 10: DS, 11: 'Em7', 12: 'Cadd9',  # drop
    13: 'Am7', 14: 'G/B', 15: 'Cadd9', 16: DS,  # the bass walks up A-B-C-D into the Em of bar 17
    17: 'Em', 18: 'B7', 19: 'Cadd9', 20: DS, 21: 'G', 22: 'G',                      # seasonal
    23: 'Cadd9', 24: 'G/B', 25: 'Am7', 26: 'G', 27: 'Cadd9', 28: [(0, 'Dsus4'), (2, 'D')],  # features
    29: 'G', 30: DS, 31: 'Em7', 32: 'Cadd9', 33: 'Am7', 34: 'D',                    # hook
    35: 'G', 36: DS, 37: 'Em7', 38: [(0, 'Cadd9'), (2, 'D')],                       # rapid
    39: 'G', 40: [(0, 'Cadd9'), (2, 'D')],                                           # finale
    41: 'G', 42: 'G', 43: 'G',                                                       # end
}


def segs(bar):
    c = CHART[bar]
    if isinstance(c, str):
        return [(0, 4, c)]
    return [(b, c[i + 1][0] if i + 1 < len(c) else 4, ch) for i, (b, ch) in enumerate(c)]


def chord_at(bar, beat):
    for b, e, ch in segs(bar):
        if b <= beat < e:
            return ch


# open-position acoustic (low strings) and a capo'd-sounding high part; top strings mostly keep
# D4/G4 ringing across G - D - Em7 - Cadd9 (common-tone voice leading, the indie 'anchor' sound)
GTR1 = {'G': [43, 47, 50, 55, 62, 67], 'D': [50, 57, 62, 66], 'D/F#': [42, 50, 57, 62, 66],
        'Em7': [40, 47, 52, 55, 62, 67], 'Em': [40, 47, 52, 55, 59, 64], 'Cadd9': [48, 52, 55, 62, 67],
        'Am7': [45, 52, 55, 60, 67], 'G/B': [47, 50, 55, 62, 67], 'B7': [47, 51, 57, 59, 66],
        'Dsus4': [50, 57, 62, 67]}
GTR2 = {'G': [55, 62, 67, 71], 'D': [57, 62, 66, 69], 'D/F#': [57, 62, 66, 69], 'Em7': [55, 62, 64, 71],
        'Em': [55, 59, 64, 71], 'Cadd9': [55, 60, 64, 67], 'Am7': [57, 60, 64, 67], 'G/B': [55, 62, 67, 71],
        'B7': [54, 59, 63, 69], 'Dsus4': [57, 62, 67, 69]}
# the D is sung as D7 (C4 D4 F#4): Cadd9 -> D7 -> G moves by step with the 7th falling to B3
CHOIR = {'G': [59, 62, 67], 'D': [60, 62, 66], 'D/F#': [57, 62, 66], 'Em7': [59, 62, 67], 'Em': [59, 64, 67],
         'Cadd9': [60, 64, 67], 'Am7': [60, 64, 67], 'G/B': [59, 62, 67], 'B7': [59, 63, 66], 'Dsus4': [57, 62, 67]}
ROOT_PC = {'G': 7, 'D': 2, 'D/F#': 6, 'Em7': 4, 'Em': 4, 'Cadd9': 0, 'Am7': 9, 'G/B': 11, 'B7': 11, 'Dsus4': 2}
SCALE = {7, 9, 11, 0, 2, 4, 6}

# energy per bar: the intro builds, the drop lands, seasonal plays, features breathe, hook/finale peak
ENERGY = {}
for b, e in zip(range(1, 5), (0.5, 0.58, 0.68, 0.82)):
    ENERGY[b] = e
for b in range(5, 17):
    ENERGY[b] = 1.0 if b < 9 or b > 12 else 0.97
for b in range(17, 23):
    ENERGY[b] = 0.86 if b < 19 else 0.95
for b in range(23, 29):
    ENERGY[b] = 0.7
ENERGY[28] = 0.8
for b in range(29, 35):
    ENERGY[b] = 1.05
for b in range(35, 39):
    ENERGY[b] = 1.12
for b in range(39, 44):
    ENERGY[b] = 1.2

gtr1, gtr2, pick, bass, kick, clapT, perc, glk, whis, ch, gng, fxs, imp = (track() for _ in range(13))

# ------------------------------------------------------------------ guitars
# strokes: (beat, kind, vel) with kind D = down, U = up, X = dead-string chop, M = palm-muted down
PAT_A = [(0, 'D', 1.0), (1, 'D', 0.8), (1.5, 'U', 0.6), (2.5, 'U', 0.65), (3, 'D', 0.85), (3.5, 'U', 0.6)]
PAT_B = [(0, 'D', 0.95), (0.5, 'U', 0.5), (1, 'X', 0.8), (1.5, 'U', 0.55), (2, 'D', 0.8), (2.5, 'U', 0.5),
         (3, 'X', 0.85), (3.5, 'U', 0.55)]
PAT_RAPID = [(0, 'D', 1.0), (1, 'D', 0.8), (1.5, 'U', 0.6), (2, 'D', 0.95), (2.5, 'U', 0.6), (3, 'D', 0.85),
             (3.5, 'U', 0.6)]
PAT_PM = [(b * 0.5, 'M', 0.95 if b in (0, 3, 4) else 0.62) for b in range(8)]
PAT_GALLOP = [(0, 'D', 0.95), (0.5, 'M', 0.6), (1, 'M', 0.6), (1.5, 'D', 0.8), (2, 'M', 0.6), (2.5, 'M', 0.6),
              (3, 'D', 0.85), (3.5, 'M', 0.5)]
PAT_FEAT2 = [(0, 'D', 0.6), (2.5, 'U', 0.4), (3, 'D', 0.45)]

strokes = {1: [], 2: []}  # guitar -> [(t, kind, chord, vel)]


def add_bar(g, bar, pat, gain=1.0, voicing=None):
    for beat, kind, v in pat:
        c = chord_at(bar, beat)
        t = at(bar, beat)
        t = t if beat == 0 else hum(t)
        strokes[g].append((t, kind, c, hv(v * gain * ENERGY[bar])))


for bar in range(5, 41):
    sec = next(s[0] for s in cues.SECTIONS if s[1] <= bar < s[2])
    if sec in ('drop', 'hook'):
        add_bar(1, bar, PAT_A)
        if not (9 <= bar <= 12):
            add_bar(2, bar, PAT_B, 0.9)
    elif sec == 'seasonal':
        add_bar(1, bar, PAT_GALLOP if bar < 19 else PAT_A)
        add_bar(2, bar, PAT_B, 0.85)
    elif sec == 'features':
        add_bar(1, bar, PAT_PM, 0.95)
        add_bar(2, bar, PAT_FEAT2, 0.9)
    elif sec in ('rapid', 'finale'):
        if bar in (38, 40):  # last bar before a hit: drive, then one big D strum that rings into it
            add_bar(1, bar, [p for p in PAT_RAPID if p[0] < 2] + [(2, 'D', 1.0)])
            add_bar(2, bar, [p for p in PAT_B if p[0] < 2] + [(2, 'D', 0.95)])
            if bar == 40:
                add_bar(1, bar, [(3, 'D', 0.8), (3.5, 'U', 0.75)])
        else:
            add_bar(1, bar, PAT_RAPID)
            add_bar(2, bar, PAT_B, 0.95)
# bar 34 builds: 16th strums on the last two beats, rising (replacing the 8th pattern there)
strokes[1] = [s for s in strokes[1] if not (at(34, 2) - 0.01 <= s[0] < at(35, 0) - 0.01)]
for k in range(8):
    strokes[1].append((hum(at(34, 2 + k * 0.25), 0.002), 'D' if k % 2 == 0 else 'U', 'D', 0.55 + 0.06 * k))
# the intro's last two beats: strums enter under the picking (the build)
for beat, kind, v in [(2, 'D', 0.55), (3, 'D', 0.65), (3.5, 'U', 0.6)]:
    strokes[1].append((hum(at(4, beat)), kind, 'D', v))


def render_strokes(g, tr, voic, p, stop):
    ev = sorted(strokes[g])
    for i, (t, kind, c, v) in enumerate(ev):
        nxt = ev[i + 1][0] if i + 1 < len(ev) else stop
        gap = min(nxt - t, 2.6)
        notes = voic[c]
        if kind == 'X':
            x = chop(notes, v)
        elif kind == 'M':
            x = ac_strum(notes[:3], gap, v, True, bright=0.7, mute=0.6)
        else:
            x = ac_strum(notes, gap + 0.01, v, kind == 'D', bright=0.6 if g == 1 else 0.7)
        tr.add(t, pan(x, p))


render_strokes(1, gtr1, GTR1, -0.6, cues.ENDCARD)
render_strokes(2, gtr2, GTR2, 0.6, cues.ENDCARD)
# end card: both guitars ring one G strum out to silence
gtr1.add(cues.ENDCARD, pan(ac_strum(GTR1['G'], 5.5, 0.75, True, bright=0.66), -0.6), 0.9)
gtr2.add(cues.ENDCARD + 0.012, pan(ac_strum(GTR2['G'], 5.5, 0.7, True, bright=0.72), 0.6), 0.9)

# fingerpicked guitar: the intro's single picking pattern (Travis style: thumb on the beat,
# fingers between), and an 8th arpeggio on the high part in bars 9-12
plucks = []  # (bar, beat, midi, vel)
for bar in range(1, 5):
    for k in range(8):
        beat = k * 0.5
        if bar == 4 and beat >= 2:
            continue
        v = GTR1[chord_at(bar, beat)]
        thumb = [v[0], v[1], v[2], v[1]][k // 2]  # root, 3rd (or 5th), 5th, 3rd
        if k % 2 == 0:
            notes = [(thumb, 0.9)] + ([(v[-1], 0.7)] if k == 0 else [])
        else:
            notes = [([v[-2], v[-1], v[-3], v[-1]][k // 2], 0.75)]
        e = ENERGY[bar] * (1 + 0.15 * (k == 0))
        plucks += [(bar, beat, m, vv * e) for m, vv in notes]
# open strings ring: each note sustains until its string is picked again or the chord changes
for i, (bar, beat, m, vv) in enumerate(plucks):
    t = at(bar, beat)
    seg_end = next(at(bar, e) for b, e, c in segs(bar) if b <= beat < e)
    again = [at(b2, bt2) for b2, bt2, m2, _ in plucks[i + 1:] if m2 == m]
    ring = min([seg_end] + again) - t + (0.1 if not again or min(again) > seg_end else 0.02)
    pick.add(t if beat == 0 else hum(t), pan(ac_note(m, ring, hv(vv), 0.8), -0.15 + 0.1 * (m > 55)))
for bar in range(9, 13):
    for k in range(8):
        v = GTR2[chord_at(bar, k * 0.5)]
        m = [v[0], v[1], v[2], v[3], v[2], v[1], v[2], v[3]][k]
        gtr2.add(at(bar, k * 0.5) if k == 0 else hum(at(bar, k * 0.5)), pan(ac_note(m, 0.7, hv(0.62 if k % 2 == 0 else 0.5), 0.9), 0.45))

# ------------------------------------------------------------------ bass
def near(pc, c, lo=33, hi=47):
    cands = [p for p in range(lo, hi + 1) if p % 12 == pc]
    return min(cands, key=lambda p: abs(p - c) + (0.1 if p > c else 0))


def approach(c, t):
    if t == c:
        return [c + 7 if c + 7 <= 50 else c - 5, c + 12 if c + 12 <= 52 else c + 7]
    step = 1 if t > c else -1
    between = [p for p in range(c + step, t, step) if p % 12 in SCALE]
    if len(between) >= 2:
        return between[-2:]
    if len(between) == 1:
        return [between[0], t - step] if t - step != between[0] else [c, between[0]]
    return [c, t - step]


def bass_bar(bar, style, prev):
    """Returns the last note played; adds this bar's notes."""
    sg = []
    for s in segs(bar):  # one bass chord per root (Dsus4 -> D is one D)
        if sg and ROOT_PC[sg[-1][2]] == ROOT_PC[s[2]]:
            sg[-1] = (sg[-1][0], s[1], sg[-1][2])
        else:
            sg.append(s)
    E = ENERGY[bar]
    nb = bar + 1 if bar + 1 in CHART else bar
    nxt_c = segs(nb)[0][2]
    notes = []
    for si, (b0, b1, c) in enumerate(sg):
        r = near(ROOT_PC[c], prev)
        tgt_c = sg[si + 1][2] if si + 1 < len(sg) else nxt_c
        t = near(ROOT_PC[tgt_c], r)
        fifth = r + 7 if r + 7 <= 50 else r - 5
        if ROOT_PC[c] == 2:  # on D the bass pops the octave instead of sitting on A
            fifth = r + 12 if r + 12 <= 52 else r
        if c == 'G/B':
            fifth = r + 3  # D2, the chord's real 5th, not F# against the G
        a1, a2 = approach(r, t)
        if b1 - b0 == 2:
            notes += [(b0, r, 0.9, 0.95), (b0 + 1, r, 0.45, 0.75), (b0 + 1.5, a2, 0.45, 0.8)]
        elif style == 'drive':
            notes += [(0, r, 1.4, 1.0), (1.5, r, 0.45, 0.72), (2, fifth, 0.9, 0.88), (3, a1, 0.45, 0.75), (3.5, a2, 0.45, 0.8)]
        elif style == 'busy':
            notes += [(0, r, 0.45, 1.0), (0.5, r, 0.45, 0.65), (1, r + 12 if r + 12 <= 52 else r, 0.45, 0.8), (1.5, r, 0.45, 0.7),
                      (2, fifth, 0.45, 0.85), (2.5, r, 0.45, 0.68), (3, a1, 0.45, 0.78), (3.5, a2, 0.45, 0.82)]
        elif style == 'features':
            notes += [(0, r, 1.4, 0.85), (1.5, r, 0.45, 0.6), (2, fifth, 1.4, 0.75), (3.5, a2, 0.45, 0.7)]
        elif style == 'walk':  # Halloween: staccato quarter-note walk up the arpeggio
            arp = [r, r + (3 if c == 'Em' else 4), r + 7, r + (3 if c == 'Em' else 10)]
            notes += [(q, arp[q], 0.32, 0.9 if q == 0 else 0.72) for q in range(4)]
        prev = r
    last = prev
    for beat, m, d, v in notes:
        tt = at(bar, beat) if beat == 0 else hum(at(bar, beat), 0.003)
        bass.add(tt, pick_bass(m, d * BEAT, hv(v * E, 0.05)))
        last = m
    return last


# intro: bass enters in bar 3, walks into the drop
bass.add(at(3, 0), pick_bass(40, 1.9, 0.5))
bass.add(at(4, 0), pick_bass(38, 0.95, 0.6))
bass.add(at(4, 2), pick_bass(38, 0.7, 0.68))
bass.add(hum(at(4, 3.5)), pick_bass(42, 0.22, 0.7))  # F#2, the leading tone into G2 on the drop
prev = 31
for bar in range(5, 41):
    sec = next(s[0] for s in cues.SECTIONS if s[1] <= bar < s[2])
    style = {'drop': 'drive', 'seasonal': 'walk' if bar < 19 else 'drive', 'features': 'features',
             'hook': 'busy', 'rapid': 'busy', 'finale': 'busy'}[sec]
    if bar in (13, 14, 15, 16):
        style = 'busy'
    prev = bass_bar(bar, style, prev)
bass.add(cues.ENDCARD, pick_bass(31, 4.6, 0.9))

# ------------------------------------------------------------------ drums
def k_(t, v):
    kick.add(t, stomp(v))


def c_(t, v, snare=True):
    clapT.add(t, claps(v))
    if snare:
        clapT.add(t, crack_snare(v * 0.5, 210), 0.35)


def tamb16(bar, v0, v1=None, beats=(0, 4), hits=True):
    v1 = v0 if v1 is None else v1
    for k in range(int(beats[0] * 4), int(beats[1] * 4)):
        b = k / 4 + (0.02 if k % 2 else 0.0)  # light swing on the off-16ths
        acc = [1.0, 0.42, 0.68, 0.45][k % 4]
        v = v0 + (v1 - v0) * (b - beats[0]) / max(1e-6, beats[1] - beats[0])
        if hits and k % 8 == 4:
            perc.add(hum(at(bar, b), 0.002), pan(tamb(hv(v * 1.1), True), 0.35))
        else:
            perc.add(hum(at(bar, b), 0.003), pan(tamb(hv(v * acc, 0.1)), 0.35))


def shaker16(bar, v, p=-0.4):
    for k in range(16):
        perc.add(hum(at(bar, k / 4), 0.004), pan(shaker(hv(v * [0.9, 0.45, 0.7, 0.5][k % 4], 0.12), 0.08), p))


# intro build
k_(at(3, 0), 0.4)
k_(at(3, 2), 0.45)
for k in range(4, 8):
    perc.add(hum(at(3, k * 0.5)), pan(shaker(hv(0.25 + 0.05 * k), 0.08), -0.4))
for q in range(4):
    k_(at(4, q), 0.5 + 0.1 * q)
c_(at(4, 1), 0.45, False)
c_(at(4, 3), 0.6, False)
c_(hum(at(4, 3.5)), 0.65, False)
tamb16(4, 0.15, 0.85, hits=False)
fxs.add(cues.DROP - 1.6, reverse_crash(1.6), 0.55)
fxs.add(cues.DROP - 1.0, pan(reverse_strum(GTR1['G'], 1.0), 0.0), 0.5)

for bar in range(5, 41):
    sec = next(s[0] for s in cues.SECTIONS if s[1] <= bar < s[2])
    E = ENERGY[bar]
    if sec in ('drop', 'hook') or (sec == 'seasonal' and bar >= 19):
        k_(at(bar, 0), hv(0.95 * E, 0.03))
        k_(hum(at(bar, 2)), hv(0.9 * E, 0.04))
        if bar % 2 == 0:
            k_(hum(at(bar, 2.5)), hv(0.7 * E))
        if bar % 4 == 0:
            k_(hum(at(bar, 3.5)), hv(0.6 * E))
        c_(hum(at(bar, 1), 0.003), hv(0.85 * E))
        c_(hum(at(bar, 3), 0.003), hv(0.9 * E))
        if sec == 'seasonal':  # festive: sleigh bells instead of the tambourine
            for k in range(16):
                perc.add(hum(at(bar, k / 4), 0.003), pan(sleigh(hv([1.0, 0.45, 0.7, 0.5][k % 4] * 0.85)), 0.25 if k % 2 else -0.25))
        else:
            tamb16(bar, 0.75 * E)
    elif sec == 'seasonal':  # Halloween: half-time, sneaky
        k_(at(bar, 0), 0.85 * E)
        k_(hum(at(bar, 2.5)), 0.6 * E)
        c_(hum(at(bar, 2)), 0.85 * E)
        for k in range(8):
            perc.add(hum(at(bar, k * 0.5)), pan(tamb(hv(0.5 if k % 2 else 0.75)), 0.35))
    elif sec == 'features':
        k_(at(bar, 0), 0.75 * E)
        k_(hum(at(bar, 2)), 0.65 * E)
        perc.add(hum(at(bar, 1)), pan(snap(0.5), -0.25))
        c_(hum(at(bar, 3)), 0.6 * E, False)
        shaker16(bar, 0.55)
    elif sec in ('rapid', 'finale'):
        for q in range(4):
            if bar == 38 and q == 3:
                continue  # the breath: drums rest 75.5-76.0 (q=3 is 75.5)
            k_(at(bar, q) if q == 0 else hum(at(bar, q), 0.002), hv((0.95 if q % 2 == 0 else 0.82) * E, 0.03))
        c_(hum(at(bar, 1), 0.003), hv(0.9 * E))
        if not (bar == 38):
            c_(hum(at(bar, 3), 0.003), hv(0.95 * E))
        tamb16(bar, 0.8 * E, beats=(0, 3 if bar == 38 else 4))
# fills and transitions
for b in (3, 3.5):  # into seasonal
    c_(hum(at(16, b)), 0.8)
    k_(hum(at(16, b)), 0.7)
perc.add(at(22, 2), sleigh(0.9, 0.6), 0.9)  # Christmas: a big sleigh shake
for k in range(8):
    perc.add(hum(at(22, 2 + k * 0.25)), pan(sleigh(0.5 + 0.06 * k), 0.3 if k % 2 else -0.3))
tamb16(28, 0.3, 0.9, beats=(2, 4))  # into the hook
for b in (2.5, 3, 3.5):
    k_(hum(at(28, b)), 0.6 + 0.08 * (b - 2.5) * 2)
c_(hum(at(28, 3.5)), 0.7)
fxs.add(at(29, 0) - 1.2, reverse_crash(1.2), 0.4)
# bar 34 (66-68): builds into the rapid cuts
for k in range(0, 8, 2):
    k_(hum(at(34, 2 + k * 0.25), 0.002), 0.5 + 0.06 * k)
for k in range(4):
    c_(hum(at(34, k * 0.5)), 0.35 + 0.05 * k, False)
for k in range(8):
    c_(hum(at(34, 2 + k * 0.25), 0.002), 0.4 + 0.06 * k, k % 2 == 0)
tamb16(34, 0.3, 1.0, hits=False)
fxs.add(at(35, 0) - 2.0, reverse_crash(2.0), 0.45)
k_(at(35, 0), 0.9)  # the rapid cuts land: doubled stomp under the crash
fxs.add(at(35, 0) - 1.0, pan(reverse_strum(GTR1['G'], 1.0), 0.0), 0.45)
# 74-75.5 "And so much more": three gang accents, then the breath with harmony and a swell
for b, v in ((0, 1.0), (1, 0.9), (2, 1.0), (2.5, 0.85)):
    c_(hum(at(38, b), 0.002), v)
fxs.add(cues.FINALE - 1.5, reverse_crash(1.5), 0.6)
fxs.add(cues.FINALE - 1.0, pan(reverse_strum(GTR1['G'], 1.0), 0.0), 0.55)
# into the end card
for b in (3, 3.25, 3.5, 3.75):
    c_(hum(at(40, b), 0.002), 0.7 + 0.1 * (b - 3) * 4, b in (3, 3.5))
fxs.add(cues.ENDCARD - 1.2, reverse_crash(1.2), 0.45)
# cymbals on section starts (the big three hits carry their own crash)
for t, v in ((32.0, 0.45), (56.0, 0.55), (68.0, 0.75), (20.0, 0.3)):
    perc.add(t, crash(2.5), v * 1.3)
for t in cues.DROP_CUTS:
    perc.add(t, pan(tamb(1.0, True), 0.35), 0.8)
perc.add(cues.ENDCARD, pan(tamb(0.8, True), 0.35), 0.8)

# ------------------------------------------------------------------ melody: glock + whistle hook
CALL = [(0, 74, 0.5), (0.5, 79, 1.0), (1.5, 78, 0.5), (2, 79, 0.5), (2.5, 81, 0.5), (3, 83, 1.0)]
RESP1 = [(0, 81, 1.0), (1, 79, 0.5), (1.5, 78, 0.5), (2, 74, 2.0)]
RESP2 = [(0, 84, 1.0), (1, 83, 0.5), (1.5, 81, 0.5), (2, 79, 1.5), (3.5, 76, 0.5)]
B1 = [(0, 84, 0.5), (0.5, 83, 0.5), (1, 81, 1.0), (2, 76, 0.5), (2.5, 79, 0.5), (3, 84, 1.0)]
B2 = [(0, 79, 0.5), (0.5, 81, 0.5), (1, 83, 3.0)]
RESP3 = [(0, 84, 1.0), (1, 83, 0.5), (1.5, 81, 0.5), (2, 78, 0.5), (2.5, 81, 0.5), (3, 84, 1.0)]  # C6 = D7's 7th


def phrase(bars_cells):
    """[(bar, cell)] -> absolute [(t, midi, dur_s, vel)]."""
    ev = []
    for bar, cell in bars_cells:
        for beat, m, d in cell:
            v = 1.0 if beat == int(beat) else 0.84
            t = at(bar, beat)
            ev.append((t if beat == 0 else hum(t, 0.004), m, d * BEAT, v))
    return ev


def play_glock(ev, oct_=12, vel=0.7):
    for t, m, d, v in ev:
        glk.add(t, pan(glock(m + oct_, hv(vel * v)), 0.2))


def play_whistle(ev, vel=1.0):
    t0 = ev[0][0]
    rel = [(t - t0, m + 12, d, v * vel) for t, m, d, v in ev]  # whistled an octave up: D6-C7
    whis.add(t0, whistle(rel))


# intro tile pings, rising through G major pentatonic, the last one is the G of the drop
for t, m, v in zip(cues.GLOW_TIMES, [79, 74, 76, 79, 81, 83, 86, 88, 91], np.linspace(0.95, 1.25, 9)):  # sync pings sit above the picking
    glk.add(t, pan(glock(m, v), 0.2 if m % 2 else -0.1))
# drop: the glock states the motif
play_glock(phrase([(5, CALL), (6, RESP1), (7, CALL), (8, RESP2)]), 12, 0.62)
# bars 13-14: glock arpeggios; 15-16: rising pings on the accent-colour cuts
for bar in (13, 14):
    for beat, idx in ((0, 2), (1, 1), (1.5, 2), (2.5, 0), (3, 1), (3.5, 2)):
        m = CHOIR[chord_at(bar, beat)][idx] + 24
        glk.add(at(bar, beat) if beat == 0 else hum(at(bar, beat)), pan(glock(m, hv(0.42 if beat % 1 else 0.5)), 0.2))
for t, m in zip(cues.ACCENT_CUTS, (86, 88, 91, 93)):
    glk.add(t, pan(glock(m, 0.95), 0.2))
    glk.add(t + 0.012, pan(glock(m - 12, 0.35), -0.2))
# Halloween: a toy-box minor riff; holiday montage: festive glock figure + a chime on every cut
for bar, notes in ((17, [76, 79, 83, 79, 76, 79, 83, 84]), (18, [75, 78, 81, 78, 83, 81, 78, 75])):
    for k, m in enumerate(notes):
        glk.add(at(bar, k * 0.5) if k == 0 else hum(at(bar, k * 0.5)), pan(glock(m + 12, hv(0.4 if k % 2 else 0.5)), 0.2))
FEST = {19: [88, 91, 88, 84, 86, 88], 20: [86, 91, 93, 91, 90, 86], 21: [91, 95, 91, 86, 88, 91]}
for bar, notes in FEST.items():
    for (beat, _, _), m in zip(PAT_A, notes):
        glk.add(at(bar, beat) if beat == 0 else hum(at(bar, beat)), pan(glock(m, hv(0.55)), 0.2))
for k, m in enumerate([91, 95, 98, 96, 95, 93, 91, 90, 88, 86]):  # Christmas: a sparkling run down
    b = k * 0.5 if k < 3 else 1.5 + (k - 3) * 0.25 + 0.25
    glk.add(hum(at(22, b)), pan(glock(m, 0.6 - 0.02 * k), 0.2 - 0.04 * k))
for i, t in enumerate(cues.HOLIDAY_CUTS):
    c = chord_at(int(t // 2) + 1, (t % 2) / BEAT)
    top = (88, 91, 93, 93, 95, 98, 103)[i]  # E6 G6 A6 A6 B6 D7 G7: chord tones of Cadd9 Cadd9 Dsus4 D G G G
    perc.add(t, pan(bell(top, 1.4, index=1.6, ratio=3.5, vel=0.5), 0.3 if i % 2 else -0.3), 1.3)
# features: two soft whistled fragments of the motif, far back
play_whistle(phrase([(25, [(0, 76, 0.5), (0.5, 79, 1.0), (1.5, 81, 0.5), (2, 84, 1.5)])]), 0.35)
play_whistle(phrase([(27, [(0, 74, 0.5), (0.5, 79, 1.0), (1.5, 76, 0.5), (2, 79, 1.5)])]), 0.35)
# hook: whistle carries the tune, glock doubles an octave up; bar 34 holds and climbs
hook = phrase([(29, CALL), (30, RESP1), (31, CALL), (32, RESP2), (33, B1), (34, B2)])
play_whistle(hook, 1.0)
play_glock(hook, 12, 0.3)
for k, m in enumerate([74, 76, 78, 79, 81, 83, 84, 86]):
    glk.add(hum(at(34, 2 + k * 0.25), 0.002), pan(glock(m + 12, 0.4 + 0.05 * k), -0.3 + 0.08 * k))
# rapid: the tune again, the second ending lands on A over D for the breath
rapid = phrase([(35, CALL), (36, RESP1), (37, CALL), (38, RESP3)])
play_whistle(rapid, 1.0)
play_glock(rapid, 12, 0.4)
# finale: gang vocals take the tune ('oh'), resolving to G at the end card
fin = phrase([(39, [(0, 83, 0.5)] + CALL[1:]), (40, RESP3)])  # C6 -> B5 on the 76.0 hit
play_whistle(fin, 0.9)
play_glock(fin, 12, 0.4)
for t, m, d, v in fin:
    gng.add(t - 0.01, gang(m - 12, d * 0.92, 0.85 * v, 'o'))
gng.add(cues.ENDCARD, gang(67, 2.6, 0.7, 'o'))
whis.add(cues.ENDCARD, whistle([(0, 95, 0.24, 0.7), (0.25, 93, 0.24, 0.6), (0.5, 91, 1.1, 0.55)], vib_cents=14))  # B-A-G home, then the strum rings
glk.add(cues.ENDCARD, pan(glock(91, 0.8), 0.2))
glk.add(cues.ENDCARD + 0.25, pan(glock(98, 0.5), -0.2))

# ------------------------------------------------------------------ 'ooh' backing vocals
def ooh(bar, vel, vowel='u', attack=0.3):
    for b0, b1, c in segs(bar):
        ch.add(at(bar, b0), choir(CHOIR[c], (b1 - b0) * BEAT, vel, vowel, attack, 0.9))


ch.add(at(4, 0), choir(CHOIR['Dsus4'], 1.0, 0.18, 'u', 0.6, 0.6))
ch.add(at(4, 2), choir(CHOIR['D'], 1.0, 0.3, 'u', 0.8, 0.5))
for bar in range(9, 17):
    ooh(bar, 0.26 if bar < 13 else 0.3)
for bar in (17, 18):
    ooh(bar, 0.3, 'o', 0.2)
for bar in range(19, 23):
    ooh(bar, 0.24)
for bar in range(23, 29):
    ooh(bar, 0.15, 'u', 0.5)
for bar in range(29, 35):
    ooh(bar, 0.32)
    for b0, b1, c in segs(bar):  # high harmony an octave up on the top voice
        ch.add(at(bar, b0), choir([CHOIR[c][1] + 12], (b1 - b0) * BEAT, 0.16, 'u', 0.3, 0.9))
for bar in range(35, 41):
    ooh(bar, 0.4, 'o', 0.15)
ch.add(cues.ENDCARD, choir([55, 59, 62, 67, 71], 4.2, 0.42, 'u', 0.08, 2.0))

# ------------------------------------------------------------------ hits (impact stem)
imp.add(cues.DROP, indie_hit(GTR1['G'], 2.4, 1.0))
imp.add(cues.FINALE, indie_hit(GTR1['G'], 2.8, 1.15))
imp.add(cues.ENDCARD, indie_hit(GTR1['G'], 5.5, 1.0))

# ------------------------------------------------------------------ mix
# body: the string model has no soundboard, so the EQ supplies the box (110/220 Hz) and a little
# presence, and rolls the zing off the top
GTR_EQ = [pb.HighpassFilter(75), pb.PeakFilter(cutoff_frequency_hz=110, gain_db=2.5, q=1.2),
          pb.PeakFilter(cutoff_frequency_hz=220, gain_db=3.5, q=1.0), pb.PeakFilter(cutoff_frequency_hz=1300, gain_db=-1.5, q=0.8),
          pb.PeakFilter(cutoff_frequency_hz=2800, gain_db=1.0, q=0.8), pb.HighShelfFilter(cutoff_frequency_hz=4500, gain_db=-3.5),
          pb.LowpassFilter(12000)]
mix_parts = {
    'gtr': bus(gtr1.buf + gtr2.buf, *GTR_EQ, pb.Compressor(threshold_db=-22, ratio=2.5, attack_ms=10, release_ms=120),
               pb.Reverb(room_size=0.3, damping=0.5, wet_level=0.1, dry_level=0.95)),
    'pick': bus(pick.buf, *GTR_EQ, pb.Delay(delay_seconds=0.375, feedback=0.2, mix=0.12),
                pb.Reverb(room_size=0.55, damping=0.4, wet_level=0.2, dry_level=0.9)),
    'bass': bus(bass.buf, pb.HighpassFilter(30), pb.Compressor(threshold_db=-20, ratio=4, attack_ms=5, release_ms=90),
                pb.PeakFilter(cutoff_frequency_hz=170, gain_db=2.5, q=1.0), pb.LowpassFilter(3500)),  # 170 Hz: note definition on small speakers
    'kick': bus(kick.buf, pb.HighpassFilter(32), pb.Reverb(room_size=0.15, wet_level=0.06, dry_level=1.0)),
    'clap': bus(clapT.buf, pb.HighpassFilter(250), pb.PeakFilter(cutoff_frequency_hz=1100, gain_db=2.0, q=0.9),
                pb.HighShelfFilter(cutoff_frequency_hz=6000, gain_db=-3.5), pb.Compressor(threshold_db=-18, ratio=3, attack_ms=3, release_ms=80),
                pb.Reverb(room_size=0.42, damping=0.3, wet_level=0.2, dry_level=0.9)),
    'perc': bus(perc.buf, pb.HighpassFilter(300), pb.Reverb(room_size=0.3, wet_level=0.1, dry_level=0.95)),
    'glock': bus(glk.buf, pb.HighpassFilter(500), pb.Delay(delay_seconds=0.375, feedback=0.15, mix=0.10),
                 pb.Reverb(room_size=0.65, damping=0.4, wet_level=0.26, dry_level=0.9)),
    'whistle': bus(whis.buf, pb.HighpassFilter(800), pb.Delay(delay_seconds=0.25, feedback=0.18, mix=0.1),
                   pb.Reverb(room_size=0.6, damping=0.5, wet_level=0.22, dry_level=0.92)),
    'choir': bus(ch.buf, pb.HighpassFilter(180), pb.LowpassFilter(7000),
                 pb.Reverb(room_size=0.85, damping=0.5, wet_level=0.35, dry_level=0.8)),
    'gang': bus(gng.buf, pb.HighpassFilter(140), pb.LowpassFilter(6000), pb.Compressor(threshold_db=-20, ratio=3),
                pb.Reverb(room_size=0.5, wet_level=0.2, dry_level=0.9)),
    'fx': bus(fxs.buf, pb.HighpassFilter(200), pb.Reverb(room_size=0.7, wet_level=0.25, dry_level=0.9)),
}
GAIN = {'gtr': 1.0, 'pick': 0.65, 'bass': 1.0, 'kick': 0.3, 'clap': 1.1, 'perc': 0.5, 'glock': 0.55,
        'whistle': 0.34, 'choir': 0.8, 'gang': 0.9, 'fx': 0.6}
if os.environ.get('INDIE_STEMS'):
    d = os.environ['INDIE_STEMS']
    os.makedirs(d, exist_ok=True)
    for k, v in mix_parts.items():
        np.save(os.path.join(d, k + '.npy'), (v * GAIN[k]).astype(np.float32))
    np.save(os.path.join(d, 'impact.npy'), imp.buf.astype(np.float32))
music = sum(mix_parts[k] * GAIN[k] for k in mix_parts)
write(NAME, music, imp.buf, {'lift_db': 4.0})
