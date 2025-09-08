import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, bars_to_beats, beats_to_secs


def _make_spec(density: float) -> SongSpec:
    spec = SongSpec.from_dict(
        {
            "title": "Spec",
            "seed": 1,
            "key": "C",
            "mode": "ionian",
            "tempo": 120,
            "meter": "4/4",
            "sections": [{"name": "A", "length": 2}],
            "harmony_grid": [{"section": "A", "chords": ["C", "F"]}],
            "density_curve": {"A": density},
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


def test_identical_seed_produces_identical_stems():
    spec = _make_spec(1.0)
    stems1 = build_stems_for_song(spec, spec.seed)
    stems2 = build_stems_for_song(spec, spec.seed)
    assert stems1 == stems2


def test_rendered_length_matches_sections():
    spec = _make_spec(1.0)
    stems = build_stems_for_song(spec, spec.seed)
    beats_per_bar = bars_to_beats(spec.meter)
    total_secs = spec.total_bars() * beats_per_bar * beats_to_secs(spec.tempo)
    for notes in stems.values():
        if not notes:
            continue
        max_end = max(n.start + n.dur for n in notes)
        assert abs(max_end - total_secs) < 0.05


def test_stems_respect_register_policy():
    spec = _make_spec(1.0)
    stems = build_stems_for_song(spec, spec.seed)
    for inst, (low, high) in spec.register_policy.items():
        for n in stems.get(inst, []):
            assert low <= n.pitch <= high


def test_no_duplicate_pitch_start_per_instrument():
    spec = _make_spec(1.0)
    stems = build_stems_for_song(spec, spec.seed)
    for notes in stems.values():
        seen = set()
        for n in notes:
            key = (round(n.start, 5), n.pitch)
            assert key not in seen
            seen.add(key)


def test_keys_pads_reduce_notes_with_low_density():
    spec_hi = _make_spec(1.0)
    spec_lo = _make_spec(0.1)
    stems_hi = build_stems_for_song(spec_hi, spec_hi.seed)
    stems_lo = build_stems_for_song(spec_lo, spec_lo.seed)
    assert len(stems_lo["keys"]) < len(stems_hi["keys"])
    assert len(stems_lo["pads"]) < len(stems_hi["pads"])
