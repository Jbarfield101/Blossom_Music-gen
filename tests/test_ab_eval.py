import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec


def _simple_spec() -> SongSpec:
    spec = SongSpec.from_dict(
        {
            "title": "Test",
            "seed": 1,
            "key": "C",
            "mode": "ionian",
            "tempo": 120,
            "meter": "4/4",
            "sections": [{"name": "A", "length": 1}],
            "harmony_grid": [{"section": "A", "chords": ["C"]}],
            "density_curve": {"A": 0.5},
            "register_policy": {
                "drums": [36, 50],
                "bass": [40, 60],
                "keys": [60, 72],
                "pads": [60, 72],
            },
        }
    )
    spec.validate()
    return spec


def test_ab_eval(tmp_path):
    spec = _simple_spec()
    spec_path = tmp_path / "spec.json"
    spec.to_json(spec_path)
    out_dir = tmp_path / "out"
    script = Path(__file__).resolve().parents[1] / "scripts" / "ab_eval.py"

    subprocess.run(
        [sys.executable, str(script), "--spec", str(spec_path), "--out", str(out_dir), "--seed", "0"],
        check=True,
    )

    for name in ["algorithmic.wav", "learned.wav", "metrics.json", "metrics.csv"]:
        assert (out_dir / name).exists()

    metrics = json.loads((out_dir / "metrics.json").read_text())
    for variant in metrics.values():
        for key in ["note_diversity", "ioi_histogram", "cadence_density", "section_loudness"]:
            assert key in variant


