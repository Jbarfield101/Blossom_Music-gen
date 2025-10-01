from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
from scipy.signal import lfilter


def db_to_amp(db: float) -> float:
    return 10.0 ** (db / 20.0)


def apply_gain_db(x: np.ndarray, db: float) -> np.ndarray:
    return (x * db_to_amp(db)).astype(np.float32)


def pan_mono_to_stereo(x: np.ndarray, pan: float) -> Tuple[np.ndarray, np.ndarray]:
    """Pan mono signal to stereo. pan in [-1, 1]: -1 left, 0 center, 1 right."""
    # Equal-power panning
    pan = float(np.clip(pan, -1.0, 1.0))
    angle = (pan + 1) * 0.25 * np.pi  # map [-1,1] -> [0, 0.5*pi]
    l = np.cos(angle)
    r = np.sin(angle)
    return (x * l).astype(np.float32), (x * r).astype(np.float32)


def _biquad_lowpass(fs: float, f0: float, Q: float = 0.707) -> Tuple[np.ndarray, np.ndarray]:
    w0 = 2 * np.pi * (f0 / fs)
    alpha = np.sin(w0) / (2 * Q)
    cos_w0 = np.cos(w0)
    b0 = (1 - cos_w0) / 2
    b1 = 1 - cos_w0
    b2 = (1 - cos_w0) / 2
    a0 = 1 + alpha
    a1 = -2 * cos_w0
    a2 = 1 - alpha
    b = np.array([b0, b1, b2], dtype=np.float64) / a0
    a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
    return b, a


def _biquad_highpass(fs: float, f0: float, Q: float = 0.707) -> Tuple[np.ndarray, np.ndarray]:
    w0 = 2 * np.pi * (f0 / fs)
    alpha = np.sin(w0) / (2 * Q)
    cos_w0 = np.cos(w0)
    b0 = (1 + cos_w0) / 2
    b1 = -(1 + cos_w0)
    b2 = (1 + cos_w0) / 2
    a0 = 1 + alpha
    a1 = -2 * cos_w0
    a2 = 1 - alpha
    b = np.array([b0, b1, b2], dtype=np.float64) / a0
    a = np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
    return b, a


def filter_lowpass(x: np.ndarray, sr: int, cutoff_hz: float, Q: float = 0.707) -> np.ndarray:
    b, a = _biquad_lowpass(sr, cutoff_hz, Q)
    return lfilter(b, a, x).astype(np.float32)


def filter_highpass(x: np.ndarray, sr: int, cutoff_hz: float, Q: float = 0.707) -> np.ndarray:
    b, a = _biquad_highpass(sr, cutoff_hz, Q)
    return lfilter(b, a, x).astype(np.float32)


def sidechain_duck(signal: np.ndarray, sc: np.ndarray, sr: int, max_reduction_db: float = 2.0,
                   attack_ms: float = 10.0, release_ms: float = 120.0) -> np.ndarray:
    """Ducks `signal` based on sidechain `sc` envelope by up to max_reduction_db."""
    x = signal.astype(np.float32)
    env = np.abs(sc).astype(np.float32)
    # Simple envelope follower
    a = np.exp(-1.0 / (sr * (attack_ms / 1000.0)))
    r = np.exp(-1.0 / (sr * (release_ms / 1000.0)))
    y = np.zeros_like(env)
    for i in range(len(env)):
        if env[i] > y[i-1] if i > 0 else 0:
            y[i] = a * (y[i-1] if i > 0 else 0) + (1 - a) * env[i]
        else:
            y[i] = r * (y[i-1] if i > 0 else 0) + (1 - r) * env[i]
    # Map envelope to gain reduction (soft): normalized to 0..1 via percentile
    ref = max(1e-6, np.percentile(y, 95))
    reduction = (y / ref)
    reduction = np.clip(reduction, 0.0, 1.0)
    gr_db = -max_reduction_db * reduction
    gain = (10.0 ** (gr_db / 20.0)).astype(np.float32)
    return (x * gain).astype(np.float32)


def bus_compressor(stereo: np.ndarray, sr: int, threshold_db: float = -14.0, ratio: float = 1.25,
                   attack_ms: float = 15.0, release_ms: float = 200.0) -> np.ndarray:
    """Very gentle stereo compressor."""
    x = stereo.astype(np.float32)
    thr = db_to_amp(threshold_db)
    att = np.exp(-1.0 / (sr * (attack_ms / 1000.0)))
    rel = np.exp(-1.0 / (sr * (release_ms / 1000.0)))
    env = 0.0
    out = np.empty_like(x)
    for i in range(x.shape[1]):
        frame = max(abs(x[0, i]), abs(x[1, i]))
        if frame > env:
            env = att * env + (1 - att) * frame
        else:
            env = rel * env + (1 - rel) * frame
        over = max(0.0, env - thr)
        if over > 0:
            # gain reduction for gentle ratio > 1
            gr = (over / (over * ratio + 1e-9))  # simplified
            gain = (thr + gr) / max(env, 1e-9)
        else:
            gain = 1.0
        out[0, i] = x[0, i] * gain
        out[1, i] = x[1, i] * gain
    return out


def width_enhance(stereo: np.ndarray, amount: float = 0.05) -> np.ndarray:
    x = stereo.astype(np.float32)
    mid = 0.5 * (x[0] + x[1])
    side = 0.5 * (x[0] - x[1])
    side = side * (1.0 + float(amount))
    l = (mid + side).astype(np.float32)
    r = (mid - side).astype(np.float32)
    return np.stack([l, r], axis=0)


def limiter_peak(stereo: np.ndarray, target_dbfs: float = -1.0) -> np.ndarray:
    x = stereo.astype(np.float32)
    peak = float(np.max(np.abs(x)) or 0.0)
    target = db_to_amp(target_dbfs)
    if peak > target and peak > 0:
        x = x * (target / peak)
    x = np.clip(x, -1.0, 1.0)
    return x


@dataclass
class StemConfig:
    name: str
    prompt: str
    negative: str = ""
    gain_db: float = 0.0
    pan: float = 0.0  # -1..1
    lowcut_hz: Optional[float] = None
    highcut_hz: Optional[float] = None
    sidechain: bool = False  # apply ducking against piano


def mix_stems(stems: List[Tuple[StemConfig, np.ndarray]], sr: int, sidechain_source: Optional[np.ndarray] = None) -> Tuple[np.ndarray, List[np.ndarray]]:
    """Mix mono stems into stereo. Returns (master_stereo, [stereo_stems])."""
    stereo_stems: List[np.ndarray] = []
    for cfg, mono in stems:
        x = mono.astype(np.float32)
        if cfg.lowcut_hz:
            x = filter_highpass(x, sr, cfg.lowcut_hz)
        if cfg.highcut_hz:
            x = filter_lowpass(x, sr, cfg.highcut_hz)
        if cfg.sidechain and sidechain_source is not None:
            x = sidechain_duck(x, sidechain_source, sr, max_reduction_db=2.0)
        x = apply_gain_db(x, cfg.gain_db)
        l, r = pan_mono_to_stereo(x, cfg.pan)
        stereo_stems.append(np.stack([l, r], axis=0))
    # Sum
    if stereo_stems:
        master = np.sum(stereo_stems, axis=0)
    else:
        master = np.zeros((2, 1), dtype=np.float32)
    return master.astype(np.float32), stereo_stems

