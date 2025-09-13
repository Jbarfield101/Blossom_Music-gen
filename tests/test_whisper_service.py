import asyncio
import math
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class _FakeSeg:
    def __init__(self, text: str, start: float, end: float, avg_logprob: float = 0.0):
        self.text = text
        self.start = start
        self.end = end
        self.avg_logprob = avg_logprob


class _FakeInfo:
    language = "en"
    language_probability = 1.0


class _FakeWhisperModel:
    def __init__(self, *args, **kwargs):
        self._partial_calls = 0

    def transcribe(self, audio, word_timestamps=True, initial_prompt="", vad_filter=False):
        import time

        time.sleep(0.1)
        duration = len(audio) / 16000
        if vad_filter:
            self._partial_calls += 1
            return [_FakeSeg(f"partial{self._partial_calls}", 0.0, duration, -0.2)], None
        return [_FakeSeg("final", 0.0, duration, -0.1)], _FakeInfo()


def _make_service(monkeypatch):
    fake_module = types.SimpleNamespace(WhisperModel=_FakeWhisperModel)
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_module)
    class _FakeArray(list):
        def astype(self, dtype):
            return self
        def __truediv__(self, other):
            return _FakeArray([x / other for x in self])
    def _frombuffer(pcm, dtype):
        return _FakeArray([0] * (len(pcm) // 2))
    fake_np = types.SimpleNamespace(
        int16="int16",
        float32="float32",
        frombuffer=_frombuffer,
        isscalar=lambda x: isinstance(x, (int, float)),
        bool_=bool,
    )
    monkeypatch.setitem(sys.modules, "numpy", fake_np)
    from importlib import reload
    from ears import whisper_service as ws

    reload(ws)
    return ws.WhisperService()


def test_transcribe_yields_partial_and_final(monkeypatch):
    service = _make_service(monkeypatch)

    pcm = b"\x00\x00" * 32000  # short PCM buffer (~1s at 16 kHz)

    async def _run():
        results = []
        async for seg in service.transcribe(pcm):
            results.append(seg)
        return results

    segments = asyncio.run(_run())

    assert any(not s.is_final for s in segments)
    assert any(s.is_final for s in segments)


def test_transcription_segment_fields(monkeypatch):
    service = _make_service(monkeypatch)

    pcm = b"\x00\x00" * 32000

    async def _run():
        results = []
        async for seg in service.transcribe(pcm):
            results.append(seg)
        return results

    segments = asyncio.run(_run())

    partial = next(s for s in segments if not s.is_final)
    final = next(s for s in segments if s.is_final)

    assert partial.text == "partial1"
    assert partial.start == 0.0
    assert partial.end == pytest.approx(0.5)
    assert partial.language == ""
    assert partial.language_confidence == 0.0
    assert not partial.is_final
    assert partial.confidence == pytest.approx(math.exp(-0.2))

    assert final.text == "final"
    assert final.start == 0.0
    assert final.end == pytest.approx(2.0)
    assert final.language == "en"
    assert final.language_confidence == 1.0
    assert final.is_final
    assert final.confidence == pytest.approx(math.exp(-0.1))
