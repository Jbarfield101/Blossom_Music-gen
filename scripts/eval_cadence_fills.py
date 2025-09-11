import argparse
import json
import logging
import sys
from pathlib import Path
from statistics import mean
from typing import Dict, Iterable, Iterator, List, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import event_vocab
from core.stems import Stem, bars_to_beats


logger = logging.getLogger(__name__)


def _load_from_json(obj: Dict) -> Tuple[List[Stem], Dict]:
    """Return notes and metadata from a JSON object."""
    if "tokens" in obj:
        tokens = [tuple(t) for t in obj["tokens"]]
        notes, meta = event_vocab.decode(tokens)
        return notes, meta
    notes = [Stem(**n) for n in obj.get("notes", [])]
    meta = obj.get("meta", {})
    return notes, meta


def iter_sequences(paths: Sequence[Path]) -> Iterator[Tuple[List[Stem], Dict]]:
    """Yield ``(notes, meta)`` pairs from ``paths``.

    Paths may reference JSON or JSONL files containing either rendered
    stems or token sequences. Directories are scanned for ``*.json`` files.
    """

    for path in paths:
        if path.is_dir():
            for p in sorted(path.glob("*.json")):
                yield from iter_sequences([p])
            continue

        if path.suffix == ".jsonl":
            with path.open() as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    yield _load_from_json(json.loads(line))
            continue

        if path.suffix == ".json":
            yield _load_from_json(json.loads(path.read_text()))


def _note_density(notes: Sequence[Stem], beats_per_bar: int) -> List[float]:
    counts: Dict[int, int] = {}
    for n in notes:
        bar = int(n.start // beats_per_bar)
        counts[bar] = counts.get(bar, 0) + 1
    return [c / beats_per_bar for c in counts.values()]


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path, help="Input stem or token files")
    parser.add_argument("--log-level", default="INFO", help="Logging level")
    args = parser.parse_args(argv)

    logging.basicConfig(level=getattr(logging, args.log_level.upper()))

    sequences = list(iter_sequences(args.paths))
    if not sequences:
        logger.error("No sequences found")
        return

    cad, non_cad = [], []
    soon, no_soon = [], []
    final, no_final = [], []

    for notes, meta in sequences:
        beats_per_bar = int(meta.get("meter_beats", bars_to_beats(str(meta.get("meter", "4/4")))))
        dens = _note_density(notes, beats_per_bar)
        if meta.get("cadence", 0):
            cad.extend(dens)
        else:
            non_cad.extend(dens)
        if meta.get("cadence_soon", 0):
            soon.extend(dens)
        else:
            no_soon.extend(dens)
        if meta.get("final", 0):
            final.extend(dens)
        else:
            no_final.extend(dens)

    def avg(seq: List[float]) -> float:
        return mean(seq) if seq else 0.0

    logger.info("Cadence bars avg density: %.2f from %d bars", avg(cad), len(cad))
    logger.info("Non-cadence bars avg density: %.2f from %d bars", avg(non_cad), len(non_cad))

    if avg(soon) > avg(no_soon):
        logger.info(
            "Note density increases when CADENCE_SOON token is present: %.2f vs %.2f",
            avg(soon),
            avg(no_soon),
        )
    else:
        logger.info(
            "No density increase for CADENCE_SOON token: %.2f vs %.2f",
            avg(soon),
            avg(no_soon),
        )

    if avg(final) > avg(no_final):
        logger.info(
            "Note density increases when FINAL token is present: %.2f vs %.2f",
            avg(final),
            avg(no_final),
        )
    else:
        logger.info(
            "No density increase for FINAL token: %.2f vs %.2f",
            avg(final),
            avg(no_final),
        )


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
