import os, sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, bars_to_beats, beats_to_secs
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
    raw_mix = mix(rendered, sr, {"tracks": track_cfg, "master": {"limiter": {"enabled": False}}})
    pre_peak = float(abs(raw_mix).max()) if raw_mix.size else 0.0
    target = 10 ** (-0.1 / 20.0)
    assert pre_peak > target

    mixed = mix(rendered, sr, {"tracks": track_cfg, "master": {"limiter": {"enabled": True, "threshold": -0.1}}})
    post_peak = float(abs(mixed).max()) if mixed.size else 0.0
    assert post_peak <= target + 1e-4

    beats_per_bar = bars_to_beats(spec.meter)
    total_secs = spec.total_bars() * beats_per_bar * beats_to_secs(spec.tempo)
    expected_len = int(round(total_secs * sr))
    assert abs(mixed.shape[0] - expected_len) <= 256
