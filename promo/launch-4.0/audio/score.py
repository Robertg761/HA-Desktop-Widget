"""The 4.0 spot's score: 120 BPM, Bm-G-D-A, 86 seconds. Writes stems and a music mix."""
import os
import sys
import numpy as np
import pedalboard as pb
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from engine import *  # noqa
from warp import T  # original edit time -> spot time

OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)

DUR = 87.0
BEAT = 0.5
BAR = 2.0
S16 = BEAT / 4
S8 = BEAT / 2

# Chords per bar (bar 1 starts at 0 s). Each section restarts the progression on Bm.
PROG = ['Bm', 'G', 'D', 'A']
OVERRIDE = {39: 'G', 40: 'A', 41: 'D', 42: 'D', 43: 'D'}
SECTION_STARTS = (1, 5, 17, 23, 29, 35)


def chord_of(bar):
    start = max(s for s in SECTION_STARTS if s <= bar)
    return OVERRIDE.get(bar, PROG[(bar - start) % 4])


PAD = {'Bm': [59, 62, 66, 71], 'G': [59, 62, 67, 71], 'D': [57, 62, 66, 69], 'A': [57, 61, 64, 69]}
ROOT = {'Bm': 35, 'G': 31, 'D': 38, 'A': 33}
ARP = {
    'Bm': [71, 74, 78, 83, 86],
    'G': [67, 71, 74, 79, 83],
    'D': [69, 74, 78, 81, 86],
    'A': [69, 73, 76, 81, 85],
}
ARP_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1]

# Hook, in 8ths per bar (None = hold / rest handled by duration).
HOOK = {
    'Bm': [78, None, 78, 76, 74, None, 71, None],
    'G': [74, None, 76, None, 74, 71, None, None],
    'D': [69, None, 74, None, 78, None, 81, None],
    'A': [81, None, 79, 78, 76, None, None, None],
}
FINALE_HOOK = {
    'G': [74, None, 76, None, 79, None, 78, 76],
    'A': [76, None, None, None, 73, None, 76, None],
}


def bar_t(bar):
    return (bar - 1) * BAR


def hook_notes(pattern, start):
    """[(time, midi, dur)] from an 8th-note pattern where None extends the previous note."""
    out = []
    i = 0
    while i < len(pattern):
        m = pattern[i]
        if m is None:
            i += 1
            continue
        j = i + 1
        while j < len(pattern) and pattern[j] is None:
            j += 1
        out.append((start + i * S8, m, (j - i) * S8))
        i = j
    return out


# ------------------------------------------------------------------ section map
INTRO = range(1, 5)  # 0-8
A_SEC = range(5, 17)  # 8-32
SEASON = range(17, 23)  # 32-44
B_SEC = range(23, 35)  # 44-68: palette, settings, then the hook from bar 29 (sync, pins, Omarchy)
HOOK_BARS = range(29, 35)
BUILD = 34  # 66-68, into the rapid cuts
RAPID = range(35, 39)  # 68-76
BREATH = 38  # the drums drop the last beat (75.5) before the finale
FINALE = range(39, 41)  # 76-80
END = range(41, 44)  # 80-86

drums = Track(DUR)
bass = Track(DUR)
pad = Track(DUR)
arp = Track(DUR)
lead = Track(DUR)
bells = Track(DUR)
fxs = Track(DUR)
imp = Track(DUR)  # the big hits, mastered separately so they keep their headroom
kick_times = []

K = kick()
CL = clap()
HC = hat(False)
HO = hat(True)


def groove(bar, kick_on=True, clap_on=True, hats=True, open_hats=True, vel=1.0, beats=4):
    t0 = bar_t(bar)
    for b in range(beats):
        tb = t0 + b * BEAT
        if kick_on:
            drums.add(tb, K, 1.0 * vel)
            kick_times.append(tb)
        if clap_on and b in (1, 3):
            drums.add(tb, CL, 0.8 * vel)
        if hats:
            for s in range(4):
                v = [0.55, 0.3, 0.8, 0.35][s]
                if open_hats and s == 2:
                    drums.add(tb + s * S16, HO, 0.55 * vel)
                else:
                    drums.add(tb + s * S16, hat(False, v), 0.8 * vel)


# Intro (bars 1-4): no kick; hats from bar 3; snare roll in bar 4.
for bar in (3,):
    for s in range(16):
        drums.add(bar_t(bar) + s * S16, hat(False, [0.4, 0.15, 0.6, 0.2][s % 4]), 0.6)
