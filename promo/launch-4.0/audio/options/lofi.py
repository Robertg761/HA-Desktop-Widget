"""LO-FI soundtrack option: cozy chillhop in F major, 120 BPM grid played as a 60 BPM half-time
boom-bap (kick on 1, snare laid back on beat 3 of every 2 s bar, swung hats).

Rhodes jazz voicings (maj9 / m9 / 13 / 7b9, voice-led automatically), round saturated sub bass that
walks with chromatic approach notes, a soft vibraphone motif (motor tremolo, ping-pong delay),
celesta + sleigh bells in the seasonal section, dark tape strings under the hook and finale,
vinyl crackle and tape wow throughout. Hits are a tape-thump kick + sub + dusty crash.

  python3 audio/options/lofi.py && python3 audio/master.py lofi && python3 audio/check_option.py lofi
"""
import os
import sys

import numpy as np
import pedalboard as pb
import soundfile as sf

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from engine import *  # noqa
from instruments import *  # noqa
from inst_lofi import (celesta, dusty_crash, lo_hat, lo_kick, lo_snare, lofi_bass, lofi_hit, pingpong,  # noqa
                       lo_ride, peak_tame, rev_swell, rhodes_note, sleigh, tape_pad, vibes)
from opt_common import bus, sidechain, track, write  # noqa
import cues  # noqa
from cues import BEAT, BAR, bar_t  # noqa

NAME = 'lofi'
rng = np.random.default_rng(907)
SW = 0.036    # swing: offbeat 8ths (the half-time feel's 16ths) land this late
SW16 = 0.018  # swing of the in-between 16ths (ghost hats)
LB = 0.011    # the snare sits back behind the beat


def hum(t, sd=0.0035):
    """A few ms early/late; downbeats and hits are placed without it."""
    return max(0.0, t + float(np.clip(rng.normal(0, sd), -0.008, 0.008)))


def hv(v, sd=0.08):
    return float(np.clip(v * (1 + rng.normal(0, sd)), 0.05, 1.1))


def e8(bar, k):
    """Time of the k-th 8th of `bar`, with swing on the offbeats."""
    return bar_t(bar) + k * 0.25 + (SW if k % 2 else 0.0)


def sec(bar):
    for nm, b0, b1, _ in cues.SECTIONS:
        if b0 <= bar < b1:
            return nm
    return 'end'


# ------------------------------------------------------------------ harmony (F major)
# name: (root pitch class, the rootless voicing's pitch classes)
CH = {
    'Fmaj9': (5, [9, 0, 4, 7]), 'Am9': (9, [7, 11, 0, 4]), 'Am7': (9, [7, 0, 4, 9]),
    'Dm9': (2, [5, 9, 0, 4]), 'Cm9': (0, [3, 7, 10, 2]), 'F13': (5, [3, 7, 9, 2]),
    'Bbmaj9': (10, [2, 5, 9, 0]), 'D7b9': (2, [6, 0, 3, 9]), 'Gm9': (7, [10, 2, 5, 9]),
    'Gm7': (7, [10, 2, 5, 7]), 'C9sus4': (0, [10, 2, 5, 7]), 'C13': (0, [10, 4, 9, 2]),
    'C13b9': (0, [4, 10, 1, 9]), 'C7b9': (0, [4, 10, 1, 7]), 'Bbm6': (10, [1, 5, 7, 0]),
    'Em7b5': (4, [2, 7, 10, 4]), 'A7b13': (9, [1, 7, 10, 5]), 'Fmaj7': (5, [9, 0, 4, 5]),
    # the Halloween line cliche: D - C# - C - B moving inside a D minor chord
    'Dmadd9': (2, [5, 9, 2, 4]), 'Dmmaj9': (2, [5, 9, 1, 4]), 'Dm69': (2, [5, 9, 11, 4]),
}
CHART = {
    1: 'Bbmaj9', 2: 'Am9', 3: 'Gm9', 4: [(0, 'C9sus4'), (2, 'C13')],                    # intro
    5: 'Fmaj9', 6: 'Am9', 7: 'Dm9', 8: [(0, 'Cm9'), (2, 'F13')],                        # drop
    9: 'Bbmaj9', 10: [(0, 'Am7'), (2, 'D7b9')], 11: 'Gm9', 12: [(0, 'C9sus4'), (2, 'C13b9')],
    13: 'Fmaj9', 14: 'Bbmaj9', 15: 'Gm9', 16: [(0, 'Em7b5'), (2, 'A7b13')],
    17: [(0, 'Dmadd9'), (2, 'Dmmaj9')], 18: [(0, 'Dm9'), (2, 'Dm69')],                 # Halloween
    19: 'Gm9', 20: [(0, 'C9sus4'), (2, 'C13')], 21: [(0, 'Fmaj9'), (2, 'Dm9')],         # holidays
    22: [(0, 'Fmaj7'), (1, 'D7b9'), (2, 'Gm7'), (3, 'C7b9')],                           # sleigh turnaround
    23: 'Bbmaj9', 24: 'Am9', 25: 'Gm9', 26: 'Fmaj9', 27: [(0, 'Bbmaj9'), (2, 'Bbm6')],  # features
    28: [(0, 'C9sus4'), (2, 'C13b9')],
    29: 'Fmaj9', 30: 'Am9', 31: 'Dm9', 32: [(0, 'Cm9'), (2, 'F13')], 33: 'Bbmaj9',      # hook
    34: [(0, 'Gm9'), (2, 'C13b9')],
    35: [(0, 'Fmaj9'), (2, 'Am7')], 36: [(0, 'Dm9'), (2, 'F13')],                       # rapid
    37: [(0, 'Bbmaj9'), (2, 'Bbm6')], 38: [(0, 'Gm9'), (2, 'C9sus4'), (3, 'C13b9')],
    39: 'Fmaj9', 40: [(0, 'Bbmaj9'), (2, 'Gm9'), (3, 'C13b9')],                         # finale
}


