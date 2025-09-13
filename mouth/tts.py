"""Abstractions for text-to-speech backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

import numpy as np


class TTSBackend(ABC):
    """Abstract base class for TTS backends."""

    @abstractmethod
    def synthesize(self, text: str, voice_profile: Optional[str] = None) -> np.ndarray:
        """Synthesize audio from text.

        Args:
            text: Text to convert to speech.
            voice_profile: Optional identifier or path for a voice profile or model.

        Returns:
            PCM audio as a 1-D ``numpy.float32`` array.
        """


class TTSEngine:
    """High level wrapper for text-to-speech synthesis."""

    def __init__(self, backend: str = "piper", **backend_kwargs) -> None:
        if backend == "piper":
            from .backends.piper import PiperBackend

            self.backend: TTSBackend = PiperBackend(**backend_kwargs)
        else:  # pragma: no cover - defensive programming
            raise ValueError(f"Unsupported TTS backend: {backend}")

    def synthesize(self, text: str, voice_profile: Optional[str] = None) -> np.ndarray:
        """Synthesize audio using the selected backend."""

        return self.backend.synthesize(text, voice_profile)