# bar 4: kick on every beat (heartbeat), roll accelerating
for b in range(4):
    drums.add(bar_t(4) + b * BEAT, K, 0.55 + 0.1 * b)
    kick_times.append(bar_t(4) + b * BEAT)
roll = []
t = bar_t(4)
for step, count in ((S8, 4), (S16, 6), (S16 / 2, 6)):
    for _ in range(count):
        if t < 7.97:  # the roll runs right up to the drop
            roll.append(t)
        t += step
for k, tr in enumerate(roll):
    drums.add(tr, snare(0.25 + 0.75 * k / len(roll)), 0.75)

# Main grooves
for bar in A_SEC:
    groove(bar)
    if bar == A_SEC[-1]:  # fill into the seasonal section: toms on the last two beats
        for k, (dt, f) in enumerate([(0, 150), (S16, 130), (2 * S16, 115), (3 * S16, 100), (4 * S16, 90), (5 * S16, 80), (6 * S16, 72), (7 * S16, 64)]):
            drums.add(bar_t(bar) + 2 * BEAT + dt, tom(f, 0.6 + 0.05 * k), 0.8)
for bar in SEASON:
    groove(bar, open_hats=False, vel=0.85)
    for s in range(16):
        drums.add(bar_t(bar) + s * S16, jingle([1.0, 0.5, 0.8, 0.5][s % 4]), 0.9)
for bar in B_SEC:
    if bar == BUILD:
        # build: kicks on beats, snare roll, no hats
        for b in range(4):
            drums.add(bar_t(bar) + b * BEAT, K, 0.9)
            kick_times.append(bar_t(bar) + b * BEAT)
        tr = bar_t(bar)
        k = 0
        while tr < bar_t(bar) + BAR - 0.01:
            step = S8 if tr < bar_t(bar) + 1.0 else S16
            drums.add(tr, snare(0.3 + 0.6 * (tr - bar_t(bar)) / BAR), 0.8)
            tr += step
            k += 1
    else:
        groove(bar)
for bar in RAPID:
    beats = 3 if bar == BREATH else 4  # a one-beat breath before the finale
    groove(bar, open_hats=True, beats=beats)
    for b in range(beats):
        drums.add(bar_t(bar) + b * BEAT, tom(95, 0.5), 0.6)
for bar in FINALE:
    groove(bar, vel=1.05)
drums.add(bar_t(END[0]), K, 1.0)
kick_times.append(bar_t(END[0]))

# Crashes / impacts / risers / sweeps
CR = crash()
HITS = (8.0, bar_t(FINALE[0]), bar_t(END[0]))  # 8, 76, 80
for tc in (8.0, T(16.0), bar_t(SEASON[0]), bar_t(B_SEC[0]), bar_t(HOOK_BARS[0]), bar_t(RAPID[0])) + HITS[1:]:
    drums.add(tc, CR, 0.9 if tc in HITS else 0.65)
imp.add(HITS[0], impact(), 0.9)
imp.add(HITS[1], impact(), 0.8)
imp.add(HITS[2], impact(4.5), 1.0)
fxs.add(4.0, fade_tail(riser(3.7), 60), 0.55)
fxs.add(8.0 - 1.0, reverse_crash(1.0), 0.5)
fxs.add(bar_t(BUILD), riser(1.95, 400, 9000), 0.6)
fxs.add(bar_t(RAPID[0]) - 1.2, reverse_crash(1.2), 0.5)
fxs.add(T(50.0), fade_tail(riser(3.2, 500, 10000, pitch=False), 40), 0.45)
fxs.add(HITS[1] - 0.5, reverse_crash(0.5), 0.6)  # swells through the drums' breath before the finale
fxs.add(bar_t(SEASON[0]) - 1.0, reverse_crash(1.0), 0.45)

# ------------------------------------------------------------------ pad
for bar in range(1, END[-1] + 1):
    ch = chord_of(bar)
    t0 = bar_t(bar)
    if bar in END:
        if bar != END[0]:
            continue
        notes = [50, 57, 62, 66, 69, 74]  # D major, wide
        pad.add(t0, pad_chord(notes, 4.6, cutoff=2600, attack=0.05, release=2.2), 0.9)
        continue
    if bar in INTRO:
        # filter opening 500 -> 3000 across the intro
        c0 = 450 * (3000 / 450) ** ((bar - 1) / 4)
        c1 = 450 * (3000 / 450) ** (bar / 4)
        cut = (lambda c0, c1: lambda s: c0 * (c1 / c0) ** min(1, s / BAR))(c0, c1)
        g = 0.55 + 0.1 * (bar - 1)
        pad.add(t0, pad_chord(PAD[ch], BAR, cutoff=cut, attack=0.6 if bar == 1 else 0.08, release=0.4), g)
    elif bar in SEASON:
        pad.add(t0, pad_chord(PAD[ch], BAR, cutoff=2200, attack=0.05, release=0.3), 0.6)
    else:
        pad.add(t0, pad_chord(PAD[ch], BAR, cutoff=2800 if bar not in FINALE else 3600, attack=0.03, release=0.3), 0.62)

