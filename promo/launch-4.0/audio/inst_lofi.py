"""Instruments for the LO-FI soundtrack option (chillhop): vibraphone with motor tremolo, celesta,
sleigh bells, dusty boom-bap kit, tape-strings pad, a warm lo-fi impact, reverse-reverb swells and
a lowpassed ping-pong delay. Built on engine.py / instruments.py."""
import numpy as np
import pedalboard as pb

from engine import (SR, RNG, adsr, crash, fade_tail, midi_hz, n, noise, pan, sine, softclip,
                    sosfilt, square, stereo, tvec)
from instruments import epiano, strings


# ---------------------------------------------------------------- mallets
def vibes(m, dur=1.2, vel=0.7, motor=5.2, depth=0.28, mallet=1.0):
    """Vibraphone, soft yarn mallets: fundamental, the bar's tuned 4th partial and a short ~10x
    partial, mallet thump, damper pedal release and the motor's amplitude tremolo (slightly
    phase-offset L/R so it shimmers)."""
    f = midi_hz(m)
    ring = float(np.clip(3.2 * (440 / f) ** 0.55, 0.9, 5.0))
    total = min(dur, ring) + 0.45
    t = tvec(total)
    p1 = np.sin(2 * np.pi * f * t) * np.exp(-t / (ring * 0.5))
    p4 = (0.12 + 0.22 * vel) * np.sin(2 * np.pi * f * 3.98 * t) * np.exp(-t / 0.32) if f * 4 < 15000 else 0
    p10 = (0.04 + 0.1 * vel) * np.sin(2 * np.pi * f * 9.85 * t) * np.exp(-t / 0.05) if f * 10 < 16000 else 0
    x = (p1 + p4 + p10) * (1 - np.exp(-t / 0.0012))
    th = sosfilt(noise(0.02), 'lowpass', 1500 + 3500 * vel, 2) * np.exp(-tvec(0.02) / 0.0035) * 0.22 * vel * mallet
    x[: len(th)] += th
    damp = np.ones_like(t)
    k = n(min(dur, ring))
    damp[k:] = np.exp(-(t[k:] - t[k]) / 0.11)
    x = x * damp
    ph = RNG.random() * 6.28
    L = x * (1 - depth * (0.5 + 0.5 * np.sin(2 * np.pi * motor * t + ph)))
    R = x * (1 - depth * (0.5 + 0.5 * np.sin(2 * np.pi * motor * t + ph + 0.9)))
    return fade_tail(np.vstack([L, R]) * vel * 0.42, 20)


def celesta(m, vel=0.7, dur=1.6):
    """Celesta: felt hammer on steel plates over wooden resonators - nearly pure, sweet and short,
    a soft octave and a faint inharmonic shimmer."""
    f = midi_hz(m)
    t = tvec(dur)
    tau = float(np.clip(0.75 * (880 / f) ** 0.4, 0.25, 1.2))
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
         + 0.22 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / (tau * 0.35))
         + 0.07 * np.sin(2 * np.pi * f * 4.16 * t) * np.exp(-t / 0.05))
    x *= 1 - np.exp(-t / 0.0015)
    th = sosfilt(noise(0.012), 'bandpass', [600, 3500], 2) * np.exp(-tvec(0.012) / 0.002) * 0.12
    x[: len(th)] += th
    return fade_tail(x * vel * 0.4, 20)


def sleigh(vel=0.7, length=0.1):
    """One shake of sleigh bells: a cloud of small inharmonic bells plus a bright rattle."""
    total = length + 0.22
    out = np.zeros(n(total))
    t = tvec(total)
    cnt = 9 + int(9 * vel)
    for _ in range(cnt):
        off = RNG.uniform(0, length) ** 1.3 / max(length, 1e-3) ** 0.3
        f = RNG.uniform(2600, 6800)
        i = n(off)
        s = t[: len(out) - i]
        tau = RNG.uniform(0.03, 0.08)
        out[i:] += (np.sin(2 * np.pi * f * s) + 0.5 * np.sin(2 * np.pi * f * 2.41 * s)) * np.exp(-s / tau) * RNG.uniform(0.4, 1.0)
    shape = np.exp(-np.maximum(0, t - length * 0.5) / 0.03) * np.clip(t / 0.004, 0, 1)
    out += sosfilt(noise(total), 'bandpass', [5000, 11000], 2) * shape * 0.9
    out = sosfilt(out, 'highpass', 2400, 2)
    return fade_tail(out * 0.05 * vel, 8)


