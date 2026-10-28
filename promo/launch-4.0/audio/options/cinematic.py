"""CINEMATIC soundtrack option: hybrid orchestral, epic and uplifting (keynote / trailer cue).

D major, 120 BPM on the cue-sheet grid (harmony mostly one chord per bar, so it breathes like a
60 BPM anthem while the spiccato strings drive in 8ths and gallops).
  intro    soft strings, a sparse piano stating the motif (A-D-E-F#), celesta/glock tile pings
  drop     hit on the title; spiccato ostinato, taiko, horns take the motif, dotted-quarter stabs
  seasonal Halloween in B minor (tremolo strings, creeping pizz, celesta), then sleigh bells,
           glock motif and bouncing pizzicato for the holiday montage, tubular bells on Christmas
  features piano ostinato, soft pulse, lights dim at 47.75, then a horn swell into the hook
  hook     full statement: violins + horns melody, choir 'aah', taiko; bar 34 builds
  rapid    ensemble stabs on every cut, motif an octave up, drums breathe 75.5-76
  finale   choir and full orchestra, motif augmented, resolves to a wide D major at 80
Render: python3 audio/options/cinematic.py && python3 audio/master.py cinematic && python3 audio/check_option.py cinematic
"""
import itertools
import os
import sys

import numpy as np
import pedalboard as pb

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from engine import SR, n, reverse_crash, riser  # noqa
from instruments import piano, glock  # noqa
from opt_common import bus, track, write  # noqa
from inst_cinematic import (bowed, boom, brass_sec, celesta, choir_aah, convolve, crash_cym, cym_swell, hall_ir,  # noqa
                            pizz, place, pulse, sleigh, snare_roll, spic, taiko_ens, timp, tom, tubular)
import cues  # noqa
from cues import BEAT, BAR, bar_t  # noqa

NAME = 'cinematic'
R = np.random.default_rng(2026)
VERBOSE = '--stems' in sys.argv

TR = {k: track() for k in ('pad', 'low', 'vln', 'spic', 'pizz', 'horn', 'tbn', 'choir', 'piano', 'bells',
                           'sleigh', 'taiko', 'timp', 'cym', 'synth')}
imp = track()


def add(name, t, x, gain=1.0):
    TR[name].add(t, x, gain)


def J(t, ms=5.0):
    """Humanise a time by a few ms; bar downbeats and the hits stay tight."""
    if abs(t / BAR - round(t / BAR)) < 1e-6:
        return t
    return t + float(np.clip(R.normal(0, ms / 2000), -ms / 1000, ms / 1000))


def V(v, spread=0.07):
    return v * float(np.clip(1 + R.normal(0, spread), 0.8, 1.15))


PC = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def nm(s):
    return 12 * (int(s[-1]) + 1) + PC[s[:-1]]


# ---------------------------------------------------------------- harmony
CHORDS = {  # pitch classes (root first, then the colour tones), bass pitch class
    'D': ([2, 6, 9], 2), 'D/F#': ([2, 6, 9], 6), 'G/D': ([7, 11, 2], 2), 'Bm': ([11, 2, 6], 11),
    'Bm7': ([11, 2, 6, 9], 11), 'G': ([7, 11, 2], 7), 'Gmaj7': ([7, 11, 2, 6], 7), 'A': ([9, 1, 4], 9),
    'Asus4': ([9, 2, 4], 9), 'A/C#': ([9, 1, 4], 1), 'A7': ([9, 1, 4, 7], 9), 'Em7': ([4, 7, 11, 2], 4),
    'Em/G': ([4, 7, 11], 7), 'F#7': ([6, 10, 1, 4], 6),
}
CHART = {
    1: 'D', 2: 'G/D', 3: 'Bm7', 4: [(0, 'Asus4'), (2, 'A')],
    5: 'D', 6: 'Bm', 7: 'G', 8: 'A', 9: 'D', 10: 'Bm', 11: 'G', 12: 'A',
    13: 'Em7', 14: 'D/F#', 15: 'G', 16: [(0, 'Asus4'), (1, 'A')],
    17: 'Bm', 18: [(0, 'Em/G'), (2, 'F#7')], 19: 'D', 20: 'A/C#', 21: 'Bm', 22: [(0, 'G'), (2, 'A7')],
    23: 'D', 24: 'Bm7', 25: 'Gmaj7', 26: 'D/F#', 27: 'Em7', 28: [(0, 'Asus4'), (2, 'A')],
    29: 'D', 30: 'A/C#', 31: 'Bm', 32: 'G', 33: 'Em7', 34: [(0, 'Asus4'), (2, 'A')],
    35: 'D', 36: 'A/C#', 37: 'Bm', 38: [(0, 'G'), (2, 'A')],
    39: 'D', 40: [(0, 'G'), (2, 'Asus4'), (3, 'A')], 41: 'D', 42: 'D', 43: 'D',
}
EVENTS = []  # (t0, t1, chord)
for bar in range(1, 44):
    e = CHART[bar]
    e = [(0, e)] if isinstance(e, str) else e
    for i, (b, c) in enumerate(e):
        t0 = bar_t(bar) + b * BEAT
        t1 = bar_t(bar) + (e[i + 1][0] * BEAT if i + 1 < len(e) else BAR)
        if EVENTS and EVENTS[-1][2] == c:
            EVENTS[-1] = (EVENTS[-1][0], t1, c)
        else:
            EVENTS.append((t0, t1, c))


def chord_at(t):
    for t0, t1, c in EVENTS:
        if t0 <= t + 1e-6 < t1:
            return c
    return 'D'


def lead(prev, pcs, bass_pc, prev_bass, bass):
    """Choose the next 4-voice upper voicing: chord tones within a 4th of each previous voice,
    3rd (and 7th) present, no unisons, smallest total motion, no parallel 5ths/8ves (bass too),
    no doubled bass-3rd, sensible spacing."""
    req = {pcs[1]} | ({pcs[3]} if len(pcs) > 3 else set()) | ({pcs[0]} if bass_pc != pcs[0] else set())
    cands = [[m for m in range(p - 5, p + 6) if m % 12 in pcs] for p in prev]
    best = None
    for combo in itertools.product(*cands):
        v = sorted(combo)
        if len(set(v)) < 4 or v[0] < 52 or v[-1] > 76 or not req <= {m % 12 for m in v}:
            continue
        cost = sum(abs(a - b) for a, b in zip(v, prev))
        cost += sum(3 for a, b in zip(v, v[1:]) if b - a > 9)
        if bass_pc != pcs[0] and sum(1 for m in v if m % 12 == bass_pc) > 0:
            cost += 4
        if sum(1 for m in v if m % 12 == pcs[1]) > 1:
            cost += 3
        old = [prev_bass] + list(prev)
        new = [bass] + v
        for i in range(5):
            for j in range(i + 1, 5):
                io, inn = (old[j] - old[i]) % 12, (new[j] - new[i]) % 12
                if io == inn and io in (0, 7) and old[i] != new[i]:
                    cost += 8
        if best is None or cost < best[0]:
            best = (cost, v)
    return best[1]


