import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from types import SimpleNamespace
import numpy as np
import pytest

from core.song_spec import SongSpec
from core.pattern_synth import (
    build_patterns_for_song,
    gen_drums,
    gen_bass,
    gen_keys,
    _seeded_rng,
)
from core import phrase_model


class DummyOnnxSession:
    """Minimal ONNX-like session returning deterministic logits."""

    def __init__(self, vocab: int = 8):
        self.vocab = vocab
        self._inputs = [SimpleNamespace(name="input")]

    def get_inputs(self):
        return self._inputs

    def run(self, *_args, **kwargs):
        inp = kwargs[list(kwargs.keys())[0]]
        seq_len = inp.shape[1]
        length = max(seq_len, 1)
        logits = np.tile(np.arange(self.vocab, dtype=np.float32), (1, length, 1))
        return [logits]


def _simple_spec():
    """Return a minimal SongSpec used across tests."""

    spec = SongSpec.from_dict(
        {
            "title": "Test",
            "seed": 1,
            "key": "C",
            "mode": "ionian",
            "tempo": 120,
            "meter": "4/4",
            "sections": [{"name": "A", "length": 1}],
            "harmony_grid": [{"section": "A", "chords": ["C"]}],
            "density_curve": {"A": 0.5},
            "register_policy": {
                "drums": [36, 50],
                "bass": [40, 60],
                "keys": [60, 72],
                "pads": [60, 72],
            },
        }
    )
    spec.validate()
    return spec


def test_sampler_seed_reproducibility(monkeypatch):
    """Identical sampler seed should yield identical patterns."""

    monkeypatch.setattr(
        phrase_model,
        "load_model",
        lambda inst, *, timeout=1.0, verbose=False: ("onnx", DummyOnnxSession()),
    )
    spec = _simple_spec()
    plan1 = build_patterns_for_song(spec, seed=0, sampler_seed=123)
    plan2 = build_patterns_for_song(spec, seed=0, sampler_seed=123)
    assert plan1 == plan2


@pytest.mark.parametrize("exc", [RuntimeError("no model"), TimeoutError("slow")])
def test_algorithmic_fallback(monkeypatch, exc):
    """When models fail, algorithmic generators should be used even when forced."""

    def _raise(*_a, **_k):
        raise exc

    monkeypatch.setattr("core.pattern_synth.generate_phrase", _raise)
    spec = _simple_spec()
    plan = build_patterns_for_song(spec, seed=7, sampler_seed=7, use_phrase_model="yes")

    sec = spec.sections[0]
    density = spec.density_curve[sec.name]
    chords = ["C"]

    rng_d = _seeded_rng(7, sec.name, "drums")
    rng_b = _seeded_rng(7, sec.name, "bass")
    rng_k = _seeded_rng(7, sec.name, "keys")

    expected = {
        "drums": gen_drums(sec.length, spec.meter, density, rng_d, spec),
        "bass": gen_bass(chords, spec.meter, density, rng_b, spec),
        "keys": gen_keys(chords, spec.meter, density, rng_k, spec),
    }

    patterns = plan["sections"][0]["patterns"]
    assert patterns["drums"] == expected["drums"]
    assert patterns["bass"] == expected["bass"]
    assert patterns["keys"] == expected["keys"]
