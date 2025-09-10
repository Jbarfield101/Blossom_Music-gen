# core/utils.py (helpers for Step 2; safe to append to your existing utils)
from __future__ import annotations
from pathlib import Path
import json
from typing import TypedDict, Tuple
from fractions import Fraction
import hashlib

def read_json(path: str | Path):
    path = Path(path)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def write_json(path: str | Path, obj) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)

def ensure_file(path: str | Path, err: str = "File missing"):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{err}: {p}")


def render_hash(
    spec_json: dict,
    seed: int,
    style: dict,
    configs: dict,
    git_commit: str,
) -> str:
    """Return a SHA256 hash summarising render inputs.

    The hash is based on the song specification, random seed, style, render
    configuration and the git commit used for rendering.  Inputs are
    serialised deterministically using JSON with sorted keys to ensure
    reproducible hashes across runs.
    """

    payload = {
        "spec": spec_json,
        "seed": seed,
        "style": style,
        "configs": configs,
        "git_commit": git_commit,
    }
    data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(data).hexdigest()

def density_bucket_from_float(x: float) -> str:
    """Map [0..1] -> 'sparse' | 'med' | 'busy'."""
    try:
        x = float(x)
    except Exception:
        x = 0.5
    if x <= 0.33:
        return "sparse"
    if x <= 0.66:
        return "med"
    return "busy"


# ---------------------------------------------------------------------------
# Musical helpers
# ---------------------------------------------------------------------------


class Event(TypedDict):
    """Canonical event description used by pattern generators."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


def bars_to_beats(n_bars: float, meter: str) -> float:
    """Convert ``n_bars`` to beats for ``meter`` (e.g., ``'4/4'``)."""

    beats_per_bar = int(meter.split("/", 1)[0])
    return n_bars * beats_per_bar


def beats_to_bars(n_beats: float, meter: str) -> float:
    """Convert ``n_beats`` to bars for ``meter`` (e.g., ``'4/4'``)."""

    beats_per_bar = int(meter.split("/", 1)[0])
    if beats_per_bar == 0:
        raise ValueError("Invalid meter string")
    return n_beats / beats_per_bar


# ---------------------------------------------------------------------------
# Timing helpers
# ---------------------------------------------------------------------------


def beats_to_samples(n_beats: float, tempo: float, sr: int) -> int:
    """Return the number of samples for ``n_beats`` at ``tempo`` BPM.

    The conversion uses :class:`fractions.Fraction` to avoid floating point
    drift so that consecutive calls remain sample‑accurate even for tempos
    that do not divide evenly into the sampling rate.
    """

    if tempo <= 0:
        raise ValueError("tempo must be positive")
    samples_per_beat = Fraction(60, tempo) * sr
    return int(round(Fraction(n_beats) * samples_per_beat))


def bars_to_samples(n_bars: float, meter: str, tempo: float, sr: int) -> int:
    """Return the number of samples for ``n_bars`` of ``meter`` at ``tempo`` BPM."""

    beats_per_bar = int(meter.split("/", 1)[0])
    return beats_to_samples(n_bars * beats_per_bar, tempo, sr)


def note_to_sample_indices(
    start: float,
    dur: float,
    tempo: float,
    meter: str,
    sr: int,
) -> Tuple[int, int]:
    """Return ``(start_idx, length)`` in samples for a note in bar units.

    Parameters
    ----------
    start, dur:
        Start position and duration in *bars*.
    tempo:
        Tempo in beats per minute.
    meter:
        Meter string like ``"4/4"`` used to determine beats per bar.
    sr:
        Target sampling rate.
    """

    beats_per_bar = int(meter.split("/", 1)[0])
    start_idx = beats_to_samples(start * beats_per_bar, tempo, sr)
    length = beats_to_samples(dur * beats_per_bar, tempo, sr)
    return start_idx, length

