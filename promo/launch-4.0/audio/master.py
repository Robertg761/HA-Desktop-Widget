"""Master one soundtrack option: its music and impact stems plus the shared sound effects.

  python3 audio/master.py <option>
reads audio/out/opt_<option>/music.wav and impact.wav (and meta.json, optional), adds
audio/out/sfx.wav, balances the impacts against the groove, fades the end, limits to -1 dBTP at
about -14 LUFS, and writes audio/out/soundtrack_<option>.wav.
"""
import json
import os
import sys

import numpy as np
import pedalboard as pb
import pyloudnorm as pyln
import soundfile as sf
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(__file__))
import cues  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), 'out')
SR = 48000
name = sys.argv[1]
src = os.path.join(OUT, f'opt_{name}')
meta = {'lift_db': 4.0, 'sfx_db': -4.0, 'target_lufs': -14.0}
if os.path.exists(os.path.join(src, 'meta.json')):
    meta.update(json.load(open(os.path.join(src, 'meta.json'))))


def load(path, N=None):
    x, sr = sf.read(path, always_2d=True)
    assert sr == SR, path
    x = x.T
    if N is not None:
        x = np.pad(x, ((0, 0), (0, max(0, N - x.shape[1]))))[:, :N]
    return x


N = int(cues.DUR * SR)
music = load(os.path.join(src, 'music.wav'), N)
impact = load(os.path.join(src, 'impact.wav'), N) if os.path.exists(os.path.join(src, 'impact.wav')) else np.zeros((2, N))
sfx = load(os.path.join(OUT, 'sfx.wav'), N) * 10 ** (meta['sfx_db'] / 20)
meter = pyln.Meter(SR)


def true_peak_limit(x, ceiling_db=-1.0, os_factor=4, window_ms=24.0):
    c = 10 ** (ceiling_db / 20)
    up = resample_poly(x, os_factor, 1, axis=1)
    env = np.abs(up).max(axis=0)
    env = env.reshape(-1, os_factor).max(axis=1) if env.size % os_factor == 0 else np.abs(x).max(axis=0)
    env = env[: x.shape[1]]
    g = np.minimum(1.0, c / np.maximum(env, 1e-9))
    w = max(3, int(SR * window_ms / 1000))
    g = minimum_filter1d(g, size=w, mode='nearest')
    g = uniform_filter1d(g, size=w, mode='nearest')
    g = minimum_filter1d(g, size=3, mode='nearest')
    return x * g[None]


def rms_db(x, t, dur=0.15):
    seg = x[:, int(t * SR): int((t + dur) * SR)]
    return 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-12)


bus = pb.Pedalboard([
    pb.HighpassFilter(26),
    pb.Compressor(threshold_db=-18, ratio=1.8, attack_ms=30, release_ms=200),
    pb.Limiter(threshold_db=-3.0, release_ms=120),
])
pre = music + sfx
pre = pre * 10 ** ((-17.0 - meter.integrated_loudness(pre.T)) / 20)
bed = bus(pre.astype(np.float32), SR)
BEATS = tuple(cues.bar_t(b) for b in (7, 13, 23, 29))  # ordinary downbeats in the groove


def build(imp_db, gain_db):
    m = bed * 10 ** (gain_db / 20) + impact * 10 ** (imp_db / 20)
    fo0, fo1 = int((cues.LENGTH - 1.6) * SR), int((cues.LENGTH + 0.6) * SR)
    m = m.copy()
    m[:, fo0:fo1] *= np.linspace(1, 0, fo1 - fo0)[None] ** 1.5
    m[:, fo1:] = 0
    return true_peak_limit(m)


imp_db, gain_db = -12.0, 0.0
has_imp = np.abs(impact).max() > 1e-6
for it in range(8):
    y = build(imp_db, gain_db)
    L = meter.integrated_loudness(y.T)
    lift = np.mean([rms_db(y, h) for h in cues.HITS]) - np.mean([rms_db(y, b) for b in BEATS])
    ok_l = abs(L - meta['target_lufs']) < 0.3
    ok_i = (not has_imp) or abs(lift - meta['lift_db']) < 0.5
    if ok_l and ok_i:
        break
    if has_imp:
        imp_db += float(np.clip(meta['lift_db'] - lift, -6, 6)) * 0.8
    gain_db += float(np.clip(meta['target_lufs'] - L, -4, 4)) * 0.9
print(f'{name}: {L:.1f} LUFS, hits {lift:+.1f} dB over downbeats, peak {20 * np.log10(np.abs(y).max()):.2f} dBFS')
sf.write(os.path.join(OUT, f'soundtrack_{name}.wav'), y.T, SR, subtype='PCM_24')
