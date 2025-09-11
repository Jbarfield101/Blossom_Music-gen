from __future__ import annotations
"""Algorithmic pattern generation for simple demo purposes.

This module provides lightweight pattern synthesis for four instruments:
    * drums
    * bass
    * keys
    * pads

The aim is deterministic generation given a seed.  Patterns are very
rudimentary but demonstrate how a seeding strategy and probability grids can
be combined to generate musical material.
"""

from typing import Callable, Dict, List, Optional, Sequence
import hashlib
import random

from .song_spec import SongSpec
from .theory import parse_chord_symbol, midi_note
from .utils import Event

generate_phrase: Optional[Callable[..., List[int]]] = None


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _seeded_rng(seed: int, *tokens: str) -> random.Random:
    """Return a ``random.Random`` seeded from ``seed`` and extra tokens."""
    h = hashlib.sha256("|".join([str(seed), *map(str, tokens)]).encode("utf-8")).hexdigest()
    return random.Random(int(h[:16], 16))


def _steps_per_bar(meter: str, subdivision: int = 16) -> int:
    """Return number of subdivision steps per bar for a meter string 'N/D'."""
    num_str, den_str = meter.split("/", 1)
    num = int(num_str)
    den = int(den_str)
    return num * (subdivision // den)


def euclid(pulses: int, steps: int) -> List[int]:
    """Simple Euclidean rhythm via the bucket method."""
    if pulses <= 0:
        return [0] * steps
    pattern: List[int] = []
    bucket = 0
    for _ in range(steps):
        bucket += pulses
        if bucket >= steps:
            bucket -= steps
            pattern.append(1)
        else:
            pattern.append(0)
    return pattern


def probability_grid(probs: Sequence[float], rng: random.Random) -> List[bool]:
    """Return a list of booleans sampled from given probabilities."""
    return [rng.random() < p for p in probs]


# ---------------------------------------------------------------------------
# Register helpers
# ---------------------------------------------------------------------------

def clamp_pitch(pitch: int, inst: str, spec: SongSpec) -> int:
    """Clamp ``pitch`` to the MIDI register range for ``inst``.

    If ``inst`` does not have a policy entry, ``pitch`` is returned unchanged.
    """

    policy = getattr(spec, "register_policy", {}) or {}
    rng = policy.get(inst)
    if not rng:
        return pitch
    low, high = rng
    if pitch < low:
        return low
    if pitch > high:
        return high
    return pitch


# ---------------------------------------------------------------------------
# Density mapping helpers
# ---------------------------------------------------------------------------

def density_to_hit_prob(density: float) -> float:
    """Map ``density`` in ``[0, 1]`` to a hit probability.

    The function clamps the value to the valid probability range so callers do
    not need to worry about out-of-bound densities.
    """

    return max(0.0, min(1.0, density))


def density_to_note_rate(density: float, max_rate: int = 4) -> int:
    """Map ``density`` in ``[0, 1]`` to an integer note rate.

    ``max_rate`` denotes the maximum number of evenly spaced notes that should
    be produced in a bar when ``density`` equals ``1``.  The minimum rate is
    always ``1``.
    """

    rate = 1 + density * (max_rate - 1)
    return max(1, min(max_rate, int(rate + 0.5)))


# ---------------------------------------------------------------------------
# Instrument generators
# ---------------------------------------------------------------------------

def gen_drums(n_bars: int, meter: str, density: float, rng: random.Random, spec: SongSpec) -> List[Event]:
    """Generate drum events using a simple Euclidean approach."""

    steps = _steps_per_bar(meter)
    beats = int(meter.split("/")[0])
    step_per_beat = steps // beats
    step_dur = 1 / step_per_beat
    events: List[Event] = []
    hit_prob = density_to_hit_prob(density)
    note_rate = density_to_note_rate(density, 4)
    for bar_idx in range(n_bars):
        pulses = note_rate
        kick = euclid(pulses, steps)

        snare = [0] * steps
        if beats >= 4:
            snare[step_per_beat] = 1
            snare[3 * step_per_beat] = 1
        else:
            snare[steps // 2] = 1
        for i in range(steps):
            if not snare[i] and rng.random() < 0.1 * hit_prob:
                snare[i] = 1

        hat = [0] * steps
        for i in range(steps):
            if step_per_beat // 2 == 0 or i % (step_per_beat // 2) == 0:
                hat[i] = 1
            elif rng.random() < 0.5 * hit_prob:
                hat[i] = 1

        bar_start = bar_idx * beats
        for i in range(steps):
            start = bar_start + i / step_per_beat
            if kick[i] and rng.random() < hit_prob:
                p = clamp_pitch(36, "drums", spec)
                events.append({"start": start, "dur": step_dur, "pitch": p, "vel": 100, "chan": 9})
            if snare[i] and rng.random() < hit_prob:
                p = clamp_pitch(38, "drums", spec)
                events.append({"start": start, "dur": step_dur, "pitch": p, "vel": 100, "chan": 9})
            if hat[i] and rng.random() < hit_prob:
                p = clamp_pitch(42, "drums", spec)
                events.append({"start": start, "dur": step_dur, "pitch": p, "vel": 80, "chan": 9})
    return events


def gen_bass(chords: Sequence[str], meter: str, density: float, rng: random.Random, spec: SongSpec) -> List[Event]:
    """Generate root-note bass line events."""

    steps = _steps_per_bar(meter)
    beats = int(meter.split("/")[0])
    step_per_beat = steps // beats
    step_dur = 1 / step_per_beat
    events: List[Event] = []
    hit_prob = density_to_hit_prob(density)
    note_rate = density_to_note_rate(density, 3)
    for bar_idx, chord in enumerate(chords):
        root_pc, _ = parse_chord_symbol(chord)
        root = clamp_pitch(midi_note(root_pc, 2), "bass", spec)
        pulses = note_rate
        hits = euclid(pulses, steps)
        bar_start = bar_idx * beats
        for i, h in enumerate(hits):
            if h and rng.random() < hit_prob:
                start = bar_start + i / step_per_beat
                events.append({"start": start, "dur": step_dur, "pitch": root, "vel": 100, "chan": 0})
    return events


def gen_keys(chords: Sequence[str], meter: str, density: float, rng: random.Random, spec: SongSpec) -> List[Event]:
    """Generate block-chord keyboard part events."""

    steps = _steps_per_bar(meter)
    beats = int(meter.split("/")[0])
    step_per_beat = steps // beats
    step_dur = 1 / step_per_beat
    events: List[Event] = []
    hit_prob = density_to_hit_prob(density)
    note_rate = density_to_note_rate(density, 4)
    for bar_idx, chord in enumerate(chords):
        root_pc, intervals = parse_chord_symbol(chord)
        base = midi_note(root_pc, 4)
        notes = [clamp_pitch(base + iv, "keys", spec) for iv in intervals]
        pulses = note_rate
        hits = euclid(pulses, steps)
        bar_start = bar_idx * beats
        for i, h in enumerate(hits):
            start = bar_start + i / step_per_beat
            if h and rng.random() < hit_prob:
                for n in notes:
                    events.append({"start": start, "dur": step_dur, "pitch": n, "vel": 90, "chan": 1})
            elif rng.random() < 0.05 * hit_prob:
                n = rng.choice(notes)
                events.append({"start": start, "dur": step_dur, "pitch": n, "vel": 90, "chan": 1})
    return events


def gen_pads(chords: Sequence[str], meter: str, density: float, rng: random.Random, spec: SongSpec) -> List[Event]:
    """Generate sustained pad chords (one event per bar)."""

    beats = int(meter.split("/")[0])
    events: List[Event] = []
    hit_prob = density_to_hit_prob(density)
    for bar_idx, chord in enumerate(chords):
        root_pc, intervals = parse_chord_symbol(chord)
        base = midi_note(root_pc, 4)
        notes = [clamp_pitch(base + iv, "pads", spec) for iv in intervals]
        if rng.random() < min(1.0, hit_prob + 0.1):
            start = bar_idx * beats
            for n in notes:
                events.append({"start": start, "dur": beats, "pitch": n, "vel": 80, "chan": 2})
    return events


# ---------------------------------------------------------------------------
# Orchestration helper
# ---------------------------------------------------------------------------

def build_patterns_for_song(
    spec: SongSpec,
    seed: int,
    sampler_seed: int | None = None,
    *,
    verbose: bool = False,
    use_phrase_model: str = "auto",
) -> Dict:
    """Generate patterns for all sections/instruments using ``spec``."""
    plan: Dict = {"sections": []}
    meter = spec.meter
    for sec in spec.sections:
        density = float(spec.density_curve.get(sec.name, 0.5))
        chords_row = next((r for r in spec.harmony_grid if r.get("section") == sec.name), {})
        chords = chords_row.get("chords", ["C"] * sec.length)

        def _maybe_model(inst: str, fallback):
            if use_phrase_model == "no":
                return fallback()

            global generate_phrase
            if generate_phrase is None:
                try:
                    from .phrase_model import generate_phrase as _gp

                    generate_phrase = _gp
                except Exception:
                    if use_phrase_model == "yes":
                        raise
                    return fallback()

            try:
                return generate_phrase(
                    inst,
                    n_bars=sec.length,
                    meter=meter,
                    chords=chords,
                    density=density,
                    seed=sampler_seed if sampler_seed is not None else seed,
                    timeout=1.0,
                    verbose=verbose,
                )
            except Exception:
                if use_phrase_model == "yes":
                    raise
                return fallback()

        sec_plan = {"section": sec.name, "length_bars": sec.length, "patterns": {}}
        sec_plan["patterns"]["drums"] = _maybe_model(
            "drums",
            lambda: gen_drums(sec.length, meter, density, _seeded_rng(seed, sec.name, "drums"), spec),
        )
        sec_plan["patterns"]["bass"] = _maybe_model(
            "bass",
            lambda: gen_bass(chords, meter, density, _seeded_rng(seed, sec.name, "bass"), spec),
        )
        sec_plan["patterns"]["keys"] = _maybe_model(
            "keys",
            lambda: gen_keys(chords, meter, density, _seeded_rng(seed, sec.name, "keys"), spec),
        )
        sec_plan["patterns"]["pads"] = gen_pads(chords, meter, density, _seeded_rng(seed, sec.name, "pads"), spec)

        plan["sections"].append(sec_plan)
    return plan
