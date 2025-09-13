import io
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    import numpy as np
except Exception:  # pragma: no cover - fallback stub
    import _numpy_stub as np  # type: ignore[import-not-found]
    sys.modules["numpy"] = np
import types
sys.modules.setdefault("soundfile", types.SimpleNamespace(read=lambda *a, **k: ([], 22050)))
import pytest

pytest.importorskip("discord")

from mouth.discord_player import DiscordPlayer  # noqa: E402


@pytest.mark.asyncio
async def test_text_to_discord_pipeline(monkeypatch):
    audio = np.zeros(4800)
    run = MagicMock(return_value=SimpleNamespace(stdout=b"data"))
    monkeypatch.setattr("mouth.backends.piper.subprocess.run", run)
    sf_read = MagicMock(return_value=(audio, 22050))
    monkeypatch.setattr("mouth.backends.piper.sf.read", sf_read)

    player = DiscordPlayer()
    vc = MagicMock()
    player.voice_client = vc

    class DummyEncoder:
        frame_size = 960
        channels = 1

        def encode(self, pcm, frame_size):
            return b"packet"

    monkeypatch.setattr("discord.opus.Encoder", lambda *a, **k: DummyEncoder())
    sleep = AsyncMock()
    monkeypatch.setattr("asyncio.sleep", sleep)

    await player.speak("hello world")

    assert run.called, "Piper backend should be invoked"
    assert vc.send_audio_packet.called, "Discord voice client should receive audio"
    await player.close()
