from __future__ import annotations

"""Simple stereo mixing utilities.

This module turns mono instrument stems into a stereo master bus.  Each track
can specify gain, pan, a single-band EQ and a reverb send amount via a
configuration mapping.  A shared reverb bus is generated for keys and pads (or
any track that sets a send amount) and the final mix passes through a light bus
compressor followed by a basic peak limiter targeting a user supplied dBFS
threshold (``-0.1`` by default).
"""

from typing import Any, Mapping, Dict
import math
import numpy as np


def _apply_gain_pan(signal: np.ndarray, gain_db: float, pan: float) -> np.ndarray:
    """Apply gain (in dB) and constant‑power pan to ``signal``.

    Parameters
    ----------
    signal:
        Mono input array.
    gain_db:
        Gain in decibels.
    pan:
        Position in the stereo field, ``-1`` hard left, ``1`` hard right.
    """
    gain = 10 ** (gain_db / 20.0)
    pan = max(-1.0, min(1.0, pan))
    left = signal * gain * math.sqrt(0.5 * (1.0 - pan))
    right = signal * gain * math.sqrt(0.5 * (1.0 + pan))
    return np.stack([left, right], axis=1)


def _apply_peaking_eq(
    signal: np.ndarray, sr: int, freq: float, gain_db: float, q: float = 1.0
) -> np.ndarray:
    """Apply a simple peaking EQ filter.

    Parameters
    ----------
    signal:
        Mono input array.
    sr:
        Sample rate of ``signal``.
    freq:
        Centre frequency of the bell filter.
    gain_db:
        Gain at ``freq`` in decibels. Zero leaves ``signal`` unchanged.
    q:
        Quality factor controlling bandwidth of the boost/cut.
    """

    if gain_db == 0.0 or freq <= 0.0 or freq >= sr / 2:
        return signal

    a = 10 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * freq / sr
    alpha = math.sin(w0) / (2.0 * q)
    cos_w0 = math.cos(w0)

    b0 = 1.0 + alpha * a
    b1 = -2.0 * cos_w0
    b2 = 1.0 - alpha * a
    a0 = 1.0 + alpha / a
    a1 = -2.0 * cos_w0
    a2 = 1.0 - alpha / a

    b0 /= a0
    b1 /= a0
    b2 /= a0
    a1 /= a0
    a2 /= a0

    out = np.zeros_like(signal, dtype=np.float32)
    x1 = x2 = y1 = y2 = 0.0
    for i, x0 in enumerate(signal):
        y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def _feedback_delay(signal: np.ndarray, delay: int, decay: float) -> np.ndarray:
    """Return ``signal`` passed through a simple feedback delay."""
    out = np.zeros_like(signal)
    if delay <= 0:
        return out
    for i in range(len(signal)):
        out[i] = signal[i]
        if i >= delay:
            out[i] += decay * out[i - delay]
    return out


def _simple_reverb(stereo: np.ndarray, sr: int, decay: float) -> np.ndarray:
    """Create a small stereo reverb for ``stereo`` input.

    The implementation uses three feedback delays per channel which is cheap
    but sufficient for adding a bit of spaciousness to the mix.
    """
    delays = [int(sr * t) for t in (0.0297, 0.0371, 0.0411)]
    out = np.zeros_like(stereo)
    for d in delays:
        out[:, 0] += _feedback_delay(stereo[:, 0], d, decay)
        out[:, 1] += _feedback_delay(stereo[:, 1], d, decay)
    return out / len(delays)


