import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec, Section
from core.pattern_synth import build_patterns_for_song


def test_cadence_tokens_passed_to_phrase_model(monkeypatch):
    calls = []

    def fake_generate_phrase(inst, *, cadence_soon, final, **kwargs):
        calls.append((inst, cadence_soon, final))
        return []

    monkeypatch.setattr("core.pattern_synth.generate_phrase", fake_generate_phrase)

    spec = SongSpec(
        tempo=120,
        meter="4/4",
        sections=[Section("A", 3)],
        harmony_grid=[{"section": "A", "chords": ["C", "F", "G"]}],
        cadences=[{"bar": 1, "type": "sec"}, {"bar": 2, "type": "final"}],
    )

    build_patterns_for_song(spec, seed=0, use_phrase_model="yes")

    assert calls, "phrase model was not invoked"
    for _inst, cadence_soon, final in calls:
        assert cadence_soon == [1, 1, 0]
        assert final == [0, 1, 0]