# ------------------------------------------------------------------ bass
for bar in list(A_SEC) + list(SEASON) + list(B_SEC) + list(RAPID) + list(FINALE):
    ch = chord_of(bar)
    r = ROOT[ch] + 12  # B2 etc
    t0 = bar_t(bar)
    if bar == BUILD:
        # build: roots on 8ths, rising filter
        for k in range(8):
            bass.add(t0 + k * S8, bass_note(r, S8 * 0.9, cutoff=300 + 120 * k), 0.8)
        continue
    for b in range(4):
        # off-beat 8ths, plus a ghost 16th before the next beat
        bass.add(t0 + b * BEAT + S8, bass_note(r, S8 * 0.95), 0.9)
        if b == 3:
            bass.add(t0 + b * BEAT + 3 * S16, bass_note(r + 12, S16 * 0.8, cutoff=600), 0.45)
# Intro sub drone under bars 3-4
for bar in (3, 4):
    ch = chord_of(bar)
    bass.add(bar_t(bar), bass_note(ROOT[ch] + 12, BAR * 0.98, cutoff=200, sub=1.0), 0.35)
# End: long D
bass.add(bar_t(END[0]), bass_note(38, 3.0, cutoff=260, sub=1.0), 0.8)

# ------------------------------------------------------------------ arp
for bar in range(2, END[0]):
    if bar in SEASON:
        continue
    ch = chord_of(bar)
    tones = ARP[ch]
    t0 = bar_t(bar)
    for s in range(16):
        if bar == BUILD and s >= 8:
            break
        m = tones[ARP_PATTERN[s]]
        if bar in INTRO:
            bright = 0.25 + 0.6 * ((bar - 2) * 16 + s) / 48
            vel = 0.35 + 0.35 * ((bar - 2) * 16 + s) / 48
        else:
            bright, vel = 1.0, 0.7 if bar not in B_SEC else 0.62
        arp.add(t0 + s * S16, pluck(m, S16 * 0.9, bright=bright), vel)

# Glow tones for tiles lighting in the intro (match the picture)
GLOW = [(1.5, 78), (4.5, 69), (5.0, 74), (5.5, 78), (6.0, 76), (6.5, 81), (7.0, 85), (7.25, 88), (7.5, 93)]
for tg, m in GLOW:
    bells.add(tg, glow(m, 1.8), 0.55 if tg > 1.6 else 0.7)

# ------------------------------------------------------------------ bells (seasonal + accents)
# Magic gliss into the seasonal section
for k, m in enumerate([74, 78, 81, 83, 86, 90, 93, 95, 98]):
    bells.add(bar_t(SEASON[0]) + k * 0.035, bell(m, 1.2, index=1.4, vel=0.5), 0.6)
