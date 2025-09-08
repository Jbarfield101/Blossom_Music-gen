"""Basic musical stem structures and conversion helpers."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Note:
    """Single note event."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


@dataclass
class Stem:
    """A note container; currently identical to :class:`Note`."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


@dataclass
class Stems:
    """Placeholder for collections of notes; same fields as :class:`Note`."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


def bars_to_beats(meter: str) -> int:
    """Return the number of beats contained in one bar of ``meter``.

    ``meter`` should be a string of the form ``"N/D"`` such as ``"4/4"`` or
    ``"6/8"``. Only the numerator (``N``) is needed to compute beats per bar.
    """

    try:
        num_str, _ = meter.split("/", 1)
        return int(num_str)
    except Exception as e:  # pragma: no cover - defensive
        raise ValueError(f"Invalid meter string: {meter!r}") from e


def beats_to_secs(tempo: float) -> float:
    """Return seconds per beat for a given ``tempo`` in BPM."""

    if tempo <= 0:
        raise ValueError("tempo must be positive")
    return 60.0 / tempo

