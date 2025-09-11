import os, sys
import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.stems import Stem
from core.song_spec import SongSpec
from core.eval_metrics import (
    chord_tone_coverage,
    voice_leading_smoothness,
    rhythmic_stability,
    cadence_fill_rate,
    density_alignment,
    audio_stats,
    evaluate_render,
)


def _basic_spec() -> SongSpec:
    return SongSpec.from_dict({
        "title": "t",
        "sections": [
            {"name": "a", "length": 1},
            {"name": "b", "length": 1},
        ],
        "harmony_grid": [
            {"section": "a", "chords": ["C"]},
            {"section": "b", "chords": ["F"]},
        ],
    })


def test_chord_tone_coverage():
    spec = _basic_spec()
    stems = {
        "bass": [
            Stem(start=0, dur=1, pitch=36, vel=100, chan=0),  # C
            Stem(start=4, dur=1, pitch=53, vel=100, chan=0),  # F
            Stem(start=0, dur=1, pitch=37, vel=100, chan=0),  # C# off-chord
        ]
    }
    cov = chord_tone_coverage(stems, spec)
    assert cov == pytest.approx(2 / 3)


def test_voice_leading_smoothness():
    spec = _basic_spec()
    # Compute expected directly using generate_satb
    from core.theory import generate_satb

    bass, tenor, alto, soprano = generate_satb(spec.all_chords())
    intervals = []
    for voice in (bass, tenor, alto, soprano):
        intervals.append(abs(voice[1] - voice[0]))
    expected = np.mean(intervals)
    assert voice_leading_smoothness(spec) == expected


def test_rhythmic_stability():
    stems = {
        "bass": [Stem(start=0, dur=1, pitch=36, vel=100, chan=0),
                 Stem(start=1, dur=1, pitch=36, vel=100, chan=0),
                 Stem(start=2, dur=1, pitch=36, vel=100, chan=0)],
        "keys": [Stem(start=0, dur=1, pitch=60, vel=100, chan=0),
                 Stem(start=1, dur=1, pitch=60, vel=100, chan=0),
                 Stem(start=3, dur=1, pitch=60, vel=100, chan=0)],
    }
    stability = rhythmic_stability(stems)
    assert stability["bass"] == 0.0
    assert stability["keys"] == pytest.approx(0.25)


def test_cadence_fill_rate():
    spec = SongSpec.from_dict({
        "sections": [{"name": "a", "length": 4}],
        "harmony_grid": [{"section": "a", "chords": ["C", "C", "C", "C"]}],
        "cadences": [{"bar": 3, "type": "final"}],
    })
    stems = {
        "drums": [
            Stem(start=0, dur=1, pitch=36, vel=100, chan=9),
            Stem(start=4, dur=1, pitch=36, vel=100, chan=9),
            Stem(start=8, dur=1, pitch=36, vel=100, chan=9),
            Stem(start=9, dur=1, pitch=36, vel=100, chan=9),
            Stem(start=10, dur=1, pitch=36, vel=100, chan=9),
        ]
    }
    rate = cadence_fill_rate(stems, spec)
    assert rate == pytest.approx(1.0)


def test_density_alignment():
    spec = SongSpec.from_dict({
        "sections": [{"name": "a", "length": 1}, {"name": "b", "length": 1}],
        "harmony_grid": [
            {"section": "a", "chords": ["C"]},
            {"section": "b", "chords": ["C"]},
        ],
        "density_curve": {"a": 0.5, "b": 0.25},
    })
    stems = {
        "bass": [
            Stem(start=0, dur=1, pitch=36, vel=100, chan=0),
            Stem(start=4, dur=1, pitch=36, vel=100, chan=0),
            Stem(start=4.5, dur=1, pitch=36, vel=100, chan=0),
        ]
    }
    align = density_alignment(stems, spec)
    assert align["a"] == {"expected": 0.5, "actual": 0.5}
    assert align["b"] == {"expected": 0.25, "actual": 1.0}


def test_audio_stats():
    audio = np.array([0.5, -0.5, 0.0], dtype=float)
    stats = audio_stats(audio)
    assert stats["peak_db"] == pytest.approx(-6.0206, abs=1e-3)
    assert stats["rms_db"] == pytest.approx(-7.7815, abs=1e-3)


def test_evaluate_render_structure():
    spec = _basic_spec()
    stems = {
        "bass": [Stem(start=0, dur=1, pitch=36, vel=100, chan=0)]
    }
    audio = np.array([0.1, -0.1], dtype=float)
    metrics = evaluate_render(stems, spec, audio)

    expected = {
        "chord_tone_coverage",
        "voice_leading_smoothness",
        "rhythmic_stability",
        "cadence_fill_rate",
        "density_alignment",
        "audio_stats",
    }
    assert set(metrics.keys()) == expected
    assert isinstance(metrics["chord_tone_coverage"], (int, float))
    assert isinstance(metrics["voice_leading_smoothness"], (int, float))
    assert isinstance(metrics["cadence_fill_rate"], (int, float))

    assert isinstance(metrics["rhythmic_stability"], dict)
    for v in metrics["rhythmic_stability"].values():
        assert isinstance(v, (int, float))

    assert isinstance(metrics["density_alignment"], dict)
    for sec in metrics["density_alignment"].values():
        assert isinstance(sec, dict)
        assert "expected" in sec and "actual" in sec
        assert isinstance(sec["expected"], (int, float))
        assert isinstance(sec["actual"], (int, float))

    assert isinstance(metrics["audio_stats"], dict)
    for v in metrics["audio_stats"].values():
        assert isinstance(v, (int, float))
