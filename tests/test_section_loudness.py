import os, sys
import numpy as np
import pytest

# Add repository root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, bars_to_beats, beats_to_secs
from core import dynamics
from core.render import render_song
from core.mixer import mix

# RMS helper copied from main_render.py
def _rms_db(audio: np.ndarray) -> float:
    if audio.size == 0:
        return float("-inf")
    rms = np.sqrt(np.mean(np.square(audio)))
    if rms <= 0:
        return float("-inf")
    return 20 * np.log10(rms)

def _build_spec() -> SongSpec:
    spec = SongSpec.from_dict(
        {
            "title": "Loudness Test",
            "seed": 1,
            "key": "C",
            "mode": "ionian",
            "tempo": 120,
            "meter": "4/4",
            "sections": [
                {"name": "verse", "length": 1},
                {"name": "chorus", "length": 1},
            ],
            "harmony_grid": [
                {"section": "verse", "chords": ["C"]},
                {"section": "chorus", "chords": ["C"]},
            ],
            "density_curve": {"verse": 0.5, "chorus": 0.9},
            "register_policy": {
                "drums": [35, 45],
                "bass": [36, 60],
                "keys": [60, 84],
                "pads": [60, 84],
            },
        }
    )
    spec.validate()
    return spec


def test_chorus_rms_exceeds_verse():
    spec = _build_spec()
    sr = 44100

    stems = build_stems_for_song(spec, seed=spec.seed)
    processed = dynamics.apply(spec, stems, seed=spec.seed)
    rendered = render_song(processed, sr, tempo=spec.tempo, meter=spec.meter)
    mixed = mix(rendered, sr)

    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_bar = beats_per_bar * beats_to_secs(spec.tempo)
    sec_map = spec.bars_by_section()

    verse_range = sec_map["verse"]
    chorus_range = sec_map["chorus"]

    verse_start = int(verse_range.start * sec_per_bar * sr)
    verse_end = int(verse_range.stop * sec_per_bar * sr)
    chorus_start = int(chorus_range.start * sec_per_bar * sr)
    chorus_end = int(chorus_range.stop * sec_per_bar * sr)

    verse_rms = _rms_db(mixed[verse_start:verse_end])
    chorus_rms = _rms_db(mixed[chorus_start:chorus_end])

    assert chorus_rms - verse_rms > 3.0