VOICING = []  # (t0, t1, chord, voicing, bass)
prev, pb_ = [57, 62, 66, 69], 38
for t0, t1, c in EVENTS:
    pcs, bpc = CHORDS[c]
    opts = [m for m in range(30, 46) if m % 12 == bpc]
    bass = min(opts, key=lambda m: (abs(m - pb_), m))
    if c == 'D' and t0 in (bar_t(5), bar_t(29), bar_t(35), cues.FINALE, cues.ENDCARD, 0.0):
        bass = 38
    v = prev if not VOICING else lead(prev, pcs, bpc, pb_, bass)
    if t0 == 78.0:  # finale: melody F# over G; no G4 a semitone above the horns' F#4 (Gmaj7 colour instead)
        v = [55, 62, 71, 74]  # G3 D4 B4 D5
    VOICING.append((t0, t1, c, v, bass))
    prev, pb_ = v, bass


def voicing_at(t):
    for t0, t1, c, v, b in VOICING:
        if t0 <= t + 1e-6 < t1:
            return v, b
    return VOICING[-1][3], VOICING[-1][4]


DIATONIC = {2, 4, 6, 7, 9, 11, 1}


def inten(t):
    pts = [(0, 0.25), (6, 0.45), (8, 0.85), (28, 0.9), (32, 0.55), (36, 0.62), (44, 0.42), (48, 0.36), (52, 0.5),
           (56, 0.92), (66, 1.0), (76, 1.0), (80, 0.9), (87, 0.7)]
    return float(np.interp(t, *zip(*pts)))


def section_of(t):
    for nm_, b0, b1, _ in cues.SECTIONS:
        if bar_t(b0) <= t < bar_t(b1):
            return nm_
    return 'end'


def halloween(t):
    return 32.0 <= t < 36.0


RESTRIKE = {8.0, 32.0, 36.0, 44.0, 56.0, 68.0, 76.0, 80.0}

# ---------------------------------------------------------------- sustained strings (4 voice lines)
for vi in range(4):
    segs = []
    for t0, t1, c, v, b in VOICING:
        m = v[vi]
        if segs and segs[-1][2] == m and t0 not in RESTRIKE:
            segs[-1][1] = t1
        else:
            segs.append([t0, t1, m])
    for t0, t1, m in segs:
        sec = section_of(t0)
        if vi == 3 and sec == 'hook':
            continue  # leave the D5-B5 register to the melody; the choir still sings the full voicing
        I = inten(t0)
        if sec == 'end':
            t1 = 86.6
        d = t1 - t0 + 0.06
        kw = dict(attack=0.25, release=0.6, bright=0.5)
        vel = 0.28 + 0.55 * I
        if sec == 'intro':
            kw.update(attack=1.2 if t0 < 1 else 0.6, bright=0.32, cresc=0.55 if t0 >= 6 else None)
            vel = 0.3 + 0.2 * (t0 / 8)
        elif halloween(t0):
            kw.update(trem=0.8, bright=0.42, attack=0.3)
            vel = 0.5
        elif sec == 'seasonal':
            kw.update(bright=0.45, attack=0.3)
            vel = 0.42
        elif sec == 'features':
            kw.update(bright=0.3 if 48 <= t0 < 52 else 0.36, attack=0.4)
            vel = 0.34 if 48 <= t0 < 52 else 0.4
            if t0 >= 52:
                kw.update(cresc=0.6)
                vel = 0.5
        elif sec in ('hook', 'rapid', 'finale'):
            kw.update(bright=0.6, attack=0.15)  # the builds (66-68, 74-76) are a track ride, see build_ride()
        elif sec == 'end':
            kw.update(attack=0.06, release=2.5, bright=0.55)
            vel = 0.8
        if t0 in (8.0, 56.0, 68.0, 76.0):
            kw.update(attack=0.05)
        x = bowed(m, d, V(vel, 0.04), players=5, **kw)
        add('pad', J(t0, 3), place(x, -0.15 + 0.2 * vi, 0.8), 1.0)

# ---------------------------------------------------------------- basses / celli (sustained lines with passing tones)
low_notes = []  # (t, dur, midi)
for k, (t0, t1, c, v, b) in enumerate(VOICING):
    sec = section_of(t0)
    nxt = VOICING[k + 1][4] if k + 1 < len(VOICING) else None
    end = t1
    passing = None
    if sec in ('drop', 'hook', 'rapid', 'features') and nxt is not None and abs(nxt - b) >= 3 and abs(t1 / BAR - round(t1 / BAR)) < 1e-6 and t1 - t0 >= BAR:
        step = -1 if nxt > b else 1
        p = nxt + step
        if p % 12 not in DIATONIC:
            p += step
        passing = (t1 - BEAT, BEAT, p)
        end = t1 - BEAT
    if sec == 'end':
        end = 86.6
    low_notes.append((t0, end - t0, b))
    if passing:
        low_notes.append(passing)
merged = []
for t, d, m in low_notes:
    if merged and merged[-1][2] == m and abs(merged[-1][0] + merged[-1][1] - t) < 1e-6 and t not in RESTRIKE:
        merged[-1][1] += d
    else:
        merged.append([t, d, m])
for t, d, m in merged:
    sec = section_of(t)
    I = inten(t)
    if sec == 'seasonal' and t >= 36:  # holiday montage: pizzicato basses instead
        continue
    att = 1.2 if t < 1 else (0.06 if t in RESTRIKE else 0.12)
    rel = 2.5 if sec == 'end' else 0.4
    vel = (0.35 if sec == 'intro' else 0.3 + 0.55 * I)
    cb = bowed(m, d + 0.04, V(vel, 0.04), attack=att, release=rel, players=4, bright=0.45, detune=5)
    add('low', J(t, 3), place(cb, 0.25, 0.5), 1.0)
    if sec in ('intro', 'seasonal', 'features', 'end'):  # celli an octave up where they are not playing spiccato
        vc = bowed(m + 12, d + 0.04, V(vel * 0.8, 0.04), attack=att, release=rel, players=4, bright=0.45, detune=5)
        add('low', J(t, 3), place(vc, 0.4, 0.5), 0.8)
