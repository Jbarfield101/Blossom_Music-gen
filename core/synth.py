"""Simple oscillator-based synthesiser fallback."""

from __future__ import annotations

from dataclasses import dataclass
import math
import numpy as np

from .stems import Stem


def _midi_to_freq(pitch: int) -> float:
    """Return frequency for ``pitch`` in Hz."""
    return 440.0 * (2.0 ** ((pitch - 69) / 12.0))


@dataclass
class SynthParams:
    """Configuration for the simple synthesiser."""

    wave: str = "sine"  # "sine" or "saw"
    detune: float = 0.0  # Detune in semitones
    attack: float = 0.01
    decay: float = 0.1
    sustain: float = 0.8
    release: float = 0.1
    cutoff_min: float = 200.0
    cutoff_max: float = 5000.0


def _adsr(n: int, sr: int, p: SynthParams) -> np.ndarray:
    """Return an ADSR envelope with ``n`` samples."""
    a = int(p.attack * sr)
    d = int(p.decay * sr)
    r = int(p.release * sr)
    total = a + d + r
    if total > n:
        scale = n / max(1, total)
        a = int(a * scale)
        d = int(d * scale)
        r = n - a - d
    s = n - a - d - r
    env = np.empty(n, dtype=np.float32)
    idx = 0
    if a > 0:
        env[:a] = np.linspace(0, 1, a, endpoint=False, dtype=np.float32)
        idx += a
    if d > 0:
        env[idx:idx + d] = np.linspace(1, p.sustain, d, endpoint=False, dtype=np.float32)
        idx += d
    if s > 0:
        env[idx:idx + s] = p.sustain
        idx += s
    if r > 0:
        env[idx:] = np.linspace(p.sustain, 0, n - idx, dtype=np.float32)
    else:
        env[idx:] = p.sustain
    return env


def _lowpass(data: np.ndarray, cutoff: float, sr: int) -> np.ndarray:
    """Apply a one-pole low-pass filter to ``data``."""
    if cutoff <= 0 or cutoff >= sr / 2:
        return data.astype(np.float32)
    alpha = math.exp(-2 * math.pi * cutoff / sr)
    out = np.empty_like(data, dtype=np.float32)
    out[0] = data[0]
    for i in range(1, len(data)):
        out[i] = (1 - alpha) * data[i] + alpha * out[i - 1]
    return out


def render_note(note: Stem, sr: int, params: SynthParams | None = None) -> np.ndarray:
    """Render ``note`` using a basic oscillator with ADSR and filtering."""
    params = params or SynthParams()
    dur = max(0.0, note.dur)
    n = int(round(dur * sr))
    if n <= 0:
        return np.zeros(0, dtype=np.float32)
    freq = _midi_to_freq(note.pitch) * (2 ** (params.detune / 12.0))
    t = np.arange(n, dtype=np.float32) / sr
    if params.wave == "saw":
        phase = np.mod(freq * t, 1.0)
        osc = 2.0 * phase - 1.0
    else:
        osc = np.sin(2 * math.pi * freq * t)
    env = _adsr(n, sr, params)
    data = osc * env
    cutoff = params.cutoff_min + (note.vel / 127.0) * (params.cutoff_max - params.cutoff_min)
    data = _lowpass(data, cutoff, sr)
    return (note.vel / 127.0) * data.astype(np.float32)
