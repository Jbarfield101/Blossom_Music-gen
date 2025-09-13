import io
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock
import subprocess

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    import numpy as np
except Exception:  # pragma: no cover - fallback stub
    import _numpy_stub as np  # type: ignore[import-not-found]
    sys.modules["numpy"] = np  # make available for imported modules
import types
sys.modules.setdefault("soundfile", types.SimpleNamespace(read=lambda *a, **k: ([], 22050)))
import pytest

from mouth.backends.piper import PiperBackend
from mouth.registry import VoiceProfile


def _dummy_wav(samples: np.ndarray, rate: int = 22050) -> bytes:
    # Not used when soundfile is stubbed; retained for completeness
    return b"dummy"


def test_synthesize_invokes_piper(monkeypatch):
    audio = np.array([0.0, 0.5, -0.5])
    run = MagicMock(return_value=SimpleNamespace(stdout=b"data"))
    monkeypatch.setattr("mouth.backends.piper.subprocess.run", run)
    sf_read = MagicMock(return_value=(audio, 22050))
    monkeypatch.setattr("mouth.backends.piper.sf.read", sf_read)
    backend = PiperBackend(model_path="base", config_path="cfg", executable="piper-bin")
    voice = VoiceProfile("alt")
    out = backend.synthesize("hi", voice)
    assert list(out) == list(audio)
    run.assert_called_once_with(
        ["piper-bin", "--model", "alt", "--config", "cfg"],
        input=b"hi",
        stdout=subprocess.PIPE,
        check=True,
    )


def test_warm_start_invokes_subprocess(monkeypatch):
    run = MagicMock()
    monkeypatch.setattr("mouth.backends.piper.subprocess.run", run)
    backend = PiperBackend(model_path="base", executable="piper")
    backend.warm_start(["a", "b"])
    assert run.call_count == 2
    run.assert_any_call(
        ["piper", "--model", "a"], input=b"warm start", stdout=subprocess.PIPE, check=True
    )
