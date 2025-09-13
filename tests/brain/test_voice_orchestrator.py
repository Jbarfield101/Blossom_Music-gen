from pathlib import Path
import sys
import asyncio
from types import SimpleNamespace
import types
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

sys.modules.setdefault("numpy", types.SimpleNamespace())
sys.modules.setdefault("resampy", types.SimpleNamespace(resample=lambda a, b, c: a))
sys.modules.setdefault(
    "scipy",
    types.SimpleNamespace(signal=types.SimpleNamespace(resample_poly=lambda a, b, c: a)),
)
sys.modules.setdefault(
    "discord",
    types.SimpleNamespace(
        Client=object,
        Intents=types.SimpleNamespace(none=lambda: types.SimpleNamespace(voice_states=True)),
        sinks=types.SimpleNamespace(RawData=object),
        Member=object,
        VoiceState=object,
        VoiceChannel=object,
        VoiceClient=object,
        opus=types.SimpleNamespace(Encoder=object),
    ),
)
sys.modules.setdefault("webrtcvad", types.SimpleNamespace(Vad=object))
sys.modules.setdefault("faster_whisper", types.SimpleNamespace(WhisperModel=object))
sys.modules.setdefault(
    "config.discord_profiles", types.SimpleNamespace(get_profile=lambda g, c: {})
)
sys.modules.setdefault(
    "service_api",
    types.SimpleNamespace(
        search=lambda q, tags=None: [],
        create_note=lambda *a, **k: None,
        get_vault=lambda: None,
    ),
)
fake_requests = types.SimpleNamespace(post=lambda *a, **k: None)
fake_requests.Response = type("_Resp", (), {})
fake_requests.exceptions = types.SimpleNamespace(
    HTTPError=Exception, RequestException=Exception, Timeout=Exception
)
sys.modules.setdefault("requests", fake_requests)
sys.modules.setdefault("requests.exceptions", fake_requests.exceptions)

class _StubPlayer:
    def __init__(self, *a, **k):
        pass

    def event(self, func):
        return func

    async def start(self, token):
        pass

    def get_channel(self, cid):
        return None

    async def fetch_channel(self, cid):
        return None

    async def join_voice(self, channel):
        pass

    async def speak(self, text, profile=None):
        pass

sys.modules.setdefault("mouth.discord_player", types.SimpleNamespace(DiscordPlayer=_StubPlayer))

from brain.voice_orchestrator import DiscordOrchestrator


class DummyPart:
    def __init__(self, text: str, is_final: bool) -> None:
        self.text = text
        self.is_final = is_final


class DummyPlayer:
    def __init__(self) -> None:
        self.spoken = []

    async def speak(self, text: str, profile=None) -> None:  # pragma: no cover - behaviour mocked
        self.spoken.append(text)
        try:
            await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            raise


def test_interrupt_and_queue(monkeypatch):
    async def run() -> None:
        orch = DiscordOrchestrator("T", 0, 1, debounce=0.01)
        orch.player = DummyPlayer()

        monkeypatch.setattr(
            "brain.voice_orchestrator.dialogue.respond",
            lambda msg: SimpleNamespace(narration=f"bot: {msg}"),
        )

        orch._worker_task = asyncio.create_task(orch._worker())

        # enqueue initial utterance
        await orch._handle_segment(DummyPart("hello", True), "user")
        await asyncio.sleep(0.02)
        assert orch._play_task is not None

        # simulate user speech to interrupt
        await orch._handle_segment(DummyPart("um", False), "user")
        await orch._handle_segment(DummyPart("um", False), "user")
        await asyncio.sleep(0.05)
        assert orch._play_task is None

        # new message after interruption
        await orch._handle_segment(DummyPart("world", True), "user")
        await asyncio.sleep(0.1)
        assert orch.player.spoken[-1] == "bot: world"

        orch._worker_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await orch._worker_task

    asyncio.run(run())
