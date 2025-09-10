import subprocess
import sys
from pathlib import Path
import json

import pytest

from core.stems import Stem
from core.midi_export import stems_to_midi
from core.midi_load import load_melody_midi


def _write_spec(path: Path) -> None:
    spec = {
        "title": "MelodyTest",
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


def _py310() -> Path:
    return Path(sys.executable).resolve().parent.parent / "3.10.17/bin/python"


def test_cli_merges_user_melody(tmp_path):
    py310 = _py310()
    if not py310.exists():
        pytest.skip("python3.10 not available")

    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

    melody_path = tmp_path / "melody.mid"
    melody_note = Stem(start=0.0, dur=1.0, pitch=100, vel=100, chan=0)
    stems_to_midi({"melody": [melody_note]}, 120, "4/4", melody_path)

    out_dir = tmp_path / "stems"
    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--melody-midi",
        str(melody_path),
        "--stems",
        str(out_dir),
        "--dry-run",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)

    midi_path = out_dir / "stems.mid"
    assert midi_path.exists()
    notes, tempo, meter = load_melody_midi(midi_path)
    assert tempo == pytest.approx(120)
    assert meter == "4/4"
    assert any(n.pitch == 100 for n in notes)


def test_melody_tempo_mismatch(tmp_path):
    py310 = _py310()
    if not py310.exists():
        pytest.skip("python3.10 not available")

    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

    melody_path = tmp_path / "melody.mid"
    melody_note = Stem(start=0.0, dur=1.0, pitch=100, vel=100, chan=0)
    # Different tempo than spec
    stems_to_midi({"melody": [melody_note]}, 100, "4/4", melody_path)

    out_dir = tmp_path / "stems"
    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--melody-midi",
        str(melody_path),
        "--stems",
        str(out_dir),
        "--dry-run",
    ]
    with pytest.raises(subprocess.CalledProcessError):
        subprocess.run(cmd, cwd=repo_root, check=True)
