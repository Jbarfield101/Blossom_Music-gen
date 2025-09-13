"""Abstractions for text-to-speech backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional, Union

import numpy as np

from .registry import VoiceProfile, VoiceRegistry


class TTSBackend(ABC):
    """Abstract base class for TTS backends."""

    @abstractmethod
    def synthesize(self, text: str, voice: VoiceProfile) -> np.ndarray:
        """Synthesize audio from text.

        Args:
            text: Text to convert to speech.
            voice: Voice parameters describing how the speech should sound.

        Returns:
            PCM audio as a 1-D ``numpy.float32`` array.
        """


class TTSEngine:
    """High level wrapper for text-to-speech synthesis."""

    def __init__(self, backend: str = "piper", registry: Optional[VoiceRegistry] = None, **backend_kwargs) -> None:
        if backend == "piper":
            from .backends.piper import PiperBackend

            self.backend: TTSBackend = PiperBackend(**backend_kwargs)
        else:  # pragma: no cover - defensive programming
            raise ValueError(f"Unsupported TTS backend: {backend}")

        self.registry = registry or VoiceRegistry()

    def synthesize(self, text: str, voice: Union[str, VoiceProfile, None] = None) -> np.ndarray:
        """Synthesize audio using the selected backend."""

        profile = voice if isinstance(voice, VoiceProfile) else self.registry.get_profile(voice)
        return self.backend.synthesize(text, profile)
