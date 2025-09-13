from __future__ import annotations

"""Dialogue helpers with context injection from Obsidian notes."""

from typing import List

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


def respond(message: str) -> Event:
    """Generate a structured :class:`~brain.events.Event` for ``message``.

    If the message is classified as ``"lore"`` or ``"npc"``, relevant note
    summaries are searched and prepended to the prompt. When no matching notes
    are found the original message is used unchanged. The Ollama model is then
    asked to respond with a JSON object containing ``who``, ``action``,
    ``targets``, ``effects`` and ``narration`` fields which are parsed into an
    :class:`Event` instance.
    """

    category = prompt_router.classify(message)
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

    prompt = (
        f"{prompt}\n\nRespond with a JSON object containing keys: "
        "who, action, targets, effects, narration."
    )

    raw = ollama_client.generate(prompt)
    return Event.from_json(raw)
