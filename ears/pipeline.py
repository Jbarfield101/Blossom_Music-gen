"""Discord transcription pipeline with 48 kHz → 16 kHz resampling."""
from __future__ import annotations

import math
from typing import Optional

import numpy as np

try:
    import resampy
except Exception:  # pragma: no cover - optional dependency
    resampy = None
    from scipy.signal import resample_poly

from .discord_listener import DiscordListener
from .transcript_logger import TranscriptLogger
from .vad import DiarizationHook, VoiceActivityDetector
from .whisper_service import WhisperService


def _resample(pcm: bytes, source_rate: int, target_rate: int) -> bytes:
    """Convert 48 kHz stereo PCM to mono ``target_rate`` using ``resampy``.

    The input is expected to contain interleaved 16‑bit little‑endian stereo
    samples. Channels are averaged to mono before resampling. When
    ``source_rate`` already matches ``target_rate`` the audio is still converted
    to mono but no resampling is performed. If ``resampy`` is unavailable,
    ``scipy.signal.resample_poly`` is used as a fallback.
    """
    audio = (
        np.frombuffer(pcm, dtype=np.int16).reshape(-1, 2).mean(axis=1).astype(np.float32)
    )
    if source_rate != target_rate:
        if resampy is not None:
            audio = resampy.resample(audio, source_rate, target_rate)
        else:  # pragma: no cover - exercised when resampy missing
            g = math.gcd(source_rate, target_rate)
            audio = resample_poly(audio, target_rate // g, source_rate // g)
    audio = np.clip(audio, -32768, 32767)
    return audio.astype(np.int16).tobytes()


async def run_bot(
    token: str,
    channel_id: int,
    *,
    model_path: str = "small",
    transcript_root: str = "transcripts",
    diarizer: Optional[DiarizationHook] = None,
) -> None:
    """Join a Discord voice channel and transcribe speech in real time.

    Incoming 48 kHz stereo frames are converted to 16 kHz mono before voice
    activity detection and Whisper transcription.
    """
    logger = TranscriptLogger(transcript_root)
    whisper = WhisperService(model_path)

    async def handle_segment(segment: bytes, speaker: Optional[str]) -> None:
        async for part in whisper.transcribe(segment):
            logger.append(str(channel_id), speaker or "unknown", part.text, timestamp=part.start)

    vad = VoiceActivityDetector(segment_callback=handle_segment, diarizer=diarizer)

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