# ---------------------------------------------------------------- dusty kit
def lo_kick(vel=1.0):
    """Round boom-bap kick: soft beater, woolly body, gentle saturation."""
    dur = 0.4
    t = tvec(dur)
    f = 56 + 70 * np.exp(-t / 0.03) + 25 * np.exp(-t / 0.006)  # more knock, less 808 boom
    x = sine(f, dur) * np.exp(-t / 0.14)
    beater = sosfilt(noise(0.015), 'lowpass', 2200, 2) * np.exp(-tvec(0.015) / 0.004) * 0.5
    x[: len(beater)] += beater
    return fade_tail(softclip(x * 1.5 * vel, 1.4) * (0.6 + 0.4 * vel), 20)


def lo_snare(vel=1.0):
    """Dusty, laid-back snare: low tuned body, papery wires, darkened."""
    dur = 0.38
    t = tvec(dur)
    body = (sine(178 * (1 + 0.25 * np.exp(-t / 0.012)), dur) * 0.55 + sine(332, dur) * 0.18) * np.exp(-t / 0.055)
    wires = sosfilt(noise(dur), 'bandpass', [1100, 5200], 2) * np.exp(-t / (0.10 + 0.04 * vel)) * 0.8
    x = body + wires
    x = sosfilt(x, 'lowpass', 6500, 2)
    return fade_tail(softclip(x * 1.2, 1.2) * vel * 0.8, 15)


def lo_hat(vel=0.6, open_=False):
    """Soft closed / open hat: noise + a few metallic partials, high-passed, rolled-off top."""
    dur = 0.32 if open_ else 0.07
    t = tvec(dur)
    metal = sum(square(fq, dur) for fq in (3270, 4510, 5880, 7020)) / 4
    x = sosfilt(noise(dur) * 0.75 + metal * 0.3, 'highpass', 6200, 4)
    x = sosfilt(x, 'lowpass', 11000, 2)
    tau = 0.13 if open_ else (0.014 + 0.012 * vel)
    env = np.exp(-t / tau) * np.clip(t / 0.0008, 0, 1)
    return fade_tail(x * env * 0.45 * vel, 4)


def dusty_crash(dur=3.0):
    c = crash(dur)
    c = np.vstack([sosfilt(ch, 'lowpass', 6500, 2) for ch in c])
    return pb.Pedalboard([pb.Bitcrush(bit_depth=10), pb.LowpassFilter(7000)])(c.astype(np.float32), SR) * 1.0


def lofi_hit(dur=3.0, crash_amt=1.0, snare_amt=0.6, sub_amt=1.0, root_hz=43.65, body_tau=0.75):
    """The lo-fi 'hit': a deep tape-thump kick whose sub tail settles on a tuned root (F1 by
    default, so it never beats against the bass), a dusty crash and a roomy snare crack, glued
    together with a little plate."""
    t = tvec(dur)
    f = root_hz + 90 * np.exp(-t / 0.05) + 6 * np.exp(-t / 0.25)
    body = sine(f, dur) * np.exp(-t / body_tau) * sub_amt
    thump = sosfilt(noise(dur), 'lowpass', 320, 2) * np.exp(-t / 0.07) * 0.9
    beater = sosfilt(noise(0.02), 'bandpass', [700, 3500], 2) * np.exp(-tvec(0.02) / 0.004) * 0.4
    low = body + thump
    low[: len(beater)] += beater
    low = softclip(low * 1.3, 1.3)
    st = stereo(low).astype(np.float64)
    hi = np.zeros_like(st)
    c = dusty_crash(dur)
    hi[:, : c.shape[1]] += c[:, : hi.shape[1]] * 0.55 * crash_amt
    s = lo_snare(1.0)
    hi[:, : len(s)] += s[None] * snare_amt
    hi = pb.Pedalboard([pb.Reverb(room_size=0.7, damping=0.6, wet_level=0.28, dry_level=0.85, width=0.9)])(hi.astype(np.float32), SR)
    return fade_tail(st + hi, 120)


# ---------------------------------------------------------------- pads / fx
def tape_pad(notes, dur, vel=0.5, attack=0.6, release=1.2):
    """Warm, dark 'tape strings' pad."""
    return strings(notes, dur, vel=vel, attack=attack, release=release, bright=0.18)


