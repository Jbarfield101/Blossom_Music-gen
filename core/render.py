"""Audio rendering for musical stems.

This module turns note :class:`~core.stems.Stem` events into sample buffers.
It provides tiny synthesiser fallbacks for drums, bass, keys and pads but can
also leverage the :class:`~core.sfz_sampler.SFZSampler` when an SFZ definition
is supplied.  The main entry point is :func:`render_song` which returns
parallel‑ready numpy arrays for each instrument along with a mixed output bus.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict, Iterable, List, Mapping
import math

import numpy as np

from .stems import Stem
from .sfz_sampler import SFZSampler


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def _midi_to_freq(pitch: int) -> float:
    """Return frequency for ``pitch`` in Hz."""
    return 440.0 * (2.0 ** ((pitch - 69) / 12.0))


def _schedule(
    notes: Iterable[Stem],
    render_note: Callable[[Stem], np.ndarray],
    sr: int,
) -> np.ndarray:
    """Render ``notes`` by placing waveforms into a sample‑accurate buffer."""
    end_time = 0.0
    for n in notes:
        end_time = max(end_time, n.start + n.dur)
    total_len = int(math.ceil(end_time * sr))
    out = np.zeros(total_len, dtype=np.float32)

    for n in notes:
        start = int(round(n.start * sr))
        data = render_note(n)
        end = start + len(data)
        if end > len(out):
            out = np.pad(out, (0, end - len(out)))
        out[start:end] += data[: len(out) - start]
    peak = float(np.max(np.abs(out))) if len(out) else 1.0
    if peak > 1.0:
        out /= peak
    return out


# ---------------------------------------------------------------------------
# Fallback synthesisers
# ---------------------------------------------------------------------------

def _sine_note(note: Stem, sr: int) -> np.ndarray:
    """Render ``note`` as a decaying sine wave."""
    dur = max(0, note.dur)
    n = int(round(dur * sr))
    if n <= 0:
        return np.zeros(0, dtype=np.float32)
    t = np.arange(n) / sr
    freq = _midi_to_freq(note.pitch)
    env = np.linspace(1.0, 0.0, n, dtype=np.float32)
    data = np.sin(2 * math.pi * freq * t) * env
    return (note.vel / 127.0) * data.astype(np.float32)


def _noise_burst(note: Stem, sr: int) -> np.ndarray:
    """Render ``note`` as a short noise burst used for drums."""
    dur = max(0, min(note.dur, 0.5))
    n = int(round(dur * sr))
    if n <= 0:
        return np.zeros(0, dtype=np.float32)
    rng = np.random.default_rng(int(note.start * sr) + note.pitch)
    data = rng.standard_normal(n).astype(np.float32)
    env = np.exp(-np.linspace(0, 6, n)).astype(np.float32)
    return (note.vel / 127.0) * data * env


# ---------------------------------------------------------------------------
# Instrument rendering
# ---------------------------------------------------------------------------

def _render_instrument(
    name: str,
    notes: List[Stem],
    sr: int,
    sfz: Path | None,
) -> np.ndarray:
    """Render ``notes`` for ``name`` either via SFZ or synth fallback."""
    if not notes:
        return np.zeros(0, dtype=np.float32)

    if sfz is not None:
        try:
            sampler = SFZSampler(sfz)
            return sampler.render(notes, sample_rate=sr)
        except Exception:
            # Fall back to simple synthesis if SFZ loading or rendering fails
            pass

    synth = _noise_burst if name == "drums" else lambda n: _sine_note(n, sr)
    return _schedule(notes, synth, sr)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def render_song(
    stems: Mapping[str, List[Stem]],
    sr: int,
    sfz_paths: Mapping[str, Path] | None = None,
) -> Dict[str, np.ndarray]:
    """Render ``stems`` into audio buffers.

    Parameters
    ----------
    stems:
        Mapping of instrument name to lists of :class:`Stem` events.
    sr:
        Target sampling rate.
    sfz_paths:
        Optional mapping of instrument name to SFZ file paths.

    Returns
    -------
    Dict[str, np.ndarray]
        A dictionary containing one buffer per instrument and an additional
        ``"mix"`` key with the summed output.  All returned arrays share a
        common length so they can be processed in parallel.
    """
    rendered: Dict[str, np.ndarray] = {}
    sfz_paths = sfz_paths or {}

    for name in ("drums", "bass", "keys", "pads"):
        notes = stems.get(name, [])
        rendered[name] = _render_instrument(name, notes, sr, sfz_paths.get(name))

    max_len = max((len(arr) for arr in rendered.values()), default=0)
    for k, arr in rendered.items():
        if len(arr) < max_len:
            rendered[k] = np.pad(arr, (0, max_len - len(arr)))

    if rendered:
        mix = sum(rendered.values())
        peak = float(np.max(np.abs(mix))) if len(mix) else 1.0
        if peak > 1.0:
            mix /= peak
    else:
        mix = np.zeros(0, dtype=np.float32)
    rendered["mix"] = mix.astype(np.float32)
    return rendered


def render_keys(stems: List[Stem], sfz_path: Path, sr: int) -> np.ndarray:
    """Render ``stems`` using the SFZ instrument at ``sfz_path``.

    This helper is kept for backwards compatibility with existing tests and
    examples which render only the piano/keys stems.
    """
    sampler = SFZSampler(sfz_path)
    return sampler.render(stems, sample_rate=sr)
