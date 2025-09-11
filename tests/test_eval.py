import json
from pathlib import Path

import numpy as np

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, dedupe_collisions
from core.render import render_song
from core.mixer import mix
from core.eval_metrics import evaluate_render, chord_tone_coverage
from core.render_hash import render_hash


def _demo_spec() -> SongSpec:
    return SongSpec.from_dict(
        {
            "title": "Demo",
            "seed": 1,
            "key": "C",
            "mode": "ionian",
            "tempo": 120,
            "meter": "4/4",
            "sections": [{"name": "A", "length": 1}],
            "harmony_grid": [{"section": "A", "chords": ["C"]}],
            "density_curve": {"A": 1.0},
            "register_policy": {"bass": [36, 36], "keys": [60, 60], "pads": [72, 72]},
        }
    )


def test_demo_song_regression():
    spec = _demo_spec()
    seed = spec.seed
    stems = build_stems_for_song(spec, seed)
    stems = dedupe_collisions(stems)

    # ensure no overlapping notes with same pitch/voice for bass/keys
    for inst in ("bass", "keys"):
        notes = sorted(stems.get(inst, []), key=lambda n: (n.start, n.pitch))
        for a, b in zip(notes, notes[1:]):
            assert not (a.pitch == b.pitch and a.start + a.dur > b.start)

    sfz_paths = {n: Path("none") for n in ("drums", "bass", "keys", "pads")}
    audio_stems = render_song(
        stems,
        44100,
        tempo=spec.tempo,
        meter=spec.meter,
        sfz_paths=sfz_paths,
    )
    cfg = {
        "tracks": {
            n: {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}
            for n in ("drums", "bass", "keys", "pads")
        },
        "master": {"limiter": {"enabled": True}},
    }
    # render hash unchanged for fixed seed + config
    rhash = render_hash(
        spec,
        cfg,
        {n: Path(f"/dummy/{n}.sfz") for n in ("drums", "bass", "keys", "pads")},
        seed,
        None,
        commit="test",
    )
    assert (
        rhash
        == "358d93680ab7b0256b79bad9026700e4c0cbff0e8cf3f86425343525f274512e"
    )

    mix_audio = mix(audio_stems, 44100, cfg)
    metrics = evaluate_render(stems, spec, mix_audio[:, 0])

    # chord coverage > 70% for bass/keys
    coverage = chord_tone_coverage(
        {k: v for k, v in stems.items() if k in ("bass", "keys")}, spec
    )
    assert coverage > 0.7

    # section note density matches expected bucket (±20%)
    density = metrics["density_alignment"]["A"]
    assert abs(density["actual"] - density["expected"]) <= 0.2

    # limiter peak ≤ −0.1 dBFS
    assert metrics["audio_stats"]["peak_db"] <= -0.1
