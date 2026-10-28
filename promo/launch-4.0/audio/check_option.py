"""Objective checks for a mastered soundtrack option (we cannot listen, so measure).

  python3 audio/check_option.py <option>        (reads audio/out/soundtrack_<option>.wav)
  python3 audio/check_option.py --file <wav>
Prints loudness, peaks, drop-outs, hit lift, section arc, beat-grid alignment, cue onsets, key
(overall and per section), spectral balance and stereo correlation, then PASS/WARN lines.
"""
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly, stft

sys.path.insert(0, os.path.dirname(__file__))
import cues  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), 'out')
path = sys.argv[2] if sys.argv[1] == '--file' else os.path.join(OUT, f'soundtrack_{sys.argv[1]}.wav')
y, SR = sf.read(path, always_2d=True)
y = y.T
m = y.mean(axis=0)
warn = []
print(f'file {path}\nlength {y.shape[1] / SR:.2f} s')
meter = pyln.Meter(SR)
L = meter.integrated_loudness(y.T)
tp = 20 * np.log10(np.abs(resample_poly(y, 4, 1, axis=1)).max() + 1e-12)
print(f'loudness {L:.1f} LUFS, true peak {tp:.2f} dBTP')
if abs(L + 14) > 1: warn.append('loudness far from -14 LUFS')
if tp > -0.8: warn.append('true peak above -0.8 dBTP')

# drop-outs: 50 ms windows far below the surrounding second
w = int(0.05 * SR)
nw = len(m) // w
db = 20 * np.log10(np.sqrt((m[: nw * w].reshape(nw, w) ** 2).mean(axis=1)) + 1e-9)
drops = []
for i in range(10, min(nw, int((cues.LENGTH - 2) / 0.05))):
    ctx = np.median(db[max(0, i - 10): i + 10])
    if db[i] < ctx - 12 and ctx > -40:
        drops.append(round(i * 0.05, 2))
print('drop-outs (50 ms windows >12 dB under their second):', drops[:20] or 'none')
if drops: warn.append(f'{len(drops)} drop-out windows')

def rms_db(t, d=0.15):
    s = y[:, int(t * SR): int((t + d) * SR)]
    return 20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-12)
beats = [cues.bar_t(b) for b in (7, 13, 23, 29)]
lift = np.mean([rms_db(h) for h in cues.HITS]) - np.mean([rms_db(b) for b in beats])
print(f'hits {cues.HITS} are {lift:+.1f} dB over ordinary downbeats')

print('section loudness (LUFS):')
for nm, b0, b1, _ in cues.SECTIONS:
    a, b = cues.bar_t(b0), min(cues.bar_t(b1), cues.LENGTH)
    print(f'  {nm:9s} {a:5.1f}-{b:5.1f}  {meter.integrated_loudness(y[:, int(a * SR): int(b * SR)].T):6.1f}')
print(f'  end level at {cues.LENGTH - 0.2:.1f} s: {rms_db(cues.LENGTH - 0.25, 0.2):.1f} dBFS')

# onset strength (spectral flux) and the beat grid
f, t, Z = stft(m, SR, nperseg=2048, noverlap=2048 - 480)
mag = np.log1p(np.abs(Z) * 50)
flux = np.maximum(0, np.diff(mag, axis=1)).sum(axis=0)
ft = t[1:]
def strength_at(times, tol=0.03):
    v = []
    for tt in times:
        k = (ft > tt - tol) & (ft < tt + tol)
        v.append(flux[k].max() if k.any() else 0)
    return np.array(v)
grid = np.arange(8.0, 80.0, 0.5)
on = strength_at(grid).mean()
off = strength_at(grid + 0.25).mean()
mid = strength_at(grid + 0.125).mean()
print(f'beat grid: onset strength on beats {on:.0f}, on 8ths {off:.0f}, on 16ths {mid:.0f}  (beats/16ths = {on / max(mid, 1):.2f})')
if on / max(mid, 1) < 1.15: warn.append('weak alignment to the 120 BPM beat grid')
cut_times = (cues.DROP,) + cues.DROP_CUTS + (32.0, 44.0, 56.0, 62.0, 65.0, 68.0, cues.FINALE, cues.ENDCARD)
cs = strength_at(cut_times)
print('onset strength at section cuts:', ' '.join(f'{c:g}:{v:.0f}' for c, v in zip(cut_times, cs)), f'(median flux {np.median(flux):.0f})')
gs = strength_at(cues.GLOW_TIMES)
print('onset strength at intro glow pings:', ' '.join(f'{c:g}:{v:.0f}' for c, v in zip(cues.GLOW_TIMES, gs)))

# key: Krumhansl-Schmuckler on a chroma vector
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
fk, tk, ZK = stft(m, SR, nperseg=16384, noverlap=16384 - 4800)  # 2.9 Hz bins for pitch
band = (fk > 100) & (fk < 4000)
pcs = np.round(12 * np.log2(fk[band] / 440.0) + 69).astype(int) % 12
P = np.abs(ZK[band])
def chroma(a, b):
    k = (tk >= a) & (tk < b)
    c = np.zeros(12)
    np.add.at(c, pcs, P[:, k].sum(axis=1))
    return c / (c.sum() + 1e-12)
def key_of(c):
    best = None
    for r in range(12):
        for mode, prof in (('major', MAJ), ('minor', MIN)):
            s = np.corrcoef(c, np.roll(prof, r))[0, 1]
            if best is None or s > best[0]:
                best = (s, f'{NAMES[r]} {mode}')
    return best
k = key_of(chroma(0, cues.LENGTH))
print(f'key (whole): {k[1]} (r={k[0]:.2f})')
print('key by section:', ', '.join(f'{nm}: {key_of(chroma(cues.bar_t(b0), cues.bar_t(b1)))[1]}' for nm, b0, b1, _ in cues.SECTIONS))

bands = [(20, 120), (120, 500), (500, 2000), (2000, 6000), (6000, 20000)]
E = np.abs(Z) ** 2
tot = E.sum()
print('spectral balance %:', ' '.join(f'{a}-{b}Hz:{100 * E[(f >= a) & (f < b)].sum() / tot:.0f}' for a, b in bands))
corr = np.corrcoef(y[0], y[1])[0, 1]
print(f'stereo correlation {corr:.2f}')
if corr < 0.2: warn.append('low stereo correlation (mono compatibility)')
print('\n'.join(['WARN ' + w for w in warn]) if warn else 'PASS: no automatic warnings')
