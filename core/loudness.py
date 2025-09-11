from __future__ import annotations

"""Lightweight integrated loudness estimator.

This module provides a very small approximation of the EBU R128 /
ITU-R BS.1770 loudness algorithm.  It applies a simplified K-weighting
filter followed by a gated RMS integration.  The goal is to obtain a
rough LUFS value without depending on external libraries.
"""

from typing import Iterable
import math

import numpy as np


def _biquad(x: np.ndarray, b: Iterable[float], a: Iterable[float]) -> np.ndarray:
    """Apply a biquad filter defined by numerator ``b`` and denominator ``a``."""
    b0, b1, b2 = b
    a1, a2 = a
    y = np.zeros_like(x, dtype=np.float64)
    x1 = x2 = y1 = y2 = 0.0
    for i, x0 in enumerate(x.astype(np.float64)):
        y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        y[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return y


def _k_weighting(x: np.ndarray, sr: int) -> np.ndarray:
    """Apply a simplified K-weighting filter to ``x``."""
    # High shelf at ~1.6 kHz with +4 dB gain
    f0 = 1681.974450955533
    g = 3.99984385397
    q = 0.7071752369554196
    k = math.tan(math.pi * f0 / sr)
    v0 = 10 ** (g / 20.0)
    a0 = 1 + k / q + k * k
    b0 = v0 + (v0 ** 0.5) * k / q + k * k
    b1 = 2 * (k * k - v0)
    b2 = v0 - (v0 ** 0.5) * k / q + k * k
    a1 = 2 * (k * k - 1)
    a2 = 1 - k / q + k * k
    pre = _biquad(x, (b0 / a0, b1 / a0, b2 / a0), (a1 / a0, a2 / a0))

    # High pass at 38 Hz
    f0 = 38.13547087602444
    q = 0.5003270373238773
    k = math.tan(math.pi * f0 / sr)
    a0 = 1 + k / q + k * k
    b0 = 1
    b1 = -2
    b2 = 1
    a1 = 2 * (k * k - 1)
    a2 = 1 - k / q + k * k
    return _biquad(pre, (b0 / a0, b1 / a0, b2 / a0), (a1 / a0, a2 / a0))


def estimate_lufs(audio: np.ndarray, sr: int) -> float:
    """Estimate integrated loudness (LUFS) of ``audio``.

    The implementation follows the general structure of ITU-R BS.1770 but
    omits fine details for the sake of simplicity.  It performs K-weighting
    and uses 400 ms windows with a 100 ms hop.  Windows quieter than
    −70 LUFS are ignored (absolute gate).
    """
    if audio.ndim == 2:
        x = audio.mean(axis=1)
    else:
        x = audio
    if x.size == 0:
        return float("-inf")
    x = _k_weighting(x.astype(np.float64), sr)

    win = int(sr * 0.4)
    hop = int(sr * 0.1)
    if win <= 0 or hop <= 0:
        return float("-inf")
    energies = []
    for start in range(0, len(x) - win + 1, hop):
        w = x[start : start + win]
        ms = float(np.mean(w * w))
        if ms <= 0:
            continue
        l = -0.691 + 10 * math.log10(ms)
        if l > -70.0:  # absolute gate
            energies.append(ms)
    if not energies:
        return float("-inf")
    mean_ms = float(np.mean(energies))
    return -0.691 + 10 * math.log10(mean_ms)