add('low', cues.ENDCARD, place(bowed(26, 6.5, 0.6, attack=0.08, release=2.5, players=3, bright=0.35), 0.2, 0.4), 0.8)

# ---------------------------------------------------------------- spiccato ostinato
HI_PAT = [(0, 1, 1.0), (0.5, 3, 0.62), (0.75, 3, 0.52), (1.0, 2, 0.8), (1.5, 3, 0.62), (2.0, 1, 0.95), (2.5, 3, 0.62),
          (2.75, 3, 0.52), (3.0, 2, 0.8), (3.5, 3, 0.68)]
LO_PAT = [(0, 0, 1.0), (0.5, 12, 0.6), (0.75, 12, 0.5), (1, 0, 0.8), (1.5, 12, 0.6), (1.75, 12, 0.5), (2, 0, 0.95),
          (2.5, 12, 0.6), (2.75, 12, 0.5), (3, 0, 0.8), (3.5, 12, 0.62), (3.75, 12, 0.55)]
FEAT_LO = [(b * 0.5, 0, 0.9 if b % 2 == 0 else 0.6) for b in range(8)]


def spic_bar(bar, pat_hi, pat_lo, vh, vl, bright=0.6, rest_after=None):
    t0 = bar_t(bar)
    for b, idx, acc in pat_hi or []:
        t = t0 + b * BEAT
        if rest_after is not None and t >= rest_after:
            continue
        v, _ = voicing_at(t)
        add('spic', J(t, 4), place(spic(v[idx], V(vh * acc), bright), -0.35 + 0.15 * idx, 0.7), 1.0)
    for b, off, acc in pat_lo or []:
        t = t0 + b * BEAT
        if rest_after is not None and t >= rest_after:
            continue
        _, bass = voicing_at(t)
        m = bass + 12 + off
        while m > 57:
            m -= 12
        add('spic', J(t, 4), place(spic(m, V(vl * acc), bright * 0.85), 0.45, 0.6), 1.0)


for bar in range(5, 17):
    spic_bar(bar, HI_PAT, LO_PAT, 0.75 + 0.15 * (bar >= 13), 0.8, 0.55 + 0.05 * (bar >= 13))
for bar in range(23, 29):  # features: soft and darker, celli 8ths; violins join for the build
    spic_bar(bar, HI_PAT if bar >= 27 else None, FEAT_LO, 0.35 + 0.15 * (bar - 27), 0.42, 0.35)
for bar in range(29, 41):
    rest = cues.BREATH if bar == 38 else None
    spic_bar(bar, HI_PAT, LO_PAT, 0.85 + 0.1 * (bar >= 35), 0.85 + 0.1 * (bar >= 35), 0.62, rest)

# ---------------------------------------------------------------- melody (violins) and horns
HOOK = [('A4', 55.75, 0.25),
        ('D5', 56.0, 0.75), ('E5', 56.75, 0.25), ('F#5', 57.0, 1.0),
        ('E5', 58.0, 0.75), ('D5', 58.75, 0.25), ('C#5', 59.0, 0.5), ('A4', 59.5, 0.5),
        ('B4', 60.0, 0.75), ('C#5', 60.75, 0.25), ('D5', 61.0, 0.5), ('F#5', 61.5, 0.5),
        ('G5', 62.0, 0.75), ('F#5', 62.75, 0.25), ('E5', 63.0, 0.5), ('D5', 63.5, 0.5),
        ('E5', 64.0, 0.75), ('F#5', 64.75, 0.25), ('G5', 65.0, 0.5), ('B5', 65.5, 0.5),
        ('A5', 66.0, 1.5), ('B5', 67.5, 0.25), ('C#6', 67.75, 0.25)]
RAPID = [('D6', 68.0, 0.75), ('E6', 68.75, 0.25), ('F#6', 69.0, 1.0),
         ('E6', 70.0, 0.75), ('D6', 70.75, 0.25), ('C#6', 71.0, 0.5), ('A5', 71.5, 0.5),
         ('B5', 72.0, 0.75), ('C#6', 72.75, 0.25), ('D6', 73.0, 0.5), ('F#6', 73.5, 0.5),
         ('G6', 74.0, 0.75), ('F#6', 74.75, 0.25), ('E6', 75.0, 0.75), ('A5', 75.75, 0.25)]
FINALE = [('D6', 76.0, 1.5), ('E6', 77.5, 0.5), ('F#6', 78.0, 1.0), ('E6', 79.0, 1.0)]
DROP_HORN = [('A3', 15.75, 0.25), ('D4', 16.0, 0.75), ('E4', 16.75, 0.25), ('F#4', 17.0, 1.0),
             ('F#4', 18.0, 0.75), ('E4', 18.75, 0.25), ('D4', 19.0, 0.5), ('B3', 19.5, 0.5),
             ('D4', 20.0, 0.75), ('E4', 20.75, 0.25), ('G4', 21.0, 0.5), ('F#4', 21.5, 0.5),
             ('E4', 22.0, 2.0)]


def phrase_vel(i, total, base, t):
    return base * (0.9 + 0.1 * np.sin(np.pi * i / max(1, total - 1)))


def play_line(notes, track_name, inst, base, shift=0, pan=0.0, gain=1.0):
    for i, (s, t, d) in enumerate(notes):
        m = nm(s) + shift
        v = V(phrase_vel(i, len(notes), base, t), 0.05)
        x = inst(m, d + 0.07, v)
        add(track_name, J(t, 4), place(x, pan, 0.6), gain)


def violin(m, d, v):
    return bowed(m, d, v, attack=0.07, release=0.35, players=6, bright=0.62, spread=0.5, vib=2.5)


def violin_hold(m, d, v, cresc=None):
    return bowed(m, d, v, attack=0.07, release=0.6, players=6, bright=0.62, spread=0.5, cresc=cresc, vib=2.5)


def horn(m, d, v):
    return brass_sec([m], d, v, attack=0.06, release=0.3, players=3, kind='horn')


