import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from types import SimpleNamespace
import numpy as np

from core import phrase_model


class DummyOnnxSession:
    """ONNX-like session producing deterministic logits for any sequence length."""

    def __init__(self, vocab: int = 8):
        self.vocab = vocab
        self._inputs = [SimpleNamespace(name="input")]

    def get_inputs(self):
        return self._inputs

    def run(self, *_args, **kwargs):
        if kwargs:
            inp = kwargs[list(kwargs.keys())[0]]
        else:
            inp = _args[1][list(_args[1].keys())[0]]
        seq_len = inp.shape[1]
        logits = np.tile(np.arange(self.vocab, dtype=np.float32), (1, seq_len, 1))
        return [logits]


def test_variable_length_inputs(monkeypatch):
    session = DummyOnnxSession()
    monkeypatch.setattr(phrase_model, "load_model", lambda inst, **_: ("onnx", session))

    short_prompt = [0, 1]
    long_prompt = list(range(20))

    out_short = phrase_model.generate_phrase("drum", prompt=short_prompt, max_steps=4)
    out_long = phrase_model.generate_phrase("drum", prompt=long_prompt, max_steps=4)

    assert len(out_short) == 4
    assert len(out_long) == 4
