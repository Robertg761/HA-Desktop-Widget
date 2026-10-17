"""More instruments for the soundtrack options, on top of engine.py.

Every function returns a mono or stereo float array at engine.SR, roughly peak 0.5-1.0 at vel=1.
"""
import numpy as np
import pedalboard as pb

from engine import SR, RNG, adsr, fade_tail, midi_hz, n, noise, saw, sine, sosfilt, supersaw, tvec, softclip, square

# ---------------------------------------------------------------- keys


def epiano(m, dur, vel=0.8, tine=1.0):
    """FM electric piano (Rhodes-like): a 1:1 operator pair for the body, a high ratio pair for
    the tine's attack. Harder hits are brighter. Releases with a short damper fade."""
    rel = 0.35
    total = dur + rel
    t = tvec(total)
    f = midi_hz(m)
    # body: carrier f, modulator f, index decays
    idx = (0.25 + 0.75 * vel) * np.exp(-t / 0.7) + 0.12
    body = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    # tine: very short bright ping at ratio 14
    tn = np.sin(2 * np.pi * f * t + 2.2 * vel * np.exp(-t / 0.012) * np.sin(2 * np.pi * f * 14 * t)) * np.exp(-t / 0.05) * 0.35 * tine
    decay = np.exp(-t / (1.6 * (440 / max(f, 80)) ** 0.35))
    damp = np.ones_like(t)
    k = n(dur)
    damp[k:] = np.exp(-(t[k:] - dur) / 0.09)
    env = (1 - np.exp(-t / 0.002)) * decay * damp
    x = (body * 0.7 + tn) * env * (0.35 + 0.5 * vel)
    # gentle stereo tremolo, as on a suitcase piano
    trem = 0.5 + 0.5 * np.sin(2 * np.pi * 4.2 * t)
    st = np.vstack([x * (0.8 + 0.2 * trem), x * (0.8 + 0.2 * (1 - trem))])
    return fade_tail(st, 15)


def piano(m, dur, vel=0.8):
    """Additive acoustic-style piano: stretched (inharmonic) partials, two slightly detuned
    strings per note, a two-stage decay, a felt hammer thump, and dampers on release."""
    rel = 0.25
    f = midi_hz(m)
    ring = min(6.0, 1.2 + 4.0 * (220 / f) ** 0.6)
    total = min(dur, ring) + rel
    t = tvec(total)
    B = 0.00012 * (f / 130) ** 1.3
    nparts = int(min(28, 9000 / f))
    bright = 0.6 + 0.8 * vel
    L = np.zeros_like(t)
    R = np.zeros_like(t)
    for k in range(1, nparts + 1):
        fk = k * f * np.sqrt(1 + B * k * k)
        if fk > 16000:
            break
        amp = (1.0 / k ** (1.45 - 0.35 * bright)) * (1 + 0.6 * (k == 2))
        tau1 = 0.25 * ring / (1 + 0.35 * k)
        tau2 = ring / (1 + 0.12 * k)
        env = 0.65 * np.exp(-t / tau1) + 0.35 * np.exp(-t / tau2)
        det = 1 + 0.00035 * (1 + 0.1 * k)
        ph = RNG.random() * 2 * np.pi
        L += amp * env * (np.sin(2 * np.pi * fk * t + ph) + 0.8 * np.sin(2 * np.pi * fk * det * t + ph))
        R += amp * env * (np.sin(2 * np.pi * fk * t + ph + 0.3) + 0.8 * np.sin(2 * np.pi * fk / det * t + ph))
    hammer = sosfilt(noise(0.03), 'lowpass', 1200 + 2500 * vel) * np.exp(-tvec(0.03) / 0.006) * 0.25 * vel
    L[: len(hammer)] += hammer
    R[: len(hammer)] += hammer
    damp = np.ones_like(t)
    kd = n(min(dur, ring))
    damp[kd:] = np.exp(-(t[kd:] - t[kd]) / 0.08)
    att = 1 - np.exp(-t / 0.0015)
    st = np.vstack([L, R]) * (att * damp)[None] * (0.09 + 0.13 * vel)
    return fade_tail(st, 12)


# ---------------------------------------------------------------- plucked strings


