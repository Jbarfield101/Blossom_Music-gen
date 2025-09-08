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

def gen_drums(n_bars: int, meter: str, density: float, rng: random.Random) -> Dict[str, List[List[int]]]:
    """Generate very small drum patterns as euclidean grids."""
    steps = _steps_per_bar(meter)
    beats = int(meter.split("/")[0])
    step_per_beat = steps // beats
    out = {"kick": [], "snare": [], "hat": []}
    for _ in range(n_bars):
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

        out["kick"].append(kick)
        out["snare"].append(snare)
        out["hat"].append(hat)
    return out


def gen_bass(chords: Sequence[str], meter: str, density: float, rng: random.Random) -> List[List[int | None]]:
    """Generate root-note bass lines."""
    steps = _steps_per_bar(meter)
    out: List[List[int | None]] = []
    for chord in chords:
        root_pc, _ = parse_chord_symbol(chord)
        root = midi_note(root_pc, 2)
        pulses = max(1, int(round(1 + density * 2)))
        hits = euclid(pulses, steps)
        bar = [None] * steps
        for i, h in enumerate(hits):
            if h:
                bar[i] = root
        out.append(bar)
    return out


def gen_keys(chords: Sequence[str], meter: str, density: float, rng: random.Random) -> List[List[Sequence[int]]]:
    """Generate block-chord keyboard parts."""
    steps = _steps_per_bar(meter)
    out: List[List[Sequence[int]]] = []
    for chord in chords:
        root_pc, intervals = parse_chord_symbol(chord)
        base = midi_note(root_pc, 4)
        notes = [base + iv for iv in intervals]
        pulses = max(1, int(round(1 + density * 3)))
        hits = euclid(pulses, steps)
        bar: List[List[int]] = [[] for _ in range(steps)]
        for i, h in enumerate(hits):
            if h:
                bar[i] = notes
            elif rng.random() < density * 0.05:
                bar[i] = [rng.choice(notes)]
        out.append(bar)
    return out


def gen_pads(chords: Sequence[str], meter: str, density: float, rng: random.Random) -> List[List[Sequence[int]]]:
    """Generate sustained pad chords (one per bar)."""
    steps = _steps_per_bar(meter)
    out: List[List[Sequence[int]]] = []
    for chord in chords:
        root_pc, intervals = parse_chord_symbol(chord)
        base = midi_note(root_pc, 4)
        notes = [base + iv for iv in intervals]
        bar: List[List[int]] = [[] for _ in range(steps)]
        if rng.random() < density + 0.1:
            bar[0] = notes
        out.append(bar)
    return out


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
