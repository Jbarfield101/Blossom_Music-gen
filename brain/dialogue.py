from __future__ import annotations

"""Dialogue helpers with context injection from Obsidian notes."""

from typing import List, Tuple
from pathlib import Path
import os
import re
import json

import service_api
from .constants import DEFAULT_DREADHAVEN_ROOT, BANNED_TERMS, GOD_DIR_HINTS
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


def respond(message: str, include_sources: bool = False) -> Event | str:
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
    source_paths: List[str] = []
    if category in ("lore", "npc"):
        try:
            results = service_api.search(message, tags=[category])
            for res in results:
                summary = _summarize(res.get("content", ""))
                if summary:
                    summaries.append(summary)
                    path = res.get("path") or ""
                    if path:
                        source_paths.append(path)
        except Exception:
            # Fallback: scan Markdown files under DreadHaven for quick summaries
            root = DEFAULT_DREADHAVEN_ROOT
            try:
                if root.exists() and root.is_dir():
                    q = message.strip()
                    tokens_all = [t for t in q.replace("\n", " ").split() if len(t) >= 3] or [q]
                    import re as _re
                    stop = {"the","a","an","about","tell","asked","ask","please","hi","hello","howdy","of","and","in","to","for","on","me","you"}
                    content_tokens = [t for t in tokens_all if t.lower() not in stop] or tokens_all
                    name_candidates = _re.findall(r"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b", message)
                    if not name_candidates:
                        # Derive candidates from content tokens by title-casing (handles lowercase queries like "gond")
                        name_candidates = [t.capitalize() for t in content_tokens if t.isalpha() and len(t) >= 3]
                    base_terms = name_candidates or content_tokens
                    patterns = [_re.compile(rf"\b{_re.escape(tok)}(?:[’']s)?\b", _re.IGNORECASE) for tok in base_terms]
                    banned = [_re.compile(_re.escape(t), _re.IGNORECASE) for t in BANNED_TERMS]

                    # Try direct filename match for likely entity names (e.g., Gond.md)
                    name_candidates = _re.findall(r"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b", message)
                    preferred_dirs: list[Path] = []
                    # Collect directories whose path contains any GOD_DIR_HINTS
                    for dirpath, dirnames, _ in os.walk(root):
                        dp = dirpath.lower()
                        if any(h in dp for h in (h.lower() for h in GOD_DIR_HINTS)):
                            preferred_dirs.append(Path(dirpath))
                    seen = set()
                    matched: List[Tuple[str, str]] = []
                    for pd in preferred_dirs:
                        try:
                            for nd in name_candidates:
                                fname = f"{nd}.md"
                                # Walk only this preferred dir
                                for wdir, _d, files in os.walk(pd):
                                    # case-insensitive match against files
                                    lower_files = {f.lower() for f in files}
                                    target = None
                                    if fname.lower() in lower_files:
                                        target = fname
                                    elif f"{nd}.markdown".lower() in lower_files:
                                        target = f"{nd}.markdown"
                                    if target:
                                        p = Path(wdir) / target
                                        if p in seen:
                                            continue
                                        seen.add(p)
                                        try:
                                            raw = p.read_text(encoding="utf-8", errors="ignore")
                                        except Exception:
                                            continue
                                        if any(bp.search(raw) for bp in banned):
                                            continue
                                        s = _summarize(raw)
                                        if s:
                                            matched.append((s, str(p.relative_to(root))))
                                            if len(matched) >= 5:
                                                break
                                if len(matched) >= 5:
                                    break
                            if len(matched) >= 5:
                                break
                        except Exception:
                            continue
                    # General recursive scan
                    for dirpath, _dirnames, filenames in os.walk(root):
                        for fn in filenames:
                            if not fn.lower().endswith((".md", ".markdown", ".txt")):
                                continue
                            path = Path(dirpath) / fn
                            try:
                                raw = path.read_text(encoding="utf-8", errors="ignore")
                            except Exception:
                                continue
                            if any(bp.search(raw) for bp in banned):
                                continue
                            if any(p.search(raw) for p in patterns):
                                matched.append((_summarize(raw), str(path.relative_to(root))))
                                if len(matched) >= 5:
                                    break
                        if len(matched) >= 5:
                            break
                    for summ, spath in matched:
                        if summ:
                            summaries.append(summ)
                            source_paths.append(spath)
            except Exception:
                pass

    # If we found no summaries, avoid making things up
    if not summaries:
        return f"No matching lore found in your campaign notes for: {message.strip()}"

    prompt = message
    if summaries:
        notes = "\n".join(
            s if s.startswith("-") else f"- {s}" for s in summaries
        )
        prompt = (
            f"{message}\n\nRelevant notes (your campaign):\n{notes}\n\n"
            "Use only the relevant notes above. Do not invent facts or use other IP."
        )

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
    event = Event.from_json(data)
    if include_sources and source_paths:
        unique = []
        seen_paths = set()
        for p in source_paths:
            if p not in seen_paths:
                unique.append(p)
                seen_paths.add(p)
        footer = "\n\nSources:\n" + "\n".join(f"- {p}" for p in unique)
        event.narration = (event.narration or "").rstrip() + footer
    return event
