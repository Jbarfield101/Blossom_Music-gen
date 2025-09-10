"""Tests for arranger minute-based looping and outro behaviour."""

import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.arranger import arrange_song
from core.song_spec import SongSpec, Section
from core.stems import Stem, bars_to_beats, beats_to_secs


def test_arranger_minutes_and_final_hit():
    spec = SongSpec(
        tempo=120,
        meter="4/4",
        sections=[Section("A", 2), Section("B", 2)],
    )
    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_bar = beats_to_secs(spec.tempo) * beats_per_bar
    stems = {
        "drums": [
            Stem(start=0.0, dur=0.25, pitch=36, vel=100, chan=9),
            Stem(start=2 * sec_per_bar, dur=0.25, pitch=36, vel=100, chan=9),
        ]
    }
    out = arrange_song(spec, stems, style={"outro": "hit"}, seed=1, minutes=0.5)
    end = max(n.start + n.dur for n in out["drums"])
    assert 30 * 0.98 <= end <= 30 * 1.02
    assert any(n.pitch == 49 for n in out["drums"])


def test_arranger_ritard_outro():
    spec = SongSpec(
        tempo=120,
        meter="4/4",
        sections=[Section("A", 1), Section("B", 1)],
    )
    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_bar = beats_to_secs(spec.tempo) * beats_per_bar
    stems = {
        "keys": [
            Stem(start=0.0, dur=0.5, pitch=60, vel=100, chan=0),
            Stem(start=sec_per_bar, dur=0.5, pitch=60, vel=100, chan=0),
            Stem(start=sec_per_bar + 1.0, dur=0.5, pitch=62, vel=100, chan=0),
        ]
    }
    out = arrange_song(
        spec,
        stems,
        style={"outro": {"type": "ritard", "factor": 2.0}},
        seed=2,
    )
    starts = [n.start for n in out["keys"]]
    assert any(abs(s - 4.0) < 0.05 for s in starts)
    end = max(n.start + n.dur for n in out["keys"])
    assert 6.0 * 0.99 <= end <= 6.0 * 1.01
