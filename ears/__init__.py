"""Audio input utilities."""

from .transcript_logger import TranscriptLogger

try:  # pragma: no cover - optional dependency
    from .discord_listener import DiscordListener
except Exception:  # pragma: no cover - discord is optional
    DiscordListener = None  # type: ignore[assignment]

__all__ = ["TranscriptLogger"]
if DiscordListener is not None:
    __all__.append("DiscordListener")
