from __future__ import annotations

"""Dialogue helpers with context injection from Obsidian notes."""

from typing import List
import re
import json

import service_api
from . import prompt_router, ollama_client
from .events import Event


def _summarize(content: str) -> str:
    """Return the first paragraph or bullet list from ``content``."""
    content = content.strip()
    if not content:
        return ""
    blocks = [block for block in content.split("\n\n") if block.strip()]
    if not blocks:
        return ""
    first = blocks[0].strip()
    lines = [ln.strip() for ln in first.splitlines() if ln.strip()]
    if not lines:
        return ""
    if all(ln.startswith("-") for ln in lines):
        # Return up to the first three bullet lines
        return "\n".join(lines[:3])
    return lines[0]


def respond(message: str) -> Event | str:
    """Generate a structured response for ``message`` via Ollama.

    If the message is classified as ``"lore"`` or ``"npc"``, relevant note
    summaries are searched and prepended to the prompt. When no matching notes
    are found the original message is used unchanged. Messages beginning with
    ``"note"`` are stored directly in the selected vault instead of being sent
    to the language model.
    """

    category = prompt_router.classify(message)
    if category == "note":
        match = re.match(r"note\s+(\S+)\s*:\s*(.+)", message.strip(), re.I | re.S)
        if match:
            path, text = match.group(1), match.group(2).strip()
            service_api.create_note(path, text)
            return f"Saved note to {path}"

    summaries: List[str] = []
    if category in ("lore", "npc"):
        results = service_api.search(message, tags=[category])
        for res in results:
            summary = _summarize(res.get("content", ""))
            if summary:
                summaries.append(summary)

    prompt = message
    if summaries:
        notes = "\n".join(
            s if s.startswith("-") else f"- {s}" for s in summaries
        )
        prompt = f"{message}\n\nRelevant notes:\n{notes}\n"

    # Request the model to return a JSON object describing the event
    prompt = (
        f"{prompt}\n\n"
        "Respond with a JSON object containing the keys "
        "who, action, targets, effects, narration."
    )

    raw = ollama_client.generate(prompt)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:  # pragma: no cover - error path
        raise ValueError("Malformed JSON from model") from exc

    return Event.from_json(data)
