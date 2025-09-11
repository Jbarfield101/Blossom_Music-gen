#!/usr/bin/env python3
"""Evaluate note densities for cadence markers.

This utility loads token sequences or rendered stems and computes
note density per bar. Densities of bars with ``CADENCE_SOON`` or
``FINAL`` tokens are compared against ordinary bars and an
increase is logged when such markers are present.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean
from typing import Iterable, List, Sequence, Tuple

import sys

# Allow running as a standalone script
sys.path.append(str(Path(__file__).resolve().parents[1]))

from core import event_vocab
from core.stems import Stem, bars_to_beats


TokenSeq = Sequence[Tuple[int, int]]


def _load_jsonl(path: Path) -> Iterable[TokenSeq]:
    """Yield token sequences from a JSONL ``path``."""
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            if isinstance(data, dict):
                yield data.get("tokens", [])
            else:
                yield data


def _iter_sequences(path: Path) -> Iterable[Tuple[List[Stem], int, bool]]:
    """Yield ``(notes, beats_per_bar, is_cadence)`` tuples from ``path``."""
    if path.suffix == ".jsonl":
        tokens_iter = _load_jsonl(path)
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "tokens" in data:
            tokens_iter = [data["tokens"]]
        elif isinstance(data, list) and data and isinstance(data[0], list):
            tokens_iter = [data]
        else:
            # Treat as stem representation
            stems_data = data.get("stems", []) if isinstance(data, dict) else []
            meta = data.get("meta", {}) if isinstance(data, dict) else {}
            notes = [Stem(**s) for s in stems_data]
            beats = meta.get("meter_beats")
            if beats is None:
                meter = meta.get("meter", "4/4")
                beats = bars_to_beats(meter)
            is_cadence = bool(meta.get("cadence_soon")) or bool(meta.get("final"))
            yield notes, beats, is_cadence
            return

    for tokens in tokens_iter:
        notes, meta = event_vocab.decode(tokens)
        beats = int(meta.get("meter_beats", 4))
        is_cadence = bool(meta.get("cadence_soon")) or bool(meta.get("final"))
        yield notes, beats, is_cadence


def _densities(stems: List[Stem], beats_per_bar: int) -> List[float]:
    counts: dict[int, int] = {}
    for note in stems:
        bar = int(note.start // beats_per_bar)
        counts[bar] = counts.get(bar, 0) + 1
    return [cnt / beats_per_bar for _, cnt in sorted(counts.items())]


def evaluate(paths: Sequence[Path]) -> None:
    cadence_densities: List[float] = []
    normal_densities: List[float] = []

    for path in paths:
        for notes, beats, is_cadence in _iter_sequences(path):
            densities = _densities(notes, beats)
            if is_cadence:
                cadence_densities.extend(densities)
            else:
                normal_densities.extend(densities)

    avg_cadence = mean(cadence_densities) if cadence_densities else 0.0
    avg_normal = mean(normal_densities) if normal_densities else 0.0

    print(f"Cadence bars average density: {avg_cadence:.3f}")
    print(f"Non-cadence bars average density: {avg_normal:.3f}")
    if avg_cadence > avg_normal:
        print("Note density increases when CADENCE_SOON or FINAL tokens are present.")
    else:
        print("No increase in note density for cadence bars.")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="JSON/JSONL files containing token sequences or stems")
    args = parser.parse_args(argv)
    evaluate(args.files)


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
