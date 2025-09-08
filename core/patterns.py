# core/patterns.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional
from pathlib import Path
import hashlib, random

from .song_spec import SongSpec
from .utils import density_bucket_from_float, read_json, ensure_file

# ---------- Data model ----------

@dataclass(frozen=True)
class Pattern:
    id: str
    instrument: str          # "drums" | "bass" | "keys" | "pads"
    meter: str               # e.g., "4/4"
    density: str             # "sparse" | "med" | "busy"
    length_bars: int
    midi_file: str           # relative path under /patterns/...
    style: Optional[str] = None
    tags: Optional[List[str]] = None

# ---------- Index loading / registry ----------

def load_pattern_index(index_path: str | Path, patterns_root: str | Path = None) -> Dict[str, List[Pattern]]:
    """
    Load patterns/_meta/index.json and return a registry dict keyed by instrument.
    Validates presence of referenced MIDI files.
    """
    index_path = Path(index_path)
    root = Path(patterns_root) if patterns_root else index_path.parent.parent
    data = read_json(index_path)

    # optional schema sanity checks
    registry: Dict[str, List[Pattern]] = {"drums": [], "bass": [], "keys": [], "pads": []}
    for entry in data:
        p = Pattern(
            id=str(entry["id"]),
            instrument=str(entry["instrument"]),
            meter=str(entry["meter"]),
            density=str(entry["density"]),
            length_bars=int(entry["length_bars"]),
            midi_file=str(entry["midi_file"]),
            style=entry.get("style"),
            tags=entry.get("tags"),
        )
        if p.instrument not in registry:
            registry[p.instrument] = []
        # ensure MIDI exists
        ensure_file(root / p.midi_file, f"Missing MIDI for pattern {p.id}: {p.midi_file}")
        registry[p.instrument].append(p)

    return registry

# ---------- Selection helpers ----------

def _seeded_rng(seed: int, *tokens: str) -> random.Random:
    h = hashlib.sha256(("|".join([str(seed), *map(str, tokens)])).encode("utf-8")).hexdigest()
    # Use first 16 hex chars as int seed
    return random.Random(int(h[:16], 16))

def _filter_candidates(
    registry: Dict[str, List[Pattern]],
    instrument: str,
    meter: str,
    density_bucket: str,
    style: Optional[str] = None,
) -> List[Pattern]:
    candidates = [
        p for p in registry.get(instrument, [])
        if p.meter == meter and p.density == density_bucket and (style is None or p.style == style)
    ]
    # if style filter is too strict, fallback without style
    if not candidates and style is not None:
        candidates = [
            p for p in registry.get(instrument, [])
            if p.meter == meter and p.density == density_bucket
        ]
    return candidates

# ---------- Main API ----------

def select_patterns_for_section(
    section_name: str,
    instrument: str,
    n_bars: int,
    meter: str,
    density_value: float,
    registry: Dict[str, List[Pattern]],
    seed: int,
    style: Optional[str] = None,
) -> List[str]:
    """
    Returns a list of Pattern IDs whose lengths cover exactly n_bars.
    Deterministic given (seed, section_name, instrument).
    """
    rng = _seeded_rng(seed, section_name, instrument)
    density_bucket = density_bucket_from_float(density_value)
    pool = _filter_candidates(registry, instrument, meter, density_bucket, style)

    if not pool:
        # last ditch: any density that matches meter
        pool = [p for p in registry.get(instrument, []) if p.meter == meter]
    if not pool:
        return []  # no patterns for this instrument/meter

    # prefer “fill” when we need to close gaps
    fill_pool = [p for p in pool if "fill" in (p.id.lower()) or (p.tags and "fill" in [t.lower() for t in p.tags])]
    normal_pool = [p for p in pool if p not in fill_pool] or pool

    chosen: List[str] = []
    bars_left = n_bars
    while bars_left > 0:
        # if close to the end, try to pick an exact-fit fill
        exact = [p for p in fill_pool if p.length_bars == bars_left] or [p for p in normal_pool if p.length_bars == bars_left]
        if exact:
            p = rng.choice(exact)
        else:
            # otherwise pick a normal pattern that doesn't exceed bars_left
            feas = [p for p in normal_pool if p.length_bars <= bars_left] or [rng.choice(pool)]
            p = rng.choice(feas)
        chosen.append(p.id)
        bars_left -= p.length_bars
        if bars_left < 0:
            # Safety: if we overran (because last resort picked longer), trim by discarding last and force exact fill if possible
            chosen.pop()
            # try exact fill; if none, pick the smallest fill repeatedly
            smallest = min(fill_pool or pool, key=lambda x: x.length_bars)
            reps = max(1, bars_left + p.length_bars // smallest.length_bars)
            chosen.extend([smallest.id] * reps)
            bars_left = n_bars - sum(_pattern_length(pid, pool) for pid in chosen)
            if bars_left < 0:
                # final clamp: drop last until we fit
                while bars_left < 0 and chosen:
                    last = chosen.pop()
                    bars_left += _pattern_length(last, pool)

    return chosen

def _pattern_length(pid: str, pool: List[Pattern]) -> int:
    for p in pool:
        if p.id == pid:
            return p.length_bars
    return 0

def build_section_plan(spec: SongSpec, registry: Dict[str, List[Pattern]], seed: int) -> Dict:
    """
    For each section and each instrument, pick patterns to cover section bars.
    Density comes from spec.density_curve[section], default 0.5 if missing.
    """
    meter = spec.meter
    plan = {"sections": []}

    for sec in spec.sections:
        n_bars = sec.length
        density = float(spec.density_curve.get(sec.name, 0.5))
        sec_plan = {"section": sec.name, "length_bars": n_bars, "patterns": {}}

        for instrument in ("drums", "bass", "keys", "pads"):
            ids = select_patterns_for_section(
                section_name=sec.name,
                instrument=instrument,
                n_bars=n_bars,
                meter=meter,
                density_value=density,
                registry=registry,
                seed=seed,
                style=None,  # hook: you can wire spec.style later
            )
            if ids:
                sec_plan["patterns"][instrument] = ids

        plan["sections"].append(sec_plan)

    return plan
