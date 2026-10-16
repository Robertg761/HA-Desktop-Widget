"""Helpers shared by the soundtrack options (audio/options/*.py)."""
import json
import os
import sys

import numpy as np
import pedalboard as pb
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from engine import SR, Track  # noqa: E402
import cues  # noqa: E402

OUT = os.path.join(HERE, 'out')


def track():
    """An empty stereo track the length of the spot (87 s)."""
    return Track(cues.DUR)


def bus(x, *plugins):
    """Run a (2, N) buffer through pedalboard plugins."""
    return pb.Pedalboard(list(plugins))(np.asarray(x, dtype=np.float32), SR)


def sidechain(x, times, depth=0.5, release=0.16):
    """Duck a (2, N) buffer under each time in `times` (kick pumping)."""
    N = x.shape[1]
    g = np.ones(N)
    for tk in times:
        i = int(tk * SR)
        j = min(N, i + int(release * 4 * SR))
        if i >= N:
            continue
        s = np.arange(j - i) / SR
        g[i:j] = np.minimum(g[i:j], 1 - depth * np.exp(-s / release) * np.clip(s / 0.004, 0, 1) ** 0.5)
    return x * g[None]


def write(name, music, impact=None, meta=None):
    """Save an option's stems for audio/master.py. `music` is the full balanced music mix (no
    big hits); `impact` holds the hits at cues.HITS so mastering can give them headroom."""
    d = os.path.join(OUT, f'opt_{name}')
    os.makedirs(d, exist_ok=True)
    N = int(cues.DUR * SR)

    def fit(x):
        x = np.asarray(x, dtype=np.float64)
        x = np.atleast_2d(x)
        if x.shape[0] == 1:
            x = np.vstack([x, x])
        return np.pad(x, ((0, 0), (0, max(0, N - x.shape[1]))))[:, :N]

    mus = fit(music)
    peak = np.abs(mus).max()
    if peak > 0:
        mus = mus / peak * 0.7
    sf.write(os.path.join(d, 'music.wav'), mus.T.astype(np.float32), SR, subtype='FLOAT')
    if impact is not None:
        imp = fit(impact)
        sf.write(os.path.join(d, 'impact.wav'), imp.T.astype(np.float32), SR, subtype='FLOAT')
    json.dump(meta or {}, open(os.path.join(d, 'meta.json'), 'w'))
    print(f'wrote {d} (music peak before normalising {peak:.2f})')
