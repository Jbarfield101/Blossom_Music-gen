import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from types import SimpleNamespace
import numpy as np
import pytest

from core.song_spec import SongSpec
from core.pattern_synth import build_patterns_for_song
from core import phrase_model
from core.style import load_style, StyleToken
from core.mixer import mix
from core.stems import render_drums


class DummyStyleSession:
    """ONNX-like session that shifts logits based on style input."""

    def __init__(self, vocab: int = 8):
        self.vocab = vocab
        self._inputs = [SimpleNamespace(name="input"), SimpleNamespace(name="style")]

    def get_inputs(self):
        return self._inputs

    def run(self, _none, inputs):
        inp = inputs[self._inputs[0].name]
        style_id = int(inputs[self._inputs[1].name][0])
        seq_len = max(inp.shape[1], 1)
        base = np.roll(np.arange(self.vocab, dtype=np.float32), style_id)
        logits = np.tile(base, (1, seq_len, 1))
        return [logits]


def _spec() -> SongSpec:
    spec = SongSpec.from_dict(
        {
            "title": "T",
            "seed": 1,
            "key": "C",
            "mode": "ionian",
            "tempo": 120,
            "meter": "4/4",
            "sections": [{"name": "A", "length": 1}],
            "harmony_grid": [{"section": "A", "chords": ["C"]}],
            "density_curve": {"A": 0.5},
            "register_policy": {
                "drums": [36, 52],
                "bass": [40, 60],
                "keys": [60, 72],
                "pads": [60, 72],
            },
        }
    )
    spec.validate()
    return spec


def test_phrase_style_tokens_change_output(monkeypatch):
    monkeypatch.setattr(
        phrase_model,
        "load_model",
        lambda inst, *, timeout=1.0, verbose=False: ("onnx", DummyStyleSession()),
    )
    spec = _spec()
    plan_lofi = build_patterns_for_song(
        spec,
        seed=0,
        sampler_seed=0,
        use_phrase_model="yes",
        style=int(StyleToken.LOFI),
    )
    plan_rock = build_patterns_for_song(
        spec,
        seed=0,
        sampler_seed=0,
        use_phrase_model="yes",
        style=int(StyleToken.ROCK),
    )
    seq_lofi = plan_lofi["sections"][0]["patterns"]["keys"]
    seq_rock = plan_rock["sections"][0]["patterns"]["keys"]
    assert seq_lofi != seq_rock


def test_style_files_affect_lpf_cutoff():
    sr = 44100
    t = np.arange(sr, dtype=np.float32) / sr
    tone = np.sin(2 * np.pi * 5000 * t).astype(np.float32)
    stems = {"keys": tone}
    style_lofi = load_style("assets/styles/lofi.json")
    style_rock = load_style("assets/styles/rock.json")
    out_lofi = mix(stems, sr, {}, style=style_lofi)
    out_rock = mix(stems, sr, {}, style=style_rock)
    n = out_lofi.shape[0]
    idx = int(5000 * n / sr)
    amp_lofi = np.abs(np.fft.rfft(out_lofi[:, 0])[idx])
    amp_rock = np.abs(np.fft.rfft(out_rock[:, 0])[idx])
    assert amp_lofi < amp_rock


def test_drum_style_swing_offsets():
    pattern = {"kick": [1, 1]}
    rock = load_style("assets/styles/rock.json")
    lofi = load_style("assets/styles/lofi.json")
    straight = render_drums(pattern, "4/4", 120, seed=42, swing=rock["swing"])
    swung = render_drums(pattern, "4/4", 120, seed=42, swing=lofi["swing"])
    assert pytest.approx(swung[1].start - straight[1].start, abs=1e-4) == 0.1 * 0.5 / 4
