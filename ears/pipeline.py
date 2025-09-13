"""Discord transcription pipeline with 48 kHz → 16 kHz resampling."""
from __future__ import annotations

import asyncio
import math
from typing import Awaitable, Callable, Optional

import numpy as np
import logging

try:  # pragma: no cover - optional dependency
    import sounddevice as sd
except Exception:  # pragma: no cover - exercised when sounddevice missing
    sd = None  # type: ignore

try:
    import resampy
except Exception:  # pragma: no cover - optional dependency
    resampy = None
    from scipy.signal import resample_poly

from .discord_listener import DiscordListener
from .transcript_logger import TranscriptLogger
from .vad import DiarizationHook, VoiceActivityDetector
from .whisper_service import TranscriptionSegment, WhisperService
from .devices import get_device_ids


def _resample(pcm: bytes, source_rate: int, target_rate: int) -> bytes:
    """Convert 48 kHz stereo PCM to mono ``target_rate`` using ``resampy``.

    The input is expected to contain interleaved 16‑bit little‑endian stereo
    samples. Channels are averaged to mono before resampling. When
    ``source_rate`` already matches ``target_rate`` the audio is still converted
    to mono but no resampling is performed. If ``resampy`` is unavailable,
    ``scipy.signal.resample_poly`` is used as a fallback.
    """
    # ``pcm`` should contain 16-bit stereo frames (4 bytes). If the byte
    # length is not a multiple of four, drop any trailing partial frame before
    # reshaping. Logging the number of discarded bytes helps diagnose
    # misaligned buffers.
    remainder = len(pcm) % 4
    if remainder:
        pcm = pcm[: len(pcm) - remainder]
        logging.debug("Truncated %d incomplete PCM byte(s)", remainder)

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
    part_callback: Optional[
        Callable[[TranscriptionSegment, Optional[str]], Awaitable[None]]
    ] = None,
    rate_limit: float = 0.0,
) -> None:
    """Join a Discord voice channel and transcribe speech in real time.

    Parameters
    ----------
    token, channel_id:
        Discord bot token and target voice channel identifier.
    model_path:
        Whisper model name or path.
    transcript_root:
        Directory to store JSONL transcript logs.
    diarizer:
        Optional :class:`~ears.vad.DiarizationHook` such as
        :func:`~ears.diarization.pyannote_diarize`.
    part_callback:
        Async callback invoked for every :class:`TranscriptionSegment` produced
        by Whisper. Both partial and final segments are forwarded.
    rate_limit:
        Minimum interval in seconds between successive invocations of
        ``part_callback`` for non‑final segments. Final segments are always
        emitted.

    Incoming 48 kHz stereo frames are converted to 16 kHz mono before voice
    activity detection and Whisper transcription.
    """
    logger = TranscriptLogger(transcript_root)
    whisper = WhisperService(model_path)

    async def handle_segment(segment: bytes, speaker: Optional[str]) -> None:
        last_emit = 0.0
        loop = None
        if part_callback is not None:
            loop = asyncio.get_running_loop()
        async for part in whisper.transcribe(segment):
            if part_callback is not None:
                now = loop.time()
                if part.is_final or now - last_emit >= rate_limit:
                    await part_callback(part, speaker)
                    last_emit = now
            if part.is_final:
                logger.append(
                    str(channel_id),
                    speaker or "unknown",
                    part.text,
                    timestamp=part.start,
                    language=part.language,
                    confidence=part.confidence,
                )

    vad = VoiceActivityDetector(segment_callback=handle_segment, diarizer=diarizer)

    async def handle_frame(member, pcm: bytes) -> None:
        frame = _resample(pcm, 48000, vad.sample_rate)
        await vad.process(frame, str(member.id))
        if sd is not None:
            _, out_dev = get_device_ids()
            if out_dev is not None:
                sd.play(
                    np.frombuffer(frame, dtype=np.int16),
                    vad.sample_rate,
                    device=out_dev,
                    blocking=False,
                )

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
