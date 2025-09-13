"""Text-to-speech utilities."""

from .registry import VoiceProfile, VoiceRegistry

__all__ = ["TTSEngine", "TTSBackend", "VoiceProfile", "VoiceRegistry"]


def __getattr__(name):  # pragma: no cover - thin wrapper
    if name in {"TTSEngine", "TTSBackend"}:
        from .tts import TTSEngine, TTSBackend

        return {"TTSEngine": TTSEngine, "TTSBackend": TTSBackend}[name]
    raise AttributeError(name)
