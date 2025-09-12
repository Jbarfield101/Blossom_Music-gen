"""Discord transcription pipeline."""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
from scipy.signal import resample_poly

from .discord_listener import DiscordListener
from .transcript_logger import TranscriptLogger
from .vad import VoiceActivityDetector
from .whisper_service import WhisperService


def _resample(pcm: bytes, source_rate: int, target_rate: int) -> bytes:
    """Convert stereo PCM from ``source_rate`` to mono ``target_rate``."""
    if source_rate == target_rate:
        return pcm
    audio = np.frombuffer(pcm, dtype=np.int16).reshape(-1, 2).mean(axis=1).astype(np.float32)
    g = math.gcd(source_rate, target_rate)
    resampled = resample_poly(audio, target_rate // g, source_rate // g)
    resampled = np.clip(resampled, -32768, 32767)
    return resampled.astype(np.int16).tobytes()


async def run_bot(token: str, channel_id: int, *, model_path: str = "small", transcript_root: str = "transcripts") -> None:
    """Join a Discord voice channel and transcribe speech in real time."""
    logger = TranscriptLogger(transcript_root)
    whisper = WhisperService(model_path)

    async def handle_segment(segment: bytes, speaker: Optional[str]) -> None:
        async for part in whisper.transcribe(segment):
            logger.append(str(channel_id), speaker or "unknown", part.text, timestamp=part.start)

    vad = VoiceActivityDetector(segment_callback=handle_segment)

    async def handle_frame(member, pcm: bytes) -> None:
        frame = _resample(pcm, 48000, vad.sample_rate)
        await vad.process(frame, str(member.id))

    listener = DiscordListener(frame_callback=handle_frame)

    @listener.event
    async def on_ready() -> None:
        channel = listener.get_channel(channel_id) or await listener.fetch_channel(channel_id)
        if channel is None or not hasattr(channel, "connect"):
            raise RuntimeError("Channel is not a voice channel")
        await listener.join_voice(channel)  # type: ignore[arg-type]

    try:
        await listener.start(token)
    finally:
        await vad.flush()
