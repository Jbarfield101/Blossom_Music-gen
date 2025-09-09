import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.render import render_song, _noise_burst
from core.stems import Stem


def test_drum_fallback_noise():
    sr = 44100
    note = Stem(start=0.0, dur=0.5, pitch=36, vel=127, chan=9)
    stems = {"drums": [note]}
    audio = render_song(stems, sr)
    rendered = audio["drums"].tolist()
    expected = _noise_burst(note, sr).tolist()
    assert rendered == expected