# hook: violins I (melody), violins II an octave below at a lower level, horns an octave below
play_line(HOOK, 'vln', violin, 0.85, 0, -0.5)
play_line(HOOK, 'vln', violin, 0.6, -12, -0.25, 0.55)
play_line(HOOK, 'horn', horn, 0.8, -12, -0.3)
# rapid: the weight on the octave below (D5-G5, the warm violin register), the top octave as shine
play_line(RAPID, 'vln', violin, 0.6, 0, -0.5, 0.5)
play_line(RAPID, 'vln', violin, 0.85, -12, -0.25, 0.9)
play_line(RAPID, 'horn', horn, 0.85, -24, -0.3)
# finale: the motif augmented, everyone
for s, t, d in FINALE:
    m = nm(s)
    add('vln', t, place(violin_hold(m, d + 0.07, 0.95), -0.5, 0.6), 0.7)
    add('vln', t, place(violin_hold(m - 12, d + 0.07, 0.9), -0.25, 0.6), 0.9)
    add('horn', t, place(brass_sec([m - 24], d + 0.07, 0.95, attack=0.06, kind='horn'), -0.3, 0.6), 1.0)
# drop: horns state the motif (bars 9-12)
play_line(DROP_HORN, 'horn', horn, 0.75, 0, -0.3)
# drop bars 13-14: violins I soar an octave over the top voice
for bar in (13, 14):
    v, _ = voicing_at(bar_t(bar))
    add('vln', bar_t(bar), place(violin_hold(v[3] + 12, BAR + 0.05, 0.6, cresc=0.7 if bar == 14 else None), -0.5, 0.6), 0.7)
# intro air: very soft high violins on A5 / D6 (harmonic shimmer)
add('vln', 0.0, place(bowed(81, 7.9, 0.22, attack=2.5, release=0.5, players=4, bright=0.3), -0.4, 0.8), 0.6)
add('vln', 4.0, place(bowed(86, 3.9, 0.22, attack=1.5, release=0.4, players=4, bright=0.3, cresc=0.5), -0.5, 0.8), 0.5)
# end chord: violins A5 + D6
for m in (81, 86):
    add('vln', cues.ENDCARD, place(bowed(m, 6.4, 0.7, attack=0.06, release=2.5, players=6, bright=0.5), -0.45, 0.7), 0.6)


# ---------------------------------------------------------------- brass chords, stabs and swells
def chord_tones(t, low=45, high=62, nvo=3):
    """A brass voicing of the chord at t: bass + upper voices folded into [low, high]."""
    v, b = voicing_at(t)
    out = sorted({(m - 12 if m - 12 >= low else m) for m in v if low <= m - 12 <= high or low <= m <= high})
    return out[-nvo:]


def tbn(t, d, vel, cresc=None, attack=0.05, release=0.35, low=True):
    v, b = voicing_at(t)
    upper = [m - 12 if m - 12 >= 50 else m for m in v[:3]]          # 3rds/5ths no lower than D3
    upper = [m for m in upper if m % 12 != b % 12 or m == b + 12]   # do not stack the bass pitch class
    third = CHORDS[chord_at(t)][0][1]
    if not any(m % 12 == third for m in upper + [b]):             # keep the 3rd (e.g. the A swell at 75.0)
        upper.append(next(m for m in range(52, 70) if m % 12 == third))
    notes = [b + 12] + upper
    if low:
        notes = [b] + notes
    x = brass_sec(sorted(set(notes)), d, vel, attack=attack, release=release, players=2, cresc=cresc, kind='tbn')
    add('tbn', t, place(x, 0.35, 0.6), 1.0)


def hornchord(t, d, vel, cresc=None, attack=0.08, release=0.4):
    v, b = voicing_at(t)
    x = brass_sec(v[:3], d, vel, attack=attack, release=release, players=2, cresc=cresc, kind='horn')
    add('horn', t, place(x, -0.3, 0.6), 0.8)


# intro: horns swell on Asus4 -> A into the drop
add('horn', 6.0, place(brass_sec([57, 62, 64], 1.05, 0.45, attack=0.4, cresc=0.3, kind='horn'), -0.3, 0.6), 0.8)
add('horn', 7.0, place(brass_sec([57, 61, 64], 1.05, 0.7, attack=0.05, cresc=0.5, release=0.2, kind='horn'), -0.3, 0.6), 0.8)
# hits: brass braam / chord at each hit (the boom itself is in the impact stem)
tbn(cues.DROP, 2.0, 0.95, attack=0.02, release=1.2)
hornchord(cues.DROP, 1.6, 0.9, attack=0.03)
# drop bars 13-14 horn swells, bars 15-16 dotted-quarter stabs on the accent cuts
hornchord(bar_t(13), BAR, 0.55, cresc=0.4, attack=0.3)
hornchord(bar_t(14), BAR, 0.65, cresc=0.4, attack=0.3)
for t in cues.ACCENT_CUTS:
    tbn(t, 0.45, 0.85, attack=0.015, release=0.3)
    hornchord(t, 0.45, 0.8, attack=0.02, release=0.3)
hornchord(31.5, 0.55, 0.6, cresc=0.3, attack=0.2, release=0.3)  # swell into the seasonal section
# Christmas into features: soft horn swell
hornchord(43.0, 1.0, 0.4, cresc=0.3, attack=0.4, release=0.4)
# features build: horns swell Em7 -> Asus4 -> A, trombones join
hornchord(bar_t(27), BAR, 0.45, cresc=0.3, attack=0.5)
hornchord(bar_t(28), 1.0, 0.6, cresc=0.4, attack=0.2)
hornchord(bar_t(28) + 1.0, 1.0, 0.75, cresc=0.5, attack=0.05, release=0.25)
tbn(bar_t(28), BAR, 0.55, cresc=0.2, attack=0.4, release=0.25, low=False)
# hook: trombones sustain soft low chords, swell hard in bar 34
for bar in range(29, 34):
    tbn(bar_t(bar), BAR + 0.05, 0.4 + 0.04 * (bar - 29), attack=0.15, release=0.3, low=False)
tbn(65.0, 0.4, 0.75, attack=0.015, release=0.25, low=False)  # accent on the Omarchy cut
tbn(66.0, 1.0, 0.55, cresc=0.35, attack=0.2, release=0.1, low=False)
tbn(67.0, 1.0, 0.85, cresc=0.4, attack=0.05, release=0.15)
hornchord(66.0, 2.0, 0.8, cresc=0.3, attack=0.3, release=0.2)
# rapid: ensemble stab on every cut
for t in cues.RAPID_CUTS:
    tbn(t, 0.42, 0.9 if t != 74.0 else 0.75, attack=0.012, release=0.3)