def _karplus(f, total, bright=0.7, decay=0.996, seed_noise=None):
    """Karplus-Strong string, computed one period at a time (vectorised), then resampled to the
    exact pitch."""
    L = max(4, int(round(SR / f)))
    N = n(total)
    periods = N // L + 2
    exc = seed_noise if seed_noise is not None else RNG.uniform(-1, 1, L)
    # brightness: lowpass the excitation
    a = 0.15 + 0.8 * bright
    buf = exc.copy()
    for i in range(1, L):
        buf[i] = a * buf[i] + (1 - a) * buf[i - 1]
    out = np.empty(periods * L)
    prev = buf
    out[:L] = prev
    for p in range(1, periods):
        shifted = np.concatenate(([prev[-1]], prev[:-1]))
        cur = decay * 0.5 * (prev + shifted)
        out[p * L:(p + 1) * L] = cur
        prev = cur
    # exact pitch: the two-tap average delays half a sample, so the loop plays at SR/(L + 0.5) Hz;
    # stretch that to f
    ratio = (SR / (L + 0.5)) / f
    idx = np.arange(N) / ratio
    y = np.interp(idx, np.arange(len(out)), out)
    return y


def guitar(m, dur=1.2, vel=0.8, bright=0.65, mute=0.0):
    """Steel-string pluck (Karplus-Strong + body resonance). mute>0 shortens it (palm mute)."""
    f = midi_hz(m)
    ring = (2.5 if mute == 0 else 0.25 + 0.6 * (1 - mute))
    total = min(dur, ring) + 0.3
    decay = 0.9985 if mute == 0 else 0.985 - 0.02 * mute
    y = _karplus(f, total, bright=bright * (0.7 + 0.3 * vel), decay=decay)
    t = tvec(total)
    damp = np.ones_like(t)
    kd = n(min(dur, ring))
    damp[kd:] = np.exp(-(t[kd:] - t[kd]) / 0.05)
    y = y * damp
    body = sosfilt(y, 'bandpass', [90, 4000], 2)
    body = pb.Pedalboard([pb.PeakFilter(cutoff_frequency_hz=200, gain_db=4, q=1.2), pb.PeakFilter(cutoff_frequency_hz=2500, gain_db=2, q=0.8)])(body.astype(np.float32)[None], SR)[0]
    return fade_tail(body * 0.5 * vel, 10)


def strum(notes, dur=1.0, vel=0.8, down=True, spread=0.012, bright=0.65, mute=0.0):
    """A strummed chord: the strings sound one after another, a few ms apart."""
    order = notes if down else list(reversed(notes))
    total = dur + 0.4 + spread * len(notes)
    acc = np.zeros(n(total))
    for i, m in enumerate(order):
        g = guitar(m, dur - i * spread, vel * (0.85 + 0.15 * RNG.random()), bright, mute)
        k = n(i * spread)
        acc[k:k + len(g)] += g[: len(acc) - k]
    return acc / max(1, len(notes)) ** 0.5


def pick_bass(m, dur, vel=0.8):
    """Picked electric bass: a dark KS string plus a sine fundamental."""
    f = midi_hz(m)
    total = dur + 0.08
    y = _karplus(f, total, bright=0.35, decay=0.9992)
    t = tvec(total)
    s = sine(f, total) * np.exp(-t / 1.5) * 0.6
    env = adsr(dur, a=0.003, d=0.3, s=0.75, r=0.06, total=total)
    out = sosfilt(y * 0.6 + s, 'lowpass', 2200, 2) * env
    return fade_tail(softclip(out * 1.3 * vel, 1.1), 6)


def sub_bass(m, dur, vel=0.8, attack=0.01):
    """Clean sine sub with a little second harmonic, for lo-fi and minimal tracks."""
    f = midi_hz(m)
    total = dur + 0.08
    t = tvec(total)
    x = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)
    env = adsr(dur, a=attack, d=0.2, s=0.85, r=0.07, total=total)
    return fade_tail(x * env * 0.6 * vel, 6)


# ---------------------------------------------------------------- sustained


