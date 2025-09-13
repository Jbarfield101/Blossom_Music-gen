"""Audio input utilities."""

from .transcript_logger import TranscriptLogger

try:  # pragma: no cover - optional dependency
    from .discord_listener import DiscordListener
except Exception:  # ImportError and runtime errors if backend missing
    DiscordListener = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    from .whisper_service import TranscriptionSegment, WhisperService
except Exception:  # ImportError and runtime errors if backend missing
    WhisperService = None  # type: ignore[assignment]
    TranscriptionSegment = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    from .pipeline import run_bot
except Exception:  # ImportError and runtime errors if backend missing
    run_bot = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    from .diarization import pyannote_diarize
except Exception:  # ImportError and runtime errors if backend missing
    pyannote_diarize = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    from .devices import list_devices
except Exception:  # ImportError and runtime errors if backend missing
    list_devices = None  # type: ignore[assignment]

__all__ = [
    "DiscordListener",
    "WhisperService",
    "TranscriptionSegment",
    "TranscriptLogger",
    "run_bot",
    "pyannote_diarize",
    "list_devices",
]
