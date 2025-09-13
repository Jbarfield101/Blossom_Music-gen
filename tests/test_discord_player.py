import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("discord")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from mouth.discord_player import DiscordPlayer


@pytest.mark.asyncio
async def test_join_voice_returns_client():
    player = DiscordPlayer()
    voice_client = MagicMock()
    voice_channel = MagicMock()
    voice_channel.connect = AsyncMock(return_value=voice_client)

    returned = await player.join_voice(voice_channel)

    assert returned is voice_client
    assert player.voice_client is voice_client
    await player.close()


@pytest.mark.asyncio
async def test_speak_encodes_and_sends(monkeypatch):
    player = DiscordPlayer()
    vc = MagicMock()
    player.voice_client = vc

    synth = MagicMock(return_value=[0.0] * 4800)
    player.engine.synthesize = synth

    class DummyEncoder:
        frame_size = 960
        channels = 1

        def encode(self, pcm, frame_size):
            return b"packet"

    monkeypatch.setattr(
        "discord.opus.Encoder", lambda *a, **k: DummyEncoder()
    )
    sleep = AsyncMock()
    monkeypatch.setattr("asyncio.sleep", sleep)

    await player.speak("hello")

    assert synth.called
    assert vc.send_audio_packet.call_count == 5
    vc.send_audio_packet.assert_called_with(b"packet", encode=False)
    await player.close()


@pytest.mark.asyncio
async def test_speak_without_connection_raises():
    player = DiscordPlayer()
    with pytest.raises(RuntimeError):
        await player.speak("no channel")