def strings(notes, dur, vel=0.7, attack=0.35, release=0.8, bright=0.5):
    """String ensemble: per note, several detuned saws with slow random vibrato, darkened,
    stereo spread, soft attack."""
    total = dur + release
    t = tvec(total)
    L = np.zeros_like(t)
    R = np.zeros_like(t)
    for m in notes:
        f = midi_hz(m)
        for v in range(6):
            rate = 4.5 + RNG.random() * 1.5
            depth = 0.0025 + RNG.random() * 0.002
            vib = 1 + depth * np.sin(2 * np.pi * rate * t + RNG.random() * 6.28) * np.clip(t / 0.4, 0, 1)
            det = 1 + (v - 2.5) * 0.0018
            x = saw(f * det * vib, total)
            if v % 2:
                L += x
            else:
                R += x
    st = np.vstack([L, R]) / (len(notes) * 3) ** 0.7
    cutoff = 900 + 3200 * bright
    st = np.vstack([sosfilt(st[0], 'lowpass', cutoff, 2), sosfilt(st[1], 'lowpass', cutoff, 2)])
    st = np.vstack([sosfilt(st[0], 'highpass', 120, 2), sosfilt(st[1], 'highpass', 120, 2)])
    env = adsr(dur, a=attack, d=0.3, s=0.9, r=release, total=total)
    return fade_tail(st * env[None] * vel * 0.5, 30)


def spiccato(m, vel=0.7, bright=0.6):
    """A short bowed note for string ostinatos."""
    dur = 0.16
    total = 0.45
    t = tvec(total)
    f = midi_hz(m)
    x = sum(saw(f * (1 + d), total) for d in (-0.003, 0.0, 0.0035)) / 3
    env = (1 - np.exp(-t / 0.008)) * np.exp(-t / 0.09)
    y = sosfilt(x * env, 'lowpass', 1200 + 3000 * bright, 2)
    y = sosfilt(y, 'highpass', 150, 2)
    return fade_tail(y * vel * 0.6, 20)


def brass(notes, dur, vel=0.7, attack=0.06):
    """Warm brass section: saws through a filter that opens with the swell."""
    total = dur + 0.3
    t = tvec(total)
    acc = np.zeros(len(t))
    for m in notes:
        f = midi_hz(m)
        scoop = 1 - 0.01 * np.exp(-t / 0.05)
        acc += sum(saw(f * scoop * (1 + d), total) for d in (-0.004, 0.003)) / 2
    acc /= max(1, len(notes)) ** 0.6
    env = adsr(dur, a=attack, d=0.25, s=0.85, r=0.25, total=total)
    cut = 500 + (1800 + 2600 * vel) * np.clip(env, 0, 1)
    y = np.zeros_like(acc)
    blk = 256
    from scipy.signal import butter, sosfilt as _sf
    zi = None
    for i in range(0, len(acc), blk):
        c = float(cut[min(i, len(cut) - 1)])
        sos = butter(2, min(c, SR * 0.45), btype='low', fs=SR, output='sos')
        seg = acc[i:i + blk]
        if zi is None:
            from scipy.signal import sosfilt_zi
            zi = sosfilt_zi(sos) * 0
        y[i:i + blk], zi = _sf(sos, seg, zi=zi)
    return fade_tail(y * env * vel * 0.55, 20)


def choir(notes, dur, vel=0.6, vowel='a', attack=0.4, release=1.0):
    """'Aah' choir pad: detuned saws through vowel formants."""
    F = {'a': [(800, 1.0), (1150, 0.5), (2900, 0.25)], 'o': [(450, 1.0), (800, 0.4), (2830, 0.15)], 'u': [(350, 1.0), (600, 0.3), (2700, 0.1)]}[vowel]
    total = dur + release
    acc = np.zeros((2, n(total)))
    for m in notes:
        acc += supersaw(midi_hz(m), total, voices=5, detune=0.08, spread=0.9)
    out = np.zeros_like(acc)
    for fc, g in F:
        for ch in range(2):
            out[ch] += sosfilt(acc[ch], 'bandpass', [fc * 0.85, fc * 1.15], 2) * g
    env = adsr(dur, a=attack, d=0.3, s=0.9, r=release, total=total)
    return fade_tail(out * env[None] * vel * 2.2 / max(1, len(notes)) ** 0.5, 30)


# ---------------------------------------------------------------- mallets


def marimba(m, vel=0.8):
    dur = 1.0
    t = tvec(dur)
    f = midi_hz(m)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.45) + 0.35 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t / 0.08)
         + 0.12 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t / 0.02))
    mallet = sosfilt(noise(0.01), 'bandpass', [800, 4000], 2) * np.exp(-tvec(0.01) / 0.002) * 0.3
    x[: len(mallet)] += mallet
    return fade_tail(x * (1 - np.exp(-t / 0.001)) * vel * 0.5, 20)


def glock(m, vel=0.8):
    dur = 1.6
    t = tvec(dur)
    f = midi_hz(m)
    x = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.3) + 0.12 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.1)
    return fade_tail(x * np.exp(-t / 0.55) * (1 - np.exp(-t / 0.0008)) * vel * 0.4, 20)


