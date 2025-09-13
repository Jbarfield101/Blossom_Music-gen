from __future__ import annotations

"""Discord-based speech assistant orchestrating STT, LLM and TTS."""

import asyncio
import contextlib
import os
from typing import Optional

from ears import pipeline
from ears.whisper_service import TranscriptionSegment
from brain import dialogue
from mouth.discord_player import DiscordPlayer
from config.discord_profiles import get_profile


class DiscordOrchestrator:
    """Coordinate speech recognition, dialogue generation and synthesis."""

    def __init__(self, token: str, guild_id: int, channel_id: int, *, debounce: float = 0.3) -> None:
        self.token = token
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.debounce = debounce
        self.player = DiscordPlayer()
        self.profile = get_profile(guild_id, channel_id)
        # Apply model overrides immediately so subsequent imports pick them up
        for key, value in self.profile.get("models", {}).items():
            os.environ[key.upper()] = str(value)
        self._play_task: Optional[asyncio.Task[None]] = None
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._partial_reset: Optional[asyncio.Task[None]] = None
        self._partial_count = 0
        self._listening = True
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    async def _reset_partials(self) -> None:
        await asyncio.sleep(self.debounce)
        self._partial_count = 0

    async def _handle_segment(
        self, part: TranscriptionSegment, speaker: Optional[str]
    ) -> None:
        """Handle partial and final segments from the transcription pipeline."""

        if not part.is_final:
            if self._play_task and not self._play_task.done():
                self._partial_count += 1
                if self._partial_reset is not None:
                    self._partial_reset.cancel()
                self._partial_reset = asyncio.create_task(self._reset_partials())
                if self._partial_count >= 2:
                    self._play_task.cancel()
            return

        self._partial_count = 0
        if self._partial_reset is not None:
            self._partial_reset.cancel()
            self._partial_reset = None

        if not self._listening:
            return

        text = part.text.strip()
        hotword = self.profile.get("hotword")
        if hotword:
            if hotword.lower() not in text.lower():
                return
            text = text.lower().replace(hotword.lower(), "").strip()
        if text:
            await self._queue.put(text)

    async def _worker(self) -> None:
        while True:
            text = await self._queue.get()
            self._listening = False
            reply = dialogue.respond(text)
            message = getattr(reply, "narration", str(reply))
            voice_name = self.profile.get("voice")
            voice = None
            if voice_name:
                voice = self.player.engine.registry.get_profile(voice_name)
            self._play_task = asyncio.create_task(self.player.speak(message, voice))
            try:
                await self._play_task
            except asyncio.CancelledError:
                pass
            finally:
                self._play_task = None
                self._listening = True

    async def start(self) -> None:
        """Run the orchestrator until stopped."""

        @self.player.event
        async def on_ready() -> None:
            channel = self.player.get_channel(self.channel_id) or await self.player.fetch_channel(self.channel_id)
            if channel is None or not hasattr(channel, "connect"):
                raise RuntimeError("Channel is not a voice channel")
            await self.player.join_voice(channel)  # type: ignore[arg-type]

        self._worker_task = asyncio.create_task(self._worker())
        player_task = asyncio.create_task(self.player.start(self.token))
        try:
            await pipeline.run_bot(
                self.token,
                self.channel_id,
                part_callback=self._handle_segment,
            )
        finally:
            if not player_task.done():
                player_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await player_task
            if self._worker_task and not self._worker_task.done():
                self._worker_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._worker_task
