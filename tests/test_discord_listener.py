import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

# Skip tests if discord.py is not installed
pytest.importorskip("discord")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from ears.discord_listener import DiscordListener, _PCMStream


@pytest.mark.asyncio
async def test_join_voice_attaches_pcm_stream():
    listener = DiscordListener()

    voice_client = MagicMock()
    voice_channel = MagicMock()
    voice_channel.connect = AsyncMock(return_value=voice_client)

    returned = await listener.join_voice(voice_channel)

    assert returned is voice_client
    voice_client.listen.assert_called_once()
    args, _ = voice_client.listen.call_args
    assert isinstance(args[0], _PCMStream)

    await listener.close()