def _plate_reverb(
    stereo: np.ndarray,
    sr: int,
    decay: float,
    predelay: float = 0.0,
    damp: float = 0.5,
) -> np.ndarray:
    """Return a simple plate style reverb for ``stereo`` input.

    A small network of four parallel comb filters followed by two all‑pass
    filters is used which loosely follows the classic Schroeder/plate reverb
    topology.  ``predelay`` delays the input before the comb filters and
    ``damp`` controls a one‑pole low‑pass in the feedback paths to remove
    high‑frequency content over time.
    """

    if decay <= 0.0:
        return np.zeros_like(stereo)

    # Pre‑delay simply pads the input and truncates the output back to the
    # original length so the caller's buffer size is unchanged.
    n = len(stereo)
    pred = max(0, int(predelay * sr))
    if pred > 0:
        stereo = np.pad(stereo, ((pred, 0), (0, 0)))

    def comb_filter(ch: np.ndarray, delay: int) -> np.ndarray:
        out = np.zeros_like(ch, dtype=np.float32)
        buf = np.zeros(delay, dtype=np.float32)
        lp = 0.0
        for i, x in enumerate(ch):
            y = buf[i % delay]
            # Simple one‑pole low‑pass in the feedback path.
            lp = y + damp * (lp - y)
            buf[i % delay] = x + lp * decay
            out[i] = y
        return out

    # Roughly tuned comb delays (in seconds) – values chosen to provide a
    # dense tail while remaining inexpensive.
    comb_delays = [int(sr * t) for t in (0.0297, 0.0371, 0.0411, 0.0437)]
    out = np.zeros_like(stereo, dtype=np.float32)
    for d in comb_delays:
        if d <= 0:
            continue
        out[:, 0] += comb_filter(stereo[:, 0], d)
        out[:, 1] += comb_filter(stereo[:, 1], d)
    out /= max(len(comb_delays), 1)

    def allpass_filter(ch: np.ndarray, delay: int, feedback: float) -> np.ndarray:
        buf = np.zeros(delay, dtype=np.float32)
        out = np.zeros_like(ch, dtype=np.float32)
        for i, x in enumerate(ch):
            bufout = buf[i % delay]
            y = bufout - x
            buf[i % delay] = x + bufout * feedback
            out[i] = y
        return out

    # Two small all‑pass filters add a little diffusion to the tail.
    for d in (int(0.005 * sr), int(0.0017 * sr)):
        if d > 0:
            out[:, 0] = allpass_filter(out[:, 0], d, 0.5)
            out[:, 1] = allpass_filter(out[:, 1], d, 0.5)

    return out[:n]


def _chorus(
    stereo: np.ndarray, sr: int, depth: float, rate: float, mix: float
) -> np.ndarray:
    """Apply a basic stereo chorus effect.

    Two modulated delay lines (around 10–20 ms) are applied to the left and
    right channels with their low‑frequency oscillators 180° out of phase to
    create a stereo spread.

    Parameters
    ----------
    stereo:
        Stereo input array.
    sr:
        Sample rate of ``stereo``.
    depth:
        Modulation depth in milliseconds. Values above roughly ``5`` ms are
        clamped to keep the delay within a sensible ``10‑20`` ms range.
    rate:
        LFO rate in Hz.
    mix:
        Wet/dry mix ratio, ``0`` for dry, ``1`` for fully effected.
    """

    if mix <= 0.0 or depth <= 0.0 or rate <= 0.0:
        return stereo

    base_ms = 15.0
    depth_ms = min(depth, 5.0)
    base = int(base_ms * 0.001 * sr)
    depth_s = depth_ms * 0.001 * sr

    n = np.arange(len(stereo))
    phase = 2.0 * math.pi * rate * n / sr
    delay_l = base + depth_s * np.sin(phase)
    delay_r = base + depth_s * np.sin(phase + math.pi)
    idx = np.arange(len(stereo))

    def _interp(ch: np.ndarray, d: np.ndarray) -> np.ndarray:
        return np.interp(idx - d, idx, ch, left=0.0, right=0.0)

    wet_l = _interp(stereo[:, 0], delay_l)
    wet_r = _interp(stereo[:, 1], delay_r)
    out_l = stereo[:, 0] * (1.0 - mix) + wet_l * mix
    out_r = stereo[:, 1] * (1.0 - mix) + wet_r * mix
    return np.stack([out_l, out_r], axis=1)


def _soft_clip(stereo: np.ndarray, drive: float) -> np.ndarray:
    """Apply a soft clipping transfer curve to ``stereo``.

    Parameters
    ----------
    stereo:
        Stereo input array.
    drive:
        Drive amount controlling the strength of saturation. ``0`` disables
        the effect.
    """
    if drive <= 0.0:
        return stereo
    return np.tanh(stereo * drive) / np.tanh(drive)


