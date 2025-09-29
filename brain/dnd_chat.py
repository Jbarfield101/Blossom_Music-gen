from __future__ import annotations

"""Helpers for Dungeons & Dragons specific chat interactions."""

from typing import Final

from . import dialogue, prompt_router
import service_api


_ALLOWED_CATEGORIES: Final[frozenset[str]] = frozenset({"lore", "npc", "rules"})
REFUSAL_MESSAGE: Final[str] = (
    "I'm focused on your Dungeons & Dragons campaign — lore, NPCs, and table rules. "
    "Ask about the setting, locations, characters, or rules in your world."
)


def _has_relevant_context(message: str, category: str) -> bool:
    """Return ``True`` if ``message`` appears related to D&D lore or NPCs."""

    if category in _ALLOWED_CATEGORIES:
        return True

    try:
        results = service_api.search(message, tags=list(_ALLOWED_CATEGORIES))
    except Exception:
        return False
    return bool(results)


def chat(message: str) -> str:
    """Return a narration for ``message`` or a refusal when off-topic."""

    stripped = message.strip()
    if not stripped:
        return REFUSAL_MESSAGE

    category = prompt_router.classify(stripped)
    if not _has_relevant_context(stripped, category):
        return REFUSAL_MESSAGE

    response = dialogue.respond(message)
    if isinstance(response, str):
        return response
    return response.narration
