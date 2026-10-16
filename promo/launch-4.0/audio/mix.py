"""Balance stems (+ optional sfx track), master, and write the final soundtrack."""
import os, sys, numpy as np, soundfile as sf, pedalboard as pb, pyloudnorm as pyln
sys.path.insert(0, os.path.dirname(__file__))
from warp import T, DURATION  # original edit time -> spot time
OUT = os.path.join(os.path.dirname(__file__), 'out')
SR = 48000
GAINS_DB = {'drums': -1.5, 'bass': -3.0, 'pad': 1.5, 'arp': -3.0, 'lead': -1.5, 'bells': -10.0, 'fx': -12.0}
DUCK = None
def load(name):
    x, sr = sf.read(os.path.join(OUT, name)); assert sr == SR; return x.T
RIDE = [  # (edit time, dB) music gain ride: the drop and the finale step up
    (0.0, -2.0), (7.75, -2.0), (7.8, 0.0), (9.5, 0.0), (10.5, -2.5), (23.9, -2.5), (24.1, -3.5),
    (39.9, -3.5), (40.1, -1.0), (46.0, -1.5), (51.6, 0.0), (62.0, 0.0),
]
RIDE = [(T(t), g) for t, g in RIDE] + [(DURATION + 1, 0.0)]
music = None
for name, g in GAINS_DB.items():
    y = load(f'stem_{name}.wav') * 10 ** (g / 20)
    music = y if music is None else music + y
N = music.shape[1]
tt = np.arange(N) / SR
ride_db = np.interp(tt, [p[0] for p in RIDE], [p[1] for p in RIDE])
music = music * 10 ** (ride_db / 20)[None]
sfx_path = os.path.join(OUT, 'sfx.wav')
if os.path.exists(sfx_path) and '--no-sfx' not in sys.argv:
    sfx = load('sfx.wav')
    sfx = np.pad(sfx, ((0, 0), (0, max(0, N - sfx.shape[1]))))[:, :N]
    music = music + sfx * 10 ** (float(os.environ.get('SFX_DB', '-4')) / 20)
meter = pyln.Meter(SR)
pre = meter.integrated_loudness(music.T)
music = music * 10 ** ((-17.0 - pre) / 20)
bus_chain = pb.Pedalboard([
    pb.HighpassFilter(28),
    pb.LowShelfFilter(cutoff_frequency_hz=70, gain_db=-3.5, q=0.7),
    pb.PeakFilter(cutoff_frequency_hz=180, gain_db=1.0, q=0.8),
    pb.PeakFilter(cutoff_frequency_hz=3200, gain_db=2.5, q=0.7),
    pb.HighShelfFilter(cutoff_frequency_hz=7000, gain_db=5.0, q=0.7),
    pb.Compressor(threshold_db=-20, ratio=2.0, attack_ms=25, release_ms=180),
    pb.Gain(1.0),
    pb.Limiter(threshold_db=-4.5, release_ms=120),
])
music_m = bus_chain(music.astype(np.float32), SR)
impact_raw = load('stem_impact.wav')
impact_raw = np.pad(impact_raw, ((0, 0), (0, max(0, N - impact_raw.shape[1]))))[:, :N]


def true_peak_limit(x, ceiling_db=-1.0, os_factor=4, window_ms=24.0):
    """Lookahead brickwall on the 4x-oversampled peak envelope (min filter + moving average of
    the same length, which never lets the gain exceed what each sample needs)."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    from scipy.signal import resample_poly

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
    seg = x[:, int(t * SR) : int((t + dur) * SR)]
    return 20 * np.log10(np.sqrt((seg**2).mean()) + 1e-12)


HITS = tuple(T(t) for t in (8.0, 52.0, 56.0))
BEATS = tuple(T(t) for t in (16.0, 24.0, 32.0, 40.0))


def build(imp_db, pre_db):
    m = (music_m * 10 ** (pre_db / 20)) + impact_raw * 10 ** (imp_db / 20)
    fo0, fo1 = int((DURATION - 1.6) * SR), int((DURATION + 0.6) * SR)
    m = m.copy()
    m[:, fo0:fo1] *= np.linspace(1, 0, fo1 - fo0) ** 1.5
    m[:, fo1:] = 0
    return true_peak_limit(m)


pre_db, imp_db = 0.0, -20.0
for it in range(6):
    y = build(imp_db, pre_db)
    lift = np.mean([rms_db(y, h) for h in HITS]) - np.mean([rms_db(y, b) for b in BEATS])
    L = meter.integrated_loudness(y.T)
    print(f'iter {it}: impact {imp_db:+.1f} dB, pre {pre_db:+.1f} dB -> lift {lift:.1f} dB, {L:.1f} LUFS')
    done = abs(lift - 4.5) < 0.4 and abs(L + 14.0) < 0.4
    if done:
        break
    imp_db += np.clip(4.5 - lift, -6, 6) * 0.8
    pre_db += np.clip(-14.0 - L, -4, 4) * 0.9
print(f'final LUFS {meter.integrated_loudness(y.T):.1f}  peak {20*np.log10(np.abs(y).max()):.2f} dBFS')
gaps = {round(T(g), 2): rms_db(y, T(g), 0.18) for g in (7.80, 51.66)}
print('rms just before the hits', {k: round(v, 1) for k, v in gaps.items()}, 'vs groove', round(np.mean([rms_db(y, b - 0.4, 0.18) for b in BEATS]), 1))
print('drop step: 7.0-7.7', round(meter.integrated_loudness(y[:, int(7.0*SR):int(7.7*SR)].T) if False else rms_db(y, 7.0, 0.7), 1), ' 8.0-9.0', round(rms_db(y, 8.0, 1.0), 1))
name = 'soundtrack.wav' if '--no-sfx' not in sys.argv else 'music_master.wav'
sf.write(os.path.join(OUT, name), y.T, SR, subtype='PCM_24')
