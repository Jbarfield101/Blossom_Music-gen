from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Optional


class TranscriptLogger:
    """Append and rotate per-channel transcript logs.

    Parameters
    ----------
    root:
        Directory where transcript files are stored. Files are written in
        JSONL format with one entry per line.
    """

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks: Dict[str, threading.Lock] = {}
        self._session = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _lock(self, channel: str) -> threading.Lock:
        lock = self._locks.get(channel)
        if lock is None:
            lock = threading.Lock()
            self._locks[channel] = lock
        return lock

    def _base_path(self, channel: str) -> Path:
        return self.root / f"{channel}.jsonl"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def append(self, channel: str, speaker: str, text: str, *, timestamp: Optional[float] = None) -> None:
        """Append a transcript entry for ``channel``.

        Each entry is written atomically to avoid interleaving between
        concurrent writers. The log line is encoded as JSON and flushed using
        the ``O_APPEND`` flag so writes are always appended.
        """

        entry = {
            "ts": timestamp if timestamp is not None else time.time(),
            "speaker": speaker,
            "text": text,
        }
        data = json.dumps(entry, ensure_ascii=False) + "\n"
        path = self._base_path(channel)
        with self._lock(channel):
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT)
            try:
                os.write(fd, data.encode("utf-8"))
            finally:
                os.close(fd)

    def rotate(self) -> str:
        """Rotate existing channel logs into a session‑named file.

        Returns the session identifier used for the rotation. New entries will
        start a fresh session after calling this method.
        """

        session_id = self._session
        for file in self.root.glob("*.jsonl"):
            rotated = file.with_name(f"{file.stem}.{session_id}{file.suffix}")
            file.replace(rotated)
        self._session = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        return session_id

    def _session_path(self, channel: str, session_id: Optional[str]) -> Path:
        if session_id is None:
            return self._base_path(channel)
        return self.root / f"{channel}.{session_id}.jsonl"

    def entries(self, channel: str, session_id: Optional[str] = None) -> Iterable[dict]:
        """Iterate transcript entries for ``channel`` and ``session_id``."""

        path = self._session_path(channel, session_id)
        if not path.exists():
            return []
        with open(path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]

    def summary(self, channel: str, session_id: Optional[str] = None) -> str:
        """Return a human‑readable summary for ``channel``."""

        return "\n".join(f"{e['speaker']}: {e['text']}" for e in self.entries(channel, session_id))


__all__ = ["TranscriptLogger"]
