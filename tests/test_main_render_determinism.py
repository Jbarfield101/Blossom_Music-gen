import json
import subprocess
import sys
from pathlib import Path

import pytest


def _write_spec(path: Path) -> None:
    spec = {
        "title": "Determinism",
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


def _render(spec_path: Path, out_dir: Path, py310: Path, repo_root: Path) -> tuple[str, bytes]:
    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--bundle",
        str(out_dir),
        "--dry-run",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)
    log_path = out_dir / "progress.jsonl"
    with log_path.open() as fh:
        entries = [json.loads(line) for line in fh]
    rhash = next(e["hash"] for e in entries if "hash" in e)
    midi_bytes = (out_dir / "stems.mid").read_bytes()
    return rhash, midi_bytes


def test_main_render_deterministic_cli(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

    py310 = Path(sys.executable).resolve().parent.parent / "3.10.17/bin/python"
    if not py310.exists():
        pytest.skip("python3.10 not available")

    out1 = tmp_path / "run1"
    out2 = tmp_path / "run2"

    hash1, midi1 = _render(spec_path, out1, py310, repo_root)
    hash2, midi2 = _render(spec_path, out2, py310, repo_root)

    assert hash1 == hash2
    assert midi1 == midi2
