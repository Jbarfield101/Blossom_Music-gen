"""Tests for TTS caching and warm start helpers."""

from __future__ import annotations

import pytest

np = pytest.importorskip("numpy")

from mouth import tts
from mouth.registry import VoiceProfile, VoiceRegistry


class DummyBackend(tts.TTSBackend):
    def __init__(self, **kwargs):
        self.calls: list[str] = []
        self.warmed: list[str] = []

    def synthesize(self, text: str, voice: VoiceProfile) -> np.ndarray:  # pragma: no cover - used in tests
        self.calls.append(text)
        return np.array([1.0], dtype=np.float32)

    def warm_start(self, voices) -> None:  # pragma: no cover - used in tests
        if voices is not None:
            self.warmed.extend(list(voices))


def test_cache_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "PiperBackend", DummyBackend)
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path / "cache" / "tts")
    engine = tts.TTSEngine()
    profile = VoiceProfile("demo")

    audio1 = engine.synthesize("hello", profile)
    assert np.array_equal(audio1, np.array([1.0], dtype=np.float32))
    assert engine.backend.calls == ["hello"]

    # second call should hit cache
    audio2 = engine.synthesize("hello", profile)
    assert np.array_equal(audio1, audio2)
    assert engine.backend.calls == ["hello"]

    # TTL expiry forces re-synthesis
    engine.synthesize("hello", profile, ttl=0)
    assert engine.backend.calls == ["hello", "hello"]


def test_warm_start(monkeypatch):
    monkeypatch.setattr(tts, "PiperBackend", DummyBackend)
    reg = VoiceRegistry()
    reg.set_profile("a", VoiceProfile("a"))
    reg.set_profile("b", VoiceProfile("b"))
    engine = tts.TTSEngine(registry=reg)
    engine.warm_start()
    assert set(engine.backend.warmed) == {"narrator", "a", "b"}

