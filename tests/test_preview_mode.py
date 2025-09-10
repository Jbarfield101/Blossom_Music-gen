import os
import json
import subprocess
import sys
import wave
from pathlib import Path

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.midi_load import load_melody_midi
from core.stems import bars_to_beats, beats_to_secs


def _write_spec(path: Path) -> None:
    spec = {
        "title": "PreviewTest",
        "tempo": 120,
        "meter": "4/4",
        "sections": [{"name": "A", "length": 4}],
        "harmony_grid": [{"section": "A", "chords": ["C", "F", "G", "C"]}],
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


def test_preview_mode_durations(tmp_path):
    py310 = _py310()
    if not py310.exists():
        pytest.skip("python3.10 not available")

    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

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
        "--preview",
        "2",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)

    mix_path = bundle_dir / "mix.wav"
    midi_path = bundle_dir / "stems.mid"
    assert mix_path.exists()
    assert midi_path.exists()

    with wave.open(mix_path) as wf:
        frames = wf.getnframes()
        sr = wf.getframerate()
        wav_dur = frames / float(sr)

    notes, tempo, meter = load_melody_midi(midi_path)
    midi_dur = max((n.start + n.dur) for n in notes) if notes else 0.0

    expected = 2 * bars_to_beats(meter) * beats_to_secs(tempo)
    assert wav_dur == pytest.approx(expected, abs=0.01)
    assert midi_dur == pytest.approx(expected, abs=0.01)
