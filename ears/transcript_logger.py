"""Utilities for logging speech transcripts.

This module provides :class:`TranscriptLogger` which appends JSON lines to a
per‑channel log file. Each line contains ``channel_id``, ``speaker``, ``start``,
``end``, ``text``, ``lang``, and ``confidence`` fields. Files are rotated on each
new logger instantiation to avoid corruption across sessions.
"""

from __future__ import annotations

from dataclasses import dataclass
import datetime as _dt
import glob
import json
import os
from typing import Any, Dict, List

__all__ = ["TranscriptLogger"]


@dataclass
class TranscriptEntry:
    """Container describing a single transcript segment."""

    channel_id: str
    speaker: str
    start: float
    end: float
    text: str
    lang: str | None
    confidence: float | None

    def to_json(self) -> str:
        return json.dumps(
            {
                "channel_id": self.channel_id,
                "speaker": self.speaker,
                "start": self.start,
                "end": self.end,
                "text": self.text,
                "lang": self.lang,
                "confidence": self.confidence,
            },
            ensure_ascii=False,
        )


class TranscriptLogger:
    """Append‑only JSONL logger for speech transcripts."""

    def __init__(self, channel_id: str, *, root: str = "transcripts") -> None:
        self.channel_id = str(channel_id)
        self.root = root
        os.makedirs(self.root, exist_ok=True)
        self._path = os.path.join(self.root, f"{self.channel_id}.jsonl")

        # Rotate any pre‑existing log to avoid corruption between sessions.
        if os.path.exists(self._path):
            timestamp = _dt.datetime.now().strftime("%Y%m%d%H%M%S")
            rotated = os.path.join(self.root, f"{self.channel_id}.{timestamp}.jsonl")
            os.replace(self._path, rotated)

    # ------------------------------------------------------------------
    def log(
        self,
        speaker: str,
        start: float,
        end: float,
        text: str,
        *,
        lang: str | None = None,
        confidence: float | None = None,
    ) -> None:
        """Append a transcript entry to the JSONL file.

        Parameters
        ----------
        speaker, start, end, text, lang, confidence:
            Metadata describing the transcript segment.
        """

        entry = TranscriptEntry(
            channel_id=self.channel_id,
            speaker=speaker,
            start=start,
            end=end,
            text=text,
            lang=lang,
            confidence=confidence,
        )

        line = entry.to_json() + "\n"
        data = line.encode("utf-8")
        fd = os.open(self._path, os.O_APPEND | os.O_CREAT | os.O_WRONLY)
        try:
            with os.fdopen(fd, "ab") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
        finally:
            # ``with`` block closes fd; this is just to satisfy type checkers.
            pass

    # ------------------------------------------------------------------
    def summary(self) -> List[Dict[str, Any]]:
        """Return all transcript entries for ``channel_id``.

        This scans both the current session file and any rotated logs.
        """

        pattern = os.path.join(self.root, f"{self.channel_id}*.jsonl")
        entries: List[Dict[str, Any]] = []
        for path in sorted(glob.glob(pattern)):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        return entries
