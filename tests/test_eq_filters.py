import numpy as np
import math

from core.mixer import _apply_peaking_eq, _apply_low_shelf, _apply_high_shelf


def _random_signal(n=1000, seed=0):
    rng = np.random.default_rng(seed)
    return rng.standard_normal(n).astype(np.float32)


def _ref_peaking(signal, sr, freq, gain_db, q=1.0):
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


def _ref_low_shelf(signal, sr, freq, gain_db, q=1.0):
    if gain_db == 0.0 or freq <= 0.0 or freq >= sr / 2:
        return signal
    A = 10 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * freq / sr
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
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


def _ref_high_shelf(signal, sr, freq, gain_db, q=1.0):
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


def test_peaking_eq_matches_reference():
    sig = _random_signal(1000)
    out_new = _apply_peaking_eq(sig, 48000, 1000.0, 6.0, 1.0)
    out_ref = _ref_peaking(sig, 48000, 1000.0, 6.0, 1.0)
    assert np.allclose(out_new, out_ref, atol=1e-6)


def test_low_shelf_matches_reference():
    sig = _random_signal(1000)
    out_new = _apply_low_shelf(sig, 48000, 200.0, 6.0, 1.0)
    out_ref = _ref_low_shelf(sig, 48000, 200.0, 6.0, 1.0)
    assert np.allclose(out_new, out_ref, atol=1e-6)


def test_high_shelf_matches_reference():
    sig = _random_signal(1000)
    out_new = _apply_high_shelf(sig, 48000, 2000.0, 6.0, 1.0)
    out_ref = _ref_high_shelf(sig, 48000, 2000.0, 6.0, 1.0)
    assert np.allclose(out_new, out_ref, atol=1e-6)
