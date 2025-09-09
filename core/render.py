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
from .utils import note_to_sample_indices
from . import synth

try:  # pragma: no cover - optional dependency
    import soundfile as sf  # type: ignore
except Exception:  # pragma: no cover - handled at runtime
    sf = None  # type: ignore


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
    tempo: float | None = None,
    meter: str | None = None,
) -> np.ndarray:
    """Render ``notes`` by placing waveforms into a sample‑accurate buffer."""
    end_sample = 0
    starts: List[int] = []
    for n in notes:
        if tempo is not None and meter is not None:
            start_idx, length = note_to_sample_indices(n.start, n.dur, tempo, meter, sr)
        else:
            start_idx = int(round(n.start * sr))
            length = int(round(n.dur * sr))
        starts.append(start_idx)
        end_sample = max(end_sample, start_idx + length)

    out = np.zeros(end_sample, dtype=np.float32)

    for idx, n in enumerate(notes):
        start = starts[idx]
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


def _load_drum_samples(
    directory: Path,
    sr: int,
    patterns: Mapping[int, str] | None = None,
) -> Dict[int, np.ndarray]:
    """Return a mapping of drum ``pitch`` to waveform arrays.

    Parameters
    ----------
    directory:
        Directory searched for drum samples.
    sr:
        Target sampling rate.
    patterns:
        Optional mapping of MIDI pitch to glob patterns.  The default searches
        for ``kick.*`` (MIDI 36), ``snare.*`` (38) and ``hat.*`` (42).

    The first file matching each pattern is loaded as a mono float array and
    resampled to ``sr`` if needed.  Missing files are ignored.
    """
    if sf is None:
        return {}

    mapping: Dict[int, np.ndarray] = {}
    default_patterns = {36: "kick.*", 38: "snare.*", 42: "hat.*"}
    patterns = {**default_patterns, **(patterns or {})}

    for pitch, pattern in patterns.items():
        for path in sorted(directory.glob(pattern)):
            try:
                data, rate = sf.read(str(path), always_2d=True, dtype="float32")
            except Exception:
                # Skip files that soundfile cannot decode
                continue
            if data.shape[1] > 1:
                data = np.mean(data, axis=1)
            else:
                data = data[:, 0]
            if rate != sr:
                data = np.array(
                    SFZSampler._resample(data.tolist(), rate / sr), dtype="float32"
                )
            mapping[pitch] = data
            break
    return mapping


def _render_drums(
    notes: List[Stem],
    sr: int,
    sample_dir: Path | None,
    tempo: float | None = None,
    meter: str | None = None,
    sample_patterns: Mapping[int, str] | None = None,
) -> np.ndarray:
    """Render ``notes`` using drum samples or noise fallbacks."""
    if not notes:
        return np.zeros(0, dtype=np.float32)
    samples = {}
    if sample_dir is not None and sample_dir.exists():
        samples = _load_drum_samples(sample_dir, sr, patterns=sample_patterns)

    def render_note(n: Stem) -> np.ndarray:
        data = samples.get(n.pitch)
        if data is None:
            return _noise_burst(n, sr)
        length = min(len(data), int(round(n.dur * sr)))
        return (n.vel / 127.0) * data[:length]

    return _schedule(notes, render_note, sr, tempo=tempo, meter=meter)


# ---------------------------------------------------------------------------
# Instrument rendering
# ---------------------------------------------------------------------------