def rev_swell(notes, length=2.0, vel=0.6, room=0.95):
    """Reverse-reverb swell of a Rhodes chord: rises over `length` s and cuts off exactly at its
    end (place it at hit - length)."""
    ch = sum(epiano(m, 0.8, vel) for m in notes)
    buf = np.zeros((2, n(length + 3.0)), dtype=np.float32)
    buf[:, : ch.shape[1]] += ch
    wet = pb.Pedalboard([pb.Reverb(room_size=room, damping=0.5, wet_level=1.0, dry_level=0.15, width=1.0),
                         pb.LowpassFilter(5000)])(buf, SR)
    seg = wet[:, : n(length)][:, ::-1]
    return seg * np.linspace(0, 1, seg.shape[1])[None] ** 1.6


def pingpong(x, d=0.375, fb=0.38, taps=6, lp=3200):
    """Lowpassed ping-pong delay (wet only): echoes alternate L/R and darken as they repeat."""
    mono = np.asarray(x).mean(axis=0)
    out = np.zeros((2, len(mono)))
    cur = mono.copy()
    for k in range(1, taps + 1):
        cur = sosfilt(cur, 'lowpass', lp, 1)
        sh = n(d * k)
        if sh >= len(mono):
            break
        g = fb ** (k - 1) * 0.6
        out[k % 2, sh:] += cur[: len(mono) - sh] * g
    return out


def place_pan(trk, at, x, p, gain=1.0):
    trk.add(at, pan(x, p), gain)


# ---------------------------------------------------------------- keys / bass with more character
def rhodes_note(m, dur, vel=0.6, bark=1.0):
    """Rhodes: the FM epiano plus the pickup's even-harmonic 'bark', which grows with velocity
    (gives the keys presence in the mids instead of a pure, dull fundamental)."""
    from instruments import epiano as _ep
    x = _ep(m, dur, vel, tine=1.7)
    sq = x * x
    sq = sq - np.vstack([sosfilt(ch, 'lowpass', 35, 2) for ch in sq])  # drop the DC / envelope thump
    return x + bark * (0.35 + 1.1 * vel) * sq


def lofi_bass(m, dur, vel=0.8, body=0.65):
    """Round sub (sine + 2nd) with a soft, lowpassed saw 'finger' layer so the line still reads on
    small speakers."""
    from instruments import sub_bass as _sb
    from engine import saw as _saw
    s = _sb(m, dur, vel, attack=0.008)
    f = float(midi_hz(m))
    total = dur + 0.08
    z = sosfilt(_saw(f, total), 'lowpass', min(650.0, f * 6), 2)
    env = adsr(dur, a=0.006, d=0.3, s=0.45, r=0.06, total=total)
    out = s.copy()
    k = min(len(out), len(z))
    out[:k] += (z * env)[:k] * body * vel * 0.6
    return out


def lo_ride(vel=0.5):
    """Dusty ride: a cluster of inharmonic metallic partials with a soft stick tick."""
    dur = 0.9
    t = tvec(dur)
    metal = sum(square(fq, dur) * a for fq, a in ((2980, 1.0), (4170, 0.8), (5310, 0.7), (6650, 0.5), (8120, 0.35))) / 3.4
    x = sosfilt(metal * 0.6 + noise(dur) * 0.25, 'bandpass', [3500, 10000], 2)
    env = np.exp(-t / 0.35) * 0.7 + np.exp(-t / 0.03) * 0.3
    tick = sosfilt(noise(0.006), 'bandpass', [2000, 6000], 2) * np.exp(-tvec(0.006) / 0.0015) * 0.4
    x = x * env
    x[: len(tick)] += tick
    return fade_tail(x * vel * 0.32, 30)


def peak_tame(x, ceiling=0.5, window_ms=12.0, release_ms=60.0):
    """Gentle look-ahead peak limiter for the music bus: only the spikes above `ceiling` (mallet and
    snare transients) are pulled down, with a smoothed gain envelope; everything else is untouched
    (pedalboard's Limiter adds make-up gain and compresses the whole mix instead)."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    x = np.asarray(x, dtype=np.float64)
    env = np.abs(x).max(axis=0)
    g = np.minimum(1.0, ceiling / np.maximum(env, 1e-9))
    w = max(3, int(SR * window_ms / 1000))
    g = minimum_filter1d(g, size=w, mode='nearest')
    g = uniform_filter1d(g, size=w, mode='nearest')
    r = max(3, int(SR * release_ms / 1000))
    g = np.minimum(g, uniform_filter1d(minimum_filter1d(g, size=r, mode='nearest'), size=r, mode='nearest'))
    return x * g[None]
