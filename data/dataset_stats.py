"""Utilities for computing statistics on tokenized datasets."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple, Any

from core import event_vocab

# Mapping from token id to human-readable name
TOKEN_ID_TO_NAME: Dict[int, str] = {
    event_vocab.BAR: "BAR",
    event_vocab.BEAT: "BEAT",
    event_vocab.INST: "INST",
    event_vocab.CHORD: "CHORD",
    event_vocab.DENS: "DENS",
    event_vocab.NOTE_ON: "NOTE_ON",
    event_vocab.NOTE_OFF: "NOTE_OFF",
    event_vocab.VEL: "VEL",
    event_vocab.DUR: "DUR",
    event_vocab.SECTION: "SECTION",
    event_vocab.CADENCE: "CADENCE",
    event_vocab.METER: "METER",
    event_vocab.SEED: "SEED",
}

# Tokens considered conditioning metadata
CONDITIONING_TOKENS = {
    event_vocab.SECTION,
    event_vocab.METER,
    event_vocab.DENS,
    event_vocab.CHORD,
    event_vocab.SEED,
    event_vocab.CADENCE,
}

# Optional mappings from token value to human-readable name
VALUE_MAPPINGS: Dict[int, Dict[int, str]] = {
    event_vocab.SECTION: event_vocab.ID_TO_SECTION,
    event_vocab.CHORD: event_vocab.ID_TO_CHORD,
}


def _load_jsonl(path: Path) -> Iterable[List[Tuple[int, int]]]:
    """Yield token sequences from a JSONL ``path``."""
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            data = json.loads(line)
            yield data.get("tokens", [])


def compute_stats(paths: Sequence[Path]) -> Dict[str, Any]:
    """Compute dataset statistics for JSONL files in ``paths``."""

    total_tokens = 0
    song_count = 0
    token_counts: Counter[str] = Counter()
    conditioning_counts: Dict[str, Counter[str]] = defaultdict(Counter)

    for path in paths:
        for tokens in _load_jsonl(path):
            song_count += 1
            total_tokens += len(tokens)
            for tok, val in tokens:
                name = TOKEN_ID_TO_NAME.get(tok, str(tok))
                token_counts[name] += 1
                if tok in CONDITIONING_TOKENS:
                    mapping = VALUE_MAPPINGS.get(tok)
                    if mapping:
                        val_name = mapping.get(val, str(val))
                    else:
                        val_name = str(val)
                    conditioning_counts[name][val_name] += 1

    avg_len = total_tokens / song_count if song_count else 0.0

    stats = {
        "songs": song_count,
        "total_tokens": total_tokens,
        "avg_tokens_per_song": avg_len,
        "token_type_counts": dict(token_counts),
        "conditioning_frequencies": {k: dict(v) for k, v in conditioning_counts.items()},
    }
    return stats


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="JSONL dataset files")
    parser.add_argument("--out-json", type=Path, default=None, help="Optional path to write JSON stats")
    args = parser.parse_args(argv)

    stats = compute_stats(args.files)
    print(json.dumps(stats, indent=2))

    if args.out_json:
        args.out_json.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
