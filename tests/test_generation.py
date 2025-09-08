import pytest
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


from core.song_spec import SongSpec
from core.pattern_synth import build_patterns_for_song


@pytest.fixture
def song_spec():
    spec = SongSpec.from_dict({
        "title": "Test Song",
        "seed": 123,
        "key": "C",
        "mode": "ionian",
        "tempo": 120,
        "meter": "4/4",
        "sections": [
            {"name": "A", "length": 2},
            {"name": "B", "length": 2},
        ],
        "harmony_grid": [
            {"section": "A", "chords": ["C", "D"]},
            {"section": "B", "chords": ["E", "G"]},
        ],
        "density_curve": {"A": 1.0, "B": 1.0},
        "register_policy": {
            "bass": [36, 60],
            "keys": [60, 84],
            "pads": [60, 84],
        },
    })
    spec.validate()
    return spec


def test_deterministic_generation(song_spec):
    plan1 = build_patterns_for_song(song_spec, song_spec.seed)
    plan2 = build_patterns_for_song(song_spec, song_spec.seed)
    assert plan1 == plan2


def test_total_bars_match(song_spec):
    plan = build_patterns_for_song(song_spec, song_spec.seed)
    beats = int(song_spec.meter.split("/")[0])
    for sec in plan["sections"]:
        length = sec["length_bars"]
        for events in sec["patterns"].values():
            if not events:
                continue
            max_end = max(e["start"] + e["dur"] for e in events)
            assert max_end <= length * beats + 1e-9


def test_register_policy_respected(song_spec):
    plan = build_patterns_for_song(song_spec, song_spec.seed)
    for sec in plan["sections"]:
        for inst, events in sec["patterns"].items():
            if inst not in song_spec.register_policy:
                continue
            low, high = song_spec.register_policy[inst]
            for e in events:
                assert low <= e["pitch"] <= high


def _top_line(events):
    grouped = {}
    for e in events:
        grouped.setdefault(e["start"], []).append(e["pitch"])
    tops = [max(pitches) for _, pitches in sorted(grouped.items()) if len(pitches) > 1]
    return tops


def test_top_line_monotonic(song_spec):
    plan = build_patterns_for_song(song_spec, song_spec.seed)
    for sec in plan["sections"]:
        for inst in ["keys", "pads"]:
            events = sec["patterns"].get(inst, [])
            if not events:
                continue
            tops = _top_line(events)
            assert all(a <= b for a, b in zip(tops, tops[1:]))
