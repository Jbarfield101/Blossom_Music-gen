import asyncio
from types import SimpleNamespace

import os
import sys
import types

import pytest

sys.modules.setdefault("numpy", types.SimpleNamespace())
sys.modules.setdefault("resampy", types.SimpleNamespace(resample=lambda audio, sr, tr: audio))
sys.modules.setdefault(
    "scipy",
    types.SimpleNamespace(signal=types.SimpleNamespace(resample_poly=lambda a, b, c: a)),
)
# Minimal stub of the ``discord`` package required by :mod:`ears.discord_listener`
class _DiscordClient:
    def __init__(self, *args, **kwargs):
        pass


class _DiscordIntents:
    @classmethod
    def none(cls):
        return cls()


sys.modules.setdefault(
    "discord",
    types.SimpleNamespace(
        Client=_DiscordClient,
        Intents=_DiscordIntents,
        sinks=types.SimpleNamespace(RawData=object),
        Member=object,
        VoiceState=object,
        VoiceChannel=object,
        VoiceClient=object,
    ),
)
sys.modules.setdefault("webrtcvad", types.SimpleNamespace(Vad=object))
sys.modules.setdefault("faster_whisper", types.SimpleNamespace(WhisperModel=object))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import ears.pipeline as pipeline


class DummyChannel:
    connect = True


class DummyPart:
    def __init__(self, text, is_final, start=0.0, language="en", confidence=0.5):
        self.text = text
        self.is_final = is_final
        self.start = start
        self.language = language
        self.confidence = confidence


class DummyWhisper:
    _parts = []

    def __init__(self, model_path):
        pass

    async def transcribe(self, segment):
        for part in self._parts:
            yield part


class DummyLogger:
    def __init__(self, root):
        self.records = []

    def append(
        self,
        channel,
        speaker,
        text,
        timestamp=None,
        language=None,
        confidence=None,
    ):
        self.records.append(
            (channel, speaker, text, timestamp, language, confidence)
        )


class DummyVAD:
    sample_rate = 16000

    def __init__(self, segment_callback, diarizer=None):
        self.segment_callback = segment_callback

    async def process(self, frame, speaker_id):
        await self.segment_callback(b"", speaker_id)

    async def flush(self):
        pass


class DummyListener:
    def __init__(self, frame_callback):
        self.frame_callback = frame_callback

    def event(self, func):
        self.on_ready = func
        return func

    def get_channel(self, cid):
        return DummyChannel()

    async def fetch_channel(self, cid):
        return DummyChannel()

    async def join_voice(self, channel):
        pass

    async def start(self, token):
        await self.on_ready()
        await self.frame_callback(SimpleNamespace(id=1), b"audio")


def test_part_callback_receives_segments(monkeypatch):
    monkeypatch.setattr(pipeline, "WhisperService", DummyWhisper)
    monkeypatch.setattr(pipeline, "TranscriptLogger", DummyLogger)
    monkeypatch.setattr(pipeline, "DiscordListener", DummyListener)
    monkeypatch.setattr(pipeline, "VoiceActivityDetector", DummyVAD)
    monkeypatch.setattr(pipeline, "_resample", lambda pcm, sr, tr: pcm)

    DummyWhisper._parts = [DummyPart("hi", False), DummyPart("there", True)]

    received = []

    async def cb(part, speaker):
        received.append((part.text, part.is_final, speaker))

    asyncio.run(pipeline.run_bot("T", 123, part_callback=cb))
    assert received == [("hi", False, "1"), ("there", True, "1")]


def test_rate_limit_suppresses_rapid_partials(monkeypatch):
    monkeypatch.setattr(pipeline, "WhisperService", DummyWhisper)
    monkeypatch.setattr(pipeline, "TranscriptLogger", DummyLogger)
    monkeypatch.setattr(pipeline, "DiscordListener", DummyListener)
    monkeypatch.setattr(pipeline, "VoiceActivityDetector", DummyVAD)
    monkeypatch.setattr(pipeline, "_resample", lambda pcm, sr, tr: pcm)

    DummyWhisper._parts = [
        DummyPart("a", False),
        DummyPart("b", False),
        DummyPart("c", True),
    ]

    received = []

    async def cb(part, speaker):
        received.append((part.text, part.is_final))

    asyncio.run(pipeline.run_bot("T", 123, part_callback=cb, rate_limit=1.0))
    assert received == [("a", False), ("c", True)]
