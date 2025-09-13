"""Discord text-to-speech player.

This module provides a small wrapper around :class:`discord.Client` that
connects to a voice channel and streams speech synthesized by
:class:`~mouth.tts.TTSEngine`.  Audio is generated via the Piper backend,
resampled to 48 kHz mono, encoded to Opus and forwarded to the connected
voice client.
"""

from __future__ import annotations

import asyncio
import math
from typing import Optional

import discord

try:  # pragma: no cover - optional dependency
    import numpy as np
except Exception:  # pragma: no cover - exercised when numpy missing
    np = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    import sounddevice as sd
except Exception:  # pragma: no cover - exercised when sounddevice missing
    sd = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    import resampy
except Exception:  # pragma: no cover - exercised when resampy missing
    resampy = None  # type: ignore[assignment]
    try:  # pragma: no cover - optional dependency
        from scipy.signal import resample_poly
    except Exception:  # pragma: no cover - exercised when scipy missing
        resample_poly = None  # type: ignore[assignment]

from .tts import TTSEngine
from .registry import VoiceProfile
from ears.devices import get_device_ids


class DiscordPlayer(discord.Client):
    """Client that plays text-to-speech audio in Discord voice channels."""

    def __init__(
        self,
        *,
        engine: Optional[TTSEngine] = None,
        input_rate: int = 22050,
        intents: Optional[discord.Intents] = None,
        **kwargs,
    ) -> None:
        intents = intents or discord.Intents.none()
        intents.voice_states = True
        super().__init__(intents=intents, **kwargs)
        self.engine = engine or TTSEngine()
        self.input_rate = input_rate
        self.voice_client: Optional[discord.VoiceClient] = None

    async def join_voice(self, channel: discord.VoiceChannel) -> discord.VoiceClient:
        """Connect to ``channel`` and store the resulting voice client."""

        vc = await channel.connect()
        self.voice_client = vc
        return vc

    async def speak(self, text: str, profile: Optional[VoiceProfile] = None) -> None:
        """Synthesize ``text`` and stream it to the connected voice channel."""

        if self.voice_client is None:
            raise RuntimeError("Not connected to a voice channel")

        audio = self.engine.synthesize(text, profile)
        if self.input_rate != 48000:
            if np is not None and resampy is not None:
                audio = resampy.resample(audio, self.input_rate, 48000)
            elif np is not None and resample_poly is not None:  # pragma: no cover - scipy fallback
                g = math.gcd(self.input_rate, 48000)
                audio = resample_poly(audio, 48000 // g, self.input_rate // g)
            else:  # pragma: no cover - very naive fallback
                ratio = 48000 / float(self.input_rate)
                audio = [audio[int(i / ratio)] for i in range(int(len(audio) * ratio))]

        if np is not None:
            pcm = np.clip(audio * 32767, -32768, 32767).astype(np.int16).tobytes()
        else:  # pragma: no cover - exercised when numpy missing
            samples = [int(max(min(x * 32767, 32767), -32768)) for x in audio]
            pcm = bytearray()
            for s in samples:
                pcm.extend(int(s).to_bytes(2, "little", signed=True))
        if sd is not None and np is not None:
            _, out_dev = get_device_ids()
            if out_dev is not None:
                sd.play(
                    np.frombuffer(pcm, dtype=np.int16),
                    48000,
                    device=out_dev,
                    blocking=False,
                )
        encoder = discord.opus.Encoder(48000, 1)
        frame_size = encoder.frame_size
        step = frame_size * 2  # 16-bit mono

        for i in range(0, len(pcm), step):
            frame = pcm[i : i + step]
            if len(frame) < step:
                frame = frame.ljust(step, b"\x00")
            packet = encoder.encode(frame, frame_size)
            self.voice_client.send_audio_packet(packet, encode=False)
            await asyncio.sleep(frame_size / 48000.0)


async def run_bot(
    token: str,
    channel_id: int,
    *,
    text: str,
    voice: Optional[VoiceProfile] = None,
    **engine_kwargs,
) -> None:
    """Join a Discord channel and speak ``text`` once."""

    player = DiscordPlayer(engine=TTSEngine(**engine_kwargs))

    @player.event
    async def on_ready() -> None:
        channel = player.get_channel(channel_id) or await player.fetch_channel(channel_id)
        if channel is None or not hasattr(channel, "connect"):
            raise RuntimeError("Channel is not a voice channel")
        await player.join_voice(channel)  # type: ignore[arg-type]
        await player.speak(text, voice)
        await player.close()

    await player.start(token)
