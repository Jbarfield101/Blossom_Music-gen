from __future__ import annotations

"""Simple stereo mixing utilities.

This module turns mono instrument stems into a stereo master bus.  Each track
can specify gain, pan and a reverb send amount via a configuration mapping.
A shared reverb bus is generated for keys and pads (or any track that sets a
send amount) and the final mix passes through a basic peak limiter targeting a
user supplied dBFS threshold (``-0.1`` by default).
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
        ``reverb`` -> ``decay`` (seconds) and ``wet`` level (0..1).
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
        stereo = _apply_gain_pan(mono, gain_db, pan)
        mix += stereo
        reverb_bus += stereo * send

    rev_cfg = config.get("reverb", {})
    decay = float(rev_cfg.get("decay", 0.5))
    wet = float(rev_cfg.get("wet", 0.3))
    if wet > 0.0:
        mix += _simple_reverb(reverb_bus, sr, decay) * wet

    lim_cfg = config.get("master", {}).get("limiter", {})
    if lim_cfg.get("enabled", True):
        threshold_db = float(lim_cfg.get("threshold", -0.1))
        target = 10 ** (threshold_db / 20.0)
        peak = float(np.max(np.abs(mix))) if mix.size else 0.0
        if peak > target and peak > 0.0:
            mix *= target / peak
    return mix
