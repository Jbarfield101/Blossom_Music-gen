import math
import os, sys
import numpy as np
import pytest
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec, Section
from core.stems import Stem, bars_to_beats, beats_to_secs
from core import dynamics
from core.render import render_song
from core.mixer import mix


@pytest.fixture
def song_spec() -> SongSpec:
    return SongSpec(
        tempo=120,
        meter="4/4",
        sections=[Section("verse", 1), Section("chorus", 1)],
    )


def test_chorus_louder_than_verse(song_spec: SongSpec):
    spec = song_spec
    sec_per_bar = bars_to_beats(spec.meter) * beats_to_secs(spec.tempo)
    stems = {
        "keys": [
            Stem(start=0.0, dur=0.5, pitch=60, vel=80, chan=0),
            Stem(start=sec_per_bar, dur=0.5, pitch=60, vel=80, chan=0),
        ]
    }
    processed = dynamics.apply(spec, stems, seed=0)
    verse_vels = [n.vel for n in processed["keys"] if n.start < sec_per_bar]
    chorus_vels = [n.vel for n in processed["keys"] if n.start >= sec_per_bar]

    def rms(vals):
        return math.sqrt(sum(v * v for v in vals) / len(vals))

    assert rms(chorus_vels) > rms(verse_vels)

    sr = 44100
    rendered = render_song(processed, sr)
    mixed = mix(rendered, sr)
    bar_samples = int(sec_per_bar * sr)
    verse_audio = mixed[:bar_samples]
    chorus_audio = mixed[bar_samples : 2 * bar_samples]

    def audio_rms(buf: np.ndarray) -> float:
        return float(np.sqrt(np.mean(np.square(buf))))

    assert audio_rms(chorus_audio) > audio_rms(verse_audio)
