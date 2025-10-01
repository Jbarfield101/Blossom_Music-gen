from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import numpy as np
from scipy.signal import fftconvolve, lfilter


@dataclass
class EqSettings:
    # Interpreting request as +2 dB high-shelf around 4–6 kHz and a gentle low-cut ~35–40 Hz
    high_shelf_freq_hz: float = 5000.0
    high_shelf_gain_db: float = 2.0
    high_shelf_q: float = 0.707

    lowcut_hz: float = 35.0
    lowcut_q: float = 0.707


@dataclass
class ReverbSettings:
    wet: float = 0.12  # 12% wet
    length_sec: float = 0.6
    # fixed, deterministic small-room IR if no external IR provided


@dataclass
class DitherSettings:
    target_peak_dbfs: float = -1.0
    bit_depth: int = 16


@dataclass
class ChainSettings:
    eq: EqSettings = EqSettings()
    reverb: ReverbSettings = ReverbSettings()
    dither: DitherSettings = DitherSettings()


def _biquad_high_shelf(fs: float, f0: float, gain_db: float, Q: float = 0.707) -> tuple[np.ndarray, np.ndarray]:
    # RBJ cookbook
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * (f0 / fs)
    alpha = np.sin(w0) / (2 * Q)
    cos_w0 = np.cos(w0)

    b0 =    A*((A+1) + (A-1)*cos_w0 + 2*np.sqrt(A)*alpha)
    b1 = -2*A*((A-1) + (A+1)*cos_w0)
    b2 =    A*((A+1) + (A-1)*cos_w0 - 2*np.sqrt(A)*alpha)
    a0 =       (A+1) - (A-1)*cos_w0 + 2*np.sqrt(A)*alpha
    a1 =  2*((A-1) - (A+1)*cos_w0)
    a2 =       (A+1) - (A-1)*cos_w0 - 2*np.sqrt(A)*alpha

    b = np.array([b0, b1, b2], dtype=np.float64) / a0
    a = np.array([1.0, a1/a0, a2/a0], dtype=np.float64)
    return b, a


def _biquad_highpass(fs: float, f0: float, Q: float = 0.707) -> tuple[np.ndarray, np.ndarray]:
    # RBJ cookbook HPF
    w0 = 2 * np.pi * (f0 / fs)
    alpha = np.sin(w0) / (2 * Q)
    cos_w0 = np.cos(w0)

    b0 =  (1 + cos_w0) / 2
    b1 = -(1 + cos_w0)
    b2 =  (1 + cos_w0) / 2
    a0 =   1 + alpha
    a1 =  -2 * cos_w0
    a2 =   1 - alpha

    b = np.array([b0, b1, b2], dtype=np.float64) / a0
    a = np.array([1.0, a1/a0, a2/a0], dtype=np.float64)
    return b, a


def apply_eq(y: np.ndarray, sr: int, eq: EqSettings) -> np.ndarray:
    y = y.astype(np.float32, copy=False)
    b_s, a_s = _biquad_high_shelf(sr, eq.high_shelf_freq_hz, eq.high_shelf_gain_db, eq.high_shelf_q)
    y1 = lfilter(b_s, a_s, y).astype(np.float32)
    b_hp, a_hp = _biquad_highpass(sr, eq.lowcut_hz, eq.lowcut_q)
    y2 = lfilter(b_hp, a_hp, y1).astype(np.float32)
    return y2


def _generate_small_room_ir(sr: int, length_sec: float = 0.6) -> np.ndarray:
    n = int(sr * length_sec)
    t = np.arange(n) / sr
    # Exponential decay
    decay = np.exp(-t * 6.0)
    ir = decay
    # Early reflections (fixed positions)
    for delay_ms, amp in [(9, 0.35), (17, 0.25), (28, 0.18), (41, 0.12)]:
        d = int(sr * (delay_ms / 1000.0))
        if d < n:
            ir[d] += amp
    # Gentle HF damping
    ir = apply_eq(ir.astype(np.float32), sr, EqSettings(high_shelf_freq_hz=4000.0, high_shelf_gain_db=-1.5, lowcut_hz=20.0))
    # Normalize IR peak
    ir /= (np.max(np.abs(ir)) or 1.0)
    return ir.astype(np.float32)


def apply_convolution_reverb(y: np.ndarray, sr: int, rev: ReverbSettings, ir: Optional[np.ndarray] = None) -> np.ndarray:
    dry = y.astype(np.float32)
    if ir is None:
        ir = _generate_small_room_ir(sr, rev.length_sec)
    wet_sig = fftconvolve(dry, ir, mode='same').astype(np.float32)
    wet = np.clip(rev.wet, 0.0, 1.0)
    out = (1.0 - wet) * dry + wet * wet_sig
    return out.astype(np.float32)


def normalize_and_dither(y: np.ndarray, dither: DitherSettings, seed: Optional[int] = None) -> np.ndarray:
    x = y.astype(np.float32)
    # Normalize to peak target
    peak = float(np.max(np.abs(x)) or 0.0)
    target_amp = 10 ** (dither.target_peak_dbfs / 20.0)
    if peak > 0:
        x = x * (target_amp / peak)

    # TPDF dither @ 1 LSB of target bit depth
    q_step = 1.0 / (2 ** (dither.bit_depth - 1))
    rng = np.random.default_rng(seed if seed is not None else 0)
    tpdf = (rng.random(x.shape, dtype=np.float32) - rng.random(x.shape, dtype=np.float32)) * q_step
    x = x + tpdf
    # Keep in range
    x = np.clip(x, -1.0, 1.0)
    return x.astype(np.float32)


def process_audio_chain(
    audio: np.ndarray,
    sr: int,
    chain: ChainSettings = ChainSettings(),
    seed: Optional[int] = None,
) -> np.ndarray:
    y = audio.astype(np.float32)
    y = apply_eq(y, sr, chain.eq)
    y = apply_convolution_reverb(y, sr, chain.reverb)
    y = normalize_and_dither(y, chain.dither, seed=seed)
    return y


def write_metadata_json(path: str | Path, data: dict) -> str:
    p = Path(path)
    meta_path = p.with_suffix('.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return meta_path.as_posix()

