from __future__ import annotations

from datetime import datetime
from pathlib import Path
import os
import requests

from ears.transcript_logger import TranscriptLogger
import service_api


def export_session(transcript_root: str | Path | None = None,
                   combat_url: str | None = None) -> Path:
    """Export combat tracker events and transcript summaries to a note.

    Parameters
    ----------
    transcript_root:
        Directory containing transcript log files. When ``None``, the path is
        taken from the ``TRANSCRIPT_ROOT`` environment variable and defaults to
        ``"transcripts"``.
    combat_url:
        Base URL of the combat tracker service. When ``None``, the value is
        taken from ``COMBAT_TRACKER_URL`` and defaults to
        ``"http://localhost:8000"``.

    Returns
    -------
    Path
        The path to the created note within the vault.
    """

    combat_url = combat_url or os.getenv("COMBAT_TRACKER_URL", "http://localhost:8000")
    resp = requests.get(f"{combat_url}/events", timeout=10)
    resp.raise_for_status()
    events = resp.json()

    transcript_root = Path(transcript_root or os.getenv("TRANSCRIPT_ROOT", "transcripts"))
    logger = TranscriptLogger(transcript_root)
    session_id = logger.rotate()

    summaries: list[tuple[str, str]] = []
    for file in transcript_root.glob(f"*.{session_id}.jsonl"):
        channel = file.stem.split(".")[0]
        summary = logger.summary(channel, session_id)
        if summary:
            summaries.append((channel, summary))

    lines: list[str] = ["## Combat"]
    if events:
        for event in events:
            ts = event.get("ts")
            desc = event.get("desc") or event.get("event") or event.get("text") or ""
            if ts is not None:
                ts_text = datetime.fromtimestamp(ts).isoformat(timespec="seconds")
                lines.append(f"- {ts_text} {desc}")
            else:
                lines.append(f"- {desc}")
    else:
        lines.append("No combat events.")

    lines.append("## Transcripts")
    if summaries:
        for channel, summary in summaries:
            lines.append(f"### {channel}")
            lines.append(summary)
    else:
        lines.append("No transcripts.")

    content = "\n".join(lines)
    date_str = datetime.now().strftime("%Y-%m-%d")
    note_path = service_api.create_note(f"Session Log/{date_str}.md", content)
    return note_path


__all__ = ["export_session"]