def segs(bar):
    c = CHART[bar]
    if isinstance(c, str):
        return [(0, 4, c)]
    return [(b, c[i + 1][0] if i + 1 < len(c) else 4, ch) for i, (b, ch) in enumerate(c)]


def voicings(pcs, lo=52, hi=72):
    out = []
    for rot in range(len(pcs)):
        order = pcs[rot:] + pcs[:rot]
        for base in range(48, 72):
            if base % 12 != order[0]:
                continue
            v = [base]
            for pc in order[1:]:
                v.append(v[-1] + ((pc - v[-1]) % 12 or 12))
            if lo <= v[0] and v[-1] <= hi:
                out.append(v)
            d2 = sorted(v[:-2] + [v[-2] - 12] + v[-1:])  # drop-2: wider, more Rhodes-like
            if lo - 2 <= d2[0] and d2[-1] <= hi:
                out.append(d2)
    return out


VOI = {}
prev = None
for bar in sorted(CHART):
    for b0, b1, ch in segs(bar):
        cands = voicings(CH[ch][1])
        if prev is None:
            v = min(cands, key=lambda c: abs(np.mean(c) - 61))
        else:
            v = min(cands, key=lambda c: sum(abs(a - b) for a, b in zip(c, prev)) + 0.35 * abs(np.mean(c) - 61)
                    + (6 if (c[1] - c[0] <= 2 and c[0] < 55) else 0))  # no muddy seconds down low
        # the tonic is played rooted (F3 A3 C4 E4 G4) so F reads on small speakers; the voice-leader
        # keeps following the rootless shape, so the chords around it keep their open voicings
        VOI[(bar, b0)] = [53, 57, 60, 64, 67] if ch == 'Fmaj9' else v
        prev = v
END_VOICING = [41, 48, 53, 57, 64, 67]  # F2 C3 F3 A3 E4 G4: lush, open, clearly rooted Fmaj9


def root_near(pc, ref, lo=29, hi=41):
    cands = [m for m in range(lo, hi + 1) if m % 12 == pc]
    return min(cands, key=lambda m: abs(m - ref))


# ------------------------------------------------------------------ tracks
keys, mallets, pad, bass, drums, drums_in, vinyl_t, fxt, fxswell, imp = (track() for _ in range(10))
KICKS = []


def rhodes(t, notes, dur, vel, roll=0.011, exact=False):
    for i, m in enumerate(notes):
        tt = t + i * roll * (0.7 + 0.6 * rng.random())
        keys.add(tt if (exact and i == 0) else hum(tt, 0.003), rhodes_note(m, dur, hv(vel * (0.92 if i else 1.0), 0.06)), 1.0)


# ------------------------------------------------------------------ Rhodes comping
SEC_VEL = {'intro': 0.44, 'drop': 0.52, 'seasonal': 0.47, 'features': 0.42, 'hook': 0.73,
           'rapid': 0.74, 'finale': 0.77}