tbn(74.5, 1.5, 0.6, cresc=0.3, attack=0.3, release=0.2, low=False)  # 'and so much more' swell
tbn(75.0, 1.0, 0.8, cresc=0.4, attack=0.1, release=0.1)
# finale: trombones and tuba
tbn(cues.FINALE, BAR + 0.05, 0.95, attack=0.02, release=0.3)
tbn(78.0, 1.0, 0.85, attack=0.08, release=0.2)
tbn(79.0, 1.02, 0.85, cresc=0.6, attack=0.05, release=0.1)
# end chord
add('tbn', cues.ENDCARD, place(brass_sec([38, 45, 50, 54], 4.5, 0.85, attack=0.02, release=2.0, players=2, kind='tbn'), 0.35, 0.6), 1.0)
add('horn', cues.ENDCARD, place(brass_sec([57, 62, 66, 69], 4.8, 0.85, attack=0.03, release=2.0, players=3, kind='horn'), -0.3, 0.6), 0.8)

# ---------------------------------------------------------------- choir
for vi in range(5):  # one line per voice (4 upper voices + the bass doubled in the finale); held notes stay held
    segs = []
    for t0, t1, c, v, b in VOICING:
        if not (56.0 <= t0 < 80.0):
            continue
        if vi == 4:
            if section_of(t0) != 'finale':
                continue
            m = b + 12
        else:
            m = v[vi]
        if segs and segs[-1][2] == m and t0 not in RESTRIKE and abs(segs[-1][1] - t0) < 1e-6:
            segs[-1][1] = t1
        else:
            segs.append([t0, t1, m])
    for t0, t1, m in segs:
        vel = {'hook': 0.6, 'rapid': 0.6, 'finale': 0.8}[section_of(t0)]
        build = 66 <= t0 < 68 or 74 <= t0 < 76  # quicker re-attacks inside the swells, no dip on the chord change
        add('choir', J(t0, 3), choir_aah([m], t1 - t0 + 0.12, V(vel, 0.04), attack=0.12 if t0 in RESTRIKE else 0.15 if build else 0.35,
                                         release=0.6, air=0.02), 0.5)
add('choir', cues.ENDCARD, choir_aah([50, 57, 62, 66, 69, 74], 5.5, 0.8, attack=0.1, release=2.5), 1.0)

# ---------------------------------------------------------------- piano
PIANO_INTRO = [('D2', 0.0, 2.0, 0.42), ('A2', 0.0, 2.0, 0.36), ('D3', 2.0, 2.0, 0.36), ('B3', 2.03, 1.9, 0.3),
               ('A3', 3.75, 0.25, 0.42), ('D4', 4.0, 0.75, 0.55), ('B1', 4.0, 2.0, 0.4), ('F#2', 4.02, 1.9, 0.32),
               ('E4', 4.75, 0.25, 0.45), ('F#4', 5.0, 1.0, 0.55), ('E4', 6.0, 0.75, 0.55), ('A1', 6.0, 2.0, 0.42),
               ('E2', 6.02, 1.9, 0.34), ('D4', 6.75, 0.25, 0.45), ('C#4', 7.0, 0.5, 0.52), ('A3', 7.5, 0.5, 0.5)]
for s, t, d, v in PIANO_INTRO:
    add('piano', J(t, 4), piano(nm(s), d + 0.3, V(v, 0.05)), 1.0)
PIANO_PAT = [1, 3, 2, 3, 0, 3, 2, 3]
for bar in range(23, 29):
    for k, idx in enumerate(PIANO_PAT):
        t = bar_t(bar) + k * 0.25
        v, b = voicing_at(t)
        vel = (0.5 if k % 2 == 0 else 0.38) * (1.15 if k == 0 else 1.0) * (0.85 if 48 <= t < 50 else 1.0)
        add('piano', J(t, 5), piano(v[idx] + 12 if idx >= 2 else v[idx] + 12, 0.45, V(vel, 0.06)), 0.85)
    for b_ in (0, 2):
        t = bar_t(bar) + b_ * BEAT
        v, b = voicing_at(t)
        add('piano', J(t, 3), piano(b + 12, 0.95, V(0.45, 0.05)), 0.8)
add('piano', 47.75, piano(31, 1.0, 0.6), 0.9)  # 'Enter dims the lights': a low G under the pickup
add('piano', 47.75, piano(43, 1.0, 0.5), 0.8)
add('piano', cues.ENDCARD, piano(26, 5.0, 0.7), 1.0)
add('piano', cues.ENDCARD, piano(38, 5.0, 0.6), 0.9)
add('piano', cues.ENDCARD, piano(45, 5.0, 0.5), 0.8)

# ---------------------------------------------------------------- bells: tile pings, seasonal, sparkle
GLOW_NOTES = [81, 78, 81, 83, 86, 88, 90, 93, 97]  # A5 | F#5 A5 B5 D6 E6 F#6 A6 C#7 (D major pentatonic rising)
for i, (t, m) in enumerate(zip(cues.GLOW_TIMES, GLOW_NOTES)):
    v = 0.9 if i == 0 else 0.65 + 0.03 * i
    add('bells', t, place(celesta(m, v), 0.3 - 0.07 * i, 0.5), 1.0)
    add('bells', t, place(glock(m, v * 0.6), 0.35 - 0.07 * i, 0.5), 0.7)
# Halloween: celesta 8ths, creepy neighbour notes
HAL = [90, 86, 83, 86, 90, 86, 83, 82, 91, 88, 83, 88, 90, 85, 82, 85]
for k, m in enumerate(HAL):
    t = 32.0 + k * 0.25
    add('bells', J(t, 4), place(celesta(m, V(0.6 if k % 2 == 0 else 0.45), 1.2), 0.35, 0.5), 0.9)
# holiday montage: glock + celesta state the motif, a note on every cut
GLK = [('D6', 36.0, 0.75), ('E6', 36.75, 0.25), ('F#6', 37.0, 1.0), ('E6', 38.0, 0.75), ('D6', 38.75, 0.25),
       ('C#6', 39.0, 0.5), ('A5', 39.5, 0.5), ('B5', 40.0, 0.75), ('C#6', 40.75, 0.25), ('D6', 41.0, 0.5),
       ('F#6', 41.5, 0.5), ('G6', 42.0, 0.5), ('F#6', 42.5, 0.5), ('E6', 43.0, 0.5), ('C#6', 43.5, 0.5)]
for s, t, d in GLK:
    add('bells', J(t, 3), place(glock(nm(s), V(0.8)), 0.3, 0.5), 0.9)
    add('bells', J(t, 3), place(celesta(nm(s) - 12, V(0.55)), 0.2, 0.5), 0.8)