for bar in SEASON:
    ch = chord_of(bar)
    for (tn, m, d) in hook_notes(HOOK[ch], bar_t(bar)):
        bells.add(tn, bell(m + 12, 1.4, index=1.8, vel=0.9), 0.6)
        bells.add(tn, bell(m, 1.6, index=1.2, vel=0.6), 0.35)
    # twinkle 16ths on chord tones
    for s in range(0, 16, 2):
        m = ARP[ch][[0, 2, 4, 2, 3, 1, 4, 2][s // 2]] + 12
        bells.add(bar_t(bar) + s * S16 + S16, bell(m, 0.6, index=0.8, vel=0.25), 0.4)
# Accent cycle blips, one on each accent cut
for k, m in enumerate([78, 81, 83, 86]):
    bells.add(T(22.0 + k * 0.5), bell(m, 1.0, index=1.5, vel=0.8), 0.5)

# ------------------------------------------------------------------ lead (hook)
for bar in HOOK_BARS:
    ch = chord_of(bar)
    for (tn, m, d) in hook_notes(HOOK[ch], bar_t(bar)):
        lead.add(tn, lead_note(m, d * 0.92), 0.5)
for bar in FINALE:
    ch = chord_of(bar)
    for (tn, m, d) in hook_notes(FINALE_HOOK[ch], bar_t(bar)):
        lead.add(tn, lead_note(m, d * 0.92), 0.55)
# Final resolve: D chord in the lead at 56
for m in (74, 78, 81):
    lead.add(bar_t(END[0]), lead_note(m, 2.6, cutoff=4200), 0.32)
# Rapid section: chord stabs on each cut (beats)
for bar in RAPID:
    ch = chord_of(bar)
    for b in range(4):
        if bar == BREATH and b == 3:
            continue
        for m in PAD[ch][1:]:
            lead.add(bar_t(bar) + b * BEAT, lead_note(m + 12, 0.14, cutoff=3800), 0.16)

# ------------------------------------------------------------------ sidechain
def sidechain_curve(times, depth=0.6, rel=0.18, dur=DUR):
    N = n(dur)
    g = np.ones(N)
    t = np.arange(N) / SR
    for tk in sorted(times):
        i = n(tk)
        j = min(N, i + n(0.45))
        seg = t[i:j] - tk
        duck = depth * np.exp(-seg / rel) * np.clip(seg / 0.004, 0, 1) ** 0.5
        g[i:j] = np.minimum(g[i:j], 1 - duck)
    return g


sc = sidechain_curve(kick_times)
for tr, d in ((pad, 1.0), (bass, 0.85), (arp, 0.6), (lead, 0.35)):
    tr.buf *= (1 - d * (1 - sc))[None]

# No silence gaps: the music runs into the drop and the finale, carried by the risers and reverse
# crashes (muting every stem a fraction of a beat early read as a glitch, not a break).

# ------------------------------------------------------------------ buses
f32 = lambda x: x.astype(np.float32)


def bus(x, *plugins):
    return pb.Pedalboard(list(plugins))(f32(x), SR)


drums_m = bus(drums.buf, pb.HighpassFilter(30), pb.Compressor(threshold_db=-14, ratio=3, attack_ms=8, release_ms=120), pb.Gain(0))
drums_m = drums_m + bus(drums.buf * 0.18, pb.HighpassFilter(500), pb.Reverb(room_size=0.5, damping=0.6, wet_level=1.0, dry_level=0.0, width=1.0))
bass_m = bus(bass.buf, pb.HighpassFilter(28), pb.LowpassFilter(5000), pb.Compressor(threshold_db=-12, ratio=4, attack_ms=5, release_ms=80))
pad_m = bus(pad.buf, pb.HighpassFilter(140), pb.Chorus(rate_hz=0.4, depth=0.25, mix=0.35), pb.Reverb(room_size=0.82, damping=0.5, wet_level=0.35, dry_level=0.8, width=1.0))
arp_m = bus(arp.buf, pb.HighpassFilter(220), pb.Delay(delay_seconds=0.375, feedback=0.35, mix=0.28), pb.Reverb(room_size=0.7, wet_level=0.25, dry_level=0.85))
lead_m = bus(lead.buf, pb.HighpassFilter(200), pb.Delay(delay_seconds=0.375, feedback=0.3, mix=0.22), pb.Reverb(room_size=0.85, wet_level=0.32, dry_level=0.8, width=1.0))
bells_m = bus(bells.buf, pb.HighpassFilter(300), pb.Delay(delay_seconds=0.25, feedback=0.3, mix=0.2), pb.Reverb(room_size=0.9, damping=0.3, wet_level=0.45, dry_level=0.75, width=1.0))
fx_m = bus(fxs.buf, pb.HighpassFilter(25), pb.Reverb(room_size=0.9, wet_level=0.3, dry_level=0.85, width=1.0))

imp_m = bus(imp.buf, pb.HighpassFilter(22), pb.Reverb(room_size=0.9, wet_level=0.28, dry_level=0.9, width=1.0))

stems = {
    'drums': (drums_m, 1.0),
    'bass': (bass_m, 1.0),
    'pad': (pad_m, 1.0),
    'arp': (arp_m, 1.0),
    'lead': (lead_m, 1.0),
    'bells': (bells_m, 1.0),
    'fx': (fx_m, 1.0),
    'impact': (imp_m, 1.0),
}
mix = None
for name, (x, g) in stems.items():
    y = x[:, : n(DUR)] * g
    sf.write(os.path.join(OUT, f'stem_{name}.wav'), y.T, SR, subtype='FLOAT')
    mix = y if mix is None else mix + y

# fade out the tail
N = mix.shape[1]
fo0, fo1 = n(60.2), n(62.6)
mix[:, fo0:fo1] *= np.linspace(1, 0, fo1 - fo0) ** 1.5
mix[:, fo1:] = 0
sf.write(os.path.join(OUT, 'music_premaster.wav'), mix.T, SR, subtype='FLOAT')
print('peak premaster', np.abs(mix).max())