def _compress_bus(
    stereo: np.ndarray,
    sr: int,
    threshold_db: float,
    ratio: float,
    attack: float,
    release: float,
) -> np.ndarray:
    """Apply a simple stereo bus compressor."""

    if ratio <= 1.0:
        return stereo

    attack = max(1e-4, attack)
    release = max(1e-4, release)
    a_coeff = math.exp(-1.0 / (sr * attack))
    r_coeff = math.exp(-1.0 / (sr * release))

    env = 0.0
    out = np.zeros_like(stereo, dtype=np.float32)
    for i, (l, r) in enumerate(stereo):
        x = max(abs(l), abs(r))
        if x > env:
            env = a_coeff * env + (1.0 - a_coeff) * x
        else:
            env = r_coeff * env + (1.0 - r_coeff) * x

        env_db = 20.0 * math.log10(env + 1e-12)
        if env_db > threshold_db:
            gain_db = threshold_db + (env_db - threshold_db) / ratio - env_db
            gain = 10 ** (gain_db / 20.0)
        else:
            gain = 1.0

        out[i, 0] = l * gain
        out[i, 1] = r * gain

    return out


def mix(stems: Mapping[str, np.ndarray], sr: int, config: Mapping[str, Any] | None = None) -> np.ndarray:
    """Mix ``stems`` into a stereo master bus.

    Parameters
    ----------
    stems:
        Mapping of track name to mono audio arrays.
    sr:
        Sample rate of the signals.
    config:
        Optional configuration mapping.  Recognised keys:

        ``tracks`` -> mapping of track name to ``gain`` (dB), ``pan`` (-1..1)
        and ``reverb_send`` (0..1).
        ``reverb`` -> ``decay`` (seconds), ``wet`` level (0..1), ``predelay``
        (seconds) and high‑frequency ``damp`` (0..1).
        ``master`` -> ``limiter`` mapping with ``enabled`` and ``threshold``.

    Returns
    -------
    np.ndarray
        A stereo float32 buffer.
    """
    config = dict(config or {})
    track_cfg: Dict[str, Any] = config.get("tracks", {})
    max_len = max((len(a) for a in stems.values()), default=0)
    mix = np.zeros((max_len, 2), dtype=np.float32)
    reverb_bus = np.zeros((max_len, 2), dtype=np.float32)

    for name, mono in stems.items():
        if name == "mix":
            continue
        if len(mono) < max_len:
            mono = np.pad(mono, (0, max_len - len(mono)))
        mono = mono.astype(np.float32)
        cfg = track_cfg.get(name, {})
        gain_db = float(cfg.get("gain", 0.0))
        pan = float(cfg.get("pan", 0.0))
        send = float(cfg.get("reverb_send", 0.0))
        eq_cfg = cfg.get("eq")
        if eq_cfg:
            freq = float(eq_cfg.get("freq", 0.0))
            eq_gain = float(eq_cfg.get("gain", 0.0))
            q = float(eq_cfg.get("q", 1.0))
            mono = _apply_peaking_eq(mono, sr, freq, eq_gain, q)
        stereo = _apply_gain_pan(mono, gain_db, pan)
        chorus_cfg = cfg.get("chorus")
        if chorus_cfg:
            depth = float(chorus_cfg.get("depth", 0.0))
            rate = float(chorus_cfg.get("rate", 0.0))
            wet = float(chorus_cfg.get("mix", 0.0))
            stereo = _chorus(stereo, sr, depth, rate, wet)
        mix += stereo
        reverb_bus += stereo * send

    rev_cfg = config.get("reverb", {})
    decay = float(rev_cfg.get("decay", 0.5))
    wet = float(rev_cfg.get("wet", 0.3))
    predelay = float(rev_cfg.get("predelay", 0.0))
    damp = float(rev_cfg.get("damp", 0.5))
    if wet > 0.0:
        mix += _plate_reverb(reverb_bus, sr, decay, predelay, damp) * wet

    sat_cfg = config.get("master", {}).get("saturation", {})
    drive = float(sat_cfg.get("drive", 0.0))
    if drive > 0.0:
        mix = _soft_clip(mix, drive)

    comp_cfg = config.get("master", {}).get("compressor", {})
    if comp_cfg.get("enabled", True):
        threshold_db = float(comp_cfg.get("threshold", -6.0))
        ratio = float(comp_cfg.get("ratio", 2.0))
        attack = float(comp_cfg.get("attack", 0.01))
        release = float(comp_cfg.get("release", 0.1))
        mix = _compress_bus(mix, sr, threshold_db, ratio, attack, release)

    lim_cfg = config.get("master", {}).get("limiter", {})
    if lim_cfg.get("enabled", True):
        threshold_db = float(lim_cfg.get("threshold", -0.1))
        target = 10 ** (threshold_db / 20.0)
        peak = float(np.max(np.abs(mix))) if mix.size else 0.0
        if peak > target and peak > 0.0:
            mix *= target / peak
    return mix