for bar in range(1, 41):
    s = sec(bar)
    v0 = SEC_VEL[s]
    sg = segs(bar)
    for b0, b1, ch in sg:
        t0 = bar_t(bar) + b0 * BEAT
        L = (b1 - b0) * BEAT
        voi = VOI[(bar, b0)]
        vel = v0
        if bar in (5, 29, 39) and b0 == 0:
            vel = min(0.85, v0 + 0.18)  # the drop, hook and finale chords land harder
        if s in ('intro', 'features'):
            rhodes(t0, voi, L + 0.06, vel, roll=0.016 if s == 'intro' else 0.012, exact=b0 == 0)
            if s == 'intro' and bar <= 2:
                keys.add(t0, rhodes_note(root_near(CH[ch][0], 46, 41, 52), L + 0.06, 0.42), 1.0)
            continue
        # a soft left-hand root, so the harmony still reads where the sub bass does not (laptops)
        keys.add(t0 if b0 == 0 else hum(t0), rhodes_note(root_near(CH[ch][0], 46, 41, 52), min(L, 1.4) * 0.92, hv(0.3, 0.05), bark=0.6), 0.75)
        if len(sg) == 1:
            if bar % 2 == 1:  # A: hold, then a soft re-strike of the top three on beat 4
                rhodes(t0, voi, 1.35, vel, exact=True)
                rhodes(hum(t0 + 1.5), voi[1:], 0.42, vel * 0.62)
            else:             # B: short, then a syncopated re-strike on the swung 'and' of 2
                rhodes(t0, voi, 0.62, vel, exact=True)
                rhodes(t0 + 0.75 + SW, voi, 1.1, vel * 0.78)
        else:
            rhodes(t0, voi, L * (0.9 if L > BEAT else 0.85), vel * (1.0 if b0 == 0 else 0.9), exact=b0 % 2 == 0)
rhodes(cues.ENDCARD, END_VOICING, 6.0, 0.62, roll=0.028, exact=True)

# ------------------------------------------------------------------ bass
bl = []  # (t, midi, dur, vel)
ref = 36
for bar in range(3, 41):
    s = sec(bar)
    sg = segs(bar)
    nxt_pc = CH[segs(bar + 1)[0][2]][0] if bar + 1 in CHART else 5
    t0 = bar_t(bar)
    if s == 'intro':
        for b0, b1, ch in sg:
            r = root_near(CH[ch][0], ref)
            bl.append((t0 + b0 * BEAT, r, (b1 - b0) * BEAT - 0.05, 0.5))
            ref = r
        if bar == 4:  # chromatic lead-in (E) to the F under the drop
            bl.append((e8(bar, 7), root_near(nxt_pc, ref) - 1, 0.2, 0.45))
        continue
    if s == 'features':
        r = root_near(CH[sg[0][2]][0], ref)
        if len(sg) == 1:
            bl.append((t0, r, 1.4, 0.6))
            bl.append((e8(bar, 6), r + 7 if r + 7 <= 43 else r - 5, 0.42, 0.5))
        else:
            for b0, b1, ch in sg:
                r = root_near(CH[ch][0], ref)
                bl.append((t0 + b0 * BEAT, r, (b1 - b0) * BEAT - 0.06, 0.6))
                ref = r
        ref = r
        continue
    if len(sg) == 1:
        r = root_near(CH[sg[0][2]][0], ref)
        nr = root_near(nxt_pc, r)
        appr = nr - 1 if nr > r else (nr + 1 if nr < r else r + 7)
        if bar % 2 == 1:
            bl.append((t0, r, 1.2, 0.9))
            bl.append((hum(t0 + 1.25), r + 12 if r + 12 <= 45 else r, 0.2, 0.42))
            bl.append((e8(bar, 7), appr, 0.22, 0.66))
        else:
            bl.append((t0, r, 0.6, 0.85))
            bl.append((e8(bar, 3), r, 0.62, 0.66))
            bl.append((e8(bar, 6), r + 7 if r + 7 <= 43 else r - 5, 0.24, 0.55))
            bl.append((e8(bar, 7), appr, 0.22, 0.62))
        ref = r
    else:
        for i, (b0, b1, ch) in enumerate(sg):
            r = root_near(CH[ch][0], ref)
            L = (b1 - b0) * BEAT
            bl.append((t0 + b0 * BEAT, r, L * 0.85 if L >= 1 else L * 0.8, 0.85 if b0 == 0 else 0.75))
            ref = r
        if sg[-1][1] - sg[-1][0] >= 2 and bar not in (34, 38):
            nr = root_near(nxt_pc, ref)
            bl.append((e8(bar, 7), nr - 1 if nr > ref else nr + 1 if nr < ref else ref + 7, 0.2, 0.6))
# bar 34 (66-68): the bass walks up into the rapid cuts
bl = [b for b in bl if not (66.0 <= b[0] < 68.0)]
bl += [(66.0, 31, 0.45, 0.85), (e8(34, 2), 33, 0.22, 0.7), (e8(34, 3), 34, 0.22, 0.72), (67.0, 36, 0.45, 0.82),
       (e8(34, 6), 37, 0.22, 0.78), (e8(34, 7), 40, 0.2, 0.85)]
