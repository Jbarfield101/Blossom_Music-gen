import math
import pytest
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec, extend_sections_to_minutes
from core.arranger import arrange_song
from core.stems import Stem, bars_to_beats, beats_to_secs


def _base_spec():
    spec = SongSpec.from_dict({
        "title": "Loop", "tempo": 120, "meter": "4/4",
        "sections": [{"name": "A", "length": 1}],
        "harmony_grid": [{"section": "A", "chords": ["C"]}],
    })
    spec.validate()
    return spec


def test_loop_to_minutes():
    spec = _base_spec()
    spec.outro = "hit"
    extend_sections_to_minutes(spec, 1.0)
    bars_needed = math.ceil(1.0 * spec.tempo / 4)
    assert spec.total_bars() >= bars_needed
    assert spec.sections[-1].name == "outro"
    assert len(spec.sections) > 2


def test_outro_hit():
    spec = _base_spec()
    spec.outro = "hit"
    extend_sections_to_minutes(spec, 0.01)
    stems = {"bass": [Stem(start=0.0, dur=1.0, pitch=40, vel=100, chan=0)]}
    arr = arrange_song(spec, stems, style={}, seed=0)
    beats = bars_to_beats(spec.meter)
    sec_per_bar = beats * beats_to_secs(spec.tempo)
    start_outro = (spec.total_bars() - spec.sections[-1].length) * sec_per_bar
    times = [n.start for n in arr["bass"] if n.start >= start_outro]
    assert len(times) == 1
    assert times[0] == pytest.approx(start_outro, abs=0.01)


def test_outro_ritard():
    spec = _base_spec()
    spec.outro = "ritard"
    extend_sections_to_minutes(spec, 0.01)
    stems = {"bass": [Stem(start=0.0, dur=1.0, pitch=40, vel=100, chan=0)]}
    arr = arrange_song(spec, stems, style={}, seed=0)
    beats = bars_to_beats(spec.meter)
    sec_per_bar = beats * beats_to_secs(spec.tempo)
    start_outro = (spec.total_bars() - spec.sections[-1].length) * sec_per_bar
    times = [n.start for n in arr["bass"] if n.start >= start_outro]
    assert len(times) == 3
    assert times[1] - times[0] < times[2] - times[1]


def test_runtime_within_tolerance():
    spec = _base_spec()
    spec.outro = "hit"
    minutes = 1.5
    extend_sections_to_minutes(spec, minutes)
    beats = bars_to_beats(spec.meter)
    sec_per_bar = beats * beats_to_secs(spec.tempo)
    total_time = spec.total_bars() * sec_per_bar
    target = minutes * 60.0
    assert abs(total_time - target) <= target * 0.02
