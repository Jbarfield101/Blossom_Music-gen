"""Discord voice listener with PCM frame streaming.

This module relies on a maintained ``discord.py`` fork that exposes voice
receive functionality.  It provides a small wrapper around
:class:`discord.Client` to join voice channels and forward raw 48 kHz stereo
16‑bit PCM frames for downstream processing. The transcription pipeline
resamples these frames to 16 kHz mono.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Awaitable, Callable, Optional

import discord

PCMFrameCallback = Callable[[discord.Member, bytes], Awaitable[None]]
VoiceStateCallback = Callable[[discord.Member, discord.VoiceState, discord.VoiceState], Awaitable[None]]
SpeakingCallback = Callable[[discord.Member, bool], Awaitable[None]]


class _PCMStream(discord.sinks.RawData):
    """Sink that forwards PCM frames to a coroutine callback."""

    def __init__(self, frame_callback: PCMFrameCallback):
        super().__init__()
        self._cb = frame_callback

    def write(self, data: bytes, user: discord.Member) -> None:  # type: ignore[override]
        if self._cb is None:
            return
        result = self._cb(user, data)
        if inspect.iscoroutine(result):
            asyncio.create_task(result)


class DiscordListener(discord.Client):
    """Client that captures voice data from Discord channels.

    Parameters
    ----------
    frame_callback:
        Coroutine executed for every 20 ms frame of 48 kHz stereo 16‑bit PCM
        data. Downstream consumers typically convert this to 16 kHz mono.
    on_voice_state_update:
        Optional coroutine dispatched when a user's voice state changes.
    on_speaking:
        Optional coroutine dispatched when a user starts or stops speaking.
    intents:
        Custom intents. If omitted, voice state intents are enabled automatically.
    """

    def __init__(
        self,
        *,
        frame_callback: Optional[PCMFrameCallback] = None,
        on_voice_state_update: Optional[VoiceStateCallback] = None,
        on_speaking: Optional[SpeakingCallback] = None,
        intents: Optional[discord.Intents] = None,
        **kwargs,
    ) -> None:
        intents = intents or discord.Intents.none()
        intents.voice_states = True
        super().__init__(intents=intents, **kwargs)
        self._frame_cb = frame_callback
        self._voice_state_cb = on_voice_state_update
        self._speaking_cb = on_speaking
        self._sink = _PCMStream(self._handle_frame)

    async def join_voice(self, channel: discord.VoiceChannel) -> discord.VoiceClient:
        """Connect to ``channel`` and begin capturing audio."""

        vc = await channel.connect()
        vc.listen(self._sink)  # start receiving PCM frames
        return vc

    # ------------------------------------------------------------------
    # discord.Client event handlers
    # ------------------------------------------------------------------
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState) -> None:  # noqa: D401 - inherited docstring
        if self._voice_state_cb is not None:
            await self._voice_state_cb(member, before, after)

    async def on_speaking(self, member: discord.Member, speaking: bool) -> None:  # noqa: D401 - inherited docstring
        if self._speaking_cb is not None:
            await self._speaking_cb(member, speaking)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _handle_frame(self, user: discord.Member, data: bytes) -> Awaitable[None] | None:
        if self._frame_cb is None:
            return None
        return self._frame_cb(user, data)
