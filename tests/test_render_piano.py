import os
import sys
import json
import math
from pathlib import Path

import pytest

sf = pytest.importorskip("soundfile")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, bars_to_beats, beats_to_secs
from core.render import render_keys


def test_render_piano(tmp_path):
    # Write a minimal song specification to JSON
    spec_dict = {
        "title": "PianoTest",
        "seed": 7,
        "key": "C",
        "mode": "ionian",
        "tempo": 120,
        "meter": "4/4",
        "sections": [{"name": "A", "length": 1}],
        "harmony_grid": [{"section": "A", "chords": ["C"]}],
        "density_curve": {"A": 1.0},
        "register_policy": {
            "keys": [60, 84],
            "pads": [60, 84],
            "bass": [36, 60],
        },
    }
    song_path = tmp_path / "song.json"
    song_path.write_text(json.dumps(spec_dict))
    spec = SongSpec.from_json(str(song_path))
    spec.validate()

    # Prepare SFZ and matching sample in the temporary directory
    sfz_src = Path("assets/sfz/piano.sfz")
    sfz_path = tmp_path / "piano.sfz"
    sfz_text = sfz_src.read_text().replace(".wav", ".flac")
    sfz_path.write_text(sfz_text)

    sample_path = tmp_path / "piano_C4.flac"
    sr = 44100
    freq = 440.0
    dur = 0.5
    frames = int(sr * dur)
    samples = [math.sin(2 * math.pi * freq * i / sr) for i in range(frames)]
    sf.write(sample_path, samples, sr)

    # Build stems and render using the piano SFZ
    stems = build_stems_for_song(spec, spec.seed)
    keys = stems["keys"]
    audio = render_keys(keys, sfz_path, sr)

    beats_per_bar = bars_to_beats(spec.meter)
    total_secs = spec.total_bars() * beats_per_bar * beats_to_secs(spec.tempo)
    expected_len = int(round(total_secs * sr))
    assert abs(len(audio) - expected_len) <= 256

    peak = max(abs(x) for x in audio) if audio else 0.0
    assert peak <= 1.0
    assert any(x != 0.0 for x in audio)