add('bells', 42.0, place(tubular(nm('D5'), 0.9), 0.15, 0.4), 1.0)  # Christmas chimes
add('bells', 43.0, place(tubular(nm('A4'), 0.75), 0.15, 0.4), 1.0)
# hook / finale sparkle: glock doubles the melody's long notes two octaves up
for s, t, d in HOOK + FINALE:
    if d >= 0.5 and t >= 56:
        m = nm(s) + (12 if t < 68 else 0)
        add('bells', t, place(glock(m, 0.45), 0.3, 0.5), 0.6)
for m in (86, 93):
    add('bells', cues.ENDCARD, place(celesta(m, 0.7, 3.0), 0.25, 0.5), 0.9)
    add('bells', cues.ENDCARD, place(glock(m, 0.5), 0.3, 0.5), 0.7)

# ---------------------------------------------------------------- pizzicato
HAL_PIZZ = [(32.0, 'B2'), (32.5, 'F#2'), (33.0, 'B2'), (33.25, 'C#3'), (33.5, 'D3'), (33.75, 'C#3'),
            (34.0, 'G2'), (34.5, 'B2'), (35.0, 'F#2'), (35.25, 'A#2'), (35.5, 'C#3'), (35.75, 'E3')]
for t, s in HAL_PIZZ:
    add('pizz', J(t, 4), place(pizz(nm(s), V(0.85)), 0.4, 0.5), 1.0)
for bar in (17, 18):
    for b in (1.5, 3.5):
        t = bar_t(bar) + b * BEAT
        v, _ = voicing_at(t)
        for m in v[1:]:
            add('pizz', J(t, 6), place(pizz(m + 12, V(0.55), 2), -0.4, 0.5), 0.6)
for bar in range(19, 23):  # oom-pah basses on the beats, violin chords on the offbeats
    for b in range(4):
        t = bar_t(bar) + b * BEAT
        v, bass = voicing_at(t)
        fifth = (CHORDS[chord_at(t)][0][0] + 7) % 12
        m = bass if b % 2 == 0 else next(k for k in range(bass + 1, bass + 13) if k % 12 == fifth)
        add('pizz', J(t, 4), place(pizz(m, V(0.9 if b % 2 == 0 else 0.7)), 0.35, 0.5), 1.0)
        add('pizz', J(t, 4), place(pizz(m + 12, V(0.6)), 0.45, 0.5), 0.6)
        for m2 in v[1:]:
            add('pizz', J(t + 0.25, 6), place(pizz(m2 + 12, V(0.5), 2), -0.4, 0.5), 0.5)

# ---------------------------------------------------------------- sleigh bells
for k in range(32):
    t = 36.0 + k * 0.25
    on_beat = k % 2 == 0
    cut = abs(t - round(t)) < 1e-6
    v = (1.0 if cut else 0.75 if on_beat else 0.5) * (1.15 if t >= 42 else 1.0)
    add('sleigh', J(t, 5), sleigh(V(v)), 1.0)

# ---------------------------------------------------------------- taiko / toms / snare
KEY_HZ = [440 * 2 ** ((m - 69) / 12) for m in range(26, 64) if m % 12 in (2, 4, 6, 9, 11)]  # D major pentatonic


def kf(f):
    """Snap a drum's tuning to the nearest D-pentatonic pitch so the drums never sit between semitones."""
    return min(KEY_HZ, key=lambda h: abs(np.log(h / f)))


def taiko(t, vel, f=55, size=3):
    add('taiko', t, taiko_ens(kf(f), vel, size), 1.0)


def tm(t, f, vel):
    add('taiko', J(t, 4), tom(kf(f), V(vel)), 0.7)


def groove(bar, I, fill=False, busy=False):
    t0 = bar_t(bar)
    taiko(t0, 1.0 * I)
    taiko(t0 + 2 * BEAT, 0.85 * I)
    for b, v in ((1.5, 0.5), (3.0, 0.6), (3.5, 0.5)) + (((0.5, 0.35), (2.5, 0.42)) if busy else ()):
        taiko(J(t0 + b * BEAT, 4), V(v * I), f=85, size=2)
    if fill:
        for b, f, v in ((2.5, 150, 0.6), (3.0, 130, 0.7), (3.5, 110, 0.8)):
            tm(t0 + b * BEAT, f, v * I)


# intro build: soft taiko 8ths from 6.0, 16ths in the last beat
for k in range(8):
    taiko(J(6.0 + k * 0.25, 4), 0.2 + 0.05 * k, f=70, size=2)
for k in range(4):
    tm(7.5 + k * 0.125, 120 + 10 * k, 0.45 + 0.12 * k)
for bar in range(5, 17):
    groove(bar, 0.85 if bar < 13 else 0.95, fill=bar in (8, 12), busy=bar >= 13)
for t in cues.ACCENT_CUTS:
    taiko(t, 1.0, f=60, size=3)
# Halloween: heartbeat taiko; holiday: light low toms on every cut
for bar in (17, 18):
    taiko(bar_t(bar), 0.55, f=50, size=2)
    taiko(bar_t(bar) + 1.25, 0.35, f=50, size=2)
for t in cues.HOLIDAY_CUTS + (43.0,):
    tm(t, 95, 0.55)
    tm(t + 0.5, 120, 0.3)
# features: soft taiko heartbeat, 8ths into the hook
for bar in range(23, 29):
    taiko(bar_t(bar), 0.5 if bar < 27 else 0.6, f=52, size=2)
    tm(bar_t(bar) + 1.25, 100, 0.3)
for k in range(4):
    taiko(J(55.0 + k * 0.25, 4), 0.4 + 0.12 * k, f=75, size=2)
for bar in range(29, 34):
    groove(bar, 1.0, fill=bar in (32,), busy=True)
taiko(65.0, 0.95, f=60)  # Omarchy cut accent
# bar 34 build: taiko 8ths then 16ths, snare roll
for k in range(4):
    taiko(66.0 + k * 0.25 if k else 66.0, 0.6 + 0.08 * k, f=70, size=2)
for k in range(8):
    tm(67.0 + k * 0.125, 100 + 8 * k, 0.5 + 0.06 * k)
add('taiko', 66.0, snare_roll(2.0, 0.12, 0.85), 0.7)
# rapid: driving beats, big hits on every cut
for bar in range(35, 39):
    t0 = bar_t(bar)
    for b in range(4):
        t = t0 + b * BEAT
        if t >= cues.BREATH:
            continue
        if b % 2 == 0:
            taiko(t, 1.0, f=55, size=3)
        else:
            taiko(J(t, 3), 0.65, f=85, size=2)
        if t + 0.25 < cues.BREATH:
            tm(t + 0.25, 140, 0.35)
