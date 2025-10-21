"""Abstractions for text-to-speech backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
import hashlib
import json
import time
import os
from pathlib import Path
from typing import Optional, Union

import numpy as np
import soundfile as sf

from .registry import VoiceProfile, VoiceRegistry
from telemetry import record_elevenlabs_usage


CACHE_DIR = Path("cache/tts")


def _infer_voice_provider(voice: VoiceProfile) -> str:
    """Best-effort provider inference for a voice profile."""

    tags = getattr(voice, "tags", None) or []
    if any(str(tag).lower() == "elevenlabs" for tag in tags):
        return "elevenlabs"
    voice_id = (voice.voice_id or "").strip()
    lower_id = voice_id.lower()
    if lower_id.startswith("elevenlabs") or lower_id.startswith("eleven_"):
        return "elevenlabs"
    if voice_id and len(voice_id) >= 10 and voice_id.isalnum() and any(ch.isupper() for ch in voice_id):
        return "elevenlabs"
    return "piper"


def _cache_key(voice: VoiceProfile, text: str) -> str:
    data = json.dumps(
        {
            "voice_id": voice.voice_id,
            "speed": voice.speed,
            "emotion": voice.emotion,
            "text": text,
        },
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def cache_lookup(key: str, ttl: Optional[float] = None) -> Optional[np.ndarray]:
    """Return cached PCM if present and not expired."""

    path = CACHE_DIR / f"{key}.npy"
    if not path.exists():
        return None
    if ttl is not None and ttl >= 0:
        age = time.time() - path.stat().st_mtime
        if age > ttl:
            try:
                path.unlink()
                (path.with_suffix(".opus")).unlink(missing_ok=True)  # type: ignore[arg-type]
            except OSError:
                pass
            return None
    return np.load(path)


def cache_store(
    key: str,
    audio: np.ndarray,
    *,
    rate: int = 22050,
) -> None:
    """Store ``audio`` in the cache under ``key``."""

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.save(CACHE_DIR / f"{key}.npy", audio)
    try:  # pragma: no cover - optional dependency or codec support
        sf.write(CACHE_DIR / f"{key}.opus", audio, rate, format="OGG", subtype="OPUS")
    except Exception:
        pass


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

    # ------------------------------------------------------------------
    def warm_start(self, *args, **kwargs) -> None:  # pragma: no cover - default no-op
        """Pre-load backend resources to reduce first-use latency."""
        return None


class TTSEngine:
    """High level wrapper for text-to-speech synthesis."""

    def __init__(self, backend: str = "piper", registry: Optional[VoiceRegistry] = None, **backend_kwargs) -> None:
        if backend == "piper":
            from .backends.piper import PiperBackend

            backend_kwargs.setdefault("model_path", os.getenv("PIPER_VOICE", "narrator"))
            cfg_env = os.getenv("PIPER_CONFIG")
            if cfg_env and "config_path" not in backend_kwargs:
                backend_kwargs["config_path"] = cfg_env
            self.backend: TTSBackend = PiperBackend(**backend_kwargs)
        else:  # pragma: no cover - defensive programming
            raise ValueError(f"Unsupported TTS backend: {backend}")

        self.registry = registry or VoiceRegistry()

    # ------------------------------------------------------------------
    def synthesize(
        self, text: str, voice: Union[str, VoiceProfile, None] = None, *, ttl: Optional[float] = None
    ) -> np.ndarray:
        """Synthesize audio using the selected backend with caching."""

        profile = voice if isinstance(voice, VoiceProfile) else self.registry.get_profile(voice)
        key = _cache_key(profile, text)
        cached = cache_lookup(key, ttl)
        if cached is not None:
            return cached
        audio = self.backend.synthesize(text, profile)
        if _infer_voice_provider(profile) == "elevenlabs":
            payload = text if isinstance(text, str) else str(text)
            record_elevenlabs_usage(len(payload))
        cache_store(key, audio)
        return audio

    # ------------------------------------------------------------------
    def warm_start(self) -> None:
        """Eagerly load backend resources."""

        if hasattr(self.backend, "warm_start"):
            self.backend.warm_start(
                [p.voice_id for p in getattr(self.registry, "_profiles", {}).values()]
            )
