import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.render import render_song, _noise_burst, _load_drum_samples
from core.stems import Stem


def test_drum_fallback_noise():
    sr = 44100
    note = Stem(start=0.0, dur=0.5, pitch=36, vel=127, chan=9)
    stems = {"drums": [note]}
    audio = render_song(stems, sr)
    rendered = audio["drums"].tolist()
    expected = _noise_burst(note, sr).tolist()
    assert rendered == expected


def test_drum_flac_sample_loaded(tmp_path):
    sf = pytest.importorskip("soundfile")
    sr = 44100
    # Create a simple FLAC kick sample
    sample_path = tmp_path / "kick.flac"
    sf.write(sample_path, [0.1] * 10, sr)
    mapping = _load_drum_samples(tmp_path, sr)
    assert 36 in mapping and len(mapping[36]) == 10


def test_custom_drum_pattern(tmp_path):
    sf = pytest.importorskip("soundfile")
    sr = 44100
    # Sample file with a non-standard name
    sample_path = tmp_path / "bd.flac"
    sf.write(sample_path, [0.2] * 5, sr)
    mapping = _load_drum_samples(tmp_path, sr, {36: "bd.flac"})
    assert 36 in mapping and len(mapping[36]) == 5