_sr = snare_roll(1.5, 0.15, 0.8)[:, : n(1.5)]
_sr[:, -n(0.012):] *= np.linspace(1, 0, n(0.012))[None]
add('taiko', 74.0, _sr, 0.7)  # stops dead at the breath
# finale groove and a fill into the end card
for bar in (39,):
    groove(bar, 1.0, busy=True)
taiko(78.0, 1.0)
taiko(78.75, 0.6, f=85, size=2)
for k in range(4):
    tm(79.0 + k * 0.25, 150 - 12 * k, 0.6 + 0.1 * k)
for k in range(4):
    tm(79.5 + k * 0.125, 120 - 8 * k, 0.6 + 0.08 * k)

# ---------------------------------------------------------------- timpani
for t in cues.DROP_CUTS:
    _, b = voicing_at(t)
    while b < 38:
        b += 12
    add('timp', t, timp(b, 0.8), 1.0)
for k in range(28):  # intro roll on A
    add('timp', J(6.0 + k / 14, 3), timp(45, 0.15 + 0.6 * (k / 28) ** 1.5, 0.9), 0.9)
for t in cues.ACCENT_CUTS:
    add('timp', t, timp(43 if t < 30 else 45, 0.9), 1.0)
for t, m, v in ((32.0, 47, 0.6), (34.0, 43, 0.5), (35.0, 42, 0.55), (36.0, 38, 0.6), (38.0, 45, 0.5), (40.0, 47, 0.5),
                (42.0, 43, 0.55), (43.0, 45, 0.55), (44.0, 38, 0.55), (47.75, 43, 0.7), (50.0, 43, 0.45), (52.0, 40, 0.5)):
    add('timp', t, timp(m, v), 1.0)
for k in range(28):  # rolls into the hook and into the rapid cuts
    add('timp', J(54.0 + k / 14, 3), timp(45, 0.12 + 0.6 * (k / 28) ** 1.5, 0.9), 0.9)
    add('timp', J(66.0 + k / 14, 3), timp(45, 0.2 + 0.65 * (k / 28) ** 1.5, 0.9), 0.9)
for bar in range(29, 34):
    _, b = voicing_at(bar_t(bar))
    while b < 38:
        b += 12
    add('timp', bar_t(bar), timp(b, 0.75), 1.0)
for t in cues.RAPID_CUTS:
    _, b = voicing_at(t)
    while b < 38:
        b += 12
    add('timp', t, timp(b, 0.85), 1.0)
for k in range(14):
    add('timp', J(79.0 + k / 14, 3), timp(45, 0.3 + 0.55 * (k / 14) ** 1.5, 0.9), 0.9)
add('timp', 78.0, timp(43, 0.85), 1.0)

# ---------------------------------------------------------------- cymbals and risers
for t0, t1, v in ((6.0, 8.0, 0.9), (30.0, 32.0, 0.6), (42.0, 44.0, 0.45), (54.0, 56.0, 0.8), (66.0, 68.0, 1.0),
                  (74.0, 76.0, 1.0), (79.0, 80.0, 0.8)):
    add('cym', t0, cym_swell(t1 - t0, v), 1.0)
add('cym', 7.0, reverse_crash(1.0), 0.25)
for t, v in ((16.0, 0.5), (24.0, 0.55), (32.0, 0.45), (44.0, 0.4), (56.0, 0.8), (60.0, 0.35), (62.0, 0.4), (65.0, 0.5),
             (68.0, 0.85), (70.0, 0.55), (72.0, 0.55), (76.0, 0.9), (78.0, 0.5)):
    add('cym', t, crash_cym(v), 1.0)
for t0, t1, v in ((4.0, 8.0, 0.35), (66.0, 68.0, 0.5), (74.0, 76.0, 0.6)):
    add('synth', t0, riser(t1 - t0, 300, 7000, pitch=True), v)

# ---------------------------------------------------------------- hybrid pulse
for bar in list(range(5, 17)) + list(range(23, 29)) + list(range(29, 41)):
    lvl = 0.6 if bar < 17 else 0.35 if bar < 29 else 0.75
    for k in range(8):
        t = bar_t(bar) + k * 0.25
        if t >= cues.BREATH and bar == 38:
            continue
        _, b = voicing_at(t)
        m = b + 12 if b < 36 else b
        add('synth', J(t, 2), pulse(m, lvl * (1.0 if k % 2 == 0 else 0.7)), 1.0)

# ---------------------------------------------------------------- builds and chokes (track rides)
def build_ride(names, t0, t1, g0):
    """Subito piano at t0, then a crescendo back to full by t1 (the sustained parts swell into the cut)."""
    i0, i1, k = n(t0), n(t1), n(0.04)
    g = np.ones(TR['pad'].buf.shape[1])
    g[i0:i1] = g0 + (1 - g0) * np.linspace(0, 1, i1 - i0) ** 1.5
    g[i0:i0 + k] = np.linspace(1, g0, k)
    for nm_ in names:
        TR[nm_].buf *= g[None]


def choke(names, t0, t1, fade=0.06):
    """Silence a track from t0 to t1 (a short fade in), so the next downbeat lands on air."""
    i0, i1 = n(t0), n(t1)
    k = min(n(fade), i1 - i0)
    g = np.zeros(i1 - i0)
    g[:k] = np.linspace(1, 0, k)
    for nm_ in names:
        TR[nm_].buf[:, i0:i1] *= g[None]


build_ride(('pad', 'low', 'choir'), 66.0, 68.0, 0.45)
build_ride(('pad', 'low', 'choir'), 74.0, 76.0, 0.5)
choke(('taiko',), cues.BREATH, cues.FINALE)            # the drums really rest 75.5-76.0
choke(('taiko', 'cym', 'timp'), 67.94, 68.0, 0.03)     # a short suck before the rapid-cut downbeat

# ---------------------------------------------------------------- the three hits (impact stem)
IR_HALL = hall_ir(2.6, 3.6, 0.022, seed=3)
IR_ROOM = hall_ir(1.3, 2.0, 0.012, seed=8)
for h, size in ((cues.DROP, 1.0), (cues.FINALE, 1.0), (cues.ENDCARD, 1.15)):
    imp.add(h, boom(5.5 if h == cues.ENDCARD else 4.0, size), 1.0)
    imp.add(h, taiko_ens(55, 1.0, size=4, dur=2.5), 1.1)
    imp.add(h, timp(38, 1.0, 3.0), 0.9)
    imp.add(h, crash_cym(1.0, 4.5), 0.9)
