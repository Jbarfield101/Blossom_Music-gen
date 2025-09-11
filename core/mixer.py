from __future__ import annotations

"""Simple stereo mixing utilities.

This module turns mono instrument stems into a stereo master bus.  Each track
can specify gain, pan, a single-band EQ and a reverb send amount via a
configuration mapping.  A shared reverb bus is generated for keys and pads (or
any track that sets a send amount) and the final mix passes through a light bus
compressor followed by an oversampled true‑peak limiter with a ``-0.8`` dBFS
ceiling.
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


def _apply_low_shelf(
    signal: np.ndarray, sr: int, freq: float, gain_db: float, q: float = 1.0
) -> np.ndarray:
    """Apply a low‑shelf EQ filter to ``signal``.

    Parameters are the same as :func:`_apply_peaking_eq` with ``freq`` marking
    the transition frequency of the shelf.
    """

    if gain_db == 0.0 or freq <= 0.0 or freq >= sr / 2:
        return signal

    A = 10 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * freq / sr
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    # Treat ``q`` as the shelf slope ``S`` from RBJ's cookbook.
    S = max(q, 1e-6)
    alpha = sin_w0 / 2.0 * math.sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0)
    sqrtA = math.sqrt(A)

    b0 = A * ((A + 1.0) - (A - 1.0) * cos_w0 + 2.0 * sqrtA * alpha)
    b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cos_w0)
    b2 = A * ((A + 1.0) - (A - 1.0) * cos_w0 - 2.0 * sqrtA * alpha)
    a0 = (A + 1.0) + (A - 1.0) * cos_w0 + 2.0 * sqrtA * alpha
    a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cos_w0)
    a2 = (A + 1.0) + (A - 1.0) * cos_w0 - 2.0 * sqrtA * alpha

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


def _apply_high_shelf(
    signal: np.ndarray, sr: int, freq: float, gain_db: float, q: float = 1.0
) -> np.ndarray:
    """Apply a high‑shelf EQ filter to ``signal``."""

    if gain_db == 0.0 or freq <= 0.0 or freq >= sr / 2:
        return signal

    A = 10 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * freq / sr
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    S = max(q, 1e-6)
    alpha = sin_w0 / 2.0 * math.sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0)
    sqrtA = math.sqrt(A)

    b0 = A * ((A + 1.0) + (A - 1.0) * cos_w0 + 2.0 * sqrtA * alpha)
    b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cos_w0)
    b2 = A * ((A + 1.0) + (A - 1.0) * cos_w0 - 2.0 * sqrtA * alpha)
    a0 = (A + 1.0) - (A - 1.0) * cos_w0 + 2.0 * sqrtA * alpha
    a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cos_w0)
    a2 = (A + 1.0) - (A - 1.0) * cos_w0 - 2.0 * sqrtA * alpha

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
    attack: float,
    release: float,
    knee_db: float = 0.0,
    lookahead_ms: float = 0.0,
) -> np.ndarray:
    """Apply a simple stereo bus compressor with RMS detection and lookahead."""

    attack = max(1e-4, attack)
    release = max(1e-4, release)
    a_coeff = math.exp(-1.0 / (sr * attack))
    r_coeff = math.exp(-1.0 / (sr * release))

    lookahead = max(0, int(sr * (lookahead_ms / 1000.0)))
    ratio = 2.0

    padded = np.pad(stereo, ((0, lookahead), (0, 0)))
    delay_buf = np.pad(stereo, ((lookahead, 0), (0, 0)))

    env_sq = 0.0
    gain_arr = np.ones(len(padded), dtype=np.float32)

    for i, (l, r) in enumerate(padded):
        x_sq = 0.5 * (l * l + r * r)
        if x_sq > env_sq:
            env_sq = a_coeff * env_sq + (1.0 - a_coeff) * x_sq
        else:
            env_sq = r_coeff * env_sq + (1.0 - r_coeff) * x_sq

        env = math.sqrt(env_sq)
        env_db = 20.0 * math.log10(env + 1e-12)

        gain_db = 0.0
        if knee_db > 0.0:
            lower = threshold_db - knee_db / 2.0
            upper = threshold_db + knee_db / 2.0
            if env_db > upper:
                gain_db = threshold_db + (env_db - threshold_db) / ratio - env_db
            elif env_db > lower:
                delta = env_db - lower
                gain_db = (1.0 / ratio - 1.0) * (delta * delta) / (2.0 * knee_db)
        else:
            if env_db > threshold_db:
                gain_db = threshold_db + (env_db - threshold_db) / ratio - env_db

        gain_arr[i] = 10 ** (gain_db / 20.0)

    out = delay_buf * gain_arr[:, None]
    return out


def _true_peak_limiter(
    stereo: np.ndarray, ceiling_db: float = -0.8, oversample: int = 4
) -> np.ndarray:
    """Scale ``stereo`` so oversampled peaks do not exceed ``ceiling_db``.

    Parameters
    ----------
    stereo:
        Input buffer to be limited in-place.
    ceiling_db:
        Target true peak level in decibels full scale.
    oversample:
        Linear interpolation factor used for peak detection.
    """
    if oversample < 1 or stereo.size == 0:
        return stereo
    target = 10 ** (ceiling_db / 20.0)
    n = len(stereo)
    idx = np.arange(n)
    up_idx = np.arange(n * oversample) / oversample
    up_l = np.interp(up_idx, idx, stereo[:, 0])
    up_r = np.interp(up_idx, idx, stereo[:, 1])
    peak = float(max(np.max(np.abs(up_l)), np.max(np.abs(up_r))))
    if peak > target and peak > 0.0:
        stereo *= target / peak
    return stereo


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
        ``master`` -> optional ``headroom_db`` for global gain trim and a
        ``limiter`` mapping with ``enabled``, ``ceiling`` and ``oversample``.

    Returns
    -------
    np.ndarray
        A stereo float32 buffer.
    """
    config = dict(config or {})
    track_cfg: Dict[str, Any] = config.get("tracks", {})
    master_cfg: Dict[str, Any] = config.get("master", {})
    headroom_val = master_cfg.get("headroom_db", 3.0)
    headroom_db = float(headroom_val) if headroom_val is not None else None
    max_len = max((len(a) for a in stems.values()), default=0)
    mix = np.zeros((max_len, 2), dtype=np.float32)
    reverb_bus = np.zeros((max_len, 2), dtype=np.float32)
    tracks: list[tuple[np.ndarray, float]] = []
    peaks: list[float] = []

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
            eq_type = str(eq_cfg.get("type", "peaking")).lower()
            if eq_type == "low_shelf":
                mono = _apply_low_shelf(mono, sr, freq, eq_gain, q)
            elif eq_type == "high_shelf":
                mono = _apply_high_shelf(mono, sr, freq, eq_gain, q)
            else:
                mono = _apply_peaking_eq(mono, sr, freq, eq_gain, q)
        stereo = _apply_gain_pan(mono, gain_db, pan)
        chorus_cfg = cfg.get("chorus")
        if chorus_cfg:
            depth = float(chorus_cfg.get("depth", 0.0))
            rate = float(chorus_cfg.get("rate", 0.0))
            wet = float(chorus_cfg.get("mix", 0.0))
            stereo = _chorus(stereo, sr, depth, rate, wet)
        tracks.append((stereo, send))
        peaks.append(float(np.max(np.abs(stereo))))

    combined_peak = sum(peaks)
    trim = 1.0
    if headroom_db is not None:
        target = 10 ** (-headroom_db / 20.0)
        if combined_peak > target and combined_peak > 0.0:
            trim = target / combined_peak

    for stereo, send in tracks:
        stereo *= trim
        mix += stereo
        reverb_bus += stereo * send

    rev_cfg = config.get("reverb", {})
    decay = float(rev_cfg.get("decay", 0.5))
    wet = float(rev_cfg.get("wet", 0.3))
    predelay = float(rev_cfg.get("predelay", 0.0))
    damp = float(rev_cfg.get("damp", 0.5))
    if wet > 0.0:
        mix += _plate_reverb(reverb_bus, sr, decay, predelay, damp) * wet

    sat_cfg = master_cfg.get("saturation", {})
    drive = float(sat_cfg.get("drive", 0.0))
    if drive > 0.0:
        mix = _soft_clip(mix, drive)

    comp_cfg = master_cfg.get("compressor", {})
    if comp_cfg.get("enabled", True):
        threshold_db = float(comp_cfg.get("threshold", -6.0))
        attack = float(comp_cfg.get("attack", 0.01))
        release = float(comp_cfg.get("release", 0.1))
        knee_db = float(comp_cfg.get("knee_db", 0.0))
        lookahead_ms = float(comp_cfg.get("lookahead_ms", 0.0))
        mix = _compress_bus(
            mix, sr, threshold_db, attack, release, knee_db, lookahead_ms
        )

    lim_cfg = master_cfg.get("limiter", {})
    if lim_cfg.get("enabled", True):
        ceiling_db = float(lim_cfg.get("ceiling", -0.8))
        oversample = int(lim_cfg.get("oversample", 4))
        mix = _true_peak_limiter(mix, ceiling_db, oversample)
    return mix
