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

from typing import Dict, List, Sequence
import hashlib
import random

from .song_spec import SongSpec
from .theory import parse_chord_symbol, midi_note
from .utils import Event


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
# Instrument generators
# ---------------------------------------------------------------------------

def gen_drums(n_bars: int, meter: str, density: float, rng: random.Random) -> List[Event]:
    """Generate drum events using a simple Euclidean approach."""

    steps = _steps_per_bar(meter)
    beats = int(meter.split("/")[0])
    step_per_beat = steps // beats
    step_dur = 1 / step_per_beat
    events: List[Event] = []
    for bar_idx in range(n_bars):
        pulses = max(1, int(round(1 + density * 3)))
        kick = euclid(pulses, steps)

        snare = [0] * steps
        if beats >= 4:
            snare[step_per_beat] = 1
            snare[3 * step_per_beat] = 1
        else:
            snare[steps // 2] = 1
        for i in range(steps):
            if not snare[i] and rng.random() < density * 0.1:
                snare[i] = 1

        hat = [0] * steps
        for i in range(steps):
            if step_per_beat // 2 == 0 or i % (step_per_beat // 2) == 0:
                hat[i] = 1
            elif rng.random() < density * 0.5:
                hat[i] = 1

        bar_start = bar_idx * beats
        for i in range(steps):
            start = bar_start + i / step_per_beat
            if kick[i]:
                events.append({"start": start, "dur": step_dur, "pitch": 36, "vel": 100, "chan": 9})
            if snare[i]:
                events.append({"start": start, "dur": step_dur, "pitch": 38, "vel": 100, "chan": 9})
            if hat[i]:
                events.append({"start": start, "dur": step_dur, "pitch": 42, "vel": 80, "chan": 9})
    return events


def gen_bass(chords: Sequence[str], meter: str, density: float, rng: random.Random) -> List[Event]:
    """Generate root-note bass line events."""

    steps = _steps_per_bar(meter)
    beats = int(meter.split("/")[0])
    step_per_beat = steps // beats
    step_dur = 1 / step_per_beat
    events: List[Event] = []
    for bar_idx, chord in enumerate(chords):
        root_pc, _ = parse_chord_symbol(chord)
        root = midi_note(root_pc, 2)
        pulses = max(1, int(round(1 + density * 2)))
        hits = euclid(pulses, steps)
        bar_start = bar_idx * beats
        for i, h in enumerate(hits):
            if h:
                start = bar_start + i / step_per_beat
                events.append({"start": start, "dur": step_dur, "pitch": root, "vel": 100, "chan": 0})
    return events


def gen_keys(chords: Sequence[str], meter: str, density: float, rng: random.Random) -> List[Event]:
    """Generate block-chord keyboard part events."""

    steps = _steps_per_bar(meter)
    beats = int(meter.split("/")[0])
    step_per_beat = steps // beats
    step_dur = 1 / step_per_beat
    events: List[Event] = []
    for bar_idx, chord in enumerate(chords):
        root_pc, intervals = parse_chord_symbol(chord)
        base = midi_note(root_pc, 4)
        notes = [base + iv for iv in intervals]
        pulses = max(1, int(round(1 + density * 3)))
        hits = euclid(pulses, steps)
        bar_start = bar_idx * beats
        for i, h in enumerate(hits):
            start = bar_start + i / step_per_beat
            if h:
                for n in notes:
                    events.append({"start": start, "dur": step_dur, "pitch": n, "vel": 90, "chan": 1})
            elif rng.random() < density * 0.05:
                n = rng.choice(notes)
                events.append({"start": start, "dur": step_dur, "pitch": n, "vel": 90, "chan": 1})
    return events


def gen_pads(chords: Sequence[str], meter: str, density: float, rng: random.Random) -> List[Event]:
    """Generate sustained pad chords (one event per bar)."""

    beats = int(meter.split("/")[0])
    events: List[Event] = []
    for bar_idx, chord in enumerate(chords):
        root_pc, intervals = parse_chord_symbol(chord)
        base = midi_note(root_pc, 4)
        notes = [base + iv for iv in intervals]
        if rng.random() < density + 0.1:
            start = bar_idx * beats
            for n in notes:
                events.append({"start": start, "dur": beats, "pitch": n, "vel": 80, "chan": 2})
    return events


# ---------------------------------------------------------------------------
# Orchestration helper
# ---------------------------------------------------------------------------

def build_patterns_for_song(spec: SongSpec, seed: int) -> Dict:
    """Generate patterns for all sections/instruments using ``spec``."""
    plan: Dict = {"sections": []}
    meter = spec.meter
    for sec in spec.sections:
        density = float(spec.density_curve.get(sec.name, 0.5))
        chords_row = next((r for r in spec.harmony_grid if r.get("section") == sec.name), {})
        chords = chords_row.get("chords", ["C"] * sec.length)

        sec_plan = {"section": sec.name, "length_bars": sec.length, "patterns": {}}
        sec_plan["patterns"]["drums"] = gen_drums(sec.length, meter, density, _seeded_rng(seed, sec.name, "drums"))
        sec_plan["patterns"]["bass"] = gen_bass(chords, meter, density, _seeded_rng(seed, sec.name, "bass"))
        sec_plan["patterns"]["keys"] = gen_keys(chords, meter, density, _seeded_rng(seed, sec.name, "keys"))
        sec_plan["patterns"]["pads"] = gen_pads(chords, meter, density, _seeded_rng(seed, sec.name, "pads"))

        plan["sections"].append(sec_plan)
    return plan