impact_stem = imp.buf + convolve(imp.buf, IR_HALL) * 0.35

# ---------------------------------------------------------------- mix
EQ = {
    'pad': [pb.HighpassFilter(140), pb.PeakFilter(330, -2.0, 1.0), pb.PeakFilter(650, -2.5, 0.9), pb.HighShelfFilter(7000, 4.0)],
    'low': [pb.HighpassFilter(30), pb.PeakFilter(220, -1.5, 1.0), pb.LowpassFilter(3500)],
    'vln': [pb.HighpassFilter(220), pb.PeakFilter(700, -1.5, 0.9), pb.PeakFilter(3000, 2.5, 0.8), pb.HighShelfFilter(7000, 4.5)],
    'spic': [pb.HighpassFilter(110), pb.PeakFilter(600, -2.0, 0.9), pb.PeakFilter(2500, 1.5, 0.9), pb.HighShelfFilter(6500, 4.0)],
    'pizz': [pb.HighpassFilter(60)],
    'horn': [pb.HighpassFilter(80), pb.PeakFilter(480, 1.0, 0.8), pb.PeakFilter(1000, -1.0, 1.0), pb.LowpassFilter(5000)],
    'tbn': [pb.HighpassFilter(40), pb.PeakFilter(500, -1.5, 0.9), pb.LowpassFilter(6000)],
    'choir': [pb.HighpassFilter(150), pb.PeakFilter(800, -2.5, 0.8), pb.PeakFilter(1100, -2.5, 1.0), pb.HighShelfFilter(4000, 4.0)],
    'piano': [pb.HighpassFilter(40)],
    'bells': [pb.HighpassFilter(450)],
    'sleigh': [pb.HighpassFilter(3000), pb.LowpassFilter(12000)],
    'taiko': [pb.HighpassFilter(32), pb.LowShelfFilter(80, -5.0), pb.PeakFilter(2500, 3.0, 0.9), pb.Compressor(threshold_db=-16, ratio=2.5, attack_ms=8, release_ms=120)],
    'timp': [pb.HighpassFilter(35)],
    'cym': [pb.HighpassFilter(350)],
    'synth': [pb.HighpassFilter(40), pb.LowpassFilter(3000)],
}
GAIN = {'pad': 1.0, 'low': 1.0, 'vln': 1.0, 'spic': 1.0, 'pizz': 1.0, 'horn': 1.0, 'tbn': 1.0, 'choir': 1.0,
        'piano': 1.0, 'bells': 1.0, 'sleigh': 1.0, 'taiko': 1.0, 'timp': 1.0, 'cym': 1.0, 'synth': 1.0}
GAIN.update({'pad': 1.0, 'low': 0.9, 'vln': 1.3, 'spic': 1.35, 'pizz': 1.3, 'horn': 0.5, 'tbn': 0.6, 'choir': 1.1,
             'piano': 0.5, 'bells': 0.7, 'sleigh': 1.3, 'taiko': 0.65, 'timp': 0.42, 'cym': 0.7, 'synth': 0.38})
SEND_HALL = {'pad': 0.3, 'low': 0.18, 'vln': 0.38, 'spic': 0.2, 'pizz': 0.3, 'horn': 0.38, 'tbn': 0.3, 'choir': 0.42,
             'piano': 0.3, 'bells': 0.45, 'sleigh': 0.3, 'taiko': 0.15, 'timp': 0.3, 'cym': 0.3, 'synth': 0.1}
SEND_ROOM = {'spic': 0.25, 'taiko': 0.3, 'timp': 0.2, 'pizz': 0.15, 'low': 0.1}

dry = np.zeros_like(TR['pad'].buf)
hall_in = np.zeros_like(dry)
room_in = np.zeros_like(dry)
stems = {}
for k, tr in TR.items():
    x = bus(tr.buf, *EQ[k]).astype(np.float64) * GAIN[k]
    stems[k] = x
    dry += x
    hall_in += x * SEND_HALL.get(k, 0)
    room_in += x * SEND_ROOM.get(k, 0)
wet = convolve(hall_in, IR_HALL) + convolve(room_in, IR_ROOM)
wet = bus(wet, pb.HighpassFilter(200), pb.PeakFilter(450, -2.5, 0.7), pb.HighShelfFilter(6000, 1.5)).astype(np.float64)
music = dry + wet
# fader ride: the intro starts softer and grows into the drop; the features section sits back
ride = np.interp(np.arange(music.shape[1]) / SR, [0, 4.5, 7.9, 8.0, 44.0, 44.4, 51.0, 55.9, 87],
                 [0.62, 0.7, 1.0, 1.0, 1.0, 0.8, 0.8, 1.0, 1.0])
music = music * ride[None]
# bus EQ: take the 1 kHz congestion (choir F2, horns, violins all meet there) down a touch, add air on top
music = bus(music, pb.PeakFilter(1000, -1.5, 0.7), pb.HighShelfFilter(6500, 2.5), pb.PeakFilter(8500, 2.0, 0.9),
            pb.Compressor(threshold_db=-20, ratio=1.8, attack_ms=25, release_ms=250)).astype(np.float64)

if VERBOSE:
    secs = [(nm_, bar_t(b0), min(bar_t(b1), 86.0)) for nm_, b0, b1, _ in cues.SECTIONS]
    pk = np.abs(music).max()
    print('stem RMS dB (relative to music peak) per section')
    print('        ' + ' '.join(f'{s[0][:6]:>7s}' for s in secs))
    for k, x in list(stems.items()) + [('DRY', dry), ('wet', wet), ('MUSIC', music)]:
        row = []
        for _, a, b in secs:
            seg = x[:, int(a * SR):int(b * SR)]
            row.append(20 * np.log10(np.sqrt((seg ** 2).mean()) / pk + 1e-9))
        print(f'{k:7s} ' + ' '.join(f'{r:7.1f}' for r in row))

if VERBOSE:
    np.savez('/tmp/claude-0/-home-user-HA-Desktop-Widget/e4da07a2-2a92-5750-b6c3-00aa90ec6a7a/scratchpad/cine_stems.npz',
             **{k: v.mean(axis=0).astype(np.float32) for k, v in list(stems.items()) + [('wet', wet), ('music', music)]})

write(NAME, music, impact_stem, {'lift_db': 4.0})
