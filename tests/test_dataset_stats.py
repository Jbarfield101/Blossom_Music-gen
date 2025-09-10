import os, sys, json
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.stems import Stem
from core import event_vocab
from data.dataset_stats import compute_stats


def _write_sample_dataset(path: Path) -> None:
    notes1 = [Stem(start=0.0, dur=1.0, pitch=60, vel=100, chan=0)]
    notes2 = [Stem(start=0.0, dur=1.0, pitch=64, vel=90, chan=1)]
    tokens1 = event_vocab.encode(notes1, section="A", meter="4/4", density=0.5, chord="C", seed=0)
    tokens2 = event_vocab.encode(notes2, section="B", meter="3/4", density=0.25, chord="G", seed=1)
    with path.open("w", encoding="utf-8") as fh:
        for tokens in (tokens1, tokens2):
            fh.write(json.dumps({"tokens": tokens}) + "\n")


def test_compute_stats(tmp_path):
    dataset = tmp_path / "sample.jsonl"
    _write_sample_dataset(dataset)
    stats = compute_stats([dataset])
    assert stats["songs"] == 2
    assert stats["total_tokens"] == 26
    assert stats["token_type_counts"]["NOTE_ON"] == 2
    assert stats["conditioning_frequencies"]["SECTION"]["A"] == 1
    assert stats["conditioning_frequencies"]["SECTION"]["B"] == 1
