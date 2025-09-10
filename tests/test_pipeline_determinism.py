import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec
from core.stems import build_stems_for_song
from core.arranger import arrange_song
from core import dynamics


def test_pipeline_deterministic_output():
    spec = SongSpec.from_dict({
        "title": "Determinism",
        "seed": 42,
        "key": "C",
        "mode": "ionian",
        "tempo": 120,
        "meter": "4/4",
        "sections": [
            {"name": "A", "length": 2},
            {"name": "B", "length": 2},
        ],
        "harmony_grid": [
            {"section": "A", "chords": ["C", "F"]},
            {"section": "B", "chords": ["G", "C"]},
        ],
        "density_curve": {"A": 1.0, "B": 1.0},
        "register_policy": {
            "drums": [36, 50],
            "bass": [40, 60],
            "keys": [60, 72],
            "pads": [60, 72],
        },
    })
    spec.validate()
    seed = spec.seed
    stems1 = build_stems_for_song(spec, seed=seed)
    arr1 = arrange_song(spec, stems1, style={}, seed=seed)
    proc1 = dynamics.apply(spec, arr1, seed)

    stems2 = build_stems_for_song(spec, seed=seed)
    arr2 = arrange_song(spec, stems2, style={}, seed=seed)
    proc2 = dynamics.apply(spec, arr2, seed)

    assert proc1 == proc2