bl.sort()
BASS_SEC = {'drop': 0.88, 'seasonal': 0.94}  # the sub grows into the hook instead of booming from the drop
for i, (t, m, d, v) in enumerate(bl):
    if i + 1 < len(bl) and bl[i + 1][0] - t < 2.2:
        d = max(d, bl[i + 1][0] - t - 0.025)
    bass.add(t, lofi_bass(m, d, hv(v * BASS_SEC.get(sec(int(t // BAR) + 1), 1.0), 0.05)), 1.0)
# (the deep F1 under the hits comes from lofi_hit's tuned sub tail, a single tone, so nothing beats)

# ------------------------------------------------------------------ drums
LVL = {'intro': 0.7, 'drop': 0.82, 'seasonal': 0.8, 'features': 0.62, 'hook': 1.13, 'rapid': 1.13, 'finale': 1.22}
HAT_V = [0.55, 0.3, 0.44, 0.3, 0.5, 0.3, 0.44, 0.34]


def k_(trk, t, v):
    trk.add(t, lo_kick(hv(v, 0.05)), 0.88)
    KICKS.append(t)


def sn(trk, t, v, layer=False):
    trk.add(t, lo_snare(hv(v, 0.06)), 1.12)
    if layer:
        trk.add(t + 0.004, pan(snap(hv(v * 0.7)), 0.15), 0.5)


def hh(trk, t, v, open_=False, p=-0.35):
    trk.add(t, pan(lo_hat(hv(v, 0.1), open_), p), 2.0)


for bar in range(3, 41):
    s = sec(bar)
    lv = LVL[s]
    t0 = bar_t(bar)
    A = bar % 2 == 1
    if s == 'intro':  # muffled preview of the beat under the filtered Rhodes
        k_(drums_in, t0, 0.8)
        sn(drums_in, t0 + 1.0 + LB, 0.55)
        if bar == 4:
            k_(drums_in, e8(bar, 7), 0.5)
            sn(drums_in, e8(bar, 7) - 0.02, 0.3)
        for k in range(0, 8, 2):
            hh(drums_in, e8(bar, k), HAT_V[k] * 0.8)
        continue
    stop = 1.5 if bar == 38 else 9.0  # the breath: drums rest 75.5-76.0
    if s == 'features':
        k_(drums, t0, 0.62)
        if not A:
            k_(drums, e8(bar, 3), 0.4)
        drums.add(t0 + 1.0 + LB, pan(rim(hv(0.55)), 0.1), 0.9)
        drums.add(t0 + 1.0 + LB + 0.003, pan(snap(hv(0.42)), 0.1), 0.45)
        for k in range(8):
            hh(drums, e8(bar, k), HAT_V[k] * 0.62 * (0.7 if k % 2 else 1.0))
        if bar == 28:  # snare returns with a pickup fill into the hook
            sn(drums, t0 + 1.0 + LB, 0.6)
            for i, (tt, v) in enumerate([(1.5, 0.35), (1.625 + SW16, 0.4), (1.75 + SW, 0.5), (1.875 + SW16, 0.62)]):
                sn(drums, hum(t0 + tt, 0.002), v)
        continue
    # full half-time boom-bap
    if A:
        k_(drums, t0, 0.95 * lv)
        if bar not in (16, 34, 40):
            k_(drums, e8(bar, 7), 0.5 * lv)
    else:
        k_(drums, t0, 0.85 * lv)
        k_(drums, e8(bar, 3), 0.6 * lv)
    big = s in ('hook', 'rapid', 'finale')
    sn(drums, t0 + 1.0 + LB, 0.88 * lv, layer=big)
    if rng.random() < 0.45 and bar not in (16, 18, 22, 34, 38, 40):
        sn(drums, hum(t0 + 1.625 + SW16, 0.002), 0.16)  # ghost note
    open_on = ((bar % 4 == 0) or (s == 'finale')) and bar not in (16, 34, 38, 40)
    for k in range(8):
        tt = e8(bar, k)
        if tt - t0 >= stop:
            break
        if k == 7 and open_on:
            hh(drums, tt, 0.42 * lv, open_=True, p=-0.3)
            continue
        hh(drums, hum(tt, 0.0025) if k else tt, HAT_V[k] * lv)
        if big and k % 2 == 0 and rng.random() < 0.35 and tt - t0 + 0.125 < stop:
            hh(drums, t0 + k * 0.25 + 0.125 + SW16, 0.15 * lv)
    if s in ('rapid', 'finale'):  # a dusty ride on the beats lifts the last stretch
        for k in range(0, 8, 2):
            tt = e8(bar, k)
            if tt - t0 < stop:
                drums.add(tt if k == 0 else hum(tt, 0.003), pan(lo_ride(hv(0.5 if k % 4 == 0 else 0.38)), 0.35), 1.0)
    if big:  # shaker on the swung 8ths, panned right
        for k in range(8):
            tt = e8(bar, k)
            if tt - t0 < stop:
                drums.add(hum(tt, 0.003), pan(shaker(hv(0.5 if k % 2 == 0 else 0.34)), 0.45), 0.5)
    # fills
    if bar == 16:
        for tt, v in [(1.5, 0.3), (1.625 + SW16, 0.38), (1.75 + SW, 0.48), (1.875 + SW16, 0.58)]:
            sn(drums, hum(t0 + tt, 0.002), v)
    if bar == 18:
        for tt, v in [(1.5, 0.32), (1.75 + SW, 0.5)]:
            sn(drums, hum(t0 + tt, 0.002), v)
    if bar == 22:
        sn(drums, e8(bar, 7), 0.42)
    if bar in (34, 40):
        for i, tt in enumerate([1.25, 1.5, 1.625, 1.75, 1.875]):
            sn(drums, hum(t0 + tt + (SW16 if tt % 0.25 else 0), 0.002), 0.34 + 0.11 * i)
for h in cues.HITS:
    KICKS.append(h)

# ------------------------------------------------------------------ melody (vibraphone) & mallets
# phrases: (8th index, midi, length in 8ths)
MEL = [
    [(0, 72, 2), (2, 76, 1), (3, 79, 3), (6, 76, 1), (7, 74, 1)],        # Fmaj9   C E G E D (the motif)
    [(0, 72, 3), (3, 71, 1), (4, 69, 4)],                                # Am9
    [(0, 77, 2), (2, 76, 1), (3, 74, 2), (5, 72, 1), (6, 69, 2)],        # Dm9
    [(0, 70, 2), (2, 67, 2), (4, 69, 2), (6, 75, 2)],                    # Cm9 - F13
    [(0, 74, 2), (2, 77, 1), (3, 81, 3), (6, 79, 1), (7, 77, 1)],        # Bbmaj9  D F A G F (motif up a step)
    [(0, 76, 3), (3, 72, 1), (4, 78, 2), (6, 75, 2)],                    # Am7 - D7b9
    [(0, 74, 2), (2, 70, 1), (3, 69, 3), (6, 67, 1), (7, 69, 1)],        # Gm9
    [(0, 70, 2), (2, 72, 1), (3, 74, 1), (4, 76, 2), (6, 73, 2)],        # C9sus4 - C13b9 (Db -> C)
]
BUILD = [(k, m, 1) for k, m in enumerate([67, 69, 70, 74, 76, 79, 81, 82])]  # bar 34, up into 68.0
RAPID = [
    [(0, 81, 3), (3, 79, 1), (4, 76, 2), (6, 72, 2)],
    [(0, 77, 3), (3, 76, 1), (4, 75, 2), (6, 74, 2)],
    [(0, 74, 2), (2, 77, 1), (3, 81, 1), (4, 79, 2), (6, 77, 2)],
    [(0, 74, 2), (2, 70, 1), (3, 69, 1), (4, 77, 2), (6, 76, 2)],
]
FINALE = [MEL[0], [(0, 74, 1), (1, 77, 1), (2, 81, 2), (4, 82, 1), (5, 81, 1), (6, 79, 1), (7, 82, 1)]]
SEAS = [
    [(0, 82, 2), (2, 86, 1), (3, 89, 3), (6, 86, 1), (7, 84, 1)],        # Gm9: the motif on celesta
    [(0, 82, 3), (3, 81, 1), (4, 79, 2), (6, 76, 2)],
    [(0, 81, 2), (2, 84, 1), (3, 88, 3), (6, 86, 1), (7, 84, 1)],
    [(0, 84, 1), (1, 81, 1), (2, 84, 1), (3, 78, 1), (4, 82, 1), (5, 86, 1), (6, 85, 1), (7, 82, 1)],
]


def play(bar, phrase, vel, inst='vibes', dbl=None, p=0.0):
    for k, m, d in phrase:
        t = e8(bar, k)
        t = t if k == 0 else hum(t, 0.004)
        accent = 1.0 if k in (0, 3, 4) else 0.85
        v = hv(vel * accent, 0.07)
        if inst == 'vibes':
            mallets.add(t, pan(vibes(m, d * 0.25 + 0.15, v), p), 1.0)
        else:
            mallets.add(t, pan(celesta(m, v), p), 1.0)
        if dbl:
            mallets.add(t + 0.003, pan(glock(m + 12, v * dbl), -p - 0.2), 1.0)


# intro: the tile-light pings - rising F major / C13 tones on vibes, each with a glock glint
for t, m, p in zip(cues.GLOW_TIMES, [81, 74, 77, 79, 81, 82, 84, 86, 88], [0.0, -0.45, -0.3, -0.15, 0.0, 0.15, 0.3, 0.4, 0.5]):
    v = 0.56 if t == 1.5 else 0.46 + 0.035 * (t - 4.5)
    mallets.add(t, pan(vibes(m, 1.6 if t == 1.5 else 0.9, v, mallet=1.5), p), 1.0)
    mallets.add(t, pan(glock(m + 12, v * 0.42), p), 1.0)
# drop: the theme, stated softly; then an echo of the motif and the themes accent stabs
for i in (0, 1, 4, 5):  # call (bars 5-6) and answer (9-10); the full theme is saved for the hook
    play(5 + i, MEL[i], 0.44, p=-0.1)
play(13, [(0, 72, 2), (2, 76, 1), (3, 79, 5)], 0.44, p=-0.1)
play(14, [(2, 77, 1), (3, 81, 4)], 0.4, p=-0.1)
for t, notes in zip(cues.ACCENT_CUTS, [[74, 77], [77, 81], [79, 82], [79, 85]]):
    ts = t + SW if round(t / 0.25) % 2 else t  # offbeat stabs swing with the groove
    for j, m in enumerate(notes):
        mallets.add(ts + j * 0.006, pan(vibes(m, 0.5, 0.48), 0.2 - 0.4 * j), 1.0)
        mallets.add(ts, pan(glock(m + 12, 0.16), 0.3), 1.0)
# seasonal: the Halloween line cliche on celesta (D C# C B over A F A), then the holiday tune
for half, top in enumerate([86, 85, 84, 83]):
    bar = 17 + half // 2
    for j, m in enumerate([top, 81, 77, 81]):
        k = (half % 2) * 4 + j
        mallets.add(hum(e8(bar, k), 0.003) if k else e8(bar, k), pan(celesta(m, hv(0.42 if j == 0 else 0.3)), 0.25), 1.0)
for i in range(4):
    play(19 + i, SEAS[i], 0.42, inst='celesta', dbl=0.0, p=0.15)
    play(19 + i, [(k, m - 12, d) for k, m, d in SEAS[i]], 0.16, inst='vibes', p=-0.3)  # vibes an octave-down shadow
mallets.add(44.0, pan(celesta(81, 0.4), 0.15), 1.0)
# features: a sparse, quiet counter-line (and a soft low 'dim' note as the lights go down)
FEAT = {24: [(0, 76, 3), (3, 79, 1), (4, 72, 3)], 25: [(0, 69, 6)], 26: [(2, 72, 1), (3, 76, 1), (4, 79, 4)],
        27: [(2, 74, 1), (3, 77, 1), (4, 79, 2), (6, 77, 2)], 28: [(0, 70, 2), (2, 72, 1), (3, 74, 1), (4, 76, 2), (6, 73, 2)]}
for bar, ph in FEAT.items():
    play(bar, ph, 0.38, p=-0.15)
# hook: the full theme, doubled by glockenspiel an octave up; bar 34 runs up into the rapid cuts
for i in range(5):
    play(29 + i, MEL[i], 0.72, dbl=0.3, p=-0.05)
play(34, BUILD, 0.5, dbl=0.18, p=-0.05)
for i in range(4):
    play(35 + i, RAPID[i], 0.72, dbl=0.28, p=-0.05)
play(39, FINALE[0], 0.76, dbl=0.3, p=-0.05)
play(40, FINALE[1], 0.72, dbl=0.28, p=-0.05)
for bar, ph in ((39, FINALE[0]), (40, FINALE[1])):  # finale: Rhodes doubles the tune an octave down
    for k, m, d in ph:
        t = e8(bar, k)
        keys.add(t if k == 0 else hum(t, 0.004), rhodes_note(m - 12, d * 0.25 + 0.1, hv(0.5)), 0.75)
# end: the tune lands on A5 over a slowly rolled Fmaj9 on vibes
mallets.add(cues.ENDCARD, pan(vibes(81, 4.0, 0.52), -0.05), 1.0)
mallets.add(cues.ENDCARD + 0.004, pan(vibes(77, 4.0, 0.4), 0.1), 1.0)  # F5 under it: a sweet 3rd, rooted
mallets.add(cues.ENDCARD, pan(glock(89, 0.2), 0.2), 1.0)
for j, m in enumerate([65, 69, 72, 76, 79]):
    mallets.add(cues.ENDCARD + 0.06 + j * 0.045, pan(vibes(m, 4.0, 0.5 if m == 65 else 0.36), -0.5 + 0.25 * j), 1.0)

# ------------------------------------------------------------------ sleigh bells (holiday montage)
for bar in (19, 20, 21):
    for k in range(8):
        tt = e8(bar, k)
        cut = (k % 4 == 0)
        fxt.add(hum(tt, 0.003) if k else tt, pan(sleigh(hv(0.85 if cut else (0.5 if k % 2 == 0 else 0.36)), 0.14 if cut else 0.07), 0.35), 2.5)
for i in range(16):  # Christmas sleigh 42-44: running 16ths
    tt = bar_t(22) + i * 0.125 + (SW16 if i % 2 else 0)
    fxt.add(hum(tt, 0.002) if i % 4 else tt, pan(sleigh(hv([0.9, 0.4, 0.6, 0.45][i % 4]), 0.06), 0.35), 2.1)

# ------------------------------------------------------------------ tape-strings pad
PADG = {'drop': 0.35, 'seasonal': 0.55, 'features': 0.35, 'hook': 2.1, 'rapid': 2.2, 'finale': 2.6}
for bar in range(5, 41):
    s = sec(bar)
    for b0, b1, ch in segs(bar):
        L = (b1 - b0) * BEAT
        notes = [m for m in VOI[(bar, b0)]]
        pad.add(bar_t(bar) + b0 * BEAT, tape_pad(notes, L + 0.05, 0.5, attack=0.25 if L < 1.5 else 0.5, release=0.6), PADG[s])
pad.add(cues.ENDCARD, tape_pad([53, 60, 65, 69, 76], 4.5, 0.5, attack=0.4, release=2.0), 1.1)  # F3 C4 F4 A4 E5

# ------------------------------------------------------------------ swells / risers (build into every hit)


def rev_cym(dur):
    c = dusty_crash(dur + 0.3)[:, : n(dur)]
    return c[:, ::-1] * np.linspace(0.1, 1, n(dur))[None] ** 2


FM9 = [53, 60, 65, 69, 76]  # rooted, spread Fmaj7: the F4 survives the swell's high-pass
for t_hit, L, g, cym in [(8.0, 2.0, 0.55, 1.6), (32.0, 1.5, 0.35, 1.0), (44.0, 1.0, 0.2, 0.8),
                          (56.0, 2.0, 0.45, 1.2), (68.0, 2.0, 0.5, 1.5), (76.0, 2.0, 0.6, 1.5), (80.0, 1.0, 0.4, 1.0)]:
    voi = {32.0: VOI[(17, 0)], 44.0: VOI[(23, 0)]}.get(t_hit, FM9)
    sw = rev_swell(voi, L, 0.6) * (0.62 if voi is FM9 else 1.0)  # the spread voicing passes more of the high-pass
    fxswell.add(t_hit - L, np.vstack([sosfilt(ch, 'highpass', 260, 2) for ch in sw]), g)
    fxt.add(t_hit - cym, rev_cym(cym), 0.32 * g / 0.5)
for t_hit, L in [(68.0, 2.0), (76.0, 2.0)]:
    r = riser(L, 300, 5000, pitch=False)
    fxt.add(t_hit - L, np.vstack([sosfilt(ch, 'lowpass', 6000, 2) for ch in r]), 0.09)

# ------------------------------------------------------------------ vinyl crackle
vin = vinyl(cues.DUR, density=6.0, hiss=0.012)
tt = np.arange(vin.shape[1]) / SR
vg = np.interp(tt, [0, 7.9, 8.1, 79.5, 80.5, 87], [1.0, 1.0, 0.85, 0.85, 0.9, 0.9])
vinyl_t.add(0.0, vin * vg[None], 1.0)

# ------------------------------------------------------------------ hits (impact stem)
imp.add(cues.DROP, lofi_hit(3.0, crash_amt=1.0, snare_amt=0.5, sub_amt=0.75, body_tau=0.6), 1.0)
imp.add(cues.FINALE, lofi_hit(3.5, crash_amt=1.0, snare_amt=0.6, sub_amt=0.75, body_tau=0.65), 1.0)
imp.add(cues.ENDCARD, lofi_hit(5.0, crash_amt=0.9, snare_amt=0.35, sub_amt=0.7, body_tau=1.3), 1.0)  # one tuned F1 rings out

# ------------------------------------------------------------------ mix


def keys_cut(t):
    if t < 8.0:
        return 520 * (1900 / 520) ** (max(0.0, t - 2.5) / 5.5)
    if t < 44.0:
        return 7000
    if t < 47.75:
        return 3200
    if t < 54.0:  # 'Enter dims the lights': the keys darken, then recover
        x = t - 47.75
        return 3200 - 1900 * np.exp(-x / 1.6) * min(1.0, x / 0.25)
    if t < 56.0:
        return 3200 * (8000 / 3200) ** ((t - 54.0) / 2.0)
    if t < 82.0:
        return 8000
    return 8000 * (2600 / 8000) ** (min(1.0, (t - 82.0) / 4.0))


def drums_in_cut(t):
    return 260 * (1100 / 260) ** (np.clip((t - 4.0) / 4.0, 0, 1) ** 1.5)


K = sorted(KICKS)
keys_b = ladder_sweep(keys.buf, keys_cut, resonance=0.12)
keys_b = lofi(keys_b, bits=12, cutoff=9000, wow=0.6)
keys_b = bus(keys_b, pb.HighpassFilter(90), pb.PeakFilter(cutoff_frequency_hz=320, gain_db=-3.0, q=0.9),
             pb.PeakFilter(cutoff_frequency_hz=1800, gain_db=2.0, q=0.7), pb.HighShelfFilter(cutoff_frequency_hz=2500, gain_db=3.0),
             pb.Chorus(rate_hz=0.5, depth=0.15, centre_delay_ms=8, feedback=0.0, mix=0.45),
             pb.Reverb(room_size=0.55, damping=0.6, wet_level=0.2, dry_level=0.85, width=0.8))
keys_b = sidechain(keys_b, K, depth=0.22, release=0.18)
_t = np.arange(keys_b.shape[1]) / SR
keys_b = keys_b * np.interp(_t, [0, 4.0, 7.95, 8.0], [0.6, 0.72, 0.95, 1.0])[None]  # the intro grows

mal = mallets.buf + pingpong(mallets.buf, 0.375, 0.36, 6, 3000) * 0.42
mal = lofi(mal, bits=12, cutoff=9500, wow=0.45)
mal = bus(mal, pb.HighpassFilter(200), pb.Reverb(room_size=0.75, damping=0.55, wet_level=0.26, dry_level=0.85, width=0.9))

pad_b = lofi(pad.buf, bits=12, cutoff=3600, wow=0.9)
pad_b = bus(pad_b, pb.HighpassFilter(230), pb.Reverb(room_size=0.85, damping=0.5, wet_level=0.32, dry_level=0.8, width=1.0))
pad_b = sidechain(pad_b, K, depth=0.38, release=0.2)

bass_b = softclip(bass.buf * 1.6, 1.5) * 0.7
bass_b = bus(bass_b, pb.HighpassFilter(30), pb.LowShelfFilter(cutoff_frequency_hz=80, gain_db=-2.0), pb.LowpassFilter(900), pb.Compressor(threshold_db=-16, ratio=2.5, attack_ms=12, release_ms=120))
bass_b = sidechain(bass_b, K, depth=0.28, release=0.12)

drm = drums.buf + ladder_sweep(drums_in.buf, drums_in_cut, resonance=0.1)
drm = bus(drm, pb.HighpassFilter(35), pb.LowShelfFilter(cutoff_frequency_hz=90, gain_db=-1.5), pb.Compressor(threshold_db=-18, ratio=3.0, attack_ms=9, release_ms=110),
          pb.Bitcrush(bit_depth=12), pb.LowpassFilter(10500),
          pb.Reverb(room_size=0.25, damping=0.7, wet_level=0.08, dry_level=1.0, width=0.6))

fx_b = bus(fxt.buf + fxswell.buf * 0.45, pb.Reverb(room_size=0.7, damping=0.5, wet_level=0.18, dry_level=0.9, width=0.9))

STEMS = {'keys': (keys_b, 0.62), 'mallets': (mal, 0.95), 'pad': (pad_b, 0.55), 'bass': (bass_b, 0.74),
         'drums': (drm, 1.0), 'vinyl': (vinyl_t.buf, 0.75), 'fx': (fx_b, 0.7)}
music = sum(x * g for x, g in STEMS.values())
music = bus(music, pb.PeakFilter(cutoff_frequency_hz=300, gain_db=-1.0, q=0.8),
            pb.HighShelfFilter(cutoff_frequency_hz=3000, gain_db=2.0), pb.LowpassFilter(15000))
music = music / (np.abs(music).max() + 1e-9)
music = peak_tame(music, 0.56)  # shave the mallet / snare spikes so the groove, not the transients, sets the level

if os.environ.get('LOFI_STEMS'):
    d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'opt_lofi', 'stems')
    os.makedirs(d, exist_ok=True)
    for k, (x, g) in STEMS.items():
        sf.write(os.path.join(d, f'{k}.wav'), (np.asarray(x) * g).T.astype(np.float32), SR, subtype='FLOAT')

write(NAME, music, imp.buf, {'lift_db': 4.0})
