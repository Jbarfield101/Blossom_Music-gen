"""Utilities for building tokenized training datasets.

This script collects note stems and optional MIDI files, tokenizes them
using :mod:`core.event_vocab`, performs a deterministic train/validation
split, and writes the sequences out as JSONL files.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple, Dict, Any

from core import event_vocab, midi_load
from core.stems import Stem, beats_to_secs


def _load_stem_json(path: Path) -> Tuple[List[Stem], Dict[str, Any]]:
    """Load note stems and metadata from ``path``.

    The JSON file is expected to contain a ``"notes"`` list describing the
    events and an optional ``"meta"`` mapping with conditioning fields.
    """

    data = json.loads(path.read_text())
    notes = [Stem(**n) for n in data.get("notes", [])]
    meta = data.get("meta", {})
    return notes, meta


def _load_midi(path: Path) -> Tuple[List[Stem], Dict[str, Any]]:
    """Load a MIDI file and return notes in beats along with metadata."""

    notes_sec, tempo, meter = midi_load.load_melody_midi(path)
    sec_per_beat = beats_to_secs(tempo)
    notes = [
        Stem(start=n.start / sec_per_beat, dur=n.dur / sec_per_beat, pitch=n.pitch, vel=n.vel, chan=n.chan)
        for n in notes_sec
    ]
    meta = {
        "section": "A",
        "meter": meter,
        "density": 0.5,
        "chord": "C",
        "seed": 0,
    }
    return notes, meta


def _tokenize(notes: Sequence[Stem], meta: Dict[str, Any]) -> List[Tuple[int, int]]:
    """Encode ``notes`` into token/value pairs using ``meta`` fields."""

    return event_vocab.encode(
        notes,
        section=str(meta.get("section", "A")),
        meter=str(meta.get("meter", "4/4")),
        density=float(meta.get("density", 0.5)),
        chord=str(meta.get("chord", "C")),
        seed=int(meta.get("seed", 0)),
        cadence=bool(meta.get("cadence", False)),
        cadence_soon=bool(meta.get("cadence_soon", False)),
        final=bool(meta.get("final", False)),
    )


def gather_songs(stems_dir: Path, midi_dir: Path | None) -> List[Dict[str, Any]]:
    """Collect and tokenize songs from ``stems_dir`` and ``midi_dir``."""

    songs: List[Dict[str, Any]] = []

    for path in sorted(stems_dir.glob("*.json")):
        notes, meta = _load_stem_json(path)
        tokens = _tokenize(notes, meta)
        songs.append({"tokens": tokens, "source": str(path)})

    if midi_dir and midi_dir.exists():
        for path in sorted(midi_dir.glob("*.mid")):
            notes, meta = _load_midi(path)
            tokens = _tokenize(notes, meta)
            songs.append({"tokens": tokens, "source": str(path)})

    return songs


def split_train_val(items: Sequence[Any], val_ratio: float, seed: int) -> Tuple[List[Any], List[Any]]:
    """Split ``items`` into train/validation subsets.

    The split is deterministic for a given ``seed``.
    """

    rng = random.Random(seed)
    indices = list(range(len(items)))
    rng.shuffle(indices)
    val_count = int(round(len(items) * val_ratio))
    val_set = set(indices[:val_count])
    train = [items[i] for i in range(len(items)) if i not in val_set]
    val = [items[i] for i in range(len(items)) if i in val_set]
    return train, val


def _save_jsonl(path: Path, records: Iterable[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec) + "\n")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stems-dir", type=Path, default=Path("out"), help="Directory containing stem JSON files")
    parser.add_argument("--midi-dir", type=Path, default=None, help="Optional directory of MIDI files")
    parser.add_argument("--val-ratio", type=float, default=0.1, help="Validation split ratio")
    parser.add_argument("--seed", type=int, default=0, help="Random seed for splits")
    parser.add_argument("--out-dir", type=Path, default=Path("data"), help="Output directory for JSONL files")
    args = parser.parse_args(argv)

    songs = gather_songs(args.stems_dir, args.midi_dir)
    train, val = split_train_val(songs, args.val_ratio, args.seed)
    _save_jsonl(args.out_dir / "train.jsonl", train)
    _save_jsonl(args.out_dir / "val.jsonl", val)


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
