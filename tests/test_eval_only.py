import json
import subprocess
import sys
from pathlib import Path

import pytest


def _write_spec(path: Path) -> None:
    spec = {
        "title": "EvalOnly",
        "tempo": 120,
        "meter": "4/4",
        "sections": [{"name": "A", "length": 1}],
        "harmony_grid": [{"section": "A", "chords": ["C"]}],
        "density_curve": {"A": 1.0},
        "register_policy": {
            "drums": [36, 50],
            "bass": [40, 60],
            "keys": [60, 72],
            "pads": [60, 72],
        },
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(spec, fh)


def test_eval_only(tmp_path):
    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

    py310 = Path(sys.executable).resolve().parent.parent / "3.10.17/bin/python"
    if not py310.exists():
        pytest.skip("python3.10 not available")

    bundle_dir = tmp_path / "bundle"
    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--bundle",
        str(bundle_dir),
        "--arrange",
        "off",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)

    mix_path = bundle_dir / "mix.wav"
    mix_bytes = mix_path.read_bytes()

    metrics_path = bundle_dir / "metrics.json"
    if metrics_path.exists():
        metrics_path.unlink()

    cmd2 = [
        str(py310),
        "main_render.py",
        "--bundle",
        str(bundle_dir),
        "--eval-only",
    ]
    subprocess.run(cmd2, cwd=repo_root, check=True)

    assert metrics_path.exists()
    with metrics_path.open() as fh:
        data = json.load(fh)
    assert "chord_tone_coverage" in data
    assert "audio_stats" in data

    mix_bytes_after = mix_path.read_bytes()
    assert mix_bytes_after == mix_bytes
