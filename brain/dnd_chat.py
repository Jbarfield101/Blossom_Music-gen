from __future__ import annotations

"""Helpers for Dungeons & Dragons specific chat interactions."""

from typing import Final
from pathlib import Path
import os
import re

from . import dialogue, prompt_router
from .constants import DEFAULT_DREADHAVEN_ROOT, BANNED_TERMS
import service_api


_ALLOWED_CATEGORIES: Final[frozenset[str]] = frozenset({"lore", "npc", "rules"})
REFUSAL_MESSAGE: Final[str] = (
    "Please enter a message about your campaign."
)


DEFAULT_FALLBACK_VAULT: Final[Path] = DEFAULT_DREADHAVEN_ROOT


def _fallback_filesystem_probe(query: str) -> bool:
    """Lightweight filesystem probe when the search index is unavailable.

    Scans Markdown files under the default DreadHaven folder and returns
    True if the query terms appear in any file.
    """
    try:
        root = DEFAULT_FALLBACK_VAULT.resolve()
        if not root.exists() or not root.is_dir():
            return False
        q = query.strip()
        if not q:
            return False
        lowered = q.lower()
        # Extract probable entity names (capitalized words) and tokens
        name_candidates = re.findall(r"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b", query)
        raw_tokens = [t for t in lowered.replace("\n", " ").split() if len(t) >= 3]
        stop = {"the","a","an","about","tell","asked","ask","please","hi","hello","howdy","of","and","in","to","for","on","me","you"}
        tokens = [t for t in raw_tokens if t.lower() not in stop]
        cleaned_names = []
        seen = set()
        for cand in name_candidates:
            canonical = cand.strip()
            lowered_name = canonical.lower()
            if lowered_name in stop or lowered_name in seen:
                continue
            seen.add(lowered_name)
            cleaned_names.append(canonical)
        base_terms = cleaned_names[:]
        for tok in tokens:
            lowered_tok = tok.lower()
            if lowered_tok not in seen:
                base_terms.append(tok)
                seen.add(lowered_tok)
        if not base_terms:
            base_terms = tokens or raw_tokens or [lowered]
        patterns = [re.compile(rf"\b{re.escape(tok)}(?:['']s)?\b", re.IGNORECASE) for tok in base_terms]
        # Walk up to a reasonable limit
        banned_patterns = [re.compile(re.escape(t), re.IGNORECASE) for t in BANNED_TERMS]
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                if not fn.lower().endswith((".md", ".markdown", ".txt")):
                    continue
                path = Path(dirpath) / fn
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue
                if any(bp.search(text) for bp in banned_patterns):
                    continue
                # Match any preferred pattern (OR), not all
                if any(p.search(text) for p in patterns):
                    return True
        return False
    except Exception:
        return False


def _has_relevant_context(message: str, category: str) -> bool:
    """Return ``True`` if ``message`` appears related to D&D lore or NPCs."""

    if category in _ALLOWED_CATEGORIES:
        return True

    try:
        results = service_api.search(message, tags=list(_ALLOWED_CATEGORIES))
        return bool(results)
    except Exception:
        # Fallback to direct filesystem probe when the search index is unavailable.
        return _fallback_filesystem_probe(message)


def chat(message: str) -> str:
    """Return a narration for ``message``.

    Always attempts to answer using campaign notes (vault or fallback folder).
    Only refuses on empty input.
    """

    stripped = message.strip()
    if not stripped:
        return REFUSAL_MESSAGE

    response = dialogue.respond(message, include_sources=True)
    if isinstance(response, str):
        return response
    return response.narration
