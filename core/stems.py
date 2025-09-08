"""Basic musical stem structures and conversion helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List
import random


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


def _steps_per_beat(meter: str, subdivision: int = 16) -> int:
    """Return how many rhythmic ``subdivision`` steps form a beat.

    The helper mirrors the logic used in :mod:`core.pattern_synth` where a
    16th‑note grid is assumed.  ``meter`` must be in ``"N/D"`` form.
    """

    try:
        _, den_str = meter.split("/", 1)
        den = int(den_str)
        if den <= 0 or subdivision % den:
            raise ValueError
        return subdivision // den
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError(f"Invalid meter string: {meter!r}") from exc


def _humanize(val: float, spread: float, rng: random.Random) -> float:
    """Return ``val`` randomly offset by ``±spread``."""

    return val + rng.uniform(-spread, spread)


def render_drums(pattern: Dict[str, List[int]], meter: str, tempo: float, seed: int) -> List[Stem]:
    """Render a drum ``pattern`` into ``Stem`` note events.

    Parameters
    ----------
    pattern:
        Mapping containing ``"kick"``, ``"snare"`` and ``"hat"`` grids.  Each
        grid is a sequence of hits (``0`` for rests, ``1`` for hits, ``2`` for
        ghost snares).  Optionally a ``"density"`` float in ``[0, 1]`` may be
        present to scale velocities.
    meter:
        Meter string like ``"4/4"`` describing the rhythmic grid.
    tempo:
        Tempo in BPM used to convert beats to seconds.
    seed:
        Seed for the random humanisation.

    Returns
    -------
    List[Stem]
        A list of note events with simple humanisation applied.
    """

    density = float(pattern.get("density", 1.0))
    steps = len(pattern.get("kick", []))
    if steps == 0:
        return []

    spb = _steps_per_beat(meter)
    sec_per_beat = beats_to_secs(tempo)
    sec_per_step = sec_per_beat / spb

    rng = random.Random(seed)

    notes: List[Stem] = []

    def _add_note(start_idx: int, pitch: int, base_vel: int) -> None:
        start = start_idx * sec_per_step
        start = _humanize(start, 0.006, rng)
        vel = int(round(base_vel * density))
        vel = int(round(_humanize(vel, 6, rng)))
        vel = max(1, min(127, vel))
        notes.append(Stem(start=start, dur=sec_per_step, pitch=pitch, vel=vel, chan=9))

    for idx, hit in enumerate(pattern.get("kick", [])):
        if hit:
            _add_note(idx, 36, 96)

    for idx, hit in enumerate(pattern.get("snare", [])):
        if not hit:
            continue
        base = 60 if hit == 2 else 100
        _add_note(idx, 38, base)

    for idx, hit in enumerate(pattern.get("hat", [])):
        if hit:
            _add_note(idx, 42, 70)

    notes.sort(key=lambda n: n.start)
    return notes

