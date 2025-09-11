import os, sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, bars_to_beats, beats_to_secs
from core.utils import note_to_sample_indices
from core.render import render_song
from core.mixer import mix


def _make_spec() -> SongSpec:
    spec = SongSpec.from_dict(
        {
            "title": "MixTest",
            "seed": 123,
            "key": "C",
            "mode": "ionian",
            "tempo": 120,
            "meter": "4/4",
            "sections": [{"name": "A", "length": 2}],
            "harmony_grid": [{"section": "A", "chords": ["C", "F"]}],
            "density_curve": {"A": 1.0},
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


def test_duration_limiter_and_stems_nonzero():
    spec = _make_spec()
    sr = 44100
    stems = build_stems_for_song(spec, spec.seed)
    rendered = render_song(stems, sr, tempo=spec.tempo, meter=spec.meter)

    # Each active stem should render some non-zero audio
    for name, notes in stems.items():
        if notes:
            assert any(sample != 0.0 for sample in rendered[name])

    # Mix with hot gains so the limiter has work to do
    track_cfg = {name: {"gain": 12.0} for name in rendered}
    raw_mix = mix(
        rendered,
        sr,
        {
            "tracks": track_cfg,
            "master": {
                "headroom_db": None,
                "compressor": {"enabled": False},
                "limiter": {"enabled": False},
            },
        },
    )
    pre_peak = float(abs(raw_mix).max()) if raw_mix.size else 0.0
    target = 10 ** (-0.8 / 20.0)
    assert pre_peak > target

    mixed = mix(
        rendered,
        sr,
        {
            "tracks": track_cfg,
            "master": {
                "headroom_db": None,
                "compressor": {"enabled": False},
                "limiter": {"enabled": True},
            },
        },
    )
    post_peak = float(abs(mixed).max()) if mixed.size else 0.0
    assert post_peak <= target + 1e-4

    idx = np.arange(len(mixed))
    up_idx = np.arange(len(mixed) * 4) / 4
    up_l = np.interp(up_idx, idx, mixed[:, 0])
    up_r = np.interp(up_idx, idx, mixed[:, 1])
    true_peak = float(np.maximum(np.abs(up_l), np.abs(up_r)).max()) if mixed.size else 0.0
    assert true_peak <= target + 1e-4

    beats_per_bar = bars_to_beats(spec.meter)
    note_ends = []
    for notes in stems.values():
        for n in notes:
            start_idx, length = note_to_sample_indices(n.start, n.dur, spec.tempo, spec.meter, sr)
            note_ends.append(start_idx + length)
    expected_len = max(note_ends) if note_ends else 0
    assert abs(mixed.shape[0] - expected_len) <= 1024
