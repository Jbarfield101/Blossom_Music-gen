import json
import subprocess
import sys
from pathlib import Path

import pytest


def _write_spec(path: Path) -> None:
    spec = {
        "title": "BundleTest",
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


def test_bundle_creation(tmp_path):
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
        "--bundle-stems",
        "--arrange",
        "off",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)

    assert (bundle_dir / "song.json").exists()
    assert (bundle_dir / "stems.mid").exists()
    assert (bundle_dir / "mix.wav").exists()
    assert (bundle_dir / "arrangement.txt").exists()
    assert (bundle_dir / "config.json").exists()
    assert (bundle_dir / "README.txt").exists()
    if (bundle_dir / "stems").exists():
        assert any((bundle_dir / "stems").glob("*.wav"))

    mix_path = tmp_path / "mix.wav"
    stems_dir = tmp_path / "stems"
    cmd2 = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--mix",
        str(mix_path),
        "--stems",
        str(stems_dir),
        "--arrange",
        "off",
    ]
    subprocess.run(cmd2, cwd=repo_root, check=True)
    assert mix_path.exists()
    assert any(stems_dir.glob("*.wav"))