# ---------------------------------------------------------------- drums


def taiko(f=62, vel=1.0):
    dur = 1.4
    t = tvec(dur)
    pitch = f * (1 + 0.5 * np.exp(-t / 0.04))
    body = sine(pitch, dur) * np.exp(-t / 0.45)
    skin = sosfilt(noise(dur), 'lowpass', 900, 2) * np.exp(-t / 0.05) * 0.5
    return fade_tail(softclip((body + skin) * 1.2 * vel, 1.3), 30)


def boom_kick(vel=1.0):
    """Round, soft kick for lo-fi / hip-hop."""
    dur = 0.6
    t = tvec(dur)
    f = 50 + 70 * np.exp(-t / 0.035)
    x = sine(f, dur) * np.exp(-t / 0.3)
    thump = sosfilt(noise(0.02), 'lowpass', 600, 2) * np.exp(-tvec(0.02) / 0.006) * 0.4
    x[: len(thump)] += thump
    return fade_tail(softclip(x * 1.3 * vel, 1.2), 20)


def crack_snare(vel=1.0, tone=200):
    dur = 0.35
    t = tvec(dur)
    body = sine(tone * (1 + 0.3 * np.exp(-t / 0.01)), dur) * np.exp(-t / 0.07) * 0.5
    nz = sosfilt(noise(dur), 'bandpass', [1200, 7000], 2) * np.exp(-t / 0.12) * 0.75
    return fade_tail((body + nz) * vel, 15)


def rim(vel=1.0):
    dur = 0.12
    t = tvec(dur)
    x = sine(1700, dur) * np.exp(-t / 0.012) + sosfilt(noise(dur), 'bandpass', [2000, 6000], 2) * np.exp(-t / 0.008) * 0.5
    return fade_tail(x * vel * 0.5, 5)


def shaker(vel=1.0, dur=0.09):
    t = tvec(dur)
    x = sosfilt(noise(dur), 'bandpass', [5000, 12000], 2)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return fade_tail(x * env * vel * 0.35, 4)


def snap(vel=1.0):
    dur = 0.18
    t = tvec(dur)
    x = sosfilt(noise(dur), 'bandpass', [1500, 5000], 2) * np.exp(-t / 0.025)
    return fade_tail(x * vel * 0.6, 6)


def gated_snare(vel=1.0):
    """80s gated-reverb snare."""
    dur = 0.4
    t = tvec(dur)
    core = np.zeros(n(dur))
    c = crack_snare(vel, 190)
    core[: len(c)] = c[: n(dur)]
    tail = sosfilt(noise(dur), 'bandpass', [800, 9000], 2) * (t < 0.22) * np.exp(-t / 0.4) * 0.45 * vel
    out = (core + tail) * 0.55
    return fade_tail(out, 8)


def vinyl(dur, density=7.0, hiss=0.02):
    """Record crackle and hiss."""
    N = n(dur)
    x = sosfilt(noise(dur), 'bandpass', [400, 9000], 2) * hiss
    k = RNG.poisson(density * dur)
    for p in RNG.integers(0, N - 200, k):
        L = int(RNG.integers(20, 160))
        x[p:p + L] += RNG.uniform(-1, 1) * np.exp(-np.arange(L) / (L / 4)) * RNG.uniform(0.05, 0.25)
    return np.vstack([x, np.roll(x, 37)])


def sub_drop(dur=1.5, f0=70, f1=30):
    t = tvec(dur)
    f = f1 + (f0 - f1) * np.exp(-t / (dur / 3))
    return fade_tail(sine(f, dur) * np.exp(-t / (dur / 2)) * (1 - np.exp(-t / 0.004)) * 0.9, 30)


def lofi(x, bits=11, cutoff=5500, wow=0.0):
    """Tape-ish lo-fi: lowpass, light bit reduction, optional wow."""
    x = np.atleast_2d(x).astype(np.float32)
    if wow > 0:
        N = x.shape[1]
        tt = np.arange(N)
        warp = tt + wow * SR * 0.002 * np.sin(2 * np.pi * 0.6 * tt / SR)
        x = np.vstack([np.interp(warp, tt, ch) for ch in x]).astype(np.float32)
    return pb.Pedalboard([pb.LowpassFilter(cutoff), pb.Bitcrush(bit_depth=bits)])(x, SR)
