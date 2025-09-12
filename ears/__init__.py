"""Audio input utilities."""

from .discord_listener import DiscordListener

try:  # pragma: no cover - optional dependency
    from .whisper_service import TranscriptionSegment, WhisperService
except Exception:  # ImportError and runtime errors if backend missing
    WhisperService = None  # type: ignore[assignment]
    TranscriptionSegment = None  # type: ignore[assignment]

__all__ = ["DiscordListener", "WhisperService", "TranscriptionSegment"]
