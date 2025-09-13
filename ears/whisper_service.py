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
import os


@dataclass
class TranscriptionSegment:
    """Represents a chunk of transcribed audio."""

    text: str
    start: float
    end: float
    confidence: float
    language: str
    language_confidence: float
    is_final: bool


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
        model_path: Optional[str] = None,
        *,
        device: str = "cuda",
        compute_type: str = "float16",
    ) -> None:
        model_path = model_path or os.getenv("WHISPER_MODEL", "small")
        self._model = WhisperModel(model_path, device=device, compute_type=compute_type)

    async def transcribe(self, pcm: bytes) -> AsyncIterator[TranscriptionSegment]:
        """Transcribe a buffer of 16‑bit mono PCM audio.

        The method streams partial results during the transcription process and
        yields finalised :class:`TranscriptionSegment` instances as soon as they
        are produced by the model.
        """

        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[Optional[object], Optional[object], bool]] = asyncio.Queue()
        finished = threading.Event()

        def _worker_final() -> None:
            segments, info = self._model.transcribe(audio, word_timestamps=True)
            for seg in segments:
                loop.call_soon_threadsafe(queue.put_nowait, (seg, info, True))
            finished.set()
            loop.call_soon_threadsafe(queue.put_nowait, (None, info, True))

        def _worker_partial() -> None:
            """Stream partial segments using a sliding buffer."""

            step = max(1, len(audio) // 4)
            pos = 0
            prompt = ""
            while not finished.is_set() and pos < len(audio):
                next_pos = min(len(audio), pos + step)
                part = audio[pos:next_pos]
                try:
                    segments, _ = self._model.transcribe(
                        part,
                        word_timestamps=True,
                        initial_prompt=prompt,
                        vad_filter=True,
                    )
                    for seg in segments:
                        # offset timestamps with position in the full audio buffer
                        seg.start += pos / 16000
                        seg.end += pos / 16000
                        prompt += seg.text + " "
                        loop.call_soon_threadsafe(queue.put_nowait, (seg, None, False))
                except Exception:
                    pass
                pos = next_pos

        # Start partial decoding before the full transcription to ensure
        # early results are available even if the final pass is fast.
        threading.Thread(target=_worker_partial, daemon=True).start()
        threading.Thread(target=_worker_final, daemon=True).start()

        while True:
            seg, info, is_final = await queue.get()
            if seg is None and is_final:
                break
            language = "" if info is None else info.language
            lang_conf = 0.0 if info is None else info.language_probability
            confidence = float(math.exp(getattr(seg, "avg_logprob", 0.0)))
            yield TranscriptionSegment(
                text=seg.text,
                start=seg.start,
                end=seg.end,
                confidence=confidence,
                language=language,
                language_confidence=lang_conf,
                is_final=is_final,
            )


__all__ = ["WhisperService", "TranscriptionSegment"]
