"""Streaming transcription using ``faster_whisper``.

This module provides a small wrapper around :class:`faster_whisper.WhisperModel`
that accepts buffered PCM audio segments and yields transcription results as
soon as they are available. Language detection is performed for each segment
and confidence scores are exposed from the underlying model.

The model runs on the CTranslate2 backend with GPU acceleration when available.
"""

from __future__ import annotations

import asyncio
import math
import threading
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import numpy as np
from faster_whisper import WhisperModel


@dataclass
class TranscriptionSegment:
    """Represents a chunk of transcribed audio."""

    text: str
    start: float
    end: float
    confidence: float
    language: str
    language_confidence: float


class WhisperService:
    """Asynchronous helper around :class:`faster_whisper.WhisperModel`.

    Parameters
    ----------
    model_path:
        Path or name of the whisper model to load.
    device:
        Device to run inference on. Defaults to ``"cuda"`` to enable GPU usage
        when available.
    compute_type:
        Compute type for the CTranslate2 backend. ``"float16"`` offers a good
        balance between speed and accuracy on modern GPUs.
    """

    def __init__(
        self,
        model_path: str = "small",
        *,
        device: str = "cuda",
        compute_type: str = "float16",
    ) -> None:
        self._model = WhisperModel(model_path, device=device, compute_type=compute_type)

    async def transcribe(self, pcm: bytes) -> AsyncIterator[TranscriptionSegment]:
        """Transcribe a buffer of 16‑bit mono PCM audio.

        The method streams partial results during the transcription process and
        yields finalised :class:`TranscriptionSegment` instances as soon as they
        are produced by the model.
        """

        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[Optional[object], Optional[object]]] = asyncio.Queue()

        def _worker() -> None:
            segments, info = self._model.transcribe(audio, word_timestamps=True)
            for seg in segments:
                loop.call_soon_threadsafe(queue.put_nowait, (seg, info))
            loop.call_soon_threadsafe(queue.put_nowait, (None, info))

        threading.Thread(target=_worker, daemon=True).start()

        while True:
            seg, info = await queue.get()
            if seg is None:
                break
            assert info is not None
            yield TranscriptionSegment(
                text=seg.text,
                start=seg.start,
                end=seg.end,
                confidence=float(math.exp(seg.avg_logprob)),
                language=info.language,
                language_confidence=info.language_probability,
            )


__all__ = ["WhisperService", "TranscriptionSegment"]
