import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec, Section
from core.arranger import arrange_song
from core.stems import Stem, bars_to_beats, beats_to_secs, _steps_per_beat


def test_drum_fill_added_at_cadence():
    spec = SongSpec(
        tempo=120,
        meter="4/4",
        sections=[Section("A", 2)],
        cadences=[{"bar": 1, "type": "sec"}],
    )
    stems = {"drums": []}
    out = arrange_song(spec, stems, style={}, seed=0)

    beats = bars_to_beats(spec.meter)
    sec_per_beat = beats_to_secs(spec.tempo)
    sec_per_bar = beats * sec_per_beat
    spb = _steps_per_beat(spec.meter)
    sec_per_step = sec_per_beat / spb
    fill_start = 1 * sec_per_bar - sec_per_step

    drum_notes = out.get("drums", [])
    tol = 0.02
    assert any(abs(n.start - fill_start) < tol and n.pitch == 38 for n in drum_notes)
