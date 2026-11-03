"""Royalty-free background music and sound effects, generated from scratch (no downloads, no copyright)."""
from __future__ import annotations

import numpy as np

from .ffutil import SR

_NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _hz(semi: float) -> float:
    return 440.0 * 2 ** ((semi - 9) / 12)          # semitone 9 (=A) in octave 4 -> 440


def _pluck(freq: float, dur: float, amp: float = 1.0, bright: float = 0.5) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t) + bright * 0.5 * np.sin(4 * np.pi * freq * t) + bright * 0.25 * np.sin(6 * np.pi * freq * t)
    return (amp * s * np.exp(-t * 5.5) * np.minimum(1, t * 400)).astype(np.float32)


def _pad(freqs: list[float], dur: float, amp: float) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.5) * np.minimum(1, (dur - t) / 0.6)
    out = np.zeros(n)
    for f in freqs:
        for det in (-0.4, 0.4):
            out += np.sin(2 * np.pi * (f + det) * t) + 0.3 * np.sin(4 * np.pi * f * t)
    return (amp * out / (2 * len(freqs)) * env).astype(np.float32)


def _kick(amp=1.0) -> np.ndarray:
    t = np.arange(int(SR * 0.22)) / SR
    f = 45 + 90 * np.exp(-t * 28)
    return (amp * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)).astype(np.float32)


def _hat(amp=1.0, rng=None) -> np.ndarray:
    rng = rng or np.random.default_rng(1)
    t = np.arange(int(SR * 0.05)) / SR
    n = rng.standard_normal(len(t))
    n = n - np.concatenate([[0], n[:-1]])             # crude high-pass
    return (amp * n * np.exp(-t * 90)).astype(np.float32)


def _add(buf: np.ndarray, snd: np.ndarray, at: float) -> None:
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(snd))
    buf[i:j] += snd[: j - i]


def music(duration: float, bpm: int, energetic: bool, seed: int = 0) -> np.ndarray:
    """Loopable chord-progression bed. Energetic = kick + hats + arpeggio (Reels); else calm pad + soft arp."""
    rng = np.random.default_rng(seed)
    total = duration + 1.5
    buf = np.zeros(int(total * SR), np.float32)
    root = int(rng.choice([0, 2, 4, 5, 7, 9]))                       # key
    prog = [(0, "min"), (-4, "maj"), (3, "maj"), (-2, "maj")]        # i - VI - III - VII (emotional)
    beat = 60.0 / bpm
    bar = 4 * beat
    k = 0
    while k * bar < total:
        deg, q = prog[k % 4]
        r = root + 57 - 12 + deg + 12                                 # around A3
        third = 3 if q == "min" else 4
        chord = [r, r + third, r + 7]
        t0 = k * bar
        _add(buf, _pad([_hz(c) for c in chord], bar + 0.4, 0.22), t0)
        _add(buf, _pluck(_hz(r - 12), beat * 1.8, 0.55, 0.2), t0)
        _add(buf, _pluck(_hz(r - 12), beat * 1.8, 0.45, 0.2), t0 + 2 * beat)
        arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12 + 12 * 0]
        steps = 8 if energetic else 4
        for s in range(steps):
            _add(buf, _pluck(_hz(arp[s % 4] + (12 if s % 8 >= 4 else 0)), beat * 0.9, 0.16 if energetic else 0.12),
                 t0 + s * bar / steps)
        if energetic:
            for b in range(4):
                _add(buf, _kick(0.55), t0 + b * beat)
                _add(buf, _hat(0.10, rng), t0 + b * beat + beat / 2)
        k += 1
    # tiny echo for space
    d = int(0.27 * SR)
    buf[d:] += 0.22 * buf[:-d]
    fade = int(1.2 * SR)
    out = buf[: int(total * SR)]
    out[-fade:] *= np.linspace(1, 0, fade)
    peak = np.abs(out).max() or 1
    return out / peak * 0.8


def whoosh(dur: float = 0.45, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(SR * dur)
    noise = rng.standard_normal(n)
    # sweep a one-pole low-pass cutoff upward then fade: classic transition whoosh
    cut = np.linspace(0.02, 0.5, n) ** 1.5
    y = np.zeros(n)
    acc = 0.0
    for i in range(n):
        acc += cut[i] * (noise[i] - acc)
        y[i] = acc
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
    y = y * env
    return (y / (np.abs(y).max() or 1) * 0.7).astype(np.float32)


def pop(freq: float = 880.0) -> np.ndarray:
    t = np.arange(int(SR * 0.12)) / SR
    f = freq * (1 + 0.6 * np.exp(-t * 60))
    return (0.6 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28)).astype(np.float32)


def _smooth_env(voice: np.ndarray, rate: int = 100, attack: float = 0.03, release: float = 0.35) -> np.ndarray:
    hop = SR // rate
    n = len(voice) // hop
    e = np.sqrt((voice[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    e = np.clip(e / (np.percentile(e, 95) or 1), 0, 1)
    out = np.zeros(n)
    a, r = np.exp(-1 / (attack * rate)), np.exp(-1 / (release * rate))
    cur = 0.0
    for i, v in enumerate(e):
        coef = a if v > cur else r
        cur = coef * cur + (1 - coef) * v
        out[i] = cur
    return out


def mix(voice: np.ndarray, duration: float, bpm: int, energetic: bool, music_gain: float,
        whoosh_times: list[float], pop_times: list[float], user_music: np.ndarray | None = None,
        seed: int = 0, duck_depth: float = 0.78) -> np.ndarray:
    """voice + auto-ducked music + sfx -> mono float array of length `duration`."""
    n = int(duration * SR)
    v = np.zeros(n, np.float32)
    v[: min(n, len(voice))] = voice[:n]
    m = user_music if user_music is not None else music(duration, bpm, energetic, seed)
    if len(m) < n:                                              # loop user music
        m = np.tile(m, int(np.ceil(n / len(m))))
    m = m[:n].copy()
    env = _smooth_env(v)
    duck = 1 - duck_depth * np.interp(np.arange(n) / SR, np.arange(len(env)) / 100, env)
    m = m * duck * music_gain
    s = np.zeros(n, np.float32)
    w = whoosh(seed=seed)
    for t in whoosh_times:
        _add(s, w * 0.35, max(0, t - 0.28))
    p = pop()
    for t in pop_times:
        _add(s, p * 0.25, t)
    out = v * 0.95 + m + s
    fade = int(0.25 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out
