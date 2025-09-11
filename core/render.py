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

from .stems import Stem, _steps_per_beat
try:  # pragma: no cover - optional dependency
    from .sfz_sampler import SFZSampler
except ImportError:  # pragma: no cover - handled at runtime
    SFZSampler = None  # type: ignore
from .utils import note_to_sample_indices
from . import synth

try:  # pragma: no cover - optional dependency
    import soundfile as sf  # type: ignore
except Exception:  # pragma: no cover - handled at runtime
    # ``soundfile`` is optional; simple synthesis fallbacks are used when missing
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
        if start < 0:
            cut = min(len(data), -start)
            data = data[cut:]
            start = 0
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
    seed = int(note.start * sr) + note.pitch
    seed = int(seed % (2 ** 32))
    rng = np.random.default_rng(seed)
    data = rng.standard_normal(n).astype(np.float32)
    env = np.exp(-np.linspace(0, 6, n)).astype(np.float32)
    data = (note.vel / 127.0) * data * env
    peak = float(np.max(np.abs(data))) if n else 1.0
    if peak > 1.0:
        data /= peak
    return data


def _load_drum_samples(
    directory: Path,
    sr: int,
    mapping: Mapping[str, int] | None = None,
) -> Dict[int, List[np.ndarray]]:
    """Return a mapping of drum ``pitch`` to lists of waveform arrays.

    ``mapping`` should provide a relation of ``filename pattern`` → ``MIDI pitch``.
    Patterns are interpreted using :func:`pathlib.Path.glob` allowing wildcards
    like ``"kick.*"`` to match any supported audio format.  If omitted, the
    function falls back to ``{"kick.*": 36, "snare.*": 38, "hat.*": 42}``.
    Multiple files may map to the same pitch allowing for round‑robin playback.
    Samples are loaded as mono float arrays and resampled to ``sr`` if needed.
    Missing files are simply ignored.
    """
    if sf is None:
        return {}

    names = mapping or {"kick.*": 36, "snare.*": 38, "hat.*": 42}
    out: Dict[int, List[np.ndarray]] = {}
    for pattern, pitch in names.items():
        for path in sorted(directory.glob(pattern)):
            if not path.is_file():
                continue
            data, rate = sf.read(str(path), always_2d=True, dtype="float32")
            if data.shape[1] > 1:
                data = np.mean(data, axis=1)
            else:
                data = data[:, 0]
            if rate != sr:
                data = np.array(
                    SFZSampler._resample(data.tolist(), rate / sr),
                    dtype="float32",
                )
            out.setdefault(pitch, []).append(data)
    return out


def _render_drums(
    notes: List[Stem],
    sr: int,
    sample_dir: Path | None,
    sample_map: Mapping[str, int] | None = None,
    tempo: float | None = None,
    meter: str | None = None,
    swing: float = 0.0,
) -> np.ndarray:
    """Render ``notes`` using drum samples or noise fallbacks.

    ``sample_map`` can specify a ``filename`` → ``pitch`` mapping for loading
    samples.  When multiple files map to the same pitch, they are cycled in a
    round‑robin fashion for successive triggers.
    """
    if not notes:
        return np.zeros(0, dtype=np.float32)

    if swing and tempo is not None and meter is not None:
        spb = _steps_per_beat(meter)
        sec_per_step = (60.0 / tempo) / spb
        beats_per_bar = int(meter.split("/", 1)[0])
        sec_per_bar = beats_per_bar * 60.0 / tempo
        shifted: List[Stem] = []
        for n in notes:
            idx = int(((n.start % sec_per_bar) / sec_per_step))
            start = n.start
            if idx % 2 == 1:
                start += swing * sec_per_step
            shifted.append(Stem(start=start, dur=n.dur, pitch=n.pitch, vel=n.vel, chan=n.chan))
        notes = shifted
    samples: Dict[int, List[np.ndarray]] = {}
    if sample_dir is not None and sample_dir.exists():
        samples = _load_drum_samples(sample_dir, sr, mapping=sample_map)

    rr_indices: Dict[int, int] = {p: 0 for p in samples}

    def render_note(n: Stem) -> np.ndarray:
        data_list = samples.get(n.pitch)
        if not data_list:
            return _noise_burst(n, sr)
        idx = rr_indices[n.pitch]
        rr_indices[n.pitch] = (idx + 1) % len(data_list)
        data = data_list[idx]
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
    drum_patterns: Mapping[str, int] | None = None,
    style: Mapping[str, object] | None = None,
) -> np.ndarray:
    """Render ``notes`` for ``name`` either via SFZ or synth fallback."""
    if name == "drums":
        drum_style = float((style or {}).get("drums", {}).get("swing", 0.0))
        return _render_drums(
            notes,
            sr,
            sfz,
            sample_map=drum_patterns,
            tempo=tempo,
            meter=meter,
            swing=drum_style,
        )

    if not notes:
        return np.zeros(0, dtype=np.float32)

    if sfz is not None and SFZSampler is not None:
        try:
            sampler = SFZSampler(sfz)
            return sampler.render(notes, sample_rate=sr)
        except Exception:
            # Fall back to simple synthesis if SFZ loading or rendering fails
            pass

    params_map = {
        "bass": synth.SynthParams(wave="sine"),
        "keys": synth.SynthParams(
            wave="saw",
            detune=0.1,
            lpf_order=2,
            keytrack=1.0,
            cutoff_min=200.0,
            cutoff_max=5000.0,
        ),
        "pads": synth.SynthParams(
            wave="pulse",
            detune=0.3,
            lpf_order=4,
            keytrack=0.5,
            cutoff_min=100.0,
            cutoff_max=4000.0,
        ),
    }
    params = params_map.get(name, synth.SynthParams())
    synth_defaults = (style or {}).get("synth_defaults", {})
    cutoff = synth_defaults.get("lpf_cutoff")
    if cutoff is not None:
        params.cutoff_max = float(cutoff)

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
    drum_patterns: Mapping[str, int] | None = None,
    style: Mapping[str, object] | None = None,
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
    drum_patterns:
        Optional mapping of filename patterns to MIDI pitches used when loading
        drum samples.  Patterns follow :func:`pathlib.Path.glob` syntax and
        default to ``{"kick.*": 36, "snare.*": 38, "hat.*": 42}`` when
        omitted.

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
        resolved = _resolve_default(path)
        if resolved is None and path.exists():
            resolved = path
        sfz_paths[name] = resolved
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
            drum_patterns=drum_patterns,
            style=style,
        )

    max_len = max((len(arr) for arr in rendered.values()), default=0)
    for k, arr in rendered.items():
        if len(arr) < max_len:
            rendered[k] = np.pad(arr, (0, max_len - len(arr)))
    return rendered


def render_keys(stems: List[Stem], sfz_path: Path, sr: int) -> List[float]:
    """Render ``stems`` using the SFZ instrument at ``sfz_path``.

    Returns a plain Python list for compatibility with legacy tests expecting
    a sequence that can be truth‑tested directly.
    """
    sampler = SFZSampler(sfz_path)
    data = sampler.render(stems, sample_rate=sr)
    return data.tolist()