def _render_instrument(
    name: str,
    notes: List[Stem],
    sr: int,
    sfz: Path | None,
    tempo: float | None = None,
    meter: str | None = None,
    drum_patterns: Mapping[int, str] | None = None,
) -> np.ndarray:
    """Render ``notes`` for ``name`` either via SFZ or synth fallback."""
    if name == "drums":
        return _render_drums(
            notes,
            sr,
            sfz,
            tempo=tempo,
            meter=meter,
            sample_patterns=drum_patterns,
        )

    if not notes:
        return np.zeros(0, dtype=np.float32)

    if sfz is not None:
        try:
            sampler = SFZSampler(sfz)
            return sampler.render(notes, sample_rate=sr)
        except Exception:
            # Fall back to simple synthesis if SFZ loading or rendering fails
            pass

    params_map = {
        "bass": synth.SynthParams(wave="sine"),
        "keys": synth.SynthParams(wave="saw", detune=0.1),
        "pads": synth.SynthParams(wave="saw", detune=0.3),
    }
    params = params_map.get(name, synth.SynthParams())

    return _schedule(
        notes,
        lambda n, p=params: synth.render_note(n, sr, p),
        sr,
        tempo=tempo,
        meter=meter,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def render_song(
    stems: Mapping[str, List[Stem]],
    sr: int,
    tempo: float | None = None,
    meter: str | None = None,
    sfz_paths: Mapping[str, Path] | None = None,
    drum_sample_patterns: Mapping[int, str] | None = None,
) -> Dict[str, np.ndarray]:
    """Render ``stems`` into audio buffers.

    Parameters
    ----------
    stems:
        Mapping of instrument name to lists of :class:`Stem` events.
    sr:
        Target sampling rate.
    tempo:
        Optional tempo in BPM used when converting musical positions to
        sample indices.  If omitted, ``note.start`` and ``note.dur`` are
        interpreted directly as seconds.
    meter:
        Optional meter string like ``"4/4"`` describing beats per bar.
        Only used when ``tempo`` is provided.
    sfz_paths:
        Optional mapping of instrument name to SFZ file paths.
    drum_sample_patterns:
        Optional mapping of drum MIDI pitches to glob patterns used when
        searching for sample files.  Defaults to ``{"kick.*", "snare.*", "hat.*"}``.

    Returns
    -------
    Dict[str, np.ndarray]
        A dictionary containing one buffer per instrument.  All returned
        arrays share a common length so they can be processed in parallel or
        fed into a downstream mixer.
    """
    rendered: Dict[str, np.ndarray] = {}
    sfz_paths = dict(sfz_paths or {})

    def _resolve_default(path: Path | None) -> Path | None:
        """Return a usable SFZ file within ``path`` if available.

        ``path`` may point directly to an SFZ file or to a directory that
        contains one or more variants.  The first matching ``*.sfz`` file is
        chosen.  Missing paths simply return ``None`` allowing the caller to
        fall back to synthesis.
        """

        if path is None:
            return None
        if path.is_file() and path.suffix.lower() == ".sfz":
            return path
        if path.is_dir():
            for candidate in sorted(path.rglob("*.sfz")):
                return candidate
        return None

    # Populate with default asset locations if not explicitly provided
    defaults = {
        "drums": Path("assets/sfz/Drums"),
        "bass": Path("assets/sfz/Bass"),
        "keys": Path("assets/sfz/Piano"),
        "pads": Path("assets/sfz/Pads"),
    }
    # Resolve any user supplied paths first so we only fall back when needed
    for name, path in list(sfz_paths.items()):
        sfz_paths[name] = _resolve_default(path)
    for name, path in defaults.items():
        sfz_paths.setdefault(name, _resolve_default(path))

    for name in ("drums", "bass", "keys", "pads"):
        notes = stems.get(name, [])
        rendered[name] = _render_instrument(
            name,
            notes,
            sr,
            sfz_paths.get(name),
            tempo=tempo,
            meter=meter,
            drum_patterns=drum_sample_patterns,
        )

    max_len = max((len(arr) for arr in rendered.values()), default=0)
    for k, arr in rendered.items():
        if len(arr) < max_len:
            rendered[k] = np.pad(arr, (0, max_len - len(arr)))
    return rendered


def render_keys(stems: List[Stem], sfz_path: Path, sr: int) -> np.ndarray:
    """Render ``stems`` using the SFZ instrument at ``sfz_path``.

    This helper is kept for backwards compatibility with existing tests and
    examples which render only the piano/keys stems.
    """
    sampler = SFZSampler(sfz_path)
    return sampler.render(stems, sample_rate=sr)
